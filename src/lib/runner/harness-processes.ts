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
 * time and command line, and the same for the process that started it (its
 * owner). A clean close removes it. Three things read the record:
 *   - starting a chat's session first stops any recorded harness for that
 *     chat still running, so a chat never has two;
 *   - the home's startup stops every harness a previous server left;
 *   - the home's exit signals the harnesses it holds.
 *
 * A recorded process is signalled only while it's still that same process,
 * by start time and command line, checked right before each signal (the
 * worker's rule, P2.7 to P2.9 review fixes). A harness whose owner is another
 * live process is never touched. Nothing unrecorded is touched either, so a
 * harness orphaned between its spawn and its record is missed, which is the
 * safe way to be wrong.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getWorkDir } from '@/lib/config/paths';
import { stopWorkerDescendants } from '@/lib/service/worker-processes';
import { writeFileAtomic } from '@/lib/worker/durable-file';
import {
  processIdentitiesSync,
  processIdentity,
  sameProcess,
  type ProcessIdentity,
} from '@/lib/worker/leftovers';
import { ExecutorError } from './errors';

interface HarnessProcessEntry {
  chatSessionId: string;
  /** The process whose runner started it. */
  owner: ProcessIdentity;
  process: ProcessIdentity;
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
  selfRef[SELF_KEY] ??= processIdentity(process.pid);
  return selfRef[SELF_KEY]!;
}

async function isSelf(owner: ProcessIdentity): Promise<boolean> {
  return owner.pid === process.pid && sameProcess(await selfIdentity(), owner);
}

// ─── The record ───────────────────────────────────────────────

function readEntries(file: string): HarnessProcessEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: unknown };
    return Array.isArray(parsed?.entries) ? (parsed.entries as HarnessProcessEntry[]) : [];
  } catch {
    return [];
  }
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
  return update(file, async (entries) => {
    const others = entries.filter((e) => e.chatSessionId !== chatSessionId);
    const strays: HarnessProcessEntry[] = [];
    for (const entry of entries) {
      if (entry.chatSessionId !== chatSessionId) continue;
      if (!sameProcess(await processIdentity(entry.process.pid), entry.process)) continue;
      if (!(await isSelf(entry.owner)) && sameProcess(await processIdentity(entry.owner.pid), entry.owner)) {
        throw new ExecutorError(
          'already_running',
          `This chat's agent is still running under another Ri process (pid ${entry.owner.pid}). Stop that one first.`,
        );
      }
      strays.push(entry);
    }
    const survivors = await stopWorkerDescendants(strays.map((e) => e.process), graceMs);
    if (survivors.length > 0) {
      throw new ExecutorError(
        'already_running',
        `This chat's previous agent process (pid ${survivors.map((p) => p.pid).join(', ')}) didn't stop, so a new one wasn't started.`,
      );
    }
    return { entries: others, result: strays.map((e) => e.process.pid) };
  });
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
  return update(file, async (entries) => {
    const kept: HarnessProcessEntry[] = [];
    const leftovers: HarnessProcessEntry[] = [];
    for (const entry of entries) {
      if (!sameProcess(await processIdentity(entry.process.pid), entry.process)) continue;
      const ownerRunning = (await isSelf(entry.owner)) || sameProcess(await processIdentity(entry.owner.pid), entry.owner);
      (ownerRunning ? kept : leftovers).push(entry);
    }
    const survivors = await stopWorkerDescendants(leftovers.map((e) => e.process), graceMs);
    // One that wouldn't stop stays recorded, so the chat's next start tries again and refuses.
    const unstopped = leftovers.filter((e) => survivors.some((p) => p.pid === e.process.pid));
    return {
      entries: [...kept, ...unstopped],
      result: leftovers.filter((e) => !unstopped.includes(e)).map((e) => e.process.pid),
    };
  });
}

/**
 * SIGTERM every harness this process recorded, synchronously, as it exits.
 * Each is checked to still be the same process first. The record is left for
 * the next startup, which stops any that ignored the signal.
 */
export function signalOwnHarnesses(self: ProcessIdentity, file = harnessProcessRecordPath()): number[] {
  const own = readEntries(file).filter((e) => e.owner.pid === self.pid && sameProcess(self, e.owner));
  const running = processIdentitiesSync(own.map((e) => e.process.pid));
  const signalled: number[] = [];
  for (const entry of own) {
    if (!sameProcess(running.get(entry.process.pid), entry.process)) continue;
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
