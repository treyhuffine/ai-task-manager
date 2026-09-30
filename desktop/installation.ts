import fs from 'node:fs';
import path from 'node:path';
import { canonical } from '../src/lib/service/paths';
import { atomicWriteFile } from '../src/lib/config/atomic-write';

export interface LocalInstallation { root: string; database: string; config: string; work: string }
export interface InstallationInspection {
  identity: LocalInstallation;
  phase: string;
  version?: string;
  pendingMigrations: number;
  appliedMigrations: number;
  canUse: boolean;
  reason?: string;
}

export function localInstallation(input: unknown): LocalInstallation {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Select a local installation.');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['root', 'database', 'config', 'work'].includes(key))) throw new Error('Unknown installation setting.');
  if (typeof value.root !== 'string' || !path.isAbsolute(value.root) || value.root.includes('\0')) throw new Error('Choose an absolute data folder.');
  const root = canonical(value.root);
  const result: LocalInstallation = { root, database: path.join(root, 'data.db'), config: path.join(root, '.config'), work: path.join(root, '.work') };
  for (const key of ['database', 'config', 'work'] as const) {
    const candidate = value[key];
    if (candidate !== undefined && candidate !== '') {
      if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || candidate.includes('\0')) throw new Error(`Choose an absolute ${key} path.`);
      result[key] = canonical(candidate);
    }
  }
  if ([result.root, result.config, result.work].includes(result.database)) throw new Error('The database must be a file, separate from installation folders.');
  return result;
}

/** This checks filesystem identity only. The ordinary Node inspector checks
 * the database history and private service protocol before association. */
export function assertExistingInstallation(identity: LocalInstallation, options: { allowMissingDatabase?: boolean } = {}) {
  const connected = options.allowMissingDatabase && !fs.existsSync(identity.database) && fs.existsSync(path.join(identity.config, 'connection.json'));
  for (const key of ['root', 'database', 'config', 'work'] as const) {
    // A viewer-only CLI connection may never have needed a work directory.
    if (key === 'work' && connected && !fs.existsSync(identity.work)) continue;
    if (key === 'database' && options.allowMissingDatabase && !fs.existsSync(identity.database)) continue;
    const stat = fs.statSync(identity[key]);
    if (key === 'database' ? !stat.isFile() : !stat.isDirectory()) throw new Error(`The ${key} path is not an existing ${key === 'database' ? 'file' : 'folder'}.`);
    if (process.getuid && stat.uid !== process.getuid()) throw new Error(`The ${key} path belongs to another OS account.`);
  }
}

export function installationEnvironment(identity: LocalInstallation): NodeJS.ProcessEnv {
  return { NODE_ENV: process.env.NODE_ENV, RI_DESKTOP_ROOT: identity.root, RI_DESKTOP_DATABASE: identity.database, RI_DESKTOP_CONFIG: identity.config, RI_DESKTOP_WORK: identity.work, RI_DESKTOP_ASSOCIATED: '1' };
}

export function readInstallation(file: string): LocalInstallation | undefined {
  if (!fs.existsSync(file)) return;
  const stat = fs.statSync(file);
  if (stat.size > 16_384) throw new Error('The saved local installation is invalid.');
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.format !== 1) throw new Error('The saved local installation format is unsupported.');
  return localInstallation(record.identity);
}

export function saveInstallation(file: string, identity: LocalInstallation) {
  atomicWriteFile(file, JSON.stringify({ format: 1, identity: localInstallation(identity) }));
}
