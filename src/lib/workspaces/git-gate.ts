/**
 * One process-wide bound on how many `git` subprocesses the server runs at once.
 *
 * The diff-stats surface is the reason this exists. Expanding the workspace tree
 * fires one `/workspaces/:id/sessions` request per expanded workspace, each row
 * then asks for a diff-stats badge, and those coalesce into batched
 * `POST /sessions/diff-stats` requests. Every batch already caps its own fan-out
 * (`WORKTREE_CONCURRENCY`), but nothing capped the *sum* across the several
 * batches in flight, so a burst could fork dozens of `git` processes at the same
 * instant — on a machine that is usually also running coding agents. `git`
 * itself is off the JS event loop (it's a child process), so this never blocked
 * Node; it saturated CPU and I/O, which is what made everything, including the
 * cheap DB-only reads queued behind it, feel slow.
 *
 * Routing every spawn through one gate turns that spike into a bounded, steady
 * drain: at most `GIT_CONCURRENCY` git processes exist at once, extra work waits
 * its turn. This is the "queue in front of the expensive resource" that a worker
 * pool would give, without moving anything off-process — git is already its own
 * process, so the win is bounding how many run, not where they run.
 */

import os from 'node:os';
import { APP_SHORT_ID } from '@/constants/app';
import { AsyncSemaphore } from '@/lib/util/async-semaphore';

/** `FLOW_GIT_CONCURRENCY` (prefix tracks the app id, like the path overrides). */
const ENV_KEY = `${APP_SHORT_ID.toUpperCase()}_GIT_CONCURRENCY`;

/**
 * Default: leave the box headroom. Agents doing real work are the priority, so
 * the badge refresher should not be able to claim every core. Two cores are
 * reserved for the event loop and the agents; the floor of 2 keeps a
 * single/dual-core machine from serialising to a crawl.
 */
function defaultLimit(): number {
  const cores = os.cpus()?.length ?? 4;
  return Math.max(2, cores - 2);
}

function resolveLimit(): number {
  const raw = process.env[ENV_KEY];
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 1) return Math.floor(parsed);
  }
  return defaultLimit();
}

const gate = new AsyncSemaphore(resolveLimit());

/** Run a single `git` invocation under the shared concurrency bound. */
export function runGit<T>(fn: () => Promise<T>): Promise<T> {
  return gate.run(fn);
}

/** Snapshot of the gate, for instrumentation and tests. */
export function gitGateStats(): { available: number; waiting: number } {
  return { available: gate.available, waiting: gate.waiting };
}
