/**
 * In-memory `ConnectionStore` + `AuthRequestStore` (§10). The reference store for
 * tests and ephemeral use. Persists opaque sealed blobs — it never sees plaintext.
 */
import type {
  AuthRequest,
  AuthRequestStore,
  Connection,
  ConnectionStore,
  SealedSecret,
  StoredConnection,
} from '../core/types';

export type MemoryStore = ConnectionStore & AuthRequestStore;

export function inMemoryStore(): MemoryStore {
  const connections = new Map<string, StoredConnection>();
  const authRequests = new Map<string, AuthRequest>();

  return {
    // ── ConnectionStore ──
    async list(filter) {
      const out: Connection[] = [];
      for (const { connection } of connections.values()) {
        if (filter?.ownerId && connection.ownerId !== filter.ownerId) continue;
        if (filter?.providerId && connection.providerId !== filter.providerId) continue;
        out.push(structuredClone(connection));
      }
      return out;
    },
    async get(id) {
      const entry = connections.get(id);
      return entry ? structuredClone(entry) : null;
    },
    async save(connection: Connection, sealed: SealedSecret) {
      connections.set(connection.id, { connection: structuredClone(connection), sealed });
    },
    async setStatus(id, status, _reason) {
      const entry = connections.get(id);
      if (!entry) return;
      entry.connection.status = status;
      entry.connection.updatedAt = new Date().toISOString();
    },
    async delete(id) {
      connections.delete(id);
    },

    // ── AuthRequestStore ──
    async put(req: AuthRequest) {
      authRequests.set(req.state, structuredClone(req));
    },
    async take(state: string) {
      const req = authRequests.get(state);
      if (!req) return null;
      authRequests.delete(state); // single-use; the runtime owns the expiry decision
      return req;
    },
    async sweepExpired(now: number) {
      for (const [state, req] of authRequests) {
        if (req.expiresAt < now) authRequests.delete(state);
      }
    },
  };
}
