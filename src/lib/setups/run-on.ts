/**
 * Where an agent's new executions run (docs/homes-spec.md §3.3, P3.1).
 *
 * The choices are the computers the agent is set up on: the home first, then
 * the others in the order they were set up. The default is the one the person
 * saved with "Make this the default". Until they save one, it's the home when
 * its setup there is usable, otherwise the first computer set up for the
 * agent. A one-off "Run on" choice never changes it.
 *
 * A computer that can't take the work is still a choice, with the reason, and
 * a start on it is refused with that reason. Nothing is ever swapped for
 * another computer: not a one-off choice, and not a saved default that has
 * since stopped working.
 */

import {
  getComputer,
  getHome,
  getWorkspace,
  listAgentSetups,
  listEnrolledComputerIds,
  updateWorkspace,
  type AgentSetupWithComputer,
} from '@/lib/db/queries';
import { isComputerConnected } from '@/lib/workers/hub';

export interface RunOnChoice {
  computerId: string;
  /** The computer's name, as the person named it: MacBook, Mac Mini. Never a hostname or address. */
  name: string;
  /** The home's own computer. */
  isHome: boolean;
  /** Work can be started here. */
  ready: boolean;
  /** Why it can't, when it can't. */
  problem: string | null;
  /** Its worker is connected now. Work started while it isn't waits for it. The home is always connected. */
  connected: boolean;
}

export interface RunOn {
  choices: RunOnChoice[];
  /** What the person saved with "Make this the default", or null when they never have. */
  savedDefaultId: string | null;
  /** Where a new execution runs when the start names no computer. Null only for a home with no identity yet. */
  defaultId: string | null;
  /**
   * The computer the agent lives on, and its folder there (spec §5.6, §7):
   * the home when it's set up there, or has no setup anywhere yet, and
   * otherwise its default. Its main chat is pinned there, and its own Files
   * and Terminal open there. Null only for a home with no identity yet.
   */
  livesOn: { computerId: string; name: string; isHome: boolean; folder: string | null } | null;
}

export class RunOnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunOnError';
  }
}

/** A setup's problem inside a sentence, which ends once whether or not the problem does. */
export function notReady(folder: string, setup: { problem: string | null; status: string }): string {
  const reason = (setup.problem ?? setup.status).trim().replace(/[.!]+$/, '');
  return `${folder} isn't ready: ${reason}.`;
}

function problemOf(agentName: string, computerName: string, setup: AgentSetupWithComputer | undefined, enrolled: boolean): string | null {
  if (!setup) return `${agentName} isn't set up on ${computerName}. Attach its folder there, or pick another computer.`;
  if (!enrolled) return `${computerName} isn't set up to run agents. Run \`ri worker enroll\` there first.`;
  if (setup.status !== 'ready') return notReady(`${agentName}'s folder on ${computerName}`, setup);
  return null;
}

export function runOnFor(workspaceId: string): RunOn | null {
  const ws = getWorkspace(workspaceId);
  if (!ws) return null;
  const host = getHome()?.hostComputerId ?? null;
  const setups = listAgentSetups({ workspaceId }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const enrolled = listEnrolledComputerIds();
  const choices: RunOnChoice[] = [];

  // The home: its own setup, or no setup anywhere, for an agent from before
  // setups, which runs in its folder here. Its setup can be imperfect (a
  // reference missing, say) and still run: a start here has never been
  // refused for that, so the reason is shown, not enforced.
  const homeSetup = host ? setups.find((s) => s.computerId === host) : undefined;
  if (host && (homeSetup || setups.length === 0)) {
    choices.push({
      computerId: host,
      name: getComputer(host)?.name ?? 'This home',
      isHome: true,
      ready: !homeSetup || homeSetup.status === 'ready',
      problem: homeSetup && homeSetup.status !== 'ready' ? notReady(`${ws.name}'s folder here`, homeSetup) : null,
      connected: true,
    });
  }
  for (const setup of setups) {
    if (setup.computerId === host) continue;
    const computer = getComputer(setup.computerId);
    if (!computer || computer.status !== 'active') continue;
    const isEnrolled = enrolled.has(computer.id);
    const problem = problemOf(ws.name, computer.name, setup, isEnrolled);
    choices.push({
      computerId: computer.id,
      name: computer.name,
      isHome: false,
      ready: problem === null,
      problem,
      connected: isEnrolled && isComputerConnected(computer.id),
    });
  }

  // A saved default that's no longer set up stays the default, shown with
  // why it can't run, until the person picks again.
  const saved = ws.defaultComputerId ?? null;
  if (saved && !choices.some((c) => c.computerId === saved)) {
    const computer = getComputer(saved);
    choices.push({
      computerId: saved,
      name: computer?.name ?? 'A removed computer',
      isHome: saved === host,
      ready: false,
      problem:
        !computer || computer.status !== 'active'
          ? `${computer?.name ?? 'That computer'} is no longer connected to this home.`
          : problemOf(ws.name, computer.name, undefined, enrolled.has(saved)),
      connected: false,
    });
  }

  const defaultId =
    saved
    ?? choices.find((c) => c.isHome && c.ready)?.computerId
    ?? choices.find((c) => c.ready)?.computerId
    ?? choices[0]?.computerId
    ?? host;
  const livesOnId = choices.some((c) => c.isHome) ? host : defaultId;
  const livesOn = livesOnId
    ? {
        computerId: livesOnId,
        name: choices.find((c) => c.computerId === livesOnId)?.name ?? getComputer(livesOnId)?.name ?? 'This home',
        isHome: livesOnId === host,
        folder:
          livesOnId === host
            ? (homeSetup?.sourcePath ?? ws.cwd)
            : (setups.find((s) => s.computerId === livesOnId)?.sourcePath ?? null),
      }
    : null;
  return { choices, savedDefaultId: saved, defaultId, livesOn };
}

/**
 * Why the home can't start new work for an agent, or null when it can (spec
 * §7, P3.4). Scheduled work always starts on the home, the one scheduler: an
 * agent set up only on other computers has no folder here to run it in, and
 * the fire isn't sent to another computer instead. An agent from before
 * setups runs in its folder here, and an imperfect setup here still runs.
 */
export function homeCantRun(workspaceId: string): string | null {
  const ws = getWorkspace(workspaceId);
  const host = getHome()?.hostComputerId ?? null;
  if (!ws || !host) return null;
  const setups = listAgentSetups({ workspaceId });
  if (setups.length === 0 || setups.some((s) => s.computerId === host)) return null;
  const name = getComputer(host)?.name ?? 'this home';
  return `${ws.name} isn't set up on ${name}, where scheduled work runs. Attach its folder there to run this.`;
}

/**
 * The computer an agent lives on (spec §5.6 and §7): the home when the agent
 * is set up there, or has no setup anywhere yet, and otherwise its default
 * computer. Null means the home. A new main chat is pinned to it (P3.4),
 * and keeps it: it's never cloned or moved, and its history stays readable
 * while that computer is away. The agent's own terminals open there (P3.5).
 */
export function agentComputerFor(workspaceId: string): string | null {
  const livesOn = runOnFor(workspaceId)?.livesOn;
  return livesOn && !livesOn.isHome ? livesOn.computerId : null;
}

/**
 * Save or clear an agent's default computer ("Make this the default"). Only
 * a computer the agent can be pointed at: one it's set up on, or the home.
 */
export function setDefaultComputer(workspaceId: string, computerId: string | null): RunOn {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new RunOnError('No such agent.');
  if (computerId !== null) {
    const computer = getComputer(computerId);
    if (!computer || computer.status !== 'active') throw new RunOnError('That computer is no longer connected to this home.');
    const isHome = computerId === getHome()?.hostComputerId;
    if (!isHome && !listAgentSetups({ workspaceId, computerId }).length) {
      throw new RunOnError(`${ws.name} isn't set up on ${computer.name}. Attach its folder there first.`);
    }
  }
  updateWorkspace(workspaceId, { defaultComputerId: computerId });
  return runOnFor(workspaceId)!;
}
