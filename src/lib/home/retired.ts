/**
 * Whether the home in a folder was retired, and the note it left
 * (src/lib/home/retire.ts). Light on purpose: every database open checks it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot, getDbPath } from '@/lib/config/paths';

export const RETIRED_DIR = '.retired';
export const RETIRED_MARKER = 'retired.json';

export interface RetiredHome {
  version: 1;
  homeId: string | null;
  homeName: string;
  /** The device it ran on, as it knew itself. */
  host: string | null;
  retiredAt: string;
  /** Where its work lives now, as the person said: a name or an address. */
  successor: string | null;
  /** What it held, to recognize it by later. */
  counts: Record<string, number>;
}

/** Opening a database in a folder whose home was retired. */
export class RetiredHomeError extends Error {
  constructor(readonly retired: RetiredHome, readonly dir: string) {
    super(describeRetired(retired, dir));
    this.name = 'RetiredHomeError';
  }
}

/** Every retired home in a folder, latest first. */
export function retiredHomes(root: string = getAppRoot()): Array<{ dir: string; retired: RetiredHome }> {
  const base = path.join(root, RETIRED_DIR);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .map((name) => path.join(base, name))
    .filter((dir) => fs.existsSync(path.join(dir, RETIRED_MARKER)))
    .map((dir) => ({ dir, retired: JSON.parse(fs.readFileSync(path.join(dir, RETIRED_MARKER), 'utf8')) as RetiredHome }))
    .sort((a, b) => b.retired.retiredAt.localeCompare(a.retired.retiredAt));
}

export function describeRetired(retired: RetiredHome, dir: string): string {
  const where = retired.successor ? ` Its work now lives in ${retired.successor}.` : '';
  return (
    `${retired.homeName}, the home in this folder, was retired on ${retired.retiredAt.slice(0, 10)}.${where} ` +
    `Its data is kept in ${dir}. Connect this device to your home with \`ri connect\`, ` +
    'or bring this one back with `ri home retire --undo`.'
  );
}

/**
 * Before a database is created at the folder's own path: refuse when the
 * folder's home was retired. An existing database, another path (tests, an
 * explicit override), or a folder never retired, pass.
 */
export function assertNotRetired(dbPath: string): void {
  if (fs.existsSync(dbPath) || path.resolve(dbPath) !== path.resolve(getDbPath())) return;
  const latest = retiredHomes()[0];
  if (latest) throw new RetiredHomeError(latest.retired, latest.dir);
}
