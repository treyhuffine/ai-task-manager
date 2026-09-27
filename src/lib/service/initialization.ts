import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFile, withFileLock } from '@/lib/config/atomic-file';
import { getRuntimeInstallDir, serviceIdentity } from './paths';
import { installedRuntime, stageRuntime } from './runtime';

const recordSchema = z.object({
  format: z.literal(1), phase: z.enum(['pending', 'consumed']), runtimeId: z.string().regex(/^[a-f0-9]{64}$/),
  identity: z.object({ root: z.string(), database: z.string(), config: z.string(), work: z.string() }).strict(),
  createdAt: z.string().datetime(), consumedAt: z.string().datetime().optional(),
}).strict().refine(value => value.phase === 'consumed' ? !!value.consumedAt : value.consumedAt === undefined, 'Invalid initialization phase');
const recordFile = () => path.join(getRuntimeInstallDir(), 'initialization.json');

function readRecord() {
  const file = recordFile();
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe desktop initialization record');
  const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (JSON.stringify(record.identity) !== JSON.stringify(serviceIdentity())) throw new Error('Desktop initialization belongs to another installation');
  return record;
}

/** Only the first desktop staging operation can grant one initial DB open.
 * A failed endpoint/TLS setup retains the pending grant for the same runtime.
 * It cannot be recreated for an existing or previously initialized home. */
export function stageFirstDesktopRuntime(resources: string) {
  return withFileLock(path.join(getRuntimeInstallDir(), 'initialize'), () => {
    if (installedRuntime() || fs.existsSync(serviceIdentity().database) || fs.existsSync(recordFile())) throw new Error('This installation is no longer new. Inspect it before starting.');
    const runtime = stageRuntime(resources);
    if (fs.existsSync(serviceIdentity().database)) throw new Error('A database appeared while preparing this installation. Inspect it before starting.');
    atomicWriteFile(recordFile(), JSON.stringify({ format: 1, phase: 'pending', runtimeId: runtime.id, identity: serviceIdentity(), createdAt: new Date().toISOString() }));
    return runtime;
  });
}

/** Read-only missing-DB exception, valid only before the first bootstrap. */
export function pendingDesktopInitialization(runtimeId: string) {
  if (fs.existsSync(serviceIdentity().database)) return false;
  const record = readRecord();
  if (!record || record.phase !== 'pending') return false;
  if (record.runtimeId !== runtimeId) throw new Error('Desktop initialization does not match the selected runtime');
  for (const folder of [record.identity.root, record.identity.config, record.identity.work]) {
    const stat = fs.statSync(folder);
    if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) throw new Error('Desktop initialization folders are missing or belong to another account');
  }
  return true;
}

/** The owning controller calls this immediately BEFORE importing/bootstrapping
 * the application DB. Once consumed, a lost DB can never reuse this grant. */
export function consumeDesktopInitialization() {
  const record = readRecord();
  if (!record) return;
  if (record.phase === 'consumed') {
    if (!fs.existsSync(serviceIdentity().database)) throw new Error('This installation was already initialized, but its database is missing. Restore the database before starting.');
    return;
  }
  const active = installedRuntime();
  if (!active || record.runtimeId !== active.id) throw new Error('Desktop initialization does not match the selected runtime');
  atomicWriteFile(recordFile(), JSON.stringify({ ...record, phase: 'consumed', consumedAt: new Date().toISOString() }));
}
