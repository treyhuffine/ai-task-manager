/**
 * Home and computer identity (docs/homes-spec.md §2.2, §5.1, §10.3).
 *
 * A home has a stable id that no address or machine change alters, and a
 * host computer whose in-process runner serves it. The database says which
 * home it is and which computer hosts it. The machine says which computer it
 * is, in `<config>/machine.json`. The two must agree before this root acts
 * as the home:
 *
 * - No home row yet (a new database, or one from before this build): make
 *   the home and this machine's computer row. The ids are written to
 *   `machine.json` first, so a crash between the two steps repeats them.
 * - Home row and matching `machine.json`: active.
 * - Anything else means the database came from somewhere else: a restored
 *   backup (which never carries `machine.json`), a copied root, or a moved
 *   home. The root stays out of service until a person claims it with
 *   `ri home claim`, which makes this machine the host. Two roots never act
 *   as one home by accident.
 */

import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { getMachineIdentityPath, getDbPath } from '@/lib/config/paths';
import {
  createComputer,
  createHomeIdentity,
  getComputer,
  getHome,
  setHomeHost,
} from '@/lib/db/queries';
import type { ComputerRecord, HomeKind, HomeRecord } from '@/db/types';
import { thisComputerFacts } from './computer-name';

export { defaultComputerName } from './computer-name';

export const MACHINE_IDENTITY_VERSION = 1;

export interface MachineIdentity {
  version: number;
  homeId: string;
  computerId: string;
  createdAt: string;
}

export type NeedsClaimReason =
  /** No machine identity: a restored backup or a copied root. */
  | 'no_machine_identity'
  /** This machine's identity belongs to a different home. */
  | 'other_home'
  /** The home is hosted by another computer, e.g. after a move. */
  | 'other_host';

export type HomeIdentityStatus =
  | { state: 'active'; home: HomeRecord; computer: ComputerRecord; created: boolean }
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
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<MachineIdentity>;
  if (typeof parsed.homeId !== 'string' || typeof parsed.computerId !== 'string') {
    throw new Error(`${file} is malformed. Move it aside and run \`ri home claim\` to rebuild it.`);
  }
  return {
    version: parsed.version ?? MACHINE_IDENTITY_VERSION,
    homeId: parsed.homeId,
    computerId: parsed.computerId,
    createdAt: parsed.createdAt ?? new Date().toISOString(),
  };
}

/** Atomic write, 0600 in a 0700 directory. */
export function writeMachineIdentity(identity: Omit<MachineIdentity, 'version'>): MachineIdentity {
  const file = getMachineIdentityPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const record: MachineIdentity = { version: MACHINE_IDENTITY_VERSION, ...identity };
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
function writeMachineIdentityOnce(identity: Omit<MachineIdentity, 'version'>): MachineIdentity {
  const file = getMachineIdentityPath();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: MACHINE_IDENTITY_VERSION, ...identity }, null, 2) + '\n', {
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
      machine ?? writeMachineIdentityOnce({ homeId: uuidv7(), computerId: uuidv7(), createdAt: new Date().toISOString() });
    try {
      const made = createHomeIdentity({
        homeId: ids.homeId,
        kind: opts.kind ?? 'personal',
        name: opts.name ?? 'My Ri',
        host: { id: ids.computerId, ...thisComputerFacts() },
      });
      return { state: 'active', home: made.home, computer: made.computer, created: true };
    } catch (err) {
      // Another process made the home first. Its row decides.
      if (!getHome()) throw err;
      return resolveHomeIdentity(opts);
    }
  }

  if (!machine) return { state: 'needs_claim', home: current, reason: 'no_machine_identity', machine };
  if (machine.homeId !== current.id) return { state: 'needs_claim', home: current, reason: 'other_home', machine };
  if (machine.computerId !== current.hostComputerId) {
    return { state: 'needs_claim', home: current, reason: 'other_host', machine };
  }
  const computer = getComputer(current.hostComputerId);
  if (!computer) throw new Error(`Home ${current.id} names host ${current.hostComputerId}, which does not exist.`);
  return { state: 'active', home: current, computer, created: false };
}

export function describeNeedsClaim(reason: NeedsClaimReason): string {
  const why = {
    no_machine_identity: 'This data was restored or copied here, so this computer is not recorded as its host.',
    other_home: 'This computer belongs to a different home than the data in this folder.',
    other_host: 'This home is hosted by another computer.',
  }[reason];
  return `${why} If this computer should now be the home, run \`ri home claim\`. Until then it will not act as the home, so two copies never run as one.`;
}

let cached: { dbPath: string; status: HomeIdentityStatus } | null = null;

/**
 * The identity for boot paths: memoized per database, made on first use.
 * Throws `HomeIdentityError` when the root needs claiming.
 */
export function ensureHomeIdentity(opts: ResolveOptions = {}): Extract<HomeIdentityStatus, { state: 'active' }> {
  const dbPath = getDbPath();
  if (!cached || cached.dbPath !== dbPath) cached = { dbPath, status: resolveHomeIdentity(opts) };
  const status = cached.status;
  if (status.state === 'needs_claim') {
    cached = null;
    throw new HomeIdentityError(describeNeedsClaim(status.reason), status.reason);
  }
  return status;
}

/** Whether this root may act as the home. Never throws. */
export function isHomeActive(): boolean {
  try {
    ensureHomeIdentity();
    return true;
  } catch {
    return false;
  }
}

export function resetHomeIdentityCache(): void {
  cached = null;
}

/**
 * Make this machine the host of the home in this root (§10.3: a restored
 * root is explicitly selected as the active home). Reuses this machine's
 * computer row when the home already knows it, and adds one otherwise.
 */
export function claimHome(): Extract<HomeIdentityStatus, { state: 'active' }> {
  const status = resolveHomeIdentity();
  if (status.state === 'active') return status;
  const known = status.machine && status.machine.homeId === status.home.id ? getComputer(status.machine.computerId) : null;
  const computer = known && known.status === 'active' ? known : createComputer(thisComputerFacts());
  setHomeHost(computer.id);
  writeMachineIdentity({ homeId: status.home.id, computerId: computer.id, createdAt: new Date().toISOString() });
  resetHomeIdentityCache();
  return ensureHomeIdentity();
}
