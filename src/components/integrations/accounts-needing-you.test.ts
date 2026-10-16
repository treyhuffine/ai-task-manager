import { describe, expect, it } from 'vitest';
import type { AccountNeedingYou } from '@/lib/integrations/attention';
import { connectAccountsAnchor, reconnectLabel } from './accounts-needing-you';

const account = (name: string, target: AccountNeedingYou['target'], extra: Partial<AccountNeedingYou> = {}): AccountNeedingYou => ({
  key: `${target.kind}:${target.id}:${extra.account ?? ''}`, name, target, ...extra,
});
const google = (label: string) => account('Google', { kind: 'provider', id: 'google' }, { account: label });
const gmail = account('Gmail', { kind: 'application', id: 'gmail' });
const receipts = account('Receipts', { kind: 'server', id: 'receipts' });
const docs = account('Docs', { kind: 'server', id: 'docs' });

describe('connectAccountsAnchor', () => {
  it('opens the Connectors list while nothing needs you', () => {
    expect(connectAccountsAnchor([])).toBe('integrations');
  });

  it('goes straight to the one page that fixes every account', () => {
    expect(connectAccountsAnchor([google('Work'), google('Home')])).toBe('integrations:google');
    expect(connectAccountsAnchor([gmail])).toBe('integrations:app:gmail');
    expect(connectAccountsAnchor([receipts])).toBe('mcp:receipts');
  });

  it('opens the list that marks each, when they live on different pages', () => {
    expect(connectAccountsAnchor([google('Work'), gmail])).toBe('integrations');
    expect(connectAccountsAnchor([gmail, receipts])).toBe('integrations');
    expect(connectAccountsAnchor([receipts, docs])).toBe('mcp');
  });
});

describe('reconnectLabel', () => {
  it('says nothing while nothing needs you', () => {
    expect(reconnectLabel([])).toBeUndefined();
  });

  it('names every account, with the identity that tells them apart', () => {
    expect(reconnectLabel([gmail])).toBe('Reconnect Gmail');
    expect(reconnectLabel([google('Work'), receipts])).toBe('Reconnect Google (Work) and Receipts');
    expect(reconnectLabel([gmail, google('Work'), receipts])).toBe('Reconnect Gmail, Google (Work) and Receipts');
  });
});
