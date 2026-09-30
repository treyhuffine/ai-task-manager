import { getHostedMcpProvider, PROVIDER_CATALOG } from '@connectors/engine/providers';
import { hostedMcpConnectionId, hostedMcpEndpointSetup } from '@/lib/connectors/hosted-mcp';
import { getConnectorConnectionStore, getConnectorOwnerId, getMcpServerStore, getProviderStatuses } from '@/lib/connectors/runtime';
import { ConnectionRequest } from './connection-request';
import type { ConnectionRequestAccount } from './request-connection';

export default async function ConnectPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const providerId = typeof params.provider === 'string' ? params.provider : '';
  const hosted = getHostedMcpProvider(providerId);
  const auth = hosted?.auth;
  const registered = auth?.kind === 'oauth' && auth.registration === 'registered';
  const status = registered ? (await getProviderStatuses()).find(provider => provider.id === providerId) : undefined;
  const existingConnectionId = typeof params.connection === 'string' ? params.connection : undefined;
  const servers = hosted ? getMcpServerStore().list().filter(entry => entry.providerId === providerId) : [];
  const accounts: ConnectionRequestAccount[] = hosted ? servers.map(server => ({
    serverId: server.id, connectionId: hostedMcpConnectionId(server), label: server.displayName,
    authConfigId: server.authConfigId, endpointConfig: hostedMcpEndpointSetup(hosted, server),
    configured: registered ? status?.mcp?.accounts?.find(account => account.serverId === server.id)?.configured ?? status?.configured ?? false : true,
  })) : [];
  if (hosted) {
    const previous = await getConnectorConnectionStore().list({ ownerId: getConnectorOwnerId(), providerId });
    for (const connection of previous) {
      if (accounts.some(account => account.connectionId === connection.id)) continue;
      accounts.push({ connectionId: connection.id, label: connection.email || connection.label || connection.accountId,
        configured: registered ? status?.configured ?? false : true, endpointConfig: hostedMcpEndpointSetup(hosted) });
    }
  }
  const account = existingConnectionId ? accounts.find(item => item.connectionId === existingConnectionId) : accounts.length === 1 ? accounts[0] : undefined;
  const endpointConfig = hosted?.endpoint
    ? account?.endpointConfig ?? hostedMcpEndpointSetup(hosted)
    : undefined;
  let scopes: string[] = [];
  try {
    const parsed: unknown = JSON.parse(typeof params.scopes === 'string' ? params.scopes : '[]');
    if (Array.isArray(parsed) && parsed.length <= 100 && parsed.every(item => typeof item === 'string' && item.length <= 500)) scopes = parsed;
  } catch { /* The API validates the provider and its allowed scopes. */ }

  return <ConnectionRequest
    providerId={providerId}
    displayName={hosted?.displayName ?? PROVIDER_CATALOG.find(provider => provider.id === providerId)?.displayName ?? providerId}
    authKind={auth?.kind ?? 'oauth'}
    credentialLabel={auth?.kind === 'bearer' ? auth.label : undefined}
    helpUrl={auth?.kind === 'bearer' ? auth.helpUrl : undefined}
    endpointConfig={endpointConfig}
    {...(registered ? { oauthRegistration: 'registered' as const, configured: account?.configured ?? status?.configured ?? false, redirectUri: status?.mcp?.redirectUri } : {})}
    scopes={scopes}
    authConfigId={account?.authConfigId ?? (accounts.length === 0 ? status?.mcp?.authConfigId : undefined) ?? (typeof params.client === 'string' ? params.client : undefined)}
    existingConnectionId={existingConnectionId ?? account?.connectionId}
    {...(account ? { serverId: account.serverId } : {})}
    {...(accounts.length ? { accounts } : {})}
  />;
}
