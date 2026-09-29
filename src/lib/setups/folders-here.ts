/**
 * This device's folders, for its home (docs/homes-spec.md §4.1-4.2):
 * whether the ones it records are there, and a folder's folders for choosing
 * one. Runs on a worker for its device and on the home for its own. No
 * database: the home records what these find.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Whether each folder is there, as a folder. */
export function checkFoldersHere(paths: readonly string[]): Array<{ path: string; exists: boolean }> {
  return paths.map((p) => ({ path: p, exists: isDirectory(p) }));
}

export interface FolderListing {
  /** The folder listed. */
  path: string;
  /** Its parent, while that's still within the person's home folder. */
  parent: string | null;
  /** The person's home folder: where choosing starts, and its limit. */
  home: string;
  folders: Array<{ name: string; path: string; isGit: boolean }>;
  /** More folders than are listed. */
  truncated: boolean;
}

const MAX_FOLDERS = 500;

export class FolderListingError extends Error {}

/**
 * A folder's folders, within the person's home folder, for choosing one:
 * hidden ones left out, Git projects marked. `~` and relative paths are from
 * the home folder.
 */
export function listFoldersHere(at: string | null): FolderListing {
  const home = os.homedir();
  const target = at ? expand(at, home) : home;
  let real: string;
  try {
    real = fs.realpathSync(target);
  } catch {
    throw new FolderListingError(`${target} isn't there.`);
  }
  const realHome = fs.realpathSync(home);
  if (!within(realHome, real)) throw new FolderListingError('Choose a folder inside your home folder.');
  if (!isDirectory(real)) throw new FolderListingError(`${target} isn't a folder.`);
  const entries = fs.readdirSync(real, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && isDirectory(path.join(real, e.name)))))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const folders = entries.slice(0, MAX_FOLDERS).map((e) => {
    const full = path.join(real, e.name);
    return { name: e.name, path: full, isGit: fs.existsSync(path.join(full, '.git')) };
  });
  const parent = real === realHome ? null : path.dirname(real);
  return { path: real, parent, home: realHome, folders, truncated: entries.length > MAX_FOLDERS };
}

function expand(typed: string, home: string): string {
  const t = typed.trim();
  if (t === '~') return home;
  if (t.startsWith('~/')) return path.join(home, t.slice(2));
  return path.resolve(home, t);
}

function within(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
