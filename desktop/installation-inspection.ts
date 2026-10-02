import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { inspectMigrationHistory } from '../src/lib/db/migrate';
import { serviceStatus } from '../src/lib/service/client';
import { canonical, getRuntimeInstallDir, serviceIdentity } from '../src/lib/service/paths';
import { readLiveServerRuntime } from '../src/lib/server-runtime/record';
import { assertExistingInstallation, type InstallationInspection } from './installation';
import { installedRuntime } from '../src/lib/service/runtime';
import { ReleaseSchema } from '../src/lib/service/release-trust';
import { MaintenanceWindowSchema } from '../src/lib/service/update-settings';
import { resolveServiceRole } from '../src/lib/service/role';
import { pendingDesktopInitialization } from '../src/lib/service/initialization';
import { serviceOwnerHeld } from '../src/lib/service/owner';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const updateRecord = z.object({
  format: z.literal(1), phase: z.enum(['idle', 'available', 'downloading', 'ready', 'waiting', 'draining', 'checkpointing', 'validating', 'committed', 'failed', 'recovery-required']),
  changedAt: z.string().datetime(), release: ReleaseSchema.optional(), priorId: digest.optional(), checkpoint: z.string().optional(),
  approved: z.boolean().optional(), bytes: z.number().int().nonnegative().optional(), reason: z.string().optional(), error: z.string().optional(),
  committedAt: z.string().datetime().optional(), window: MaintenanceWindowSchema.optional(),
}).strict();

function readPrivateJson(file: string, maximumBytes: number): unknown {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > maximumBytes || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o022)) throw new Error('Unsafe saved recovery metadata');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** A cheap preflight of the existing durable record, not recovery itself.
 * The existing controller verifies complete runtime/checkpoint contents before
 * mutation. Hashing every attachment here would time out the inspector. */
function hasRecordedRecovery(active: NonNullable<ReturnType<typeof installedRuntime>>, identity: ReturnType<typeof serviceIdentity>) {
  const install = getRuntimeInstallDir();
  const file = path.join(install, 'update.json');
  if (!fs.existsSync(file)) return false;
  const record = updateRecord.parse(readPrivateJson(file, 256 * 1024));
  if (!['validating', 'committed', 'recovery-required'].includes(record.phase)) return false;
  const fail = () => { throw new Error('The saved update recovery record does not match this installation. Inspect the preserved files before starting.'); };
  const release = record.release;
  if (!release || !record.priorId || (!record.committedAt && !record.checkpoint) || (record.phase === 'committed' && !record.committedAt) ||
      (record.phase === 'validating' && record.committedAt) || release.platform !== process.platform || release.arch !== process.arch ||
      (active.id !== record.priorId && (!record.committedAt || active.id !== release.runtime.id))) return fail();

  // The record may refer only to its already staged runtime. Verify the
  // content-addressed inventory metadata and its migration journal without
  // selecting this shell's bundle or executing any target code.
  for (const id of new Set(record.committedAt ? [active.id, release.runtime.id] : [record.priorId, release.runtime.id])) {
    const runtime = path.join(install, 'releases', id);
    if (canonical(runtime) !== runtime) return fail();
    const manifest = z.object({ format: z.literal(1), id: digest, version: z.string(), platform: z.string(), arch: z.string(), node: z.string(),
      files: z.array(z.object({ name: z.string(), sha256: digest.optional(), link: z.string().optional(), executable: z.boolean() }).strict()).max(200_000),
    }).strict().parse(readPrivateJson(path.join(runtime, 'runtime-manifest.json'), 64 * 1024 * 1024));
    const { id: manifestId, ...content } = manifest;
    if (manifestId !== id || createHash('sha256').update(JSON.stringify(content)).digest('hex') !== id ||
        manifest.platform !== process.platform || manifest.arch !== process.arch ||
        !['node/bin/node', 'server/dist/service/main.cjs'].every(name => manifest.files.some(entry => entry.name === name && entry.sha256))) return fail();
    if (id === release.runtime.id && (manifest.version !== release.version || createHash('sha256').update(fs.readFileSync(path.join(runtime, 'server/drizzle/meta/_journal.json'))).digest('hex') !== release.migrationHistory)) return fail();
  }

  // Forward recovery never restores a checkpoint or requires the prior files.
  // Old backups may have been removed after a successful committed upgrade.
  if (record.committedAt) return true;
  const checkpoint = canonical(record.checkpoint!);
  if (!path.isAbsolute(record.checkpoint!) || checkpoint !== record.checkpoint || path.dirname(checkpoint) !== path.join(install, 'recovery')) return fail();
  const manifest = z.object({ format: z.literal(1), identity: z.object({ root: z.string(), database: z.string(), config: z.string(), work: z.string() }).strict(),
    database: digest, entries: z.array(z.object({ source: z.string(), saved: z.string(), size: z.number().nonnegative().optional(), sha256: digest.optional(), link: z.string().optional() }).strict()),
  }).strict().parse(readPrivateJson(path.join(checkpoint, 'checkpoint.json'), 64 * 1024 * 1024));
  if (JSON.stringify(manifest.identity) !== JSON.stringify(identity)) return fail();
  for (const entry of manifest.entries) {
    if (!path.resolve(checkpoint, entry.saved).startsWith(`${checkpoint}${path.sep}`) || (entry.link === undefined && !entry.sha256)) return fail();
  }
  if (!fs.lstatSync(path.join(checkpoint, 'database.sqlite')).isFile()) return fail();
  return true;
}

/** The checkout a development launch runs from, or null for anything else. A
 * packaged app is never development (`main.ts`) and carries its resources. */
function sourceDevelopmentRepo(): string | null {
  if (process.env.RI_DESKTOP_MODE !== 'development' || process.env.RI_DESKTOP_RESOURCES) return null;
  return process.env.RI_DESKTOP_REPO || null;
}

export async function inspectExistingInstallation(): Promise<InstallationInspection> {
  const identity = serviceIdentity();
  const role = resolveServiceRole();
  if (role.role === 'conflict' || role.role === 'retired') return { identity, phase: role.role, pendingMigrations: 0, appliedMigrations: 0, canUse: false, reason: role.message };
  if (role.role === 'worker' || role.role === 'viewer') {
    assertExistingInstallation(identity, { allowMissingDatabase: true });
    const status = await serviceStatus();
    // A connected installation has no authoritative SQLite schema to inspect.
    // Its existing runtime, worker journal and credentials stay where they are.
    return { identity, phase: status?.phase ?? role.role, version: status?.version,
      pendingMigrations: 0, appliedMigrations: 0, canUse: !status || status.phase === 'running',
      reason: status && status.phase !== 'running' ? 'Resolve the existing service state before connecting.' : undefined };
  }
  const selected = fs.existsSync(identity.database) ? undefined : installedRuntime();
  const pendingInitialization = !!selected && pendingDesktopInitialization(selected.id);
  // The service makes the work folder as it starts, so development doesn't need one yet.
  if (!pendingInitialization) assertExistingInstallation(identity, { allowMissingWork: !!sourceDevelopmentRepo() });
  const status = await serviceStatus();
  // A live verified owner is already responsible for its schema. Never open
  // the database as a side effect of connecting another viewer.
  if (status) return { identity, phase: status.phase, version: status.version, pendingMigrations: 0, appliedMigrations: 0,
    canUse: status.phase === 'running', reason: status.phase === 'running' ? undefined : 'Resolve the existing service state before connecting.' } satisfies InstallationInspection;
  if (readLiveServerRuntime()) throw new Error('An older foreground launcher is using this installation. Stop it before connecting the desktop app.');
  // A launcher that publishes no record (`pnpm dev`) still holds the owner
  // lock, and a service started now would only fail on it.
  if (serviceOwnerHeld()) throw new Error('Another launcher is using this installation, such as `pnpm dev` or `ri start`. Stop it before opening the desktop app.');
  const active = selected ?? installedRuntime();
  if (!active) {
    // A source checkout in development is its own runtime: it opens the home
    // the way `pnpm dev` does, applying its pending migrations as it boots.
    // An unrelated history still refuses (`inspectMigrationHistory` throws).
    const source = sourceDevelopmentRepo();
    if (source) {
      const db = new Database(identity.database, { readonly: true, fileMustExist: true });
      try {
        const history = inspectMigrationHistory(db, path.join(source, 'drizzle'));
        return { identity, phase: 'stopped', pendingMigrations: history.pending.length, appliedMigrations: history.applied, canUse: true } satisfies InstallationInspection;
      } finally { db.close(); }
    }
    return { identity, phase: 'stopped', pendingMigrations: 0, appliedMigrations: 0, canUse: false,
      reason: 'Start this installation with its existing CLI service before connecting. Ri will not select replacement runtime binaries for a stopped CLI installation.' };
  }
  if (pendingInitialization) return { identity, phase: 'initialization-pending', pendingMigrations: 0, appliedMigrations: 0, canUse: true,
    reason: 'The selected runtime has not opened its first database yet. Initial setup can resume after correcting the reported problem.' };
  if (hasRecordedRecovery(active, identity)) return { identity, phase: 'recovery-pending', pendingMigrations: 0, appliedMigrations: 0, canUse: true,
    reason: 'The existing controller must finish recorded update recovery before opening the app database. No recovery or migration was applied by this inspection.' };
  const db = new Database(identity.database, { readonly: true, fileMustExist: true });
  try {
    const startupRepo = active.repo;
    const history = inspectMigrationHistory(db, path.join(startupRepo, 'drizzle'));
    return { identity, phase: 'stopped', pendingMigrations: history.pending.length, appliedMigrations: history.applied,
      canUse: history.pending.length === 0,
      reason: history.pending.length ? 'This installation needs a database upgrade. Start its matching service and use its verified update flow before connecting. No migration was applied.' : undefined } satisfies InstallationInspection;
  } finally { db.close(); }
}
