import { describe, expect, it } from 'vitest';
import { normalizeConnectorScopes, pinMatchesConnection, scopePins } from './scope-pins';
import type { WorkspaceConnectorScope } from '@/db/types';

describe('scopePins', () => {
  it('is empty for an all-accounts scope', () => {
    expect(scopePins({ toolkitId: 'gmail' })).toEqual([]);
    expect(scopePins({ toolkitId: 'gmail', accounts: [] })).toEqual([]);
  });

  it('reads the current set and the legacy single pin, deduped', () => {
    expect(
      scopePins({
        toolkitId: 'gmail',
        accounts: [{ accountId: 'a' }, { accountId: 'b', authConfigId: 'cfg' }],
        account: { accountId: 'a' },
      }),
    ).toEqual([{ accountId: 'a' }, { accountId: 'b', authConfigId: 'cfg' }]);
    expect(scopePins({ toolkitId: 'gmail', account: { accountId: 'a' } })).toEqual([{ accountId: 'a' }]);
  });
});

describe('pinMatchesConnection', () => {
  it('matches on accountId AND authConfigId (undefined and null both mean the default client)', () => {
    expect(pinMatchesConnection({ accountId: 'a' }, { accountId: 'a', authConfigId: null })).toBe(true);
    expect(pinMatchesConnection({ accountId: 'a' }, { accountId: 'a', authConfigId: 'cfg' })).toBe(false);
    expect(pinMatchesConnection({ accountId: 'a', authConfigId: 'cfg' }, { accountId: 'a', authConfigId: 'cfg' })).toBe(true);
    expect(pinMatchesConnection({ accountId: 'a' }, { accountId: 'b' })).toBe(false);
  });
});

describe('normalizeConnectorScopes (read path)', () => {
  it('rewrites legacy rows into the current shape and passes current rows through', () => {
    const stored: WorkspaceConnectorScope[] = [
      { toolkitId: 'gmail', account: { accountId: 'a', authConfigId: 'cfg' } },
      { toolkitId: 'slack' },
      { toolkitId: 'google_calendar', accounts: [{ accountId: 'a' }, { accountId: 'b' }] },
    ];
    expect(normalizeConnectorScopes(stored)).toEqual([
      { toolkitId: 'gmail', accounts: [{ accountId: 'a', authConfigId: 'cfg' }] },
      { toolkitId: 'slack' },
      { toolkitId: 'google_calendar', accounts: [{ accountId: 'a' }, { accountId: 'b' }] },
    ]);
  });

  it('fails closed: a scope whose declared pins are all malformed is dropped, never widened', () => {
    const corrupt = [
      { toolkitId: 'gmail', accounts: [{ accountId: '' }] },
      { toolkitId: 'slack', account: { nope: true } },
      { toolkitId: 'google_calendar', accounts: [{ accountId: 'ok' }, { accountId: 7 }] },
      { toolkitId: '' },
    ] as unknown as WorkspaceConnectorScope[];
    expect(normalizeConnectorScopes(corrupt)).toEqual([{ toolkitId: 'google_calendar', accounts: [{ accountId: 'ok' }] }]);
  });

  it('fails closed: an accounts value that is not a list is dropped, never read as all accounts', () => {
    const corrupt = [
      { toolkitId: 'gmail', accounts: { accountId: 'work' } },
      { toolkitId: 'slack', accounts: 'work' },
      { toolkitId: 'notion', accounts: 7 },
      // Null and an empty list do mean every account.
      { toolkitId: 'google_calendar', accounts: null },
      { toolkitId: 'google_drive', accounts: [] },
    ] as unknown as WorkspaceConnectorScope[];
    expect(normalizeConnectorScopes(corrupt)).toEqual([{ toolkitId: 'google_calendar' }, { toolkitId: 'google_drive' }]);
  });

  it('tolerates a missing column value', () => {
    expect(normalizeConnectorScopes(null)).toEqual([]);
    expect(normalizeConnectorScopes(undefined)).toEqual([]);
  });
});
