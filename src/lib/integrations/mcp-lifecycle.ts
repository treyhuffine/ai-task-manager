import path from 'node:path';
import { fileLock, type ConnectionStore, type Lock } from '@integrations/engine';
import { getConfigDir } from '@/lib/config/paths';
import type { McpServerEntry, McpServerPatch, McpServerStore } from './mcp-servers';
import { hostedMcpConnectionId } from './hosted-mcp';

function lifecycleLock(): Lock {
  return fileLock({ dir: path.join(getConfigDir(), 'integrations', 'locks') });
}

// The derived connection id is stable across server removal/recreation. Using
// it also serializes a replacement entry against deletion of its predecessor.
const lifecycleKey = (entry: McpServerEntry) => `mcp-lifecycle:${hostedMcpConnectionId(entry)}`;

function matchesTransport(snapshot: McpServerEntry, current: McpServerEntry | null): current is McpServerEntry {
  return Boolean(current?.enabled && current.url === snapshot.url && current.slug === snapshot.slug &&
    current.providerId === snapshot.providerId && current.accountId === snapshot.accountId &&
    current.authConfigId === snapshot.authConfigId &&
    current.capabilityRevision === snapshot.capabilityRevision &&
    current.credentialRevision === snapshot.credentialRevision &&
    hostedMcpConnectionId(current) === hostedMcpConnectionId(snapshot) &&
    JSON.stringify(current.auth) === JSON.stringify(snapshot.auth) &&
    JSON.stringify(current.toolOverrides) === JSON.stringify(snapshot.toolOverrides));
}

/** Read on every execution so another process can revoke a captured transport. */
export function isCurrentMcpTransport(snapshot: McpServerEntry, servers: Pick<McpServerStore, 'get'>): boolean {
  return matchesTransport(snapshot, servers.get(snapshot.id));
}

/** Serialize token replacement with ingestion and removal of the same connection. */
export async function activateMcpServer(
  snapshot: McpServerEntry,
  servers: Pick<McpServerStore, 'get' | 'update'>,
  connections: Pick<ConnectionStore, 'get' | 'setStatus'>,
  ownerId: string,
  secret?: string,
  lock: Lock = lifecycleLock(),
): Promise<McpServerEntry | null> {
  return updateMcpServerConfiguration(snapshot, servers, connections, ownerId, { enabled: true, ...(secret !== undefined ? { secret } : {}) }, lock);
}

/** Prevent cached transports from retaining access after their authority changes. */
export async function updateMcpServerConfiguration(
  snapshot: McpServerEntry,
  servers: Pick<McpServerStore, 'get' | 'update'>,
  connections: Pick<ConnectionStore, 'get' | 'setStatus'>,
  ownerId: string,
  patch: McpServerPatch,
  lock: Lock = lifecycleLock(),
): Promise<McpServerEntry | null> {
  return lock.withLock(lifecycleKey(snapshot), async () => {
    const current = servers.get(snapshot.id);
    if (!current || current.url !== snapshot.url || current.slug !== snapshot.slug ||
      current.providerId !== snapshot.providerId || current.accountId !== snapshot.accountId ||
      current.authConfigId !== snapshot.authConfigId ||
      hostedMcpConnectionId(current) !== hostedMcpConnectionId(snapshot) ||
      JSON.stringify(current.auth) !== JSON.stringify(snapshot.auth)) return null;
    const stored = await connections.get(hostedMcpConnectionId(current));
    if (stored && stored.connection.ownerId !== ownerId) return null;
    // A cached runtime in another process must stop using the previous token
    // even when discovery with the replacement token fails. Finalization sets
    // this row active again only after the new transport is ready.
    const transportChanged = patch.enabled === false || patch.secret !== undefined ||
      (patch.url !== undefined && patch.url !== current.url) ||
      (patch.auth !== undefined && JSON.stringify(patch.auth) !== JSON.stringify(current.auth));
    if (transportChanged && stored) {
      await connections.setStatus(stored.connection.id, 'needs_reauth', 'The connection settings changed. Reconnect to refresh access.');
    }
    return servers.update(current.id, patch);
  });
}

/** Finalize local ingestion only while the discovered server remains authoritative. */
export async function finalizeMcpServer<T>(
  snapshot: McpServerEntry,
  servers: Pick<McpServerStore, 'get'>,
  finalize: (current: McpServerEntry) => Promise<T>,
  lock: Lock = lifecycleLock(),
): Promise<T | null> {
  return lock.withLock(lifecycleKey(snapshot), async () => {
    const current = servers.get(snapshot.id);
    if (!matchesTransport(snapshot, current)) return null;
    return finalize(current);
  });
}

/** Hold every account's lifecycle lock while publishing one shared provider. */
export async function finalizeMcpServers<T>(
  snapshots: readonly McpServerEntry[],
  servers: Pick<McpServerStore, 'get'>,
  finalize: (current: McpServerEntry[]) => Promise<T>,
  lock: Lock = lifecycleLock(),
): Promise<T> {
  const ordered = [...snapshots].sort((a, b) => lifecycleKey(a).localeCompare(lifecycleKey(b)));
  if (new Set(ordered.map(lifecycleKey)).size !== ordered.length) throw new Error('Duplicate MCP account identities.');
  const acquire = (index: number): Promise<T> => index < ordered.length
    ? lock.withLock(lifecycleKey(ordered[index]), () => acquire(index + 1))
    : finalize(ordered.flatMap(snapshot => {
      const current = servers.get(snapshot.id);
      return matchesTransport(snapshot, current) ? [current] : [];
    }));
  return acquire(0);
}

/** Remove the authority and its derived row under the same lock ingestion uses. */
export async function removeMcpServer(
  snapshot: McpServerEntry,
  servers: Pick<McpServerStore, 'get' | 'remove'>,
  connections: Pick<ConnectionStore, 'get' | 'delete'>,
  ownerId: string,
  lock: Lock = lifecycleLock(),
): Promise<boolean> {
  return lock.withLock(lifecycleKey(snapshot), async () => {
    const current = servers.get(snapshot.id);
    if (!current) return true; // A concurrent disconnect already finished.
    const connectionId = hostedMcpConnectionId(current);
    if (connectionId !== hostedMcpConnectionId(snapshot)) return false;
    const stored = await connections.get(connectionId);
    if (stored && stored.connection.ownerId !== ownerId) return false;
    await servers.remove(current.id);
    await connections.delete(connectionId);
    return true;
  });
}
