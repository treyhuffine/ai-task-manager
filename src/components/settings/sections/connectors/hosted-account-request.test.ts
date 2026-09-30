import { describe, expect, it } from 'vitest';
import { hostedAccountRequestFields, hostedAccountSignedIn, providerForHostedAccount } from './hosted-account-request';
import type { HostedConnectIntent, ProviderStatus } from './types';

const options = [{ id: 'us', label: 'United States' }, { id: 'eu', label: 'Europe' }];
const provider: ProviderStatus = {
  id: 'fixture', displayName: 'Service', method: 'mcp', configured: true,
  mcp: {
    requiresAuth: false, oauthRegistration: 'registered', authConfigId: 'app-a', serverId: 'server-a',
    endpointConfig: { kind: 'region', label: 'Region', options, selectedId: 'us', locked: true },
    accounts: [
      { serverId: 'server-a', connectionId: 'connection-a', requiresAuth: false, configured: true, authConfigId: 'app-a', endpointConfig: { kind: 'region', label: 'Region', options, selectedId: 'us', locked: true } },
      { serverId: 'server-b', connectionId: 'connection-b', requiresAuth: true, configured: false, authConfigId: 'app-b', endpointConfig: { kind: 'region', label: 'Region', options, selectedId: 'eu', locked: true } },
    ],
  },
};

describe('hosted account request isolation', () => {
  it('reconnects the selected account with its pinned client and region', () => {
    const intent: HostedConnectIntent = { serverId: 'server-b', existingConnectionId: 'connection-b', label: 'Europe team' };
    expect(providerForHostedAccount(provider, intent).configured).toBe(false);
    expect(hostedAccountRequestFields(provider, intent, 'app-a', { endpointId: 'us' })).toEqual({
      serverId: 'server-b', existingConnectionId: 'connection-b', label: 'Europe team', authConfigId: 'app-b', endpointId: 'eu',
    });
  });

  it('never inherits the first account client or endpoint when adding an account', () => {
    const intent: HostedConnectIntent = { addAccount: true, setupId: 'stable-setup', label: 'New team', endpointId: 'eu' };
    const scoped = providerForHostedAccount(provider, intent);
    expect(scoped.configured).toBe(true);
    expect(scoped.mcp?.authConfigId).toBeUndefined();
    expect(scoped.mcp?.serverId).toBeUndefined();
    expect(scoped.mcp?.endpointConfig).toEqual({ kind: 'region', label: 'Region', options, locked: false });
    expect(hostedAccountRequestFields(provider, intent, 'new-app')).toEqual({ addAccount: true, setupId: 'stable-setup', label: 'New team', endpointId: 'eu', authConfigId: 'new-app' });
    expect(hostedAccountRequestFields(provider, intent)).not.toHaveProperty('authConfigId');
    expect(hostedAccountRequestFields(provider, intent)).toEqual(hostedAccountRequestFields(provider, intent));
    expect(() => hostedAccountRequestFields(provider, { addAccount: true, setupId: 'stable-setup' })).toThrow('region');
  });

  it('does not silently choose another account for missing, inconsistent, or stale targets', () => {
    for (const intent of [{}, { serverId: 'deleted' }, { existingConnectionId: 'deleted' }, { serverId: 'server-a', existingConnectionId: 'connection-b' }]) {
      expect(() => providerForHostedAccount(provider, intent)).toThrow('no longer available');
    }
    expect(providerForHostedAccount(provider, { existingConnectionId: 'connection-b' }).mcp?.serverId).toBe('server-b');
  });

  it('clears an instance binding for new accounts and preserves its exact URL on reconnect', () => {
    const instance: ProviderStatus = { ...provider, mcp: { ...provider.mcp!, endpointConfig: { kind: 'instance', label: 'Instance', placeholder: 'https://example.com', selectedUrl: 'https://first.example/', locked: true }, accounts: [
      { serverId: 'instance', requiresAuth: false, endpointConfig: { kind: 'instance', label: 'Instance', placeholder: 'https://example.com', selectedUrl: 'https://second.example/', locked: true } },
    ] } };
    expect(hostedAccountRequestFields(instance, { serverId: 'instance' })).toMatchObject({ instanceUrl: 'https://second.example/' });
    const fresh = providerForHostedAccount(instance, { addAccount: true });
    expect(fresh.mcp?.endpointConfig).toEqual({ kind: 'instance', label: 'Instance', placeholder: 'https://example.com', locked: false });
  });

  it('retains the legacy single-account request shape', () => {
    const legacy = { ...provider, mcp: { ...provider.mcp!, accounts: undefined } };
    expect(hostedAccountRequestFields(legacy)).toEqual({ label: 'Service', endpointId: 'us', authConfigId: 'app-a' });
  });

  it('connects public services without requesting an account', () => {
    const publicProvider: ProviderStatus = { id: 'public', displayName: 'Public', method: 'mcp', configured: true, mcp: { authKind: 'none', requiresAuth: false, accounts: [] } };
    expect(hostedAccountRequestFields(publicProvider, {})).toEqual({ label: 'Public' });
  });

  it('migrates a verified saved connection without borrowing another account app or region', () => {
    const connection = { id: 'legacy', providerId: provider.id, accountId: 'old-account', status: 'needs_reauth', scopes: [] };
    const intent = { existingConnectionId: connection.id, endpointId: 'eu' };
    expect(hostedAccountRequestFields(provider, intent, 'replacement-app', undefined, [connection])).toEqual({
      existingConnectionId: 'legacy', label: 'Service', endpointId: 'eu', authConfigId: 'replacement-app',
    });
    const scoped = providerForHostedAccount(provider, intent, [connection]);
    expect(scoped.configured).toBe(true);
    expect(scoped.mcp?.authConfigId).toBeUndefined();
    expect(scoped.mcp?.endpointConfig?.locked).toBe(false);
    expect(() => hostedAccountRequestFields(provider, intent, undefined, undefined, [{ ...connection, providerId: 'someone-else' }])).toThrow('no longer available');
  });

  it('waits for the targeted browser sign-in despite another healthy account', () => {
    expect(hostedAccountSignedIn(provider, 'server-b')).toBe(false);
    expect(hostedAccountSignedIn(provider, 'removed')).toBe(false);
    expect(hostedAccountSignedIn(provider, 'server-a')).toBe(true);
    expect(hostedAccountSignedIn(undefined, 'server-b')).toBe(false);
    const complete = { ...provider, mcp: { ...provider.mcp!, accounts: provider.mcp!.accounts!.map(account => ({ ...account, requiresAuth: false })) } };
    expect(hostedAccountSignedIn(complete, 'server-b')).toBe(true);
    expect(hostedAccountSignedIn(provider)).toBe(true);
  });

  it('does not mistake old working credentials for completed consent on reconnect', () => {
    const reconnecting: ProviderStatus = { ...provider, mcp: { ...provider.mcp!, accounts: [
      { serverId: 'target', requiresAuth: false, lastAuthorizationId: 'previous-consent' },
      { serverId: 'other', requiresAuth: false, lastAuthorizationId: 'new-consent' },
    ] } };
    expect(hostedAccountSignedIn(reconnecting, 'target', 'new-consent')).toBe(false);
    expect(hostedAccountSignedIn(reconnecting, undefined, 'new-consent')).toBe(false);
    const completed: ProviderStatus = { ...reconnecting, mcp: { ...reconnecting.mcp!, accounts: [{ serverId: 'target', requiresAuth: false, lastAuthorizationId: 'new-consent' }] } };
    expect(hostedAccountSignedIn(completed, 'target', 'new-consent')).toBe(true);
    expect(hostedAccountSignedIn({ ...provider, mcp: { requiresAuth: false } }, 'target', 'new-consent')).toBe(false);
  });
});
