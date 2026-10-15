/**
 * Local connection rows for managed accounts (docs/connector-service-spec.md §7). A managed
 * account is an engine `Connection` under the source-namespaced provider, so the existing account
 * pins, access picker, approvals and audit treat it like any other account. Its sealed credential
 * is a `remote_account` reference with a per-connect binding nonce, never a token.
 *
 *  - `accountId` is the remote connected-account id. It is the permission key, so a reconnect that
 *    keeps the remote binding keeps its grants, and a new remote account never inherits them.
 *  - The verified email is metadata shown beside the user's label, not an identity for grants.
 *  - `authConfigId` stays unset: there is no Ri auth config behind a managed account. The remote
 *    auth config id lives in `config`.
 */
import { randomBytes } from 'node:crypto';
import type { Connection, ConnectionStore, Credentials, SecretBox } from '@integrations/engine';
import { managedToolkitId, parseManagedToolkitId } from './applications';
import type { ApplicationId, SourceEntry } from './types';
import type { RemoteAccount } from './composio/client';

export interface ManagedConnectionConfig {
  managed: true;
  sourceId: string;
  sourceKind: SourceEntry['kind'];
  applicationId: ApplicationId;
  remoteAccountId: string;
  remoteUserId: string;
  remoteToolkit: string;
  remoteAuthConfigId: string;
  verifiedEmail?: string;
  verifiedAt?: string;
}

export function managedConnectionId(sourceId: string, remoteAccountId: string): string {
  return `${sourceId}-${remoteAccountId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export function isManagedConnection(connection: Pick<Connection, 'providerId' | 'config'>): boolean {
  return Boolean(parseManagedToolkitId(connection.providerId)) && (connection.config as { managed?: unknown } | undefined)?.managed === true;
}

export function managedConfig(connection: Pick<Connection, 'config'>): ManagedConnectionConfig | null {
  const config = connection.config as Partial<ManagedConnectionConfig> | undefined;
  if (!config?.managed || typeof config.sourceId !== 'string' || typeof config.remoteAccountId !== 'string' || typeof config.applicationId !== 'string') return null;
  return config as ManagedConnectionConfig;
}

/**
 * Save (or refresh) the local row for a verified remote account. Idempotent: the same remote
 * account always maps to the same connection id, so a replayed completion updates one row.
 */
export async function saveManagedConnection(
  store: ConnectionStore,
  secretBox: SecretBox,
  input: { ownerId: string; source: SourceEntry; applicationId: ApplicationId; remote: RemoteAccount; email?: string | null; label?: string },
): Promise<Connection> {
  const id = managedConnectionId(input.source.id, input.remote.id);
  const existing = await store.get(id);
  const previous = existing?.connection;
  if (previous && (previous.accountId !== input.remote.id || previous.ownerId !== input.ownerId)) {
    throw new Error('A different account already uses this connection id.');
  }
  const now = new Date().toISOString();
  const config: ManagedConnectionConfig = {
    managed: true,
    sourceId: input.source.id,
    sourceKind: input.source.kind,
    applicationId: input.applicationId,
    remoteAccountId: input.remote.id,
    remoteUserId: input.source.remoteUserId,
    remoteToolkit: input.remote.toolkitSlug,
    remoteAuthConfigId: input.remote.authConfigId,
    ...(input.email ? { verifiedEmail: input.email, verifiedAt: now } : previous && managedConfig(previous)?.verifiedEmail
      ? { verifiedEmail: managedConfig(previous)!.verifiedEmail, verifiedAt: managedConfig(previous)!.verifiedAt } : {}),
  };
  const label = input.label?.trim() || previous?.label || input.remote.alias || undefined;
  const connection: Connection = {
    id,
    ownerId: input.ownerId,
    providerId: managedToolkitId(input.source.id, input.applicationId),
    accountId: input.remote.id,
    ...(config.verifiedEmail ? { email: config.verifiedEmail } : {}),
    ...(label ? { label } : {}),
    scopes: [],
    status: 'active',
    config: config as unknown as Record<string, unknown>,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    ...(previous?.lastUsedAt ? { lastUsedAt: previous.lastUsedAt } : {}),
  };
  // Keep the binding across a refresh of the same remote account, so calls in flight still match.
  let credential: Credentials | undefined;
  if (existing) {
    const opened = await secretBox.open<Credentials>(existing.sealed).catch(() => undefined);
    if (opened?.type === 'remote_account' && opened.remoteAccountId === input.remote.id && opened.sourceId === input.source.id) credential = opened;
  }
  credential ??= { type: 'remote_account', sourceId: input.source.id, remoteAccountId: input.remote.id, binding: randomBytes(16).toString('hex') };
  await store.save(connection, await secretBox.seal(credential));
  return connection;
}

export async function listManagedConnections(store: ConnectionStore, filter: { ownerId: string; sourceId?: string; applicationId?: ApplicationId }): Promise<Connection[]> {
  const all = await store.list({ ownerId: filter.ownerId });
  return all.filter(connection => {
    const config = managedConfig(connection);
    if (!config || !isManagedConnection(connection)) return false;
    return (!filter.sourceId || config.sourceId === filter.sourceId) && (!filter.applicationId || config.applicationId === filter.applicationId);
  });
}
