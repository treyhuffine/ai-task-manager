import { connectorEndpointSelection, type HostedEndpointSelection } from '@/lib/client/connector-endpoint';
import { isRegisteredMcp, type Connection, type HostedConnectIntent, type ProviderStatus } from './types';

/** Form and request settings always come from the account being connected. */
export function providerForHostedAccount(provider: ProviderStatus, intent?: HostedConnectIntent, connections: Connection[] = []): ProviderStatus {
  if (!provider.mcp?.accounts || !intent) return provider;
  const { accounts, ...common } = provider.mcp;
  const firstPublicConnection = provider.mcp.authKind === 'none' && accounts.length === 0 && !intent.serverId && !intent.existingConnectionId;
  const legacyConnection = !intent.serverId && !!intent.existingConnectionId
    && !accounts.some(account => account.connectionId === intent.existingConnectionId)
    && connections.some(connection => connection.id === intent.existingConnectionId && connection.providerId === provider.id);
  if (intent.addAccount || firstPublicConnection || legacyConnection) {
    const setup = common.endpointConfig;
    const endpointConfig = !setup ? undefined : setup.kind === 'region'
      ? { kind: setup.kind, label: setup.label, options: setup.options, locked: false }
      : { kind: setup.kind, label: setup.label, placeholder: setup.placeholder, locked: false };
    return { ...provider, mcp: { ...common, serverId: undefined, authConfigId: undefined, requiresAuth: true, error: undefined, status: undefined, endpointConfig } };
  }
  const account = accounts.find(candidate => intent.serverId
    ? candidate.serverId === intent.serverId && (!intent.existingConnectionId || candidate.connectionId === intent.existingConnectionId)
    : !!intent.existingConnectionId && candidate.connectionId === intent.existingConnectionId);
  if (!account) throw new Error('This account is no longer available. Refresh connections and try again.');
  return { ...provider, configured: account.configured ?? provider.configured, mcp: { ...common, ...account } };
}

/** Build only the selected account's settings, never aggregate account defaults. */
export function hostedAccountRequestFields(
  provider: ProviderStatus,
  intent?: HostedConnectIntent,
  authConfigId?: string,
  fallbackEndpoint?: HostedEndpointSelection,
  connections: Connection[] = [],
) {
  const scoped = providerForHostedAccount(provider, intent, connections);
  const selectedApp = scoped.mcp?.authConfigId || authConfigId;
  return {
    label: intent?.label ?? provider.displayName,
    ...(intent?.addAccount ? { addAccount: true, setupId: intent.setupId } : {
      ...(intent?.serverId ? { serverId: intent.serverId } : {}),
      ...(intent?.existingConnectionId ? { existingConnectionId: intent.existingConnectionId } : {}),
    }),
    ...connectorEndpointSelection(scoped.mcp?.endpointConfig, intent ?? fallbackEndpoint),
    ...(isRegisteredMcp(scoped) && selectedApp ? { authConfigId: selectedApp } : {}),
  };
}

/** A different connected account must not complete an unfinished browser sign-in. */
export function hostedAccountSignedIn(provider: ProviderStatus | undefined, serverId?: string, authorizationId?: string): boolean {
  if (authorizationId) {
    return !!serverId && !!provider?.mcp?.accounts?.some(account => account.serverId === serverId
      && !account.requiresAuth && account.lastAuthorizationId === authorizationId);
  }
  if (serverId && provider?.mcp?.accounts) {
    return provider.mcp.accounts.some(account => account.serverId === serverId && !account.requiresAuth);
  }
  return provider?.mcp?.requiresAuth === false;
}
