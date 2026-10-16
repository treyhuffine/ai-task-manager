import { describe, expect, it } from 'vitest';
import { accountsNeedingYou } from './attention';

type Connection = Parameters<typeof accountsNeedingYou>[0][number];
type Server = Parameters<typeof accountsNeedingYou>[1][number];

const connection = (over: Partial<Connection> & { id: string; providerId: string }): Connection => ({
  accountId: over.id, status: 'active', ...over,
});
const server = (over: Partial<Server> & { id: string; slug: string }): Server => ({
  displayName: over.slug, enabled: true, lastStatus: 'ok', ...over,
});
const managed = (applicationId: string) => ({ managed: true, sourceId: 'source', remoteAccountId: 'remote', applicationId });

describe('accountsNeedingYou', () => {
  it('is empty while every account works', () => {
    expect(accountsNeedingYou(
      [connection({ id: 'g', providerId: 'google' }), connection({ id: 'mcp-todoist', providerId: 'todoist' })],
      [server({ id: 'todoist', slug: 'todoist', providerId: 'todoist', displayName: 'Todoist' })],
    )).toEqual([]);
  });

  it('names a signed-out account by its service and identity, and where to fix it', () => {
    expect(accountsNeedingYou([
      connection({ id: 'g', providerId: 'google', label: 'Work', email: 'me@work.test', status: 'needs_reauth' }),
      connection({ id: 'm', providerId: 'composio_gmail', email: 'me@home.test', status: 'needs_reauth', config: managed('gmail') }),
    ], [])).toEqual([
      { key: 'm', name: 'Gmail', account: 'me@home.test', target: { kind: 'application', id: 'gmail' } },
      { key: 'g', name: 'Google', account: 'Work', target: { kind: 'provider', id: 'google' } },
    ]);
  });

  it('counts an official server once per account, with its label only when it tells accounts apart', () => {
    const servers = [
      server({ id: 'first', slug: 'builtin_todoist', providerId: 'todoist', displayName: 'Todoist', connectionId: 'hosted-1' }),
      server({ id: 'second', slug: 'builtin_todoist_2', providerId: 'todoist', displayName: 'Todoist 2', connectionId: 'hosted-2', lastStatus: 'error' }),
    ];
    expect(accountsNeedingYou([
      connection({ id: 'hosted-1', providerId: 'todoist', status: 'needs_reauth' }),
      connection({ id: 'hosted-2', providerId: 'todoist', status: 'needs_reauth' }),
    ], servers)).toEqual([
      { key: 'first', name: 'Todoist', account: undefined, target: { kind: 'provider', id: 'todoist' } },
      { key: 'second', name: 'Todoist', account: 'Todoist 2', target: { kind: 'provider', id: 'todoist' } },
    ]);
  });

  it('counts a custom server whose key was rejected, once, by its own name', () => {
    const receipts = server({ id: 'receipts', slug: 'receipts', displayName: 'Receipts', lastStatus: 'error' });
    const expected = [{ key: 'receipts', name: 'Receipts', target: { kind: 'server', id: 'receipts' } }];
    expect(accountsNeedingYou([], [receipts])).toEqual(expected);
    expect(accountsNeedingYou([connection({ id: 'mcp-receipts', providerId: 'mcp_receipts', status: 'needs_reauth' })], [receipts])).toEqual(expected);
  });

  it('leaves out what is turned off, and a server that is only unreachable', () => {
    expect(accountsNeedingYou(
      [connection({ id: 'hosted-off', providerId: 'notion', status: 'needs_reauth' })],
      [
        server({ id: 'notion', slug: 'builtin_notion', providerId: 'notion', connectionId: 'hosted-off', enabled: false }),
        server({ id: 'off', slug: 'off', enabled: false, lastStatus: 'error' }),
        server({ id: 'down', slug: 'down', lastStatus: 'unreachable' }),
      ],
    )).toEqual([]);
  });

  it('still names an account whose service Ri no longer lists', () => {
    expect(accountsNeedingYou([connection({ id: 'old', providerId: 'retired_service', status: 'needs_reauth' })], []))
      .toEqual([{ key: 'old', name: 'retired_service', account: undefined, target: { kind: 'provider', id: 'retired_service' } }]);
  });
});
