/**
 * Active-run lookup: which run is in flight in a chat session right now.
 * The dispatcher registers a run for the duration of its executor turn
 * (`runWith`), so the executor's stream hook (`event-hooks.ts`) can attribute
 * cost and summary to the right run row without threading the runId through
 * every layer. Manual chat sends never call `runWith`, so they are skipped.
 *
 * In-process only. What a run changed is recorded durably in the database at
 * the action layer instead (`artifact-refs.ts`), because the action can run in
 * another process (the CLI in the harness's shell).
 */

const STATE_KEY = Symbol.for('@ri/run-artifact-bucket');
const globalRef = globalThis as unknown as { [STATE_KEY]?: Map<string, string> };
if (!globalRef[STATE_KEY]) globalRef[STATE_KEY] = new Map();
const bySession = globalRef[STATE_KEY]!;

/**
 * Register a run as active against a chat session. Use the `runWith`
 * wrapper unless you specifically need raw control: it pairs with
 * `endRun` so the bookkeeping survives an exception in the body.
 */
export function beginRun(runId: string, chatSessionId: string): void {
  bySession.set(chatSessionId, runId);
}

export function endRun(runId: string, chatSessionId: string): void {
  // Pop the chat→run association so subsequent manual sends don't get
  // attributed to a finished run.
  if (bySession.get(chatSessionId) === runId) bySession.delete(chatSessionId);
}

/** The run currently in flight against the given chat, if any. */
export function getActiveRunForSession(chatSessionId: string): string | null {
  return bySession.get(chatSessionId) ?? null;
}

/**
 * Convenience wrapper for the dispatcher: registers the run for the body's
 * duration. End-of-run bookkeeping is idempotent, so a thrown body still
 * cleans up.
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
  getActiveRunForSession,
  runWith,
};

/** Test seam. */
export function _resetArtifactBucket(): void {
  bySession.clear();
}
