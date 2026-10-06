/**
 * Hand app-composed text to a session's harness as a new turn (or into the running one: concurrent
 * sends queue natively, see the messages route). Used for app notices that should move a waiting
 * agent along, like integration approvals telling it the user decided. Mirrors the messages route's
 * dispatch (preparation hold, worktree self-heal, release once a chat elsewhere has it queued).
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
  // Released once: when a turn for a computer elsewhere is saved in its queue (from then on its
  // delivery state and the worker say what the chat is doing), or when the dispatch settles.
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    executor.endDispatchPreparation(sessionId, preparationRef);
  };
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
      await executor.dispatch(sessionId, text, { onQueued: release });
    } finally {
      release();
    }
  })().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sessions] dispatch failed for ${sessionId}:`, msg);
  });
}
