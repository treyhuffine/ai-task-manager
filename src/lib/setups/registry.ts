/**
 * This computer's list of registered setup files (docs/homes-spec.md §4.2):
 * which source folders hold a `.ri.local.json` that Ri should read. It lives
 * in this computer's private config, never in a project or a backup, and it
 * only locates files. The paths an agent uses are in those files.
 *
 * A copied `.ri.local.json` that isn't registered here is ignored: a copy
 * is not enrollment.
 *
 * A folder is registered once however it's spelled: two paths that reach the
 * same directory (through a symlink, say) are the same folder here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getSetupRegistryPath } from '@/lib/config/paths';

export const SETUP_REGISTRY_VERSION = 1;

export interface RegisteredLocation {
  /** Absolute source folder. */
  dir: string;
  registeredAt: string;
}

interface RegistryFile {
  version: number;
  locations: RegisteredLocation[];
}

function load(): RegistryFile {
  const file = getSetupRegistryPath();
  if (!fs.existsSync(file)) return { version: SETUP_REGISTRY_VERSION, locations: [] };
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<RegistryFile>;
  const locations = Array.isArray(parsed.locations)
    ? parsed.locations.filter((l): l is RegisteredLocation => typeof l?.dir === 'string')
    : [];
  return { version: parsed.version ?? SETUP_REGISTRY_VERSION, locations };
}

function save(registry: RegistryFile): void {
  const file = getSetupRegistryPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function normalize(dir: string): string {
  return path.resolve(dir);
}

/**
 * Whether two paths are the same folder: spelled the same, or both existing
 * and the same directory on disk. A folder that's gone compares by spelling.
 */
export function sameFolder(a: string, b: string): boolean {
  const da = normalize(a);
  const db = normalize(b);
  if (da === db) return true;
  try {
    const sa = fs.statSync(da);
    const sb = fs.statSync(db);
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

export function listRegisteredLocations(): RegisteredLocation[] {
  return load().locations;
}

/** The registration for this folder, however it was spelled when registered. */
export function getLocation(dir: string): RegisteredLocation | null {
  return load().locations.find((l) => sameFolder(l.dir, dir)) ?? null;
}

export function isRegistered(dir: string): boolean {
  return getLocation(dir) !== null;
}

/** Register a source folder. Registering it again, under any spelling, changes nothing. */
export function registerLocation(dir: string): RegisteredLocation {
  const registry = load();
  const existing = registry.locations.find((l) => sameFolder(l.dir, dir));
  if (existing) return existing;
  const location = { dir: normalize(dir), registeredAt: new Date().toISOString() };
  registry.locations.push(location);
  save(registry);
  return location;
}

export function unregisterLocation(dir: string): boolean {
  const registry = load();
  const next = registry.locations.filter((l) => !sameFolder(l.dir, dir));
  if (next.length === registry.locations.length) return false;
  save({ ...registry, locations: next });
  return true;
}

/**
 * Point a registration at a folder's new location after a rename, or at a
 * new spelling of the same folder.
 */
export function moveLocation(fromDir: string, toDir: string): RegisteredLocation {
  const registry = load();
  const kept = registry.locations.filter((l) => !sameFolder(l.dir, fromDir) && !sameFolder(l.dir, toDir));
  const location = { dir: normalize(toDir), registeredAt: new Date().toISOString() };
  save({ ...registry, locations: [...kept, location] });
  return location;
}

/**
 * Put a folder's registration back exactly as `getLocation` returned it
 * earlier, or remove it when there was none. Used to undo a change.
 */
export function restoreLocation(dir: string, location: RegisteredLocation | null): void {
  const registry = load();
  const kept = registry.locations.filter((l) => !sameFolder(l.dir, dir) && (!location || !sameFolder(l.dir, location.dir)));
  save({ ...registry, locations: location ? [...kept, location] : kept });
}
