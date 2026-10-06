import { describe, expect, it } from 'vitest';
import { normalizeIntegrationScopes, pinMatchesConnection, scopePins, toggleAccountPin } from './scope-pins';
import type { WorkspaceIntegrationScope } from '@/db/types';

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

describe('toggleAccountPin (the picker\'s account toggle)', () => {
  const work = { accountId: 'work', authConfigId: null };
  const home = { accountId: 'home', authConfigId: null };
  const workByo = { accountId: 'work', authConfigId: 'cfg' };

  it('from "All accounts", checking one account narrows to just that account', () => {
    expect(toggleAccountPin([], work)).toEqual([{ accountId: 'work' }]);
    expect(toggleAccountPin([], workByo)).toEqual([{ accountId: 'work', authConfigId: 'cfg' }]);
  });

  it('adds an unchecked account to an explicit set, keeping order', () => {
    expect(toggleAccountPin([{ accountId: 'work' }], home)).toEqual([{ accountId: 'work' }, { accountId: 'home' }]);
  });

  it('removes a checked account from an explicit set', () => {
    expect(toggleAccountPin([{ accountId: 'work' }, { accountId: 'home' }], work)).toEqual([{ accountId: 'home' }]);
  });

  it('never empties the set, since no pins would widen to every account', () => {
    const pins = [{ accountId: 'work' }];
    expect(toggleAccountPin(pins, work)).toBe(pins);
  });

  it('treats the same account through another OAuth client as a different account', () => {
    expect(toggleAccountPin([{ accountId: 'work' }], workByo)).toEqual([{ accountId: 'work' }, { accountId: 'work', authConfigId: 'cfg' }]);
    expect(toggleAccountPin([{ accountId: 'work' }, { accountId: 'work', authConfigId: 'cfg' }], workByo)).toEqual([{ accountId: 'work' }]);
  });

  it('leaves a pinned account that is no longer connected alone', () => {
    expect(toggleAccountPin([{ accountId: 'gone' }, { accountId: 'work' }], work)).toEqual([{ accountId: 'gone' }]);
  });
});

describe('normalizeIntegrationScopes (read path)', () => {
  it('rewrites legacy rows into the current shape and passes current rows through', () => {
    const stored: WorkspaceIntegrationScope[] = [
      { toolkitId: 'gmail', account: { accountId: 'a', authConfigId: 'cfg' } },
      { toolkitId: 'slack' },
      { toolkitId: 'google_calendar', accounts: [{ accountId: 'a' }, { accountId: 'b' }] },
    ];
    expect(normalizeIntegrationScopes(stored)).toEqual([
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
    ] as unknown as WorkspaceIntegrationScope[];
    expect(normalizeIntegrationScopes(corrupt)).toEqual([{ toolkitId: 'google_calendar', accounts: [{ accountId: 'ok' }] }]);
  });

  it('fails closed: an accounts value that is not a list is dropped, never read as all accounts', () => {
    const corrupt = [
      { toolkitId: 'gmail', accounts: { accountId: 'work' } },
      { toolkitId: 'slack', accounts: 'work' },
      { toolkitId: 'notion', accounts: 7 },
      // Null and an empty list do mean every account.
      { toolkitId: 'google_calendar', accounts: null },
      { toolkitId: 'google_drive', accounts: [] },
    ] as unknown as WorkspaceIntegrationScope[];
    expect(normalizeIntegrationScopes(corrupt)).toEqual([{ toolkitId: 'google_calendar' }, { toolkitId: 'google_drive' }]);
  });

  it('tolerates a missing column value', () => {
    expect(normalizeIntegrationScopes(null)).toEqual([]);
    expect(normalizeIntegrationScopes(undefined)).toEqual([]);
  });
});
