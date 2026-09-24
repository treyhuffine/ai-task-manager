/**
 * This computer's list of registered setup files (docs/homes-spec.md §4.2):
 * which source folders hold a `.ri.local.json` that Ri should read. It lives
 * in this computer's private config, never in a project or a backup, and it
 * only locates files. The paths an agent uses are in those files.
 *
 * A copied `.ri.local.json` that isn't registered here is ignored: a copy
 * is not enrollment.
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

export function listRegisteredLocations(): RegisteredLocation[] {
  return load().locations;
}

export function isRegistered(dir: string): boolean {
  const d = normalize(dir);
  return load().locations.some((l) => l.dir === d);
}

/** Register a source folder. Registering it again changes nothing. */
export function registerLocation(dir: string): RegisteredLocation {
  const registry = load();
  const d = normalize(dir);
  const existing = registry.locations.find((l) => l.dir === d);
  if (existing) return existing;
  const location = { dir: d, registeredAt: new Date().toISOString() };
  registry.locations.push(location);
  save(registry);
  return location;
}

export function unregisterLocation(dir: string): boolean {
  const registry = load();
  const d = normalize(dir);
  const next = registry.locations.filter((l) => l.dir !== d);
  if (next.length === registry.locations.length) return false;
  save({ ...registry, locations: next });
  return true;
}

/** Point a registration at a folder's new location after a rename. */
export function moveLocation(fromDir: string, toDir: string): RegisteredLocation {
  const registry = load();
  const from = normalize(fromDir);
  const to = normalize(toDir);
  const kept = registry.locations.filter((l) => l.dir !== from && l.dir !== to);
  const location = { dir: to, registeredAt: new Date().toISOString() };
  save({ ...registry, locations: [...kept, location] });
  return location;
}
