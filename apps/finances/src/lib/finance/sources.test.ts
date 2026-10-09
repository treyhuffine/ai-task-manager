import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { getRawDb } from '@/lib/db';
import {
  collectPlaidSync,
  FinanceSourceError,
  normalizePlaidTransaction,
} from './sources';
import {
  decodeGmailReceipt,
  receiptHtmlText,
  syncFinanceMailbox,
} from './mail';
import { verifyPlaidWebhook } from './webhooks';
const { call } = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('./sources', async (original) => ({
  ...(await original<typeof import('./sources')>()),
  financeSourceCall: call,
}));
let home: TestHome;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-finance-sources-' });
  q.configureFinance(q.financeOwner, { enabled: true });
  call.mockReset();
});
afterEach(async () => home.cleanup());
const providerTx = (id: string, account = 'selected') => ({
  transaction_id: id,
  account_id: account,
  amount: 19.99,
  iso_currency_code: 'USD',
  date: '2026-10-06',
  name: 'Fictional shop',
  pending: false,
});
describe('provider lifecycle', () => {
  it('persists per-folder Outlook catch-up for Inbox, Archive and nested folders', async () => {
    const account = q.createFinanceAccount(q.financeOwner, {
      name: 'Fictional folder mailbox',
      kind: 'mailbox',
      provider: 'microsoft',
      currency: 'USD',
      connectionId: 'fake',
      sourceId: 'folders',
      balanceMinor: null,
      balanceIncludesPending: false,
      historyStart: null,
      asOf: null,
    });
    q.bindFinanceMailbox(q.financeOwner, {
      accountId: account.id,
      initialStartOn: '2026-01-01',
      query: '',
      monitoring: true,
    });
    const generation = q.getFinanceSettings()!.generation;
    call
      .mockResolvedValueOnce({
        value: [
          { id: 'inbox', childFolderCount: 0 },
          { id: 'archive', childFolderCount: 1 },
        ],
      })
      .mockResolvedValueOnce({
        value: [{ id: 'receipts', childFolderCount: 0 }],
      })
      .mockResolvedValueOnce({ value: [], '@odata.nextLink': 'inbox-page2' });
    const first = await syncFinanceMailbox(q.financeOwner, {
      accountId: account.id,
      generation,
      cursor: null,
    });
    expect(
      JSON.parse(first.cursor!).folders.map((f: { id: string }) => f.id),
    ).toEqual(['inbox', 'archive', 'receipts']);
    expect(JSON.parse(first.cursor!).index).toBe(0);
    call.mockResolvedValueOnce({
      value: [],
      '@odata.deltaLink': 'inbox-delta',
    });
    const second = await syncFinanceMailbox(q.financeOwner, {
      accountId: account.id,
      generation,
      cursor: first.cursor,
    });
    expect(call.mock.calls.at(-1)![2]).toMatchObject({
      mode: 'delta',
      folderId: 'inbox',
      cursor: 'inbox-page2',
    });
    call.mockResolvedValueOnce({
      value: [],
      '@odata.deltaLink': 'archive-delta',
    });
    const third = await syncFinanceMailbox(q.financeOwner, {
      accountId: account.id,
      generation,
      cursor: second.cursor,
    });
    expect(call.mock.calls.at(-1)![2]).toMatchObject({
      mode: 'delta',
      folderId: 'archive',
    });
    call.mockResolvedValueOnce({
      value: [],
      '@odata.deltaLink': 'receipts-delta',
    });
    const complete = await syncFinanceMailbox(q.financeOwner, {
      accountId: account.id,
      generation,
      cursor: third.cursor,
    });
    expect(complete.hasMore).toBe(false);
    expect(JSON.parse(complete.cursor!).index).toBe(0);
    call.mockResolvedValueOnce({
      value: [],
      '@odata.deltaLink': 'inbox-caught-up',
    });
    await syncFinanceMailbox(q.financeOwner, {
      accountId: account.id,
      generation,
      cursor: complete.cursor,
    });
    expect(call.mock.calls.at(-1)![2]).toMatchObject({
      mode: 'delta',
      folderId: 'inbox',
      cursor: 'inbox-delta',
    });
  });
  it('restarts from the initial cursor after pagination mutation and discards the interrupted pages', async () => {
    const seen: (string | null)[] = [];
    let n = 0;
    const batch = await collectPlaidSync(
      async (cursor) => {
        seen.push(cursor);
        n++;
        if (n === 2)
          throw new FinanceSourceError(
            'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION',
            'changed',
          );
        return {
          added: [providerTx(n === 1 ? 'discarded' : 'kept')],
          modified: [],
          removed: [],
          next_cursor: n === 1 ? 'middle' : 'final',
          has_more: n === 1,
        };
      },
      'initial',
      new Map([['selected', 'local']]),
    );
    expect(seen).toEqual(['initial', 'middle', 'initial']);
    expect(batch.cursor).toBe('final');
    expect(batch.added).toHaveLength(1);
    expect(batch.added[0]).toMatchObject({
      sourceId: 'kept',
      amountMinor: 1999,
    });
  });
  it('returns no batch or advanced cursor when a later page fails', async () => {
    let n = 0;
    await expect(
      collectPlaidSync(
        async () => {
          if (++n === 2) throw new Error('offline');
          return {
            added: [providerTx('first')],
            modified: [],
            removed: [],
            next_cursor: 'middle',
            has_more: true,
          };
        },
        null,
        new Map([['selected', 'local']]),
      ),
    ).rejects.toThrow('offline');
  });
  it('excludes unselected accounts and recognizes payments without turning them into purchases', () => {
    expect(
      normalizePlaidTransaction(
        providerTx('x', 'other'),
        new Map([['selected', 'local']]),
      ),
    ).toBeNull();
    expect(
      normalizePlaidTransaction(
        {
          ...providerTx('payment'),
          personal_finance_category: {
            primary: 'LOAN_PAYMENTS',
            detailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
          },
        },
        new Map([['selected', 'local']]),
      ),
    ).toMatchObject({ kind: 'card_payment', category: 'transfer' });
  });
  it('decodes HTML-only receipts without running scripts, fetching images, or losing the attachment reference', () => {
    const text = receiptHtmlText(
      '<script>steal()</script><h1>Invoice &amp; receipt</h1><img src="http://evil">Total &#36;19.99',
    );
    expect(text).toContain('Total $19.99');
    expect(text).not.toContain('steal');
    expect(text).not.toContain('http');
    const result = decodeGmailReceipt({
      id: 'message',
      internalDate: String(Date.parse('2026-10-06')),
      payload: {
        headers: [
          { name: 'Subject', value: 'Receipt' },
          { name: 'Message-ID', value: 'stable' },
        ],
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<b>Receipt</b>').toString('base64url') },
          },
          {
            mimeType: 'application/pdf',
            filename: 'Invoice.pdf',
            body: { attachmentId: 'attachment', size: 20 },
          },
        ],
      },
    });
    expect(result).toMatchObject({ text: 'Receipt', messageId: 'stable' });
    expect(result.attachments).toHaveLength(1);
  });
  it('catches up Gmail from its initial anchor and restarts an expired history cursor', async () => {
    const a = q.createFinanceAccount(q.financeOwner, {
      name: 'Fictional Gmail',
      kind: 'mailbox',
      provider: 'google',
      currency: 'USD',
      connectionId: 'fake',
      sourceId: 'fake',
      balanceMinor: null,
      balanceIncludesPending: false,
      historyStart: null,
      asOf: null,
    });
    q.bindFinanceMailbox(q.financeOwner, {
      accountId: a.id,
      initialStartOn: '2026-01-01',
      query: '',
      monitoring: true,
    });
    const generation = q.getFinanceSettings()!.generation;
    call
      .mockResolvedValueOnce({ historyId: 'anchor' })
      .mockResolvedValueOnce({ messages: [], nextPageToken: 'page2' });
    const first = await syncFinanceMailbox(q.financeOwner, {
      accountId: a.id,
      generation,
      cursor: null,
    });
    expect(JSON.parse(first.cursor!)).toEqual({
      phase: 'initial',
      historyId: 'anchor',
      pageToken: 'page2',
    });
    call.mockResolvedValueOnce({ messages: [] });
    const second = await syncFinanceMailbox(q.financeOwner, {
      accountId: a.id,
      generation,
      cursor: first.cursor,
    });
    expect(JSON.parse(second.cursor!)).toEqual({
      phase: 'history',
      historyId: 'anchor',
    });
    call
      .mockRejectedValueOnce(
        new FinanceSourceError('provider_error', '404 expired'),
      )
      .mockResolvedValueOnce({ historyId: 'new-anchor' });
    const reset = await syncFinanceMailbox(q.financeOwner, {
      accountId: a.id,
      generation,
      cursor: second.cursor,
    });
    expect(JSON.parse(reset.cursor!)).toEqual({
      phase: 'initial',
      historyId: 'new-anchor',
    });
    expect(reset.hasMore).toBe(true);
  });
  it('resets an expired Outlook delta without saving an invalid URL and keeps generation fencing', async () => {
    const a = q.createFinanceAccount(q.financeOwner, {
      name: 'Fictional Outlook',
      kind: 'mailbox',
      provider: 'microsoft',
      currency: 'USD',
      connectionId: 'fake',
      sourceId: 'outlook',
      balanceMinor: null,
      balanceIncludesPending: false,
      historyStart: null,
      asOf: null,
    });
    q.bindFinanceMailbox(q.financeOwner, {
      accountId: a.id,
      initialStartOn: '2026-01-01',
      query: '',
      monitoring: true,
    });
    const generation = q.getFinanceSettings()!.generation;
    call.mockRejectedValueOnce(
      new FinanceSourceError('provider_error', '410 Gone'),
    );
    const reset = await syncFinanceMailbox(q.financeOwner, {
      accountId: a.id,
      generation,
      cursor: 'expired',
    });
    expect(reset.hasMore).toBe(true);
    expect(JSON.parse(reset.cursor!).folders).toEqual([
      { id: 'inbox', cursor: null },
    ]);
    call.mockImplementationOnce(async () => {
      q.configureFinance(q.financeOwner, { enabled: false });
      return { value: [], '@odata.deltaLink': 'next' };
    });
    await expect(
      syncFinanceMailbox(q.financeOwner, {
        accountId: a.id,
        generation,
        cursor: JSON.stringify({
          version: 1,
          folders: [{ id: 'inbox', cursor: 'prior' }],
          index: 0,
          discoveredAt: Date.now(),
        }),
      }),
    ).rejects.toThrow('generation');
    expect(
      getRawDb().prepare('SELECT count(*) AS n FROM finance_evidence').get(),
    ).toEqual({ n: 0 });
  });
});
describe('Plaid webhook authentication', () => {
  it('verifies the exact body, signature algorithm and short timestamp window', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
        namedCurve: 'P-256',
      }),
      body = Buffer.from('{"item_id":"fictional"}'),
      now = Date.now();
    const jwt = (iat: number, alg = 'ES256') => {
      const head = Buffer.from(JSON.stringify({ alg, kid: 'key' })).toString(
          'base64url',
        ),
        claims = Buffer.from(
          JSON.stringify({
            iat,
            request_body_sha256: createHash('sha256')
              .update(body)
              .digest('hex'),
          }),
        ).toString('base64url');
      return (
        head +
        '.' +
        claims +
        '.' +
        sign('sha256', Buffer.from(head + '.' + claims), {
          key: privateKey,
          dsaEncoding: 'ieee-p1363',
        }).toString('base64url')
      );
    };
    const key = publicKey.export({ format: 'jwk' });
    expect(
      verifyPlaidWebhook(jwt(Math.floor(now / 1000)), body, key, now),
    ).toBe('key');
    expect(() =>
      verifyPlaidWebhook(jwt(Math.floor(now / 1000) - 301), body, key, now),
    ).toThrow('expired');
    expect(() =>
      verifyPlaidWebhook(
        jwt(Math.floor(now / 1000)),
        Buffer.from('different'),
        key,
        now,
      ),
    ).toThrow('body mismatch');
    expect(() =>
      verifyPlaidWebhook(jwt(Math.floor(now / 1000), 'none'), body, key, now),
    ).toThrow();
  });
});
