/**
 * One harness per chat (docs/homes-build.md, "One harness per chat").
 *
 * A harness is a child of the process running this runner, driven over its
 * pipes. When that process dies without closing it (a crash, or a stop that
 * never reached the sessions), the harness doesn't: it works on through its
 * turn with nothing reading it, then exits. Before this record, the next
 * message to the chat started a second harness on the same native session
 * while the first was still going. Found live: the second marked the first's
 * running tool call interrupted and answered as if it never ran, the first
 * then finished it and wrote the real result into the same transcript, and
 * both worked in the same folder.
 *
 * So every harness is written down by chat when it starts: its pid, start
 * time and parent, and the identity of the process that started it (its
 * owner). A clean close removes it. Three things read the record:
 *   - starting a chat's session first stops any recorded harness for that
 *     chat still running, so a chat never has two;
 *   - the home's startup stops every harness a previous server left;
 *   - the home's exit signals the harnesses it holds.
 *
 * A recorded process is signalled only while it's still that same process,
 * by kernel birth identity on Linux, or start time and parent elsewhere,
 * checked before each signal (the worker's rule, P2.7 to P2.9 review fixes). A harness whose owner is another
 * live process is never touched. Nothing unrecorded is touched either, so a
 * harness orphaned between its spawn and its record is missed, which is the
 * safe way to be wrong.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { stopWorkerDescendants, workerDescendants } from '@/lib/service/worker-processes';
import { writeFileAtomic } from '@/lib/worker/durable-file';
import {
  processIdentitiesSync,
  processIdentity,
  sameProcess,
  sameProcessLifetime,
  type ProcessIdentity,
} from '@/lib/worker/leftovers';
import { ExecutorError } from './errors';

interface HarnessProcessEntry {
  chatSessionId: string;
  /** The process whose runner started it. */
  owner: ProcessIdentity;
  process: ProcessIdentity;
  /** Captured before closing the root, so reparented descendants remain tracked. */
  descendants?: ProcessIdentity[];
}

export function harnessProcessRecordPath(): string {
  return path.join(getWorkDir(), 'harness-processes.json');
}

/** How long a stopped harness gets to exit on SIGTERM before SIGKILL. */
const STOP_GRACE_MS = 3_000;

// ─── This process ─────────────────────────────────────────────

const SELF_KEY = Symbol.for('@ri/harness-processes-self');
const selfRef = globalThis as unknown as { [SELF_KEY]?: Promise<ProcessIdentity | null> };

/** This process as `ps` shows it, looked up once. */
function selfIdentity(): Promise<ProcessIdentity | null> {
  if (!selfRef[SELF_KEY]) {
    const pending = processIdentity(process.pid);
    selfRef[SELF_KEY] = pending;
    // A transient ps failure is no evidence about process ownership. Retry
    // on the next inspection rather than permanently caching its rejection.
    void pending.then(identity => {
      if (!identity && selfRef[SELF_KEY] === pending) delete selfRef[SELF_KEY];
    }, () => { if (selfRef[SELF_KEY] === pending) delete selfRef[SELF_KEY]; });
  }
  return selfRef[SELF_KEY]!;
}

async function isSelf(owner: ProcessIdentity): Promise<boolean> {
  return owner.pid === process.pid && sameProcessLifetime(await selfIdentity(), owner) === true;
}
/** An unreadable recorded owner birth is not proof that another server died. */
function ownerAlive(now: ProcessIdentity | null, owner: ProcessIdentity) {
  return owner.birthId ? sameProcessLifetime(now, owner) !== false : sameProcess(now, owner);
}

// ─── The record ───────────────────────────────────────────────

function readEntries(file: string): HarnessProcessEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown };
    if (!Array.isArray(parsed?.entries) || !parsed.entries.every(validEntry)) {
      throw new Error('The harness process record is invalid. Repair the record before starting AI.');
    }
    return parsed.entries;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
function validEntry(value: unknown): value is HarnessProcessEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as HarnessProcessEntry;
  const identity = (value: ProcessIdentity | undefined) => !!value && Number.isSafeInteger(value.pid) && value.pid > 0
    && Number.isSafeInteger(value.ppid) && value.ppid >= 0 && typeof value.started === 'string' && !!value.started
    && typeof value.command === 'string' && !!value.command && (value.birthId === undefined || typeof value.birthId === 'string' && !!value.birthId);
  return typeof entry.chatSessionId === 'string' && !!entry.chatSessionId && identity(entry.owner) && identity(entry.process)
    && (entry.descendants === undefined || Array.isArray(entry.descendants) && entry.descendants.every(identity));
}

const CHAIN_KEY = Symbol.for('@ri/harness-processes-chain');
const chainRef = globalThis as unknown as { [CHAIN_KEY]?: Promise<unknown> };

/**
 * Read, change and write the record, one change at a time, so a slow check
 * never writes over a newer record. `change` returns the entries to keep and
 * a result.
 */
function update<T>(
  file: string,
  change: (entries: HarnessProcessEntry[]) => Promise<{ entries: HarnessProcessEntry[]; result: T }>,
): Promise<T> {
  const run = (chainRef[CHAIN_KEY] ?? Promise.resolve()).catch(() => {}).then(async () => {
    const before = readEntries(file);
    const { entries, result } = await change(before);
    if (entries.length !== before.length || entries.some((e, i) => e !== before[i])) {
      writeFileAtomic(file, JSON.stringify({ entries }));
    }
    return result;
  });
  chainRef[CHAIN_KEY] = run;
  return run;
}

/**
 * Write down the harness this runner just started for a chat. It replaces
 * this runner's earlier entry for the chat, whose process has closed or been
 * stopped by now (a harness that runs a process per turn records each one).
 */
export async function recordHarnessProcess(
  chatSessionId: string,
  pid: number,
  file = harnessProcessRecordPath(),
): Promise<void> {
  const [owner, harness] = await Promise.all([selfIdentity(), processIdentity(pid)]);
  // Gone already (it failed at start), or `ps` can't see us: nothing to keep.
  if (!owner || !harness) return;
  await update(file, async (entries) => {
    const kept: HarnessProcessEntry[] = [];
    for (const entry of entries) {
      if (entry.chatSessionId === chatSessionId && (await isSelf(entry.owner))) continue;
      kept.push(entry);
    }
    return { entries: [...kept, { chatSessionId, owner, process: harness }], result: undefined };
  });
}

/** Remove a chat's harness after it closed cleanly. Only that process: a newer one for the chat stays. */
export async function forgetHarnessProcess(
  chatSessionId: string,
  pid: number,
  file = harnessProcessRecordPath(),
): Promise<void> {
  await update(file, async (entries) => ({
    entries: entries.filter((e) => !(e.chatSessionId === chatSessionId && e.process.pid === pid)),
    result: undefined,
  }));
}

async function captureTree(entry: HarnessProcessEntry): Promise<HarnessProcessEntry> {
  if (sameProcessLifetime(await processIdentity(entry.process.pid), entry.process) !== true) return entry;
  const children = await workerDescendants(entry.process.pid);
  if (sameProcessLifetime(await processIdentity(entry.process.pid), entry.process) !== true) return entry;
  const descendants = new Map((entry.descendants ?? []).map(child => [child.pid, child]));
  for (const child of children) descendants.set(child.pid, child);
  return descendants.size ? { ...entry, descendants: [...descendants.values()] } : entry;
}
const tree = (entry: HarnessProcessEntry) => [...(entry.descendants ?? []), entry.process];
async function treeAlive(entry: HarnessProcessEntry) {
  for (const process of tree(entry)) if (sameProcessLifetime(await processIdentity(process.pid), process) !== false) return true;
  return false;
}

/** Snapshot while ownership and ancestry can still be verified. Serialized with record writes. */
export async function captureTrackedHarness(chatSessionId: string, pid: number, file = harnessProcessRecordPath()): Promise<void> {
  await update(file, async entries => {
    const entry = entries.find(value => value.chatSessionId === chatSessionId && value.process.pid === pid);
    if (!entry || !await isSelf(entry.owner)) return { entries, result: undefined };
    const captured = await captureTree(entry);
    return { entries: entries.map(value => value === entry ? captured : value), result: undefined };
  });
}

/** SDKs with per-turn processes report PIDs through lifecycle events rather
 * than a public handle. Keep the same ownership/identity rules for those. */
export async function captureChatHarnesses(chatSessionId: string, file = harnessProcessRecordPath()): Promise<number[]> {
  return update(file, async entries => {
    const captured: HarnessProcessEntry[] = [];
    for (const entry of entries) captured.push(entry.chatSessionId === chatSessionId && await isSelf(entry.owner) ? await captureTree(entry) : entry);
    return { entries: captured, result: captured.filter(entry => entry.chatSessionId === chatSessionId).map(entry => entry.process.pid) };
  });
}

interface HarnessRecoveryProblem { chatId: string; processes: ProcessIdentity[]; message: string }
/** A readable record narrows recovery to its owning chats. Other exceptions
 * (corrupt/unreadable records) still require Home-wide fail-closed recovery. */
export class HarnessProcessRecoveryError extends ExecutorError {
  constructor(readonly problems: HarnessRecoveryProblem[]) {
    super('already_running', problems.map(problem => problem.message).join(' '));
  }
}
async function recoveryProblems(entries: HarnessProcessEntry[], survivors: ProcessIdentity[]): Promise<HarnessRecoveryProblem[]> {
  const byChat = new Map<string, Map<number, ProcessIdentity>>();
  for (const entry of entries) {
    const processes = byChat.get(entry.chatSessionId) ?? new Map<number, ProcessIdentity>();
    for (const child of tree(entry)) {
      if (!survivors.some(value => value.pid === child.pid)) continue;
      const now = await processIdentity(child.pid);
      if (sameProcessLifetime(now, child) !== false) processes.set(child.pid, now ?? child);
    }
    if (processes.size) byChat.set(entry.chatSessionId, processes);
  }
  return [...byChat].map(([chatId, values]) => {
    const processes = [...values.values()];
    // Executable names identify the actual survivors without leaking command
    // arguments, which can include prompts or credentials.
    const descriptions = processes.map(value => `pid ${value.pid} (${path.basename(value.command.split(/\s+/)[0]).slice(0, 80)})`);
    return { chatId, processes, message: `This chat's previous harness could not be confirmed stopped: ${descriptions.join(', ')}. Ask the server owner to inspect these processes. Once they have stopped, use Restart chat to check again. Saved changes are preserved.` };
  });
}
async function removeStoppedEntries(file: string, stopped: HarnessProcessEntry[]) {
  const snapshots = new Set(stopped.map(entry => JSON.stringify(entry)));
  return update(file, async entries => {
    const kept = entries.filter(entry => !snapshots.has(JSON.stringify(entry)));
    return { entries: kept, result: kept };
  });
}
async function changedRecordError(entries: HarnessProcessEntry[]) {
  const problems = await recoveryProblems(entries, entries.flatMap(tree));
  for (const entry of entries) if (!problems.some(problem => problem.chatId === entry.chatSessionId)) {
    problems.push({ chatId: entry.chatSessionId, processes: [], message: 'This chat\'s process record changed during cleanup. Use Restart chat to check its latest processes before continuing.' });
  }
  return new HarnessProcessRecoveryError(problems);
}
async function stopRecordedTrees(entries: HarnessProcessEntry[], graceMs: number) {
  try { return await stopWorkerDescendants(entries.flatMap(tree), graceMs, sameProcessLifetime); }
  catch {
    // A signal failure still belongs to known chats. Keep all their records,
    // inspect the survivors and refuse only their work. If inspection itself
    // fails, that error propagates and startup remains globally fail-closed.
    const problems = await recoveryProblems(entries, entries.flatMap(tree));
    if (problems.length) throw new HarnessProcessRecoveryError(problems);
    return [];
  }
}

// ─── Stopping what shouldn't be running ───────────────────────

/**
 * Before a chat's session starts: stop any recorded harness for the chat
 * that is still running. That's one a previous server left, or one of this
 * runner's own it lost track of (a recycle whose close failed, a handle the
 * health check dropped as dead while its process lived on). Throws when one
 * belongs to another live process or won't stop, so the chat never gets a
 * second harness. Returns the pids stopped.
 */
export async function stopStrayHarness(
  chatSessionId: string,
  file = harnessProcessRecordPath(),
  graceMs = STOP_GRACE_MS,
): Promise<number[]> {
  // Most starts find nothing recorded for the chat: skip the queue.
  if (!readEntries(file).some((e) => e.chatSessionId === chatSessionId)) return [];
  const strays = await update(file, async (entries) => {
    const others = entries.filter((e) => e.chatSessionId !== chatSessionId);
    const strays: HarnessProcessEntry[] = [];
    for (const entry of entries) {
      if (entry.chatSessionId !== chatSessionId || !await treeAlive(entry)) continue;
      if (!(await isSelf(entry.owner)) && ownerAlive(await processIdentity(entry.owner.pid), entry.owner)) {
        throw new ExecutorError('already_running', `This chat's agent is still running under another Ri process (pid ${entry.owner.pid}). Stop that one first.`);
      }
      strays.push(await captureTree(entry));
    }
    return { entries: [...others, ...strays], result: strays };
  });
  // Persist ancestry before signalling, then wait outside the shared record
  // queue. An uncertain chat must not hold up another chat's record writes.
  const survivors = await stopRecordedTrees(strays, graceMs);
  if (survivors.length) {
    const problems = await recoveryProblems(strays, survivors);
    if (problems.length) throw new HarnessProcessRecoveryError(problems);
  }
  const kept = await removeStoppedEntries(file, strays);
  const changed = kept.filter(entry => entry.chatSessionId === chatSessionId);
  if (changed.length) throw await changedRecordError(changed);
  return strays.map(entry => entry.process.pid);
}

/**
 * At the home's startup, before anything can send: stop every recorded
 * harness whose owner is gone and that is still running. Its turn was
 * reported cut off, so it must not go on working, and the chat's next
 * message would otherwise start a second one. Entries for processes that
 * have exited are dropped. Returns the pids stopped.
 */
export async function stopOrphanedHarnesses(
  file = harnessProcessRecordPath(),
  graceMs = STOP_GRACE_MS,
): Promise<number[]> {
  if (readEntries(file).length === 0) return [];
  const leftovers = await update(file, async (entries) => {
    const kept: HarnessProcessEntry[] = [];
    const leftovers: HarnessProcessEntry[] = [];
    for (const entry of entries) {
      if (!await treeAlive(entry)) continue;
      const ownerRunning = (await isSelf(entry.owner)) || ownerAlive(await processIdentity(entry.owner.pid), entry.owner);
      (ownerRunning ? kept : leftovers).push(ownerRunning ? entry : await captureTree(entry));
    }
    return { entries: [...kept, ...leftovers], result: leftovers };
  });
  const survivors = await stopRecordedTrees(leftovers, graceMs);
  const unstopped = leftovers.filter(entry => survivors.some(process => tree(entry).some(child => child.pid === process.pid)));
  const stopped = leftovers.filter(entry => !unstopped.includes(entry));
  let kept = await removeStoppedEntries(file, stopped);
  if (unstopped.length) {
    const problems = await recoveryProblems(unstopped, survivors);
    if (problems.length) throw new HarnessProcessRecoveryError(problems);
    kept = await removeStoppedEntries(file, unstopped);
  }
  const changed = kept.filter(entry => leftovers.some(original => original.chatSessionId === entry.chatSessionId && original.process.pid === entry.process.pid));
  if (changed.length) throw await changedRecordError(changed);
  return leftovers.map(entry => entry.process.pid);
}

/**
 * SIGTERM every harness this process recorded, synchronously, as it exits.
 * Each is checked to still be the same process first. The record is left for
 * the next startup, which stops any that ignored the signal.
 */
export function signalOwnHarnesses(self: ProcessIdentity, file = harnessProcessRecordPath()): number[] {
  const own = readEntries(file).filter((e) => e.owner.pid === self.pid && sameProcessLifetime(self, e.owner) === true);
  const running = processIdentitiesSync(own.map((e) => e.process.pid));
  const signalled: number[] = [];
  for (const entry of own) {
    if (sameProcessLifetime(running.get(entry.process.pid), entry.process) !== true) continue;
    try {
      process.kill(entry.process.pid, 'SIGTERM');
      signalled.push(entry.process.pid);
    } catch {
      /* exited in between */
    }
  }
  return signalled;
}

const HOOK_KEY = Symbol.for('@ri/harness-processes-exit-hook');
const hookRef = globalThis as unknown as { [HOOK_KEY]?: boolean };

/**
 * Stop this process's harnesses when it exits, so a stopped home leaves no
 * agent working on unseen. Covers every exit that runs `exit` handlers: the
 * shutdown handlers' `process.exit`, a crash on an uncaught error. A SIGKILL
 * runs nothing, which the next startup's `stopOrphanedHarnesses` covers.
 */
export async function installHarnessExitHook(file = harnessProcessRecordPath()): Promise<void> {
  if (hookRef[HOOK_KEY]) return;
  hookRef[HOOK_KEY] = true;
  // The exit handler can't wait, so learn who we are now.
  const self = await selfIdentity();
  if (!self) return;
  process.once('exit', () => {
    try {
      signalOwnHarnesses(self, file);
    } catch {
      /* exiting regardless */
    }
  });
}

/** Test seam: forget the cached identity and hook. */
export function _resetHarnessProcessState(): void {
  selfRef[SELF_KEY] = undefined;
  chainRef[CHAIN_KEY] = undefined;
  hookRef[HOOK_KEY] = false;
}

/** Escalate a timed-out close only for this runner's exact recorded process. */
export async function stopTrackedHarness(chatSessionId: string, pid: number, file = harnessProcessRecordPath(), rootExited = false): Promise<boolean> {
  const captured = await update(file, async entries => {
    const entry = entries.find(value => value.chatSessionId === chatSessionId && value.process.pid === pid);
    if (!entry) return { entries, result: null };
    if (!(await isSelf(entry.owner))) return { entries, result: undefined };
    const captured = await captureTree(entry);
    return { entries: entries.map(value => value === entry ? captured : value), result: captured };
  });
  if (captured === undefined) return false;
  if (!captured) {
    // A CLI can exit before its first process record. Absence of a record is
    // not proof of exit, but ESRCH is. Never signal an unrecorded live PID.
    if (rootExited) return true;
    try { process.kill(pid, 0); return false; }
    catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
  }
  // Waiting for an OS process must not hold the record's global write queue.
  // Independent chats stop concurrently, and every signal rechecks identity.
  if ((await stopWorkerDescendants(tree(captured), STOP_GRACE_MS, sameProcessLifetime)).length) return false;
  const kept = await removeStoppedEntries(file, [captured]);
  return !kept.some(entry => entry.chatSessionId === chatSessionId && entry.process.pid === pid);
}
