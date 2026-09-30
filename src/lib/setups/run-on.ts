/**
 * Where an agent's new executions run (docs/homes-spec.md §3.3, P3.1).
 *
 * The choices are the devices the agent is set up on: the home first, then
 * the others in the order they were set up. The default is the one the person
 * saved with "Make this the default". Until they save one, it's the home when
 * its setup there is usable, otherwise the first device set up for the
 * agent. A one-off "Run on" choice never changes it.
 *
 * A device that can't take the work is still a choice, with the reason, and
 * a start on it is refused with that reason. Nothing is ever swapped for
 * another device: not a one-off choice, and not a saved default that has
 * since stopped working. Every other device that runs agents is a choice
 * too, after those, marked as needing the agent set up there, which the app
 * offers to do.
 */

import {
  getDevice,
  getHome,
  getWorkspace,
  listWorkspaceSetups,
  listEnrolledDeviceIds,
  updateWorkspace,
  type WorkspaceSetupWithDevice,
} from '@/lib/db/queries';
import { isDeviceConnected } from '@/lib/workers/hub';

export interface RunOnChoice {
  deviceId: string;
  /** The device's name, as the person named it: MacBook, Mac Mini. Never a hostname or address. */
  name: string;
  /** The home's own device. */
  isHome: boolean;
  /** Work can be started here. */
  ready: boolean;
  /** Why it can't, when it can't. */
  problem: string | null;
  /** Its worker is connected now. Work started while it isn't waits for it. The home is always connected. */
  connected: boolean;
  /**
   * The agent isn't on this device yet, and can be set up there from the
   * app (docs/homes-model.md): offered rather than a dead end.
   */
  needsSetup: boolean;
}

export interface RunOn {
  choices: RunOnChoice[];
  /** What the person saved with "Make this the default", or null when they never have. */
  savedDefaultId: string | null;
  /** Where a new execution runs when the start names no device. Null only for a home with no identity yet. */
  defaultId: string | null;
  /**
   * The device the agent lives on, and its folder there (spec §5.6, §7):
   * the home when it's set up there, or has no setup anywhere yet, and
   * otherwise its default. Its main chat is pinned there, and its own Files
   * and Terminal open there. Null only for a home with no identity yet.
   */
  livesOn: { deviceId: string; name: string; isHome: boolean; folder: string | null } | null;
}

export class RunOnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunOnError';
  }
}

/**
 * Whether work can start with a setup: its folders found, or not checked
 * yet (a device that's away checks them when it's back, and again before
 * it prepares work). A folder found missing, or a linked folder not chosen,
 * is a problem to fix first (docs/homes-spec.md §4.1).
 */
export function setupUsable(status: string): boolean {
  return status === 'ready' || status === 'unchecked';
}

/** Why a setup can't take work: its own problem, a whole sentence, or its status in one. */
export function setupProblem(where: string, setup: { problem: string | null; status: string }): string {
  return setup.problem ?? notReady(where, setup);
}

/** A setup's problem inside a sentence, which ends once whether or not the problem does. */
export function notReady(folder: string, setup: { problem: string | null; status: string }): string {
  const reason = (setup.problem ?? setup.status).trim().replace(/[.!]+$/, '');
  return `${folder} isn't ready: ${reason}.`;
}

function problemOf(agentName: string, deviceName: string, setup: WorkspaceSetupWithDevice | undefined, enrolled: boolean): string | null {
  if (!setup) return `${agentName} isn't on ${deviceName} yet.`;
  if (!enrolled) return `${deviceName} isn't set up to run agents. Run \`ri worker enroll\` there first.`;
  if (!setupUsable(setup.status)) return setupProblem(`${agentName}'s folder on ${deviceName}`, setup);
  return null;
}

export function runOnFor(workspaceId: string): RunOn | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;
  const host = getHome()?.hostDeviceId ?? null;
  const setups = listWorkspaceSetups({ workspaceId }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const enrolled = listEnrolledDeviceIds();
  const choices: RunOnChoice[] = [];

  // The home: its own setup, or no setup anywhere, for an agent from before
  // setups, which runs in its folder here. Its setup can be imperfect (a
  // reference missing, say) and still run: a start here has never been
  // refused for that, so the reason is shown, not enforced.
  const homeSetup = host ? setups.find((s) => s.deviceId === host) : undefined;
  if (host && (homeSetup || setups.length === 0)) {
    choices.push({
      deviceId: host,
      name: getDevice(host)?.name ?? 'This home',
      isHome: true,
      ready: !homeSetup || setupUsable(homeSetup.status),
      problem: homeSetup && !setupUsable(homeSetup.status) ? setupProblem(`${ws.name}'s folder here`, homeSetup) : null,
      connected: true,
      needsSetup: false,
    });
  }
  for (const setup of setups) {
    if (setup.deviceId === host) continue;
    const device = getDevice(setup.deviceId);
    if (!device || device.status !== 'active') continue;
    const isEnrolled = enrolled.has(device.id);
    const problem = problemOf(ws.name, device.name, setup, isEnrolled);
    choices.push({
      deviceId: device.id,
      name: device.name,
      isHome: false,
      ready: problem === null,
      problem,
      connected: isEnrolled && isDeviceConnected(device.id),
      needsSetup: false,
    });
  }

  // The other devices that run agents, where it isn't yet: set up from
  // the app when the person picks one.
  const others = [...enrolled]
    .filter((id) => id !== host && !choices.some((c) => c.deviceId === id))
    .map((id) => getDevice(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.status === 'active')
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const device of others) {
    choices.push({
      deviceId: device.id,
      name: device.name,
      isHome: false,
      ready: false,
      problem: problemOf(ws.name, device.name, undefined, true),
      connected: isDeviceConnected(device.id),
      needsSetup: true,
    });
  }

  // A saved default that's no longer set up stays the default, shown with
  // why it can't run, until the person picks again.
  const saved = ws.defaultDeviceId ?? null;
  if (saved && !choices.some((c) => c.deviceId === saved)) {
    const device = getDevice(saved);
    choices.push({
      deviceId: saved,
      name: device?.name ?? 'A removed device',
      isHome: saved === host,
      ready: false,
      problem:
        !device || device.status !== 'active'
          ? `${device?.name ?? 'That device'} is no longer connected to this home.`
          : problemOf(ws.name, device.name, undefined, enrolled.has(saved)),
      connected: false,
      needsSetup: false,
    });
  }

  const defaultId =
    saved
    ?? choices.find((c) => c.isHome && c.ready)?.deviceId
    ?? choices.find((c) => c.ready)?.deviceId
    ?? choices[0]?.deviceId
    ?? host;
  const livesOnId = choices.some((c) => c.isHome) ? host : defaultId;
  const livesOn = livesOnId
    ? {
        deviceId: livesOnId,
        name: choices.find((c) => c.deviceId === livesOnId)?.name ?? getDevice(livesOnId)?.name ?? 'This home',
        isHome: livesOnId === host,
        folder:
          livesOnId === host
            ? (homeSetup?.sourcePath ?? ws.cwd)
            : (setups.find((s) => s.deviceId === livesOnId)?.sourcePath ?? null),
      }
    : null;
  return { choices, savedDefaultId: saved, defaultId, livesOn };
}

/**
 * Why the home can't start new work for an agent, or null when it can (spec
 * §7, P3.4). Scheduled work always starts on the home, the one scheduler: an
 * agent set up only on other devices has no folder here to run it in, and
 * the fire isn't sent to another device instead. An agent from before
 * setups runs in its folder here, and an imperfect setup here still runs.
 */
export function homeCantRun(workspaceId: string): string | null {
  const ws = getWorkspace(workspaceId);
  const host = getHome()?.hostDeviceId ?? null;
  if (!ws || !host) return null;
  const setups = listWorkspaceSetups({ workspaceId });
  if (setups.length === 0 || setups.some((s) => s.deviceId === host)) return null;
  const name = getDevice(host)?.name ?? 'this home';
  return `${ws.name} isn't set up on ${name}, where scheduled work runs. Attach its folder there to run this.`;
}

/**
 * The device an agent lives on (spec §5.6 and §7): the home when the agent
 * is set up there, or has no setup anywhere yet, and otherwise its default
 * device. Null means the home. A new main chat is pinned to it (P3.4),
 * and keeps it: it's never cloned or moved, and its history stays readable
 * while that device is away. The agent's own terminals open there (P3.5).
 */
export function agentDeviceFor(workspaceId: string): string | null {
  const livesOn = runOnFor(workspaceId)?.livesOn;
  return livesOn && !livesOn.isHome ? livesOn.deviceId : null;
}

/**
 * Save or clear an agent's default device ("Make this the default"). Only
 * a device the agent can be pointed at: one it's set up on, or the home.
 */
export function setDefaultDevice(workspaceId: string, deviceId: string | null): RunOn {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new RunOnError('No such agent.');
  if (deviceId !== null) {
    const device = getDevice(deviceId);
    if (!device || device.status !== 'active') throw new RunOnError('That device is no longer connected to this home.');
    const isHome = deviceId === getHome()?.hostDeviceId;
    if (!isHome && !listWorkspaceSetups({ workspaceId, deviceId }).length) {
      throw new RunOnError(`${ws.name} isn't on ${device.name} yet. Set it up there first.`);
    }
  }
  updateWorkspace(workspaceId, { defaultDeviceId: deviceId });
  return runOnFor(workspaceId)!;
}
