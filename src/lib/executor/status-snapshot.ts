/**
 * Lightweight, read-only snapshot of the executor's in-memory session state:
 * which sessions have a live dispatch in flight, and which have a pending input
 * request (permission / AskUserQuestion) blocking the agent.
 *
 * Why this exists — compile cost, not runtime:
 * The canonical readers live in `adapter.ts` (`listRunningSessions`) and
 * `pending-input.ts` (`listSessionsWithPending`). Importing either drags in the
 * full executor + `@agentex/agent` module graph, which Turbopack dev is very
 * slow to compile (seconds per route; `/api/sessions/rail`, which reads BOTH,
 * never finished compiling). A tiny status endpoint shouldn't pull in the whole
 * agent engine just to read two in-memory collections.
 *
 * Both states are stashed on `globalThis` under stable `Symbol.for(...)` keys by
 * their owner modules, so we read the exact same live objects here WITHOUT
 * importing them. This module imports nothing, so callers stay off the heavy
 * graph. Keys + shapes are mirrored from the owners — keep in sync if they change:
 *   - `adapter.ts`        `Symbol.for('@flow/executor-state')`      → `runningSessions: Set<string>`
 *   - `pending-input.ts`  `Symbol.for('@flow/pending-input-state')` → `bySession: Map<string, Set<string>>`
 *
 * Returns empty when an owner hasn't initialized its global yet — which only
 * happens before that subsystem has ever run, i.e. when the true answer is empty.
 */

// Mirror of adapter.ts's STATE_KEY (running-session slice only).
const EXECUTOR_STATE_KEY = Symbol.for('@flow/executor-state');
// Mirror of pending-input.ts's STATE_KEY (bySession slice only).
const PENDING_STATE_KEY = Symbol.for('@flow/pending-input-state');

type ExecutorStateSlice = { runningSessions?: Set<string> };
type PendingStateSlice = { bySession?: Map<string, Set<string>> };

function readGlobal<T>(key: symbol): T | undefined {
  return (globalThis as unknown as Record<symbol, unknown>)[key] as T | undefined;
}

/** Session ids with a live dispatch in flight. Mirrors `adapter.listRunningSessions`. */
export function listRunningSessions(): string[] {
  const running = readGlobal<ExecutorStateSlice>(EXECUTOR_STATE_KEY)?.runningSessions;
  return running ? Array.from(running) : [];
}

/** Session ids with >=1 pending input request. Mirrors `pending-input.listSessionsWithPending`. */
export function listSessionsWithPending(): string[] {
  const bySession = readGlobal<PendingStateSlice>(PENDING_STATE_KEY)?.bySession;
  if (!bySession) return [];
  const out: string[] = [];
  for (const [sessionId, ids] of bySession) {
    if (ids.size > 0) out.push(sessionId);
  }
  return out;
}
