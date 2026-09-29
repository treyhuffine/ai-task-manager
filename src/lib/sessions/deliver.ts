/**
 * Hand text to a session's harness as a new turn (or into the running one: concurrent sends queue
 * natively, see the messages route). Shared by the messages route, which delivers what the user or
 * another chat typed, and by connector approvals, which tell a waiting agent the user decided.
 *
 * Fire-and-forget: the caller has already persisted whatever the transcript should show.
 */
import { getExecution } from '@/lib/db/queries';
import { ensureWorktreeReady } from '@/lib/runs/dispatch';
import * as executor from '@/lib/executor/adapter';

export function dispatchSessionTurn(sessionId: string, executionId: string | null, text: string): void {
  // Cover the accepted-message -> worktree/provider preparation gap. The
  // nested dispatch takes its own reference, so the runtime flag remains
  // true until both preparation and the actual root turn have settled.
  const preparationRef = executor.beginDispatchPreparation(sessionId);
  // Self-heal a missing worktree before dispatching. A git execution
  // can outlive its worktree directory (out-of-band `git worktree
  // remove`/`prune`, a multi-device home where `.work` wasn't synced,
  // dev resets). `resolveCwd` now refuses to run the agent in the
  // workspace's source checkout in that state — so without this the
  // turn would dead-end with `invalid_state`. Reprovisioning here (the
  // same guard the scheduled path runs) recreates the worktree so the
  // message lands in an isolated tree, never the main repo. The
  // existsSync fast-path inside makes this a no-op on the hot path.
  void (async () => {
    try {
      const execution = executionId ? getExecution(executionId) : undefined;
      const ready = await ensureWorktreeReady(sessionId, execution ?? null);
      if (!ready.ok) {
        console.error(`[sessions] worktree not ready for ${sessionId}: ${ready.error}`);
        return;
      }
      await executor.dispatch(sessionId, text);
    } finally {
      executor.endDispatchPreparation(sessionId, preparationRef);
    }
  })().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sessions] dispatch failed for ${sessionId}:`, msg);
  });
}
