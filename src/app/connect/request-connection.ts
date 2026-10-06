import { integrationEndpointSelection, type HostedEndpointSelection } from '@/lib/client/integration-endpoint';
import type { RouterInputs, RouterOutputs } from '@/lib/trpc/router';
import type { HostedMcpEndpointSetup } from '@integrations/engine/providers';

export interface ConnectionRequestAccount {
  serverId?: string;
  connectionId: string;
  label: string;
  authConfigId?: string;
  endpointConfig?: HostedMcpEndpointSetup;
  configured: boolean;
}

export interface ConnectionRequestOptions extends HostedEndpointSelection {
  providerId: string;
  authKind: 'oauth' | 'bearer' | 'none';
  scopes: string[];
  authConfigId?: string;
  existingConnectionId?: string;
  token?: string;
  endpointConfig?: HostedMcpEndpointSetup;
  oauthRegistration?: 'dynamic' | 'registered';
  configured?: boolean;
  serverId?: string;
  accounts?: ConnectionRequestAccount[];
}

/** Apply the chosen account's saved client and endpoint together. */
export function selectRequestAccount(options: ConnectionRequestOptions, connectionId?: string): ConnectionRequestOptions {
  const accounts = options.accounts ?? [];
  const selectedId = connectionId ?? options.existingConnectionId;
  const selected = selectedId ? accounts.find(account => account.connectionId === selectedId) : accounts.length === 1 ? accounts[0] : undefined;
  if (!selected && accounts.length > 1 && !selectedId) throw new Error('Choose the account to reconnect.');
  if (selectedId && accounts.length > 0 && !selected) throw new Error('The selected account is no longer available. Open Settings to reconnect it.');
  return selected ? { ...options, serverId: selected.serverId, existingConnectionId: selected.connectionId,
    authConfigId: selected.authConfigId, endpointConfig: selected.endpointConfig, configured: selected.configured } : options;
}

type OAuthStart = RouterOutputs['integrations']['connectPost'];
type Field<T, Key extends PropertyKey> = T extends unknown ? Key extends keyof T ? T[Key] : never : never;
type StartResponse = {
  authorizationUrl?: Field<OAuthStart, 'authorizationUrl'>;
  authUrl?: Field<OAuthStart, 'authUrl'>;
  requiresAuth?: Field<OAuthStart, 'requiresAuth'>;
  connection?: Pick<RouterOutputs['integrations']['connectDirectPost']['connection'], 'id'>;
};
export type ConnectionPostArgs =
  | [path: '/integrations/connect', body: RouterInputs['integrations']['connectPost']['body']]
  | [path: '/integrations/connectDirect', body: RouterInputs['integrations']['connectDirectPost']['body']];

/** Use the same declared authentication path as the integration's Settings form. */
export async function requestConnection(options: ConnectionRequestOptions, deps: {
  post: (...args: ConnectionPostArgs) => Promise<StartResponse>;
  openAuthorization: (url: string) => Promise<unknown>;
}): Promise<string> {
  options = selectRequestAccount(options);
  if (options.oauthRegistration === 'registered' && options.configured === false) {
    throw new Error('Set up an OAuth app in Settings before connecting.');
  }
  const endpoint = integrationEndpointSelection(options.endpointConfig, options);
  if (options.authKind !== 'oauth') {
    const token = options.token?.trim();
    if (options.authKind === 'bearer' && !token) throw new Error('A connection token is required.');
    const result = await deps.post('/integrations/connectDirect', {
      providerId: options.providerId,
      fields: options.authKind === 'bearer' ? { token: token ?? '' } : {},
      ...(options.existingConnectionId ? { existingConnectionId: options.existingConnectionId } : {}),
      ...(options.serverId ? { serverId: options.serverId } : {}),
      ...endpoint,
    });
    if (!result.connection) throw new Error('The connection could not be verified. Try connecting again.');
    return 'Connected. You can return to your conversation.';
  }
  const result = await deps.post('/integrations/connect', {
    providerId: options.providerId, scopes: options.scopes,
    authConfigId: options.authConfigId, existingConnectionId: options.existingConnectionId,
    ...(options.serverId ? { serverId: options.serverId } : {}),
    ...endpoint,
  });
  const authorizationUrl = result.authorizationUrl ?? result.authUrl;
  if (authorizationUrl) {
    await deps.openAuthorization(authorizationUrl);
    return 'Finish connecting in your browser.';
  }
  if (result.requiresAuth === false) return 'Connected. You can return to your conversation.';
  throw new Error('No sign-in link was returned. Try connecting again.');
}
