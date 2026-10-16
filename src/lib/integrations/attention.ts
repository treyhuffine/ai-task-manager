/**
 * The connected accounts that need the person: what only they can fix, by
 * signing in again or giving a new key. The rail's Connect accounts carries
 * their count, and a dot in the collapsed rail (docs/rail.md).
 *
 * Narrower than a connector's "Needs attention" in the library and Connectors
 * on purpose. A server that is only unreachable may come back on its own, and
 * something the person turned off is their choice. Neither is waiting on them.
 */
import type { Connection } from '@integrations/engine';
import { PROVIDER_CATALOG } from '@integrations/engine/providers';
import { hostedMcpConnectionId } from './hosted-mcp';
import type { McpServerEntry } from './mcp-servers';
import { getIntegrationConnectionStore, getIntegrationOwnerId, getMcpServerStore } from './runtime';
import { APPLICATIONS } from './sources/applications';
import { managedConfig } from './sources/managed-connections';

export interface AccountNeedingYou {
  /** The MCP server for a server's account, otherwise the connection. One per account. */
  key: string;
  /** The service, as Connectors names it ("Gmail", "Todoist", a custom server's name). */
  name: string;
  /** Which account, when the service holds one you can tell apart. */
  account?: string;
  /** Where it's fixed: a provider's page, a managed application's page, or a custom MCP server's. */
  target: { kind: 'provider'; id: string } | { kind: 'application'; id: string } | { kind: 'server'; id: string };
}

type ServerHealth = Pick<McpServerEntry, 'id' | 'slug' | 'connectionId' | 'providerId' | 'displayName' | 'enabled' | 'lastStatus'>;
type AccountConnection = Pick<Connection, 'id' | 'providerId' | 'accountId' | 'email' | 'label' | 'status' | 'config'>;

/** Pure, so the rule and its tests agree. */
export function accountsNeedingYou(connections: readonly AccountConnection[], servers: readonly ServerHealth[]): AccountNeedingYou[] {
  const serverOf = new Map(servers.map(server => [hostedMcpConnectionId(server), server]));
  const found = new Map<string, AccountNeedingYou>();
  for (const connection of connections) {
    if (connection.status !== 'needs_reauth') continue;
    const server = serverOf.get(connection.id);
    if (server && !server.enabled) continue;
    const account = describe(connection, server);
    found.set(account.key, account);
  }
  // A server that rejected its key, with no account row saying so.
  for (const server of servers) {
    if (server.enabled && server.lastStatus === 'error' && !found.has(server.id)) found.set(server.id, describe(undefined, server));
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.account ?? '').localeCompare(b.account ?? ''));
}

function describe(connection: AccountConnection | undefined, server: ServerHealth | undefined): AccountNeedingYou {
  if (server && !server.providerId) return { key: server.id, name: server.displayName, target: { kind: 'server', id: server.id } };
  const providerId = server?.providerId ?? connection!.providerId;
  const managed = connection ? managedConfig(connection) : null;
  const identity = connection?.label || connection?.email || undefined;
  if (connection && managed) {
    const application = APPLICATIONS[managed.applicationId];
    return { key: connection.id, name: application?.displayName ?? providerId, account: identity, target: { kind: 'application', id: managed.applicationId } };
  }
  const name = PROVIDER_CATALOG.find(provider => provider.id === providerId)?.displayName ?? providerId;
  // A hosted server's own name is its account label ("Todoist 2"), unless it only repeats the service.
  const account = server ? (server.displayName !== name ? server.displayName : undefined) : identity;
  return { key: server?.id ?? connection!.id, name, account, target: { kind: 'provider', id: providerId } };
}

/** Reads the stores the runtime keeps, without building the runtime or reaching any server. */
export async function listAccountsNeedingYou(): Promise<AccountNeedingYou[]> {
  const connections = await getIntegrationConnectionStore().list({ ownerId: getIntegrationOwnerId() });
  return accountsNeedingYou(connections, getMcpServerStore().list());
}
