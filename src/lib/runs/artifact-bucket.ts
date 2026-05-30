/**
 * Per-run artifact accumulator + active-run lookup. When the
 * orchestrator successfully calls a mutating action during a run, the
 * dispatcher pushes the resulting entity ref here. On terminal, the
 * result-event handler reads + flushes it into `runs.artifact_refs`.
 *
 * Indexed two ways:
 *   - By runId: the canonical store of accumulated refs.
 *   - By chatSessionId → runId: lets the executor adapter find "which
 *     run am I inside right now?" without threading the runId through
 *     every layer. Manual chat sends without a wrapping `runWith` skip
 *     accumulation (which is fine — task #12 will register them).
 *
 * Deduped by `(kind, id)` on insert — multiple updates to the same
 * task produce one ref, not N. Idempotent under retry.
 */

import type { RunArtifactRef } from '@/db/types';

interface State {
  bySession: Map<string, string>;
  byRun: Map<string, Map<string, RunArtifactRef>>;
}

const STATE_KEY = Symbol.for('@flow/run-artifact-bucket');
const globalRef = globalThis as unknown as { [STATE_KEY]?: State };
if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = { bySession: new Map(), byRun: new Map() };
}
const state = globalRef[STATE_KEY]!;

function refKey(ref: RunArtifactRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * Register a run as active against a chat session. Use the `runWith`
 * wrapper unless you specifically need raw control — it pairs with
 * `endRun` so the bookkeeping survives an exception in the body.
 */
export function beginRun(runId: string, chatSessionId: string): void {
  state.bySession.set(chatSessionId, runId);
  if (!state.byRun.has(runId)) state.byRun.set(runId, new Map());
}

export function endRun(runId: string, chatSessionId: string): RunArtifactRef[] {
  // Pop the chat→run association so subsequent manual sends don't get
  // attributed to a finished run.
  const current = state.bySession.get(chatSessionId);
  if (current === runId) state.bySession.delete(chatSessionId);
  const accum = state.byRun.get(runId);
  state.byRun.delete(runId);
  return accum ? Array.from(accum.values()) : [];
}

/**
 * Look up the run currently in flight against the given chat. The
 * executor's tool-result callback uses this to attribute a successful
 * mutating action to the right run row.
 */
export function getActiveRunForSession(chatSessionId: string): string | null {
  return state.bySession.get(chatSessionId) ?? null;
}

/**
 * Push a ref into the active accumulator for a run. Deduped — calling
 * with the same (kind, id) twice is a no-op. No-op when the run is
 * unknown (the manual-dispatch path never called `beginRun`).
 */
export function pushArtifactRef(runId: string, ref: RunArtifactRef): void {
  const bucket = state.byRun.get(runId);
  if (!bucket) return;
  bucket.set(refKey(ref), ref);
}

/** Read accumulated refs without ending the run. */
export function peekArtifactRefs(runId: string): RunArtifactRef[] {
  const bucket = state.byRun.get(runId);
  return bucket ? Array.from(bucket.values()) : [];
}

/**
 * Convenience wrapper for the dispatcher: registers the run, awaits
 * the body, returns the accumulated refs. End-of-run bookkeeping is
 * idempotent so a thrown body still cleans up.
 */
export async function runWith<T>(
  runId: string,
  chatSessionId: string,
  body: () => Promise<T>,
): Promise<T> {
  beginRun(runId, chatSessionId);
  try {
    return await body();
  } finally {
    endRun(runId, chatSessionId);
  }
}

/** Aggregate export so callers can `import { runArtifactBucket }`. */
export const runArtifactBucket = {
  beginRun,
  endRun,
  pushArtifactRef,
  peekArtifactRefs,
  getActiveRunForSession,
  runWith,
};

/** Test seam. */
export function _resetArtifactBucket(): void {
  state.bySession.clear();
  state.byRun.clear();
}
