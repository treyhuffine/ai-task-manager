/**
 * The app's open storage, created once by `initialize` from the host-resolved
 * data directory. Importing this module opens nothing: the build imports the
 * action definitions to generate the contract without touching storage.
 */
import path from 'node:path';
import fs from 'node:fs';
import { AppError } from '@ri/app-kit/contract';
import { openAppDatabase, type AppInvocation, type Bootstrap } from '@ri/app-kit/sdk';
import { createBlobStore, createJobQueue, createScopeStore, createSettings, migrate, nowIso, scopeFingerprint, type AccessScope, type BlobStore, type JobQueue, type ScopeStore, type SqlDatabase } from '@ri/app-kit/data';
import { createAccountStore, createMailIndex, type AccountStore, type MailIndex } from '@ri/app-kit/sources';
import { z } from 'zod/v4';
import { MIGRATIONS } from './migrations.js';

export interface AppState {
  instanceId: string;
  dataDir: string;
  store: Awaited<ReturnType<typeof openAppDatabase>>;
  db: SqlDatabase;
  blobs: BlobStore;
  scopes: ScopeStore;
  jobs: JobQueue;
  accounts: AccountStore;
  mail: MailIndex;
  settings: ReturnType<typeof createSettings>;
}

let state: AppState | null = null;
let clock: () => Date = () => new Date();

/** The current time. Tests replace it with a fixed clock. */
export const now = () => clock();
export const nowAt = () => clock().toISOString();
export function setClock(next: (() => Date) | null) {
  clock = next ?? (() => new Date());
}

export function app(): AppState {
  if (!state) throw new AppError('app_failed', 'The app storage is not open yet');
  return state;
}

export async function openState(boot: Pick<Bootstrap, 'dataDir' | 'instanceId'>): Promise<AppState> {
  if (state) return state;
  fs.mkdirSync(boot.dataDir, { recursive: true, mode: 0o700 });
  const store = await openAppDatabase(path.join(boot.dataDir, 'records.db'));
  const db = store.db as unknown as SqlDatabase;
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db, MIGRATIONS);
  const instanceId = boot.instanceId;
  const scopes = createScopeStore(db, () => instanceId);
  // A saved write result holds data the caller could see when it was written. A replay by
  // anyone but the owner is refused unless the caller's sources are still exactly the same.
  store.useAuthority((invocation) => authorityKey(scopes, invocation));
  state = {
    instanceId,
    dataDir: boot.dataDir,
    store,
    db,
    blobs: createBlobStore(path.join(boot.dataDir, 'blobs')),
    scopes,
    jobs: createJobQueue(db),
    accounts: createAccountStore(db),
    mail: createMailIndex(db),
    settings: createSettings(db),
  };
  return state;
}

/**
 * The data authority a write receipt is keyed to: the exact set of sources
 * the caller may use. A revoked or foreign scope throws, which refuses a
 * replay just like a new call. A write-only scope is keyed by its sources too.
 */
export function authorityKey(scopes: ScopeStore, invocation: Pick<AppInvocation, 'principal' | 'access'>): string {
  let scope: AccessScope;
  try {
    scope = scopes.resolve(invocation, 'read');
  } catch (error) {
    if ((error as AppError)?.code !== 'forbidden') throw error;
    scope = scopes.resolve(invocation, 'write');
  }
  return scopeFingerprint(scope);
}

export function closeState() {
  if (!state) return;
  try {
    state.store.close();
  } finally {
    state = null;
  }
}

/**
 * The data revision: a counter bumped inside every write transaction. The
 * opener returns it so the host's refresh notices any change cheaply.
 */
export function bumpRevision(): number {
  const { settings } = app();
  const next = settings.get('data.revision', z.number().int(), 0) + 1;
  settings.set('data.revision', next);
  settings.set('data.changedAt', nowIso());
  return next;
}
export function dataRevision(): string {
  return `r${app().settings.get('data.revision', z.number().int(), 0)}`;
}
