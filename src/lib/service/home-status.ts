/**
 * What `ri status` says about a Home's running (docs/always-on-spec.md 4.1):
 * running or stopped, since when, the last restart and why, the versions on
 * this computer and in the Home, supervision, memory and the update state.
 * Kept free of I/O, so the wording is tested as people read it.
 */
import type { ServiceStatus } from './client';

export interface HomeStatusFacts {
  status: ServiceStatus | null;
  supervised: boolean;
  /** A stop the owner recorded (section 6.4). */
  stopped: { at: string } | null;
  /** The newest release on this computer, what `ri` runs. */
  computer: { version: string; commit: string | null } | null;
  /** The commit of the release the Home runs, when it was built from a checkout. */
  homeCommit: string | null;
  /** Its address, when it was started by hand instead of under the service. */
  manual?: string | null;
  now: number;
}

function ago(at: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(at)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function version(release: { version: string; commit: string | null }) {
  return release.commit ? `main ${release.commit.slice(0, 8)}` : release.version;
}

const MIB = 1024 * 1024;

/** A Home that should be serving and isn't. One its owner stopped is fine. */
export function homeIsDown(facts: Pick<HomeStatusFacts, 'status' | 'stopped' | 'manual'>) {
  if (facts.status) return facts.status.phase !== 'running';
  return !facts.stopped && !facts.manual;
}

/** One line for a Home in the list of everything on this computer. */
export function summarizeHome(facts: HomeStatusFacts) {
  const lines = describeHomeStatus(facts);
  const pick = (label: string) => lines.find(([name]) => name === label)?.[1];
  // The first sentence: the full line's advice belongs to `ri status --root`.
  const state = pick('state')?.split(/\.(?:\s|$)/)[0];
  return [state, pick('error'), pick('version'), facts.supervised ? 'kept up by the OS' : 'not kept up'].filter(Boolean).join(', ');
}

/** Label and value pairs, in the order they print. */
export function describeHomeStatus(facts: HomeStatusFacts): [string, string][] {
  const { status, now } = facts;
  const lines: [string, string][] = [];
  if (!status && facts.manual) {
    lines.push(['state', `running at ${facts.manual}, started by hand`]);
  } else if (!status) {
    lines.push(['state', facts.stopped
      ? `stopped by you ${ago(facts.stopped.at, now)}. It stays stopped until \`ri start\`.`
      : facts.supervised ? 'not running. Ri starts it at login, or now with `ri start`. See `ri logs`.' : 'not running. Start it with `ri start`.']);
  } else if (status.phase === 'running') {
    lines.push(['state', `running${status.since ? ` since ${ago(status.since, now)}` : ''}${status.origin ? ` at ${status.origin}` : ''}`]);
  } else if (status.phase === 'restarting') {
    const next = status.restarts?.nextAttemptAt;
    lines.push(['state', `restarting${status.restarts?.crashLoop ? ', slowly because it keeps crashing' : ''}${next ? `. Next try ${new Date(next).toLocaleTimeString()}` : ''}`]);
    if (status.error) lines.push(['error', status.error]);
  } else {
    lines.push(['state', status.phase]);
    if (status.error) lines.push(['error', status.error]);
  }
  if (status?.restarts?.last) lines.push(['restart', `${ago(status.restarts.last.at, now)}: ${status.restarts.last.reason}`]);
  if (status?.restartPending) lines.push(['restart', `waiting for ${status.restartPending.waitingFor}, then: ${status.restartPending.reason}`]);
  const home = status?.release ? version({ version: status.release.release.version, commit: facts.homeCommit }) : null;
  const computer = facts.computer ? version(facts.computer) : null;
  if (home || computer) lines.push(['version', home && computer && home !== computer ? `${home}, and ${computer} on this computer` : (home ?? computer)!]);
  lines.push(['kept up', facts.supervised ? 'yes, by the OS, after crashes and restarts' : facts.manual ? 'no. `ri stop`, then `ri start` keeps it running' : 'no. `ri start` keeps it running']);
  if (status?.memory) {
    const share = Math.round(status.memory.heapUsed / status.memory.heapLimit * 100);
    lines.push(['memory', `${Math.round(status.memory.heapUsed / MIB)} of ${Math.round(status.memory.heapLimit / MIB)} MiB heap (${share}%), ${Math.round(status.memory.rss / MIB)} MiB in all`]);
  }
  const update = status?.update;
  if (update) {
    const target = update.release?.version;
    const said = update.phase === 'waiting' ? `waiting: ${update.reason ?? 'for the Home to be idle'}`
      : update.phase === 'ready' ? `${target ?? 'an update'} is ready`
      : update.phase === 'failed' || update.phase === 'recovery-required' ? `${update.phase === 'failed' ? 'failed' : 'needs recovery'}: ${update.error ?? 'see `ri logs`'}`
      : update.phase === 'idle' || update.phase === 'committed' ? 'up to date' : update.phase;
    lines.push(['update', said]);
  }
  return lines;
}
