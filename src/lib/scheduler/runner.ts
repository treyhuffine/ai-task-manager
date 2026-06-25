/**
 * Scheduler runner — owns the 60s tick, the boot recovery, and the
 * dispatch chokepoint. Started from `instrumentation.ts` once per Node
 * process; the tick is `unref`'d so a stuck schedule doesn't keep the
 * process alive at shutdown.
 *
 * The tick body, in order:
 *   1. acquire scheduler lock (single-process safety against slow ticks)
 *   2. select enabled schedules whose `next_run_at <= now`
 *   3. for each, advance `next_run_at` BEFORE dispatch (at-most-once)
 *   4. honor active-hours window — outside hours = skip the slot, but
 *      we still advance so we don't busy-loop on the same row
 *   5. enforce per-schedule + per-execution concurrency before kicking
 *      the dispatch (see `runs.dispatchRun`)
 *   6. release the lock — dispatched runs continue async, the tick
 *      finishes immediately.
 *
 * What is NOT in this file: provider invocation, cost capture,
 * summary/artifact-ref capture — those land in `runs/dispatch.ts` and
 * `executor/adapter.ts`. The runner just decides "should this row fire
 * now" and hands work off.
 */

import {
  acquireSchedulerLock,
  peekLockHolderPid,
  releaseLockIfOwnedSync,
  releaseSchedulerLock,
} from './lock';
import { computeNextRun, isWithinActiveHours } from './cron';
import {
  advanceScheduleNextRun,
  listDueSchedules,
  reapStaleRunningRuns,
} from '@/lib/db/queries';
import type { ScheduleRecord } from '@/db/types';
import { dispatchRun } from '@/lib/runs/dispatch';

const TICK_INTERVAL_MS = 60_000;
const STARTUP_DELAY_MS = 5_000;

interface RunnerState {
  interval: NodeJS.Timeout | null;
  ticking: boolean;
  /** How many ticks have run since boot — useful for tests + telemetry. */
  tickCount: number;
  /** Last logged lock-holder pid; suppresses repeated identical warnings. */
  lastReportedLockHolder: number | null;
}

const STATE_KEY = Symbol.for('@flow/scheduler-runner-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: RunnerState };
if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = {
    interval: null,
    ticking: false,
    tickCount: 0,
    lastReportedLockHolder: null,
  };
} else if (globalRef[STATE_KEY].lastReportedLockHolder === undefined) {
  // HMR migration from an older shape.
  globalRef[STATE_KEY].lastReportedLockHolder = null;
}
const state = globalRef[STATE_KEY]!;

/**
 * Install process-level shutdown hooks so an orderly stop (SIGTERM /
 * SIGINT / `process.exit`) releases the file lock owned by this pid.
 * Without this the 5-minute stale window would always swallow a
 * graceful restart; with it, a fresh boot immediately holds the lock.
 *
 * Best-effort: failures inside the hook are swallowed because we're
 * already on the exit path and there's no graceful surface to report
 * them on.
 */
let shutdownHooksInstalled = false;
function installSchedulerShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const release = () => {
    try { releaseLockIfOwnedSync(); } catch { /* exit path */ }
  };
  process.once('SIGTERM', () => {
    release();
    // Don't call process.exit — other shutdown hooks (preview teardown,
    // graceful HTTP close) are also chained off SIGTERM. They'll exit
    // naturally; we just need our lock gone.
  });
  process.once('SIGINT', release);
  process.once('beforeExit', release);
  process.once('exit', release);
}

/**
 * Start the periodic tick. Idempotent — safe to call from
 * `instrumentation.ts` even on HMR re-init. Returns the running state's
 * `tickCount` so tests can wait for a known number of ticks.
 */
export function startScheduler(): void {
  installSchedulerShutdownHooks();
  if (state.interval) return;
  // Boot recovery: any `runs` row left in `running` from a prior process
  // is dead — the in-memory executor handle didn't survive the restart.
  // Promote them so the UI stops showing fake activity and so stale
  // execution-level mutexes clear.
  try {
    reapStaleRunningRuns();
  } catch (err) {
    console.warn('[scheduler] startup reap failed', err);
  }

  // Defer first tick a few seconds so DB migrations and lazy modules
  // finish before we go banging on the schedules table.
  const initial = setTimeout(() => {
    void runTick();
    state.interval = setInterval(() => void runTick(), TICK_INTERVAL_MS);
    state.interval.unref?.();
  }, STARTUP_DELAY_MS);
  initial.unref?.();
}

export function stopScheduler(): void {
  if (state.interval) {
    clearInterval(state.interval);
    state.interval = null;
  }
}

/**
 * Single tick body, exported for tests + manual invocation in dev. Does
 * not loop. Returns the number of dispatches it kicked off.
 */
export async function runTick(now: Date = new Date()): Promise<number> {
  if (state.ticking) return 0;
  state.ticking = true;
  const lock = acquireSchedulerLock();
  if (!lock) {
    // Another process / a slow previous tick still holds the file lock.
    // Log who once per minute so a stuck or duplicate scheduler is
    // visible in the log instead of silently dropping every fire.
    const holder = peekLockHolderPid();
    if (holder !== state.lastReportedLockHolder) {
      console.warn(
        `[scheduler] tick skipped, lock held by pid ${holder ?? 'unknown'}`,
      );
      state.lastReportedLockHolder = holder;
    }
    state.ticking = false;
    return 0;
  }
  // Reset the holder memo so a subsequent contention gets its own log.
  state.lastReportedLockHolder = null;
  let dispatched = 0;
  try {
    state.tickCount++;
    const due = listDueSchedules(now);
    for (const schedule of due) {
      try {
        const fired = await processSchedule(schedule, now);
        if (fired) dispatched++;
      } catch (err) {
        // One bad row can't break the tick — log and move on.
        console.error(`[scheduler] tick failed for schedule ${schedule.id}:`, err);
      }
    }
  } finally {
    releaseSchedulerLock(lock);
    state.ticking = false;
  }
  return dispatched;
}

/**
 * Drive a single schedule's fire decision: advance next_run_at first,
 * skip-if-outside-active-hours, then call into the dispatch layer.
 *
 * Always advances next_run_at before dispatch — that's the at-most-once
 * guarantee. A crash between advance and dispatch loses the slot; a
 * crash between dispatch start and result leaves the run in `running`
 * and the boot reaper marks it failed.
 *
 * Webhook schedules don't fire from the tick (their next_run_at is
 * NULL); this function is a no-op for them by virtue of the listDue
 * query.
 */
async function processSchedule(schedule: ScheduleRecord, now: Date): Promise<boolean> {
  // Compute the next fire POST-dispatch so an already-fired `at` slot
  // doesn't loop on its own past `runAt`. Passing `lastFiredAt: now`
  // models the world after we fire: for `at` that returns null (one-
  // off complete), for `every` that returns base+interval, and for
  // `cron` it ignores lastFiredAt and resolves the next slot after
  // `now` — all the right answers in one shape.
  const nextRunAt = computeNextRun(
    { ...schedule, lastFiredAt: now.toISOString() },
    now,
  );
  advanceScheduleNextRun(schedule.id, nextRunAt, now.toISOString());

  // Active-hours skip — the slot is consumed (we already advanced
  // next_run_at) so we don't busy-loop on the same row at the next tick.
  if (!isWithinActiveHours(schedule, now)) {
    return false;
  }

  await dispatchRun({
    schedule,
    trigger: schedule.kind === 'webhook' ? 'webhook' : schedule.kind,
    triggerPayload: null,
    scheduledFor: now.toISOString(),
  });
  return true;
}

/** Diagnostic. */
export function getSchedulerStats(): { tickCount: number; ticking: boolean; running: boolean } {
  return {
    tickCount: state.tickCount,
    ticking: state.ticking,
    running: state.interval != null,
  };
}
