import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';
import { encodeEmail } from '../providers/google/gmail';
import { GOOGLE_SCOPES } from '../providers/google';

function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

describe('gmail encodeEmail — header-injection safe (P1-a)', () => {
  it('throws if a header value contains a line break (defense in depth)', () => {
    expect(() => encodeEmail({ to: 'a@b.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'b' })).toThrow(/line break/);
    expect(() => encodeEmail({ to: 'a@b.com\r\nBcc: evil@x.com', subject: 's', body: 'b' })).toThrow(/line break/);
  });

  it('RFC 2047-encodes a non-ASCII subject and base64-encodes the body', () => {
    const msg = decode(encodeEmail({ to: 'a@b.com', subject: 'Café résumé', body: 'héllo' }));
    expect(msg).toContain('Subject: =?UTF-8?B?');
    expect(msg).toContain('Content-Transfer-Encoding: base64');
    expect(msg).not.toContain('Content-Transfer-Encoding: 7bit');
    expect(msg).toContain(Buffer.from('héllo', 'utf8').toString('base64'));
  });

  it('leaves a plain ASCII subject unencoded', () => {
    const msg = decode(encodeEmail({ to: 'a@b.com', subject: 'Hello there', body: 'b' }));
    expect(msg).toContain('Subject: Hello there');
  });
});

describe('gmail schemas reject injection at validation (P1-a)', () => {
  it('rejects a CRLF in the subject with invalid_input (before any side effect)', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    const out = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com', subject: 'Hi\r\nBcc: evil@x.com', body: 'b' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'invalid_input' });
  });

  it('rejects a recipient that is not an email address', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    const out = await h.runtime.runAction('gmail.send_email', { to: 'not-an-email', subject: 's', body: 'b' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'invalid_input' });
  });

  it('accepts a comma-separated recipient list', async () => {
    const h = makeHarness();
    await h.connect();
    h.setApproval(() => 'allow');
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1' } });
    const out = await h.runtime.runAction('gmail.send_email', { to: 'a@b.com, c@d.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true);
  });
});

describe('gmail scope hierarchy (P2-b / P2-c)', () => {
  it('connecting the full toolkit bundle can create a draft (bundle includes compose)', async () => {
    const h = makeHarness();
    const bundle = h.runtime.getToolkits().find((t) => t.id === 'gmail')?.scopes ?? [];
    expect(bundle).toContain(GOOGLE_SCOPES.gmailCompose); // the union now includes it
    await h.connect({ scopes: bundle });
    h.setApproval(() => 'allow');
    h.env.action = () => ({ json: { id: 'draft1', message: { id: 'm1' } } });
    const out = await h.runtime.runAction('gmail.create_draft', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true); // NOT needs_consent
  });

  it('a connection holding gmail.modify satisfies create_draft (compose) via the hierarchy', async () => {
    const h = makeHarness();
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.gmailModify] });
    h.setApproval(() => 'allow');
    h.env.action = () => ({ json: { id: 'draft1', message: { id: 'm1' } } });
    const out = await h.runtime.runAction('gmail.create_draft', { to: 'a@b.com', subject: 's', body: 'b' });
    expect(out.ok).toBe(true);
  });

  it('a connection holding only calendar.events satisfies event reads (events ⊇ events.readonly)…', async () => {
    const h = makeHarness();
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.calendarEvents] });
    h.env.action = () => ({ json: { items: [] } });
    const out = await h.runtime.runAction('google_calendar.list_events', { calendarId: 'primary' });
    expect(out.ok).toBe(true);
  });

  it('…but calendar.events does NOT satisfy list_calendars (needs calendar.readonly) — stays conservative', async () => {
    const h = makeHarness();
    await h.connect({ scopes: ['openid', 'email', GOOGLE_SCOPES.calendarEvents] });
    const out = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(out).toMatchObject({ ok: false, reason: 'needs_consent' });
    expect((out as { missingScopes: string[] }).missingScopes).toEqual([GOOGLE_SCOPES.calendarReadonly]);
  });
});

describe('gmail.get_message honors format (P3)', () => {
  it('surfaces parsed headers and decoded body when the payload is present', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({
      json: {
        id: 'm1',
        threadId: 't1',
        snippet: 'hi',
        labelIds: ['INBOX'],
        payload: {
          mimeType: 'multipart/alternative',
          headers: [
            { name: 'From', value: 'alice@example.com' },
            { name: 'Subject', value: 'Hello' },
            { name: 'X-Other', value: 'ignored' },
          ],
          parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('body text', 'utf8').toString('base64url') } }],
        },
      },
    });
    const out = await h.runtime.runAction('gmail.get_message', { messageId: 'm1', format: 'full' });
    expect(out.ok).toBe(true);
    const r = (out as { result: { headers?: Record<string, string>; text?: string } }).result;
    expect(r.headers).toMatchObject({ From: 'alice@example.com', Subject: 'Hello' });
    expect(r.headers).not.toHaveProperty('X-Other'); // only the curated set
    expect(r.text).toBe('body text');
  });

  it('returns no headers/text when the response has no payload (minimal)', async () => {
    const h = makeHarness();
    await h.connect();
    h.env.action = () => ({ json: { id: 'm1', threadId: 't1', snippet: 'hi', labelIds: [] } });
    const out = await h.runtime.runAction('gmail.get_message', { messageId: 'm1', format: 'minimal' });
    expect(out.ok).toBe(true);
    const r = (out as { result: Record<string, unknown> }).result;
    expect(r).not.toHaveProperty('headers');
    expect(r).not.toHaveProperty('text');
  });
});
