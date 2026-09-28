import { describe, expect, it } from 'vitest';
import { resolveConnectorFilter } from './workspace-filter';
import type { WorkspaceConnectorScope } from '@/db/types';

/**
 * Workspace scopes → engine projection filters (docs/connectors-workspace-scoping-spec.md §6b):
 * all accounts, a hard pin, an allowed set, and every fail-closed path.
 */

const connections = [
  { id: 'c-personal', ownerId: 'local', providerId: 'google', accountId: 'sub-personal', email: 'personal@gmail.com' },
  { id: 'c-work', ownerId: 'local', providerId: 'google', accountId: 'sub-work', email: 'work@gmail.com' },
  { id: 'c-side', ownerId: 'local', providerId: 'google', accountId: 'sub-side', email: 'side@gmail.com' },
  { id: 'c-work-team', ownerId: 'local', providerId: 'google', accountId: 'sub-work', authConfigId: 'cfg-team', email: 'work@gmail.com' },
  { id: 'c-slack', ownerId: 'local', providerId: 'slack', accountId: 'T1', label: 'acme' },
];

const runtime = {
  getToolkits: () =>
    [
      { id: 'gmail', providerId: 'google' },
      { id: 'google_calendar', providerId: 'google' },
      { id: 'slack', providerId: 'slack' },
      { id: 'linear', providerId: 'linear' },
    ] as never,
  listConnections: async () => connections as never,
  listAccountChoices: async (providerId: string) =>
    connections
      .filter((c) => c.providerId === providerId)
      .map((c) => ({ connectionId: c.id, ...(c.email ? { email: c.email } : {}), ...(c.label ? { label: c.label } : {}) })),
};

const resolve = (scopes: WorkspaceConnectorScope[]) => resolveConnectorFilter(scopes, runtime, 'local');

describe('resolveConnectorFilter', () => {
  it('exposes an all-accounts scope with no pin or set', async () => {
    expect(await resolve([{ toolkitId: 'gmail' }])).toEqual({ toolkits: ['gmail'], connectionPins: {}, allowedAccounts: {} });
  });

  it('resolves one pin to a hard connection pin (legacy `account` rows too)', async () => {
    expect(await resolve([{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-work' }] }])).toEqual({
      toolkits: ['gmail'],
      connectionPins: { gmail: 'c-work' },
      allowedAccounts: {},
    });
    expect(await resolve([{ toolkitId: 'gmail', account: { accountId: 'sub-work', authConfigId: 'cfg-team' } }])).toMatchObject({
      connectionPins: { gmail: 'c-work-team' },
    });
  });

  it('resolves 2+ pins to an allowed set of exactly those accounts', async () => {
    const filter = await resolve([
      { toolkitId: 'gmail', accounts: [{ accountId: 'sub-work' }, { accountId: 'sub-side' }] },
      { toolkitId: 'google_calendar', accounts: [{ accountId: 'sub-personal' }] },
    ]);
    expect(filter.toolkits).toEqual(['gmail', 'google_calendar']);
    expect(filter.connectionPins).toEqual({ google_calendar: 'c-personal' });
    expect(filter.allowedAccounts.gmail!.map((c) => c.connectionId).sort()).toEqual(['c-side', 'c-work']);
  });

  it('a set with one disconnected account collapses to a pin on the live one', async () => {
    const filter = await resolve([{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }, { accountId: 'sub-side' }] }]);
    expect(filter).toEqual({ toolkits: ['gmail'], connectionPins: { gmail: 'c-side' }, allowedAccounts: {} });
  });

  it('fails closed: pins that resolve to nothing hide the toolkit rather than widening it', async () => {
    expect(await resolve([{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }, { accountId: 'sub-gone-2' }] }])).toEqual({
      toolkits: [],
      connectionPins: {},
      allowedAccounts: {},
    });
  });

  it('drops unknown toolkits and toolkits whose provider is disconnected', async () => {
    expect(await resolve([{ toolkitId: 'nope' }, { toolkitId: 'linear', accounts: [{ accountId: 'x' }] }, { toolkitId: 'slack' }])).toEqual({
      toolkits: ['slack'],
      connectionPins: {},
      allowedAccounts: {},
    });
  });

  it('returns nothing for an empty allowlist', async () => {
    expect(await resolve([])).toEqual({ toolkits: [], connectionPins: {}, allowedAccounts: {} });
  });
});
