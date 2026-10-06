import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceIntegrationScope } from '@/db/types';

/**
 * Integration scope parsing + validation (docs/integrations-workspace-scoping-spec.md §4, §6e). The
 * integration runtime is faked: three Gmail accounts (one of them connected through a second OAuth
 * client, so its email is shared), one Slack account, and a Linear toolkit whose provider is not
 * connected.
 */

interface FakeConn {
  id: string;
  providerId: string;
  accountId: string;
  authConfigId?: string;
  email?: string;
  label?: string;
}

const fake = vi.hoisted(() => ({
  connections: [] as FakeConn[],
  authConfigLabels: {} as Record<string, string>,
}));

vi.mock('./runtime', () => ({
  getIntegrationOwnerId: () => 'local',
  getIntegrationRuntime: async () => ({
    getToolkits: () => [
      { id: 'gmail', providerId: 'google', displayName: 'Gmail' },
      { id: 'google_calendar', providerId: 'google', displayName: 'Google Calendar' },
      { id: 'slack', providerId: 'slack', displayName: 'Slack' },
      { id: 'linear', providerId: 'linear', displayName: 'Linear' },
    ],
    listConnections: async () => fake.connections,
    listAccountChoices: async (providerId: string) =>
      fake.connections
        .filter((c) => c.providerId === providerId)
        .map((c) => ({
          connectionId: c.id,
          ...(c.email ? { email: c.email } : {}),
          ...(c.label ? { label: c.label } : {}),
          ...(c.authConfigId && fake.authConfigLabels[c.authConfigId] ? { authConfigLabel: fake.authConfigLabels[c.authConfigId] } : {}),
        })),
  }),
}));

const { parseIntegrationScopes, validateIntegrationScopes } = await import('./scopes');

beforeEach(() => {
  fake.connections = [
    { id: 'c-personal', providerId: 'google', accountId: 'sub-personal', email: 'personal@gmail.com' },
    { id: 'c-work', providerId: 'google', accountId: 'sub-work', email: 'work@gmail.com', label: 'Work' },
    { id: 'c-work-2', providerId: 'google', accountId: 'sub-work', email: 'work@gmail.com', authConfigId: 'cfg-team' },
    { id: 'c-slack', providerId: 'slack', accountId: 'T123', label: 'acme' },
  ];
  fake.authConfigLabels = { 'cfg-team': 'Team' };
});

describe('parseIntegrationScopes', () => {
  it('rejects non-array payloads', () => {
    expect(parseIntegrationScopes(null)).toBeNull();
    expect(parseIntegrationScopes(undefined)).toBeNull();
    expect(parseIntegrationScopes({})).toBeNull();
    expect(parseIntegrationScopes('gmail')).toBeNull();
  });

  it('rejects entries without a string toolkitId', () => {
    expect(parseIntegrationScopes([{ accounts: [{ accountId: 'a' }] }])).toBeNull();
    expect(parseIntegrationScopes([{ toolkitId: 42 }])).toBeNull();
    expect(parseIntegrationScopes([{ toolkitId: '' }])).toBeNull();
    expect(parseIntegrationScopes([null])).toBeNull();
  });

  it('keeps a bare toolkit scope (all accounts), and treats an empty or null account list the same', () => {
    expect(parseIntegrationScopes([{ toolkitId: 'gmail' }])).toEqual([{ toolkitId: 'gmail' }]);
    expect(parseIntegrationScopes([{ toolkitId: 'gmail', accounts: [] }])).toEqual([{ toolkitId: 'gmail' }]);
    expect(parseIntegrationScopes([{ toolkitId: 'gmail', accounts: null, account: null }])).toEqual([{ toolkitId: 'gmail' }]);
  });

  it('keeps a set of pins, with and without authConfigId', () => {
    expect(
      parseIntegrationScopes([
        { toolkitId: 'gmail', accounts: [{ accountId: 'a' }, { accountId: 'b', authConfigId: 'cfg_1' }] },
      ]),
    ).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'a' }, { accountId: 'b', authConfigId: 'cfg_1' }] }]);
  });

  it('keeps identifier strings (trimmed) for validation to resolve', () => {
    expect(parseIntegrationScopes([{ toolkitId: 'gmail', accounts: [' work@gmail.com ', 'personal@gmail.com'] }])).toEqual([
      { toolkitId: 'gmail', accounts: ['work@gmail.com', 'personal@gmail.com'] },
    ]);
  });

  it('folds the legacy single `account` (pin or identifier) into `accounts`', () => {
    expect(parseIntegrationScopes([{ toolkitId: 'gmail', account: { accountId: 'me', authConfigId: 'cfg_1' } }])).toEqual([
      { toolkitId: 'gmail', accounts: [{ accountId: 'me', authConfigId: 'cfg_1' }] },
    ]);
    // The string form update_workspace used to send, which the old parser silently dropped.
    expect(parseIntegrationScopes([{ toolkitId: 'gmail', account: 'me@x.com' }])).toEqual([
      { toolkitId: 'gmail', accounts: ['me@x.com'] },
    ]);
    expect(
      parseIntegrationScopes([{ toolkitId: 'gmail', accounts: [{ accountId: 'a' }], account: { accountId: 'b' } }]),
    ).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'a' }, { accountId: 'b' }] }]);
  });

  it('dedupes repeated pins and identifiers, and treats a null authConfigId as the default client', () => {
    expect(
      parseIntegrationScopes([
        {
          toolkitId: 'gmail',
          accounts: [{ accountId: 'a' }, { accountId: 'a', authConfigId: null }, 'x@y.com', 'x@y.com'],
          account: { accountId: 'a' },
        },
      ]),
    ).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'a' }, 'x@y.com'] }]);
  });

  it('rejects a malformed account instead of widening the scope to every account', () => {
    for (const bad of [
      { toolkitId: 'gmail', account: { authConfigId: 'cfg_1' } },
      { toolkitId: 'gmail', account: { accountId: '' } },
      { toolkitId: 'gmail', account: 42 },
      { toolkitId: 'gmail', accounts: 'me@x.com' },
      { toolkitId: 'gmail', accounts: [{ accountId: 'a' }, ''] },
      { toolkitId: 'gmail', accounts: [{ accountId: 'a', authConfigId: 99 }] },
      { toolkitId: 'gmail', accounts: [null] },
    ]) {
      expect(parseIntegrationScopes([bad])).toBeNull();
    }
  });

  it('strips unknown fields', () => {
    expect(
      parseIntegrationScopes([{ toolkitId: 'gmail', accounts: [{ accountId: 'a', extra: 1 }], extra: 'x' }]),
    ).toEqual([{ toolkitId: 'gmail', accounts: [{ accountId: 'a' }] }]);
  });
});

describe('validateIntegrationScopes', () => {
  const validate = async (raw: unknown, stored?: WorkspaceIntegrationScope[]) =>
    validateIntegrationScopes(parseIntegrationScopes(raw)!, stored ? { stored } : {});

  it('stores a multi-account set as exact pins', async () => {
    const res = await validate([
      { toolkitId: 'gmail', accounts: [{ accountId: 'sub-personal' }, { accountId: 'sub-work', authConfigId: 'cfg-team' }] },
    ]);
    expect(res).toEqual({
      ok: true,
      scopes: [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-personal' }, { accountId: 'sub-work', authConfigId: 'cfg-team' }] }],
    });
  });

  it('resolves identifiers (email, label, account id, "email (Client)" form) to pins, case-insensitively', async () => {
    const res = await validate([
      { toolkitId: 'gmail', accounts: ['PERSONAL@gmail.com', 'work', 'work@gmail.com (Team)'] },
      { toolkitId: 'slack', accounts: ['T123'] },
    ]);
    expect(res).toEqual({
      ok: true,
      scopes: [
        {
          toolkitId: 'gmail',
          accounts: [{ accountId: 'sub-personal' }, { accountId: 'sub-work' }, { accountId: 'sub-work', authConfigId: 'cfg-team' }],
        },
        { toolkitId: 'slack', accounts: [{ accountId: 'T123' }] },
      ],
    });
  });

  it('writes the new shape for a legacy single `account` pin', async () => {
    const res = await validate([{ toolkitId: 'gmail', account: { accountId: 'sub-personal' } }]);
    expect(res).toEqual({ ok: true, scopes: [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-personal' }] }] });
  });

  it('keeps picking every account as an explicit set (a later account is not granted)', async () => {
    const res = await validate([{ toolkitId: 'slack', accounts: [{ accountId: 'T123' }] }]);
    expect(res).toEqual({ ok: true, scopes: [{ toolkitId: 'slack', accounts: [{ accountId: 'T123' }] }] });
  });

  it('rejects an identifier that matches no connected account, listing the connected ones', async () => {
    const res = await validate([{ toolkitId: 'gmail', accounts: ['nobody@gmail.com'] }]);
    expect(res.ok).toBe(false);
    const error = (res as { error: string }).error;
    expect(error).toContain('no connected Gmail account matches "nobody@gmail.com"');
    expect(error).toContain('"personal@gmail.com"');
    expect(error).toContain('"work@gmail.com (Team)"');
  });

  it('rejects an identifier that matches more than one account, naming the exact values to use', async () => {
    const res = await validate([{ toolkitId: 'gmail', accounts: ['work@gmail.com'] }]);
    expect(res.ok).toBe(false);
    const error = (res as { error: string }).error;
    expect(error).toContain('"work@gmail.com" matches more than one connected Gmail account');
    expect(error).toContain('"work@gmail.com (Team)"');
  });

  it('rejects a new pin that matches no connection of a connected provider', async () => {
    const res = await validate([{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }] }]);
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('does not resolve to a unique connected account') });
  });

  it('keeps a stored pin whose account was disconnected (dormant), next to live ones', async () => {
    const stored = [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }, { accountId: 'sub-personal' }] }];
    const res = await validate([{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }, { accountId: 'sub-personal' }] }], stored);
    expect(res).toEqual({ ok: true, scopes: stored });
    // …including a legacy stored row.
    const legacy = await validate([{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }] }], [
      { toolkitId: 'gmail', account: { accountId: 'sub-gone' } },
    ]);
    expect(legacy).toEqual({ ok: true, scopes: [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-gone' }] }] });
  });

  it('keeps pins for a disconnected provider as dormant, and resolves an identifier naming a stored one', async () => {
    const stored = [{ toolkitId: 'linear', accounts: [{ accountId: 'lin-1' }] }];
    expect(await validate([{ toolkitId: 'linear', accounts: [{ accountId: 'lin-1' }, { accountId: 'lin-2' }] }], stored)).toEqual({
      ok: true,
      scopes: [{ toolkitId: 'linear', accounts: [{ accountId: 'lin-1' }, { accountId: 'lin-2' }] }],
    });
    expect(await validate([{ toolkitId: 'linear', accounts: ['lin-1'] }], stored)).toEqual({ ok: true, scopes: stored });
    const res = await validate([{ toolkitId: 'linear', accounts: ['me@linear.app'] }], stored);
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('no Linear account is connected') });
  });

  it('rejects unknown toolkit ids but keeps stored-unregistered ones', async () => {
    expect(await validate([{ toolkitId: 'nope' }])).toEqual({ ok: false, error: 'unknown connector service(s): nope' });
    expect(await validate([{ toolkitId: 'mcp_gone', accounts: [{ accountId: 'x' }] }], [{ toolkitId: 'mcp_gone' }])).toEqual({
      ok: true,
      scopes: [{ toolkitId: 'mcp_gone', accounts: [{ accountId: 'x' }] }],
    });
  });

  it('dedupes by toolkit (last wins) and pins that resolve to the same account', async () => {
    const res = await validate([
      { toolkitId: 'gmail', accounts: ['personal@gmail.com'] },
      { toolkitId: 'gmail', accounts: ['personal@gmail.com', { accountId: 'sub-personal' }, 'work'] },
    ]);
    expect(res).toEqual({
      ok: true,
      scopes: [{ toolkitId: 'gmail', accounts: [{ accountId: 'sub-personal' }, { accountId: 'sub-work' }] }],
    });
  });
});
