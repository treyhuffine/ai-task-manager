/**
 * File-backed + in-memory `AuthConfigStore` (authconfig spec §9 Case B) — persistence for
 * user/tenant-supplied (BYO) auth configs. Mirrors the connection `fileStore`: opaque sealed
 * blobs as JSON under a precious, never-synced dir, atomic writes, read-modify-write serialized
 * through the injected `Lock`. The store holds only safe metadata + a pre-sealed `clientSecret`
 * — no key, no crypto, no cross-store policy (the admin service owns sealing + invariants).
 */
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { AuthConfig, AuthConfigStore, AuthConfigStatus, Lock, SealedSecret } from '../core/types';
import { inProcessLock } from '../lock/in-process';

interface StoredAuthConfig {
  config: AuthConfig;
  sealedSecret?: SealedSecret;
}

/** At most one default per (provider × exact visibility level) — §4a. */
function visibilityKey(c: AuthConfig): string {
  switch (c.scope) {
    case 'global':
      return 'global';
    case 'tenant':
      return `tenant:${c.tenantId}`;
    case 'owner':
      return `owner:${c.ownerId}`;
  }
}

/** Flip the default to `id`, clearing siblings at the SAME visibility level. */
function applySetDefault(items: StoredAuthConfig[], providerId: string, id: string): StoredAuthConfig[] {
  const target = items.find((e) => e.config.id === id && e.config.providerId === providerId);
  if (!target) return items;
  const key = visibilityKey(target.config);
  return items.map((e) => {
    if (e.config.providerId !== providerId || visibilityKey(e.config) !== key) return e;
    return { ...e, config: { ...e.config, isDefault: e.config.id === id } };
  });
}

export function inMemoryAuthConfigStore(seed: StoredAuthConfig[] = []): AuthConfigStore {
  let items: StoredAuthConfig[] = seed.map((e) => ({ ...e }));
  return {
    async create(config, sealedSecret) {
      const entry: StoredAuthConfig = { config, ...(sealedSecret !== undefined ? { sealedSecret } : {}) };
      const idx = items.findIndex((e) => e.config.id === config.id);
      if (idx >= 0) items[idx] = entry;
      else items.push(entry);
    },
    async get(id) {
      return items.find((e) => e.config.id === id) ?? null;
    },
    async listForProvider(providerId) {
      return items.filter((e) => e.config.providerId === providerId).map((e) => e.config);
    },
    async setDefault(providerId, id) {
      items = applySetDefault(items, providerId, id);
    },
    async setStatus(id, status: AuthConfigStatus) {
      items = items.map((e) => (e.config.id === id ? { ...e, config: { ...e.config, status } } : e));
    },
    async delete(id) {
      items = items.filter((e) => e.config.id !== id);
    },
  };
}

export interface AuthConfigFileStoreOptions {
  /** Directory for `auth-configs.json` (e.g. `.config/connectors`). */
  dir: string;
  /** Lock serializing read-modify-write (pass a cross-process `fileLock` for a shared dir). */
  lock?: Lock;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJsonAtomic(dir: string, path: string, value: unknown): Promise<void> {
  // Precious, never-synced dir holding sealed secrets — keep it owner-only. mkdir's mode is
  // umask-masked, so enforce 0700 with a best-effort chmod (a no-op where chmod is unsupported).
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(tmp, path);
}

export function authConfigFileStore(opts: AuthConfigFileStoreOptions): AuthConfigStore {
  const path = join(opts.dir, 'auth-configs.json');
  const lock = opts.lock ?? inProcessLock();
  const read = () => readJson<StoredAuthConfig[]>(path, []);
  const write = (items: StoredAuthConfig[]) => writeJsonAtomic(opts.dir, path, items);

  return {
    async create(config, sealedSecret) {
      await lock.withLock('auth-configs', async () => {
        const items = await read();
        const entry: StoredAuthConfig = { config, ...(sealedSecret !== undefined ? { sealedSecret } : {}) };
        const idx = items.findIndex((e) => e.config.id === config.id);
        if (idx >= 0) items[idx] = entry;
        else items.push(entry);
        await write(items);
      });
    },
    async get(id) {
      return (await read()).find((e) => e.config.id === id) ?? null;
    },
    async listForProvider(providerId) {
      return (await read()).filter((e) => e.config.providerId === providerId).map((e) => e.config);
    },
    async setDefault(providerId, id) {
      await lock.withLock('auth-configs', async () => {
        await write(applySetDefault(await read(), providerId, id));
      });
    },
    async setStatus(id, status: AuthConfigStatus) {
      await lock.withLock('auth-configs', async () => {
        const items = (await read()).map((e) => (e.config.id === id ? { ...e, config: { ...e.config, status } } : e));
        await write(items);
      });
    },
    async delete(id) {
      await lock.withLock('auth-configs', async () => {
        await write((await read()).filter((e) => e.config.id !== id));
      });
    },
  };
}
