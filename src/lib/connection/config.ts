/**
 * A connected device's record of its home (docs/homes-spec.md §3.1): the
 * home's stable id and name, the address it answers on, and this device's
 * credential for it. Machine-local, 0600 in a 0700 directory, and never in a
 * backup. The address can change without changing the home: the id is what
 * a reconnect checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getConnectionPath } from '@/lib/config/paths';

export const CONNECTION_VERSION = 1;

export interface ConnectionConfig {
  version: number;
  homeId: string;
  homeName: string;
  /** Where the home answers, e.g. `https://ri-trey.beamd.run`. No trailing slash. */
  homeUrl: string;
  /** The name of the device the home runs on, for "Cannot reach your Ri on Mac Mini". */
  homeHostName: string | null;
  /** This device's key for the home. Never printed. */
  credential: string;
  connectedAt: string;
  /** This device's id at the home, once it has registered (for setups). */
  deviceId?: string | null;
}

export class ConnectionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionConfigError';
  }
}

export function normalizeHomeUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withScheme);
  return `${url.protocol}//${url.host}`;
}

function assertConnectionVersion(version: unknown, file: string): void {
  // The first connection records had no version field. Only that legacy
  // format and explicit version 1 are readable by this release.
  if (version !== undefined && version !== CONNECTION_VERSION) {
    throw new ConnectionConfigError(`${file} uses a connection format this version of Ri cannot read. Update to a compatible Ri release. The saved connection was left unchanged.`);
  }
}

function readConnectionRecord(file: string): Partial<ConnectionConfig> & { computerId?: string | null } {
  let parsed: unknown;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new ConnectionConfigError(`${file} is not valid JSON. Repair the saved connection before reconnecting.`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ConnectionConfigError(`${file} is not a connection record. Repair the saved connection before reconnecting.`);
  const record = parsed as Partial<ConnectionConfig> & { computerId?: string | null };
  assertConnectionVersion(record.version, file);
  return record;
}

export function readConnection(): ConnectionConfig | null {
  const file = getConnectionPath();
  if (!fs.existsSync(file)) return null;
  const parsed = readConnectionRecord(file);
  // Written as `computerId` before devices were named devices (2026-09-29).
  parsed.deviceId ??= parsed.computerId;
  for (const key of ['homeId', 'homeUrl', 'credential'] as const) {
    if (typeof parsed[key] !== 'string' || !parsed[key]) {
      throw new ConnectionConfigError(`${file} is missing ${key}. Connect this device again.`);
    }
  }
  return {
    version: parsed.version ?? CONNECTION_VERSION,
    homeId: parsed.homeId!,
    homeName: parsed.homeName ?? 'your Ri',
    homeUrl: normalizeHomeUrl(parsed.homeUrl!),
    homeHostName: parsed.homeHostName ?? null,
    credential: parsed.credential!,
    connectedAt: parsed.connectedAt ?? new Date().toISOString(),
    deviceId: parsed.deviceId ?? null,
  };
}

/** Atomic write, 0600 in a 0700 directory. */
export function writeConnection(config: Omit<ConnectionConfig, 'version'>): ConnectionConfig {
  const file = getConnectionPath();
  // Recheck persisted state at every writer, including a fresh pairing path
  // that did not first read it. Never normalize a future format into this one.
  if (fs.existsSync(file)) readConnectionRecord(file);
  assertConnectionVersion((config as Partial<ConnectionConfig>).version, file);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const record: ConnectionConfig = { ...config, version: CONNECTION_VERSION, homeUrl: normalizeHomeUrl(config.homeUrl) };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return record;
}

/**
 * The device id each home gave this device, kept apart from the
 * connection so it outlives `ri disconnect` and a new pairing key: the same
 * machine stays the same device of that home.
 */
function knownHomesPath(): string {
  return path.join(path.dirname(getConnectionPath()), 'known-homes.json');
}

export function rememberedDeviceId(homeId: string): string | null {
  try {
    const known = JSON.parse(fs.readFileSync(knownHomesPath(), 'utf8')) as Record<string, { deviceId?: string; computerId?: string }>;
    // Written as `computerId` before devices were named devices (2026-09-29).
    return known[homeId]?.deviceId ?? known[homeId]?.computerId ?? null;
  } catch {
    return null;
  }
}

export function rememberDeviceId(homeId: string, deviceId: string): void {
  const file = knownHomesPath();
  let known: Record<string, { deviceId: string }> = {};
  try {
    known = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first home */
  }
  known[homeId] = { deviceId };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(known, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function removeConnection(): boolean {
  const file = getConnectionPath();
  if (!fs.existsSync(file)) return false;
  fs.rmSync(file);
  return true;
}
