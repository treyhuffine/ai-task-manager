/**
 * File-backed `ConnectionStore` + `AuthRequestStore` (§10) — the v0 local host.
 * Stores opaque sealed blobs as JSON under a precious, never-synced dir. Writes
 * are atomic (write-temp + rename) so a crash or a concurrent reader never sees a
 * half-written file. Read-modify-write is serialized through the injected `Lock`:
 * pass a cross-process `fileLock` (§9) when more than one process shares this dir
 * (this repo runs the CLI and dev server against one home) — otherwise atomic
 * rename prevents torn files but NOT lost updates across processes. Defaults to an
 * in-process mutex. Secrets are sealed by the runtime before they reach here — this
 * store has no key and no crypto.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type {
  AuthRequest,
  AuthRequestStore,
  Connection,
  ConnectionStore,
  Lock,
  SealedSecret,
  StoredConnection,
} from '../core/types';
import { inProcessLock } from '../lock/in-process';

export interface FileStoreOptions {
  /** Directory for `connections.json` + `auth-requests.json` (e.g. `.config/connectors`). */
  dir: string;
  /**
   * Lock serializing read-modify-write. Pass a cross-process `fileLock` when multiple
   * processes share `dir`; defaults to an in-process mutex (single-process safe only).
   */
  lock?: Lock;
}

export type FileStore = ConnectionStore & AuthRequestStore;

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJsonAtomic(dir: string, path: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path); // atomic on POSIX
}

export function fileStore(opts: FileStoreOptions): FileStore {
  const connectionsPath = join(opts.dir, 'connections.json');
  const authRequestsPath = join(opts.dir, 'auth-requests.json');
  const lock = opts.lock ?? inProcessLock();

  const readConnections = () => readJson<StoredConnection[]>(connectionsPath, []);
  const readAuthRequests = () => readJson<AuthRequest[]>(authRequestsPath, []);

  return {
    // ── ConnectionStore ──
    async list(filter) {
      const all = await readConnections();
      return all
        .map((e) => e.connection)
        .filter(
          (c) =>
            (!filter?.ownerId || c.ownerId === filter.ownerId) &&
            (!filter?.providerId || c.providerId === filter.providerId),
        );
    },
    async get(id) {
      const all = await readConnections();
      return all.find((e) => e.connection.id === id) ?? null;
    },
    async save(connection: Connection, sealed: SealedSecret) {
      await lock.withLock('connections', async () => {
        const all = await readConnections();
        const idx = all.findIndex((e) => e.connection.id === connection.id);
        const entry: StoredConnection = { connection, sealed };
        if (idx >= 0) all[idx] = entry;
        else all.push(entry);
        await writeJsonAtomic(opts.dir, connectionsPath, all);
      });
    },
    async setStatus(id, status, _reason) {
      await lock.withLock('connections', async () => {
        const all = await readConnections();
        const entry = all.find((e) => e.connection.id === id);
        if (!entry) return;
        entry.connection.status = status;
        entry.connection.updatedAt = new Date().toISOString();
        await writeJsonAtomic(opts.dir, connectionsPath, all);
      });
    },
    async delete(id) {
      await lock.withLock('connections', async () => {
        const all = await readConnections();
        const next = all.filter((e) => e.connection.id !== id);
        await writeJsonAtomic(opts.dir, connectionsPath, next);
      });
    },

    // ── AuthRequestStore ──
    async put(req: AuthRequest) {
      await lock.withLock('auth-requests', async () => {
        const all = await readAuthRequests();
        const next = all.filter((r) => r.state !== req.state);
        next.push(req);
        await writeJsonAtomic(opts.dir, authRequestsPath, next);
      });
    },
    async take(state: string) {
      return lock.withLock('auth-requests', async () => {
        const all = await readAuthRequests();
        const req = all.find((r) => r.state === state) ?? null;
        const next = all.filter((r) => r.state !== state);
        await writeJsonAtomic(opts.dir, authRequestsPath, next);
        return req; // single-use; the runtime owns the expiry decision
      });
    },
    async sweepExpired(now: number) {
      await lock.withLock('auth-requests', async () => {
        const all = await readAuthRequests();
        const next = all.filter((r) => r.expiresAt >= now);
        if (next.length !== all.length) await writeJsonAtomic(opts.dir, authRequestsPath, next);
      });
    },
  };
}
