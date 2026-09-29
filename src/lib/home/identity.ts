/**
 * Home and device identity (docs/homes-spec.md §2.2, §5.1, §10.3).
 *
 * A home has a stable id that no address or machine change alters, and a
 * host device whose in-process runner serves it. The database says which
 * home it is and which device hosts it. The machine says which device it
 * is, in `<config>/machine.json`. The two must agree before this root acts
 * as the home:
 *
 * - No home row yet (a new database, or one from before this build): make
 *   the home and this machine's device row. The ids are written to
 *   `machine.json` first, so a crash between the two steps repeats them.
 * - Home row and matching `machine.json`: active.
 * - Anything else means the database came from somewhere else: a restored
 *   backup (which never carries `machine.json`), or a moved home. The root
 *   stays out of service until a person claims it with `ri home claim`,
 *   which makes this machine the host.
 *
 * `machine.json` also records this machine's fingerprint and the folder's
 * real location. A whole-folder copy carries `machine.json` along, so a copy
 * on another device (Migration Assistant, a disk clone) or in another
 * folder needs claiming too. What this can't stop: after a copy is claimed,
 * the original still runs where it is until it's retired (P5.3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { getAppRoot, getMachineIdentityPath, getDbPath } from '@/lib/config/paths';
import { canonicalPath } from '@/lib/config/canonical-path';
import { machineFingerprint } from './machine-fingerprint';
import {
  createDevice,
  createHomeIdentity,
  getDevice,
  getHome,
  giveHostItsKeys,
  moveHomeHost,
} from '@/lib/db/queries';
import type { DeviceRecord, HomeKind, HomeRecord } from '@/db/types';
import { thisDeviceFacts } from './device-name';

export { defaultDeviceName } from './device-name';

export const MACHINE_IDENTITY_VERSION = 1;

export interface MachineIdentity {
  version: number;
  homeId: string;
  deviceId: string;
  createdAt: string;
  /** This machine's fingerprint when written (src/lib/home/machine-fingerprint.ts). */
  machine?: string | null;
  /** The home folder's real location when written. */
  root?: string;
}

/** What binds the identity to this machine and this folder. */
function binding(): { machine: string | null; root: string } {
  return { machine: machineFingerprint(), root: canonicalPath(getAppRoot()) };
}

export type NeedsClaimReason =
  /** No machine identity: a restored backup or a copied root. */
  | 'no_machine_identity'
  /** This machine's identity belongs to a different home. */
  | 'other_home'
  /** The home is hosted by another device, e.g. after a move. */
  | 'other_host'
  /** The whole folder was copied or moved here from another device. */
  | 'other_machine'
  /** The whole folder was copied or moved to another place on this device. */
  | 'moved_or_copied';

export type HomeIdentityStatus =
  | { state: 'active'; home: HomeRecord; device: DeviceRecord; created: boolean }
  | { state: 'needs_claim'; home: HomeRecord; reason: NeedsClaimReason; machine: MachineIdentity | null };

export class HomeIdentityError extends Error {
  constructor(
    message: string,
    readonly reason: NeedsClaimReason,
  ) {
    super(message);
    this.name = 'HomeIdentityError';
  }
}

export function readMachineIdentity(): MachineIdentity | null {
  const file = getMachineIdentityPath();
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MachineIdentity> & { computerId?: string };
  // Written as `computerId` before devices were named devices (2026-09-29).
  parsed.deviceId ??= parsed.computerId;
  if (typeof parsed.homeId !== 'string' || typeof parsed.deviceId !== 'string') {
    throw new Error(`${file} is malformed. Move it aside and run \`ri home claim\` to rebuild it.`);
  }
  return {
    version: parsed.version ?? MACHINE_IDENTITY_VERSION,
    homeId: parsed.homeId,
    deviceId: parsed.deviceId,
    createdAt: parsed.createdAt ?? new Date().toISOString(),
    ...(parsed.machine !== undefined ? { machine: parsed.machine } : {}),
    ...(parsed.root !== undefined ? { root: parsed.root } : {}),
  };
}

/** Atomic write, 0600 in a 0700 directory. */
export function writeMachineIdentity(
  identity: Omit<MachineIdentity, 'version' | 'machine' | 'root'>,
): MachineIdentity {
  const file = getMachineIdentityPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const record: MachineIdentity = { version: MACHINE_IDENTITY_VERSION, ...identity, ...binding() };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return record;
}

/**
 * Write the identity only if none exists yet, and return whichever one won.
 * Two processes booting a new root at once (the CLI's `start` and the
 * server) must end up with the same ids, or the loser would find itself a
 * stranger in its own home.
 */
function writeMachineIdentityOnce(identity: Omit<MachineIdentity, 'version' | 'machine' | 'root'>): MachineIdentity {
  const file = getMachineIdentityPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: MACHINE_IDENTITY_VERSION, ...identity, ...binding() }, null, 2) + '\n', {
    mode: 0o600,
  });
  try {
    fs.linkSync(tmp, file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return readMachineIdentity()!;
}

export interface ResolveOptions {
  /** Name for a home made now. */
  name?: string;
  /** Kind for a home made now. A fact: callers that make spaces pass `team`. */
  kind?: HomeKind;
}

/** Work out this root's identity, making the home when it has none yet. */
export function resolveHomeIdentity(opts: ResolveOptions = {}): HomeIdentityStatus {
  const current = getHome();
  const machine = readMachineIdentity();

  if (!current) {
    const ids =
      machine ?? writeMachineIdentityOnce({ homeId: uuidv7(), deviceId: uuidv7(), createdAt: new Date().toISOString() });
    try {
      const made = createHomeIdentity({
        homeId: ids.homeId,
        kind: opts.kind ?? 'personal',
        name: opts.name ?? 'My Ri',
        host: { id: ids.deviceId, kind: 'computer', ...thisDeviceFacts() },
      });
      return { state: 'active', home: made.home, device: made.device, created: true };
    } catch (err) {
      // Another process made the home first. Its row decides.
      if (!getHome()) throw err;
      return resolveHomeIdentity(opts);
    }
  }

  if (!machine) return { state: 'needs_claim', home: current, reason: 'no_machine_identity', machine };
  if (machine.homeId !== current.id) return { state: 'needs_claim', home: current, reason: 'other_home', machine };
  if (machine.deviceId !== current.hostDeviceId) {
    return { state: 'needs_claim', home: current, reason: 'other_host', machine };
  }
  const here = binding();
  if (machine.machine && here.machine && machine.machine !== here.machine) {
    return { state: 'needs_claim', home: current, reason: 'other_machine', machine };
  }
  if (machine.root && machine.root !== here.root) {
    return { state: 'needs_claim', home: current, reason: 'moved_or_copied', machine };
  }
  // Written before identities were bound to a machine and folder: bind now.
  if (machine.machine === undefined || machine.root === undefined) {
    writeMachineIdentity({ homeId: machine.homeId, deviceId: machine.deviceId, createdAt: machine.createdAt });
  }
  const device = getDevice(current.hostDeviceId);
  if (!device) throw new Error(`Home ${current.id} names host ${current.hostDeviceId}, which does not exist.`);
  return { state: 'active', home: current, device, created: false };
}

export function describeNeedsClaim(reason: NeedsClaimReason): string {
  const why = {
    no_machine_identity: 'This data was restored or copied here, so this device is not recorded as its host.',
    other_home: 'This device belongs to a different home than the data in this folder.',
    other_host: 'This home is hosted by another device.',
    other_machine: 'This home was copied or moved here from another device, which may still be running it.',
    moved_or_copied: 'This home was copied or moved to this folder from another place on this device.',
  }[reason];
  return `${why} If this device should now be the home, run \`ri home claim\`. Until then it will not act as the home, so two copies never run as one.`;
}

/**
 * What was verified for this database: the ids, which never change while the
 * process runs. The rows are read fresh on every call, so a rename shows at
 * once, and the check against `machine.json` isn't repeated per request.
 */
let verified: { dbPath: string; homeId: string; deviceId: string } | null = null;

/**
 * The identity for boot paths and handlers, made on first use. Throws
 * `HomeIdentityError` when the root needs claiming.
 */
export function ensureHomeIdentity(opts: ResolveOptions = {}): Extract<HomeIdentityStatus, { state: 'active' }> {
  const dbPath = getDbPath();
  if (verified && verified.dbPath === dbPath) {
    const current = getHome();
    const device = current ? getDevice(verified.deviceId) : null;
    if (current && device && current.id === verified.homeId && current.hostDeviceId === verified.deviceId) {
      return { state: 'active', home: current, device, created: false };
    }
    verified = null;
  }
  const status = resolveHomeIdentity(opts);
  if (status.state === 'needs_claim') {
    throw new HomeIdentityError(describeNeedsClaim(status.reason), status.reason);
  }
  // The home's own keys made before its identity are its device's.
  giveHostItsKeys();
  verified = { dbPath, homeId: status.home.id, deviceId: status.device.id };
  return status;
}

/** Whether this root may act as the home. Never throws, and cheap once verified. */
export function isHomeActive(): boolean {
  if (verified && verified.dbPath === getDbPath()) return true;
  try {
    ensureHomeIdentity();
    return true;
  } catch {
    return false;
  }
}

export function resetHomeIdentityCache(): void {
  verified = null;
}

export interface ClaimOptions {
  /**
   * Which of the home's devices this machine is: an existing one's id (the
   * host, when a backup is restored on the same device, or the always-on
   * device the home moves to), or `new` for a device new to the home.
   * Without it, this machine's own record when the home already knows it,
   * else a new one.
   */
  as?: string | 'new';
}

/**
 * Make this machine the host of the home in this root (§10.3: a restored
 * root is explicitly selected as the active home). When that's a different
 * device from the one that hosted it, what ran there is pinned to it
 * (`moveHomeHost`), and it stays a device of the home.
 */
export function claimHome(opts: ClaimOptions = {}): Extract<HomeIdentityStatus, { state: 'active' }> & { moved: ReturnType<typeof moveHomeHost> | null } {
  const status = resolveHomeIdentity();
  if (status.state === 'active' && !opts.as) return { ...status, moved: null };
  let device: DeviceRecord;
  if (opts.as === 'new') {
    device = createDevice({ kind: 'computer', ...thisDeviceFacts() });
  } else if (opts.as) {
    const named = getDevice(opts.as);
    if (!named || named.status !== 'active') throw new Error(`${opts.as} is not an active device of this home.`);
    device = named;
  } else {
    // The device row this machine already has, unless the folder came from
    // different hardware: then this is a new device, and the old one stays
    // a device of the home.
    const needs = status as Extract<HomeIdentityStatus, { state: 'needs_claim' }>;
    const sameHardware = needs.reason !== 'other_machine';
    const known =
      sameHardware && needs.machine && needs.machine.homeId === needs.home.id ? getDevice(needs.machine.deviceId) : null;
    device = known && known.status === 'active' ? known : createDevice({ kind: 'computer', ...thisDeviceFacts() });
  }
  const moved = moveHomeHost(device.id);
  writeMachineIdentity({ homeId: status.home.id, deviceId: device.id, createdAt: new Date().toISOString() });
  resetHomeIdentityCache();
  return { ...ensureHomeIdentity(), moved: moved.from === moved.to ? null : moved };
}
