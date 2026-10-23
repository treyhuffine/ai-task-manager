/**
 * Finish a run, once (docs/homes-build.md, P2.1 and P2.3).
 *
 * A run ends when its turn does: the runner reports `turn_result` and the
 * home applies it. Scheduled runs also finish here for what fails before a
 * turn starts (a worktree that can't be prepared) or after it runs too long.
 * Only a run still queued or running changes, so the second call for the
 * same run (a timeout, then the interrupted turn's result) does nothing.
 *
 * `finishRunInTransaction` does the database part inside the caller's
 * transaction and queues the notification there too. Closing a quiet
 * heartbeat's harness waits for commit.
 */

import type { RunRecord } from '@/db/types';
import { bumpSessionOutcome, getRun, markRunCompleted, markRunFailed, setTriggerLastRun, settleAgentRequestsForRun, hasAgentApprovalForRun } from '@/lib/db/queries';
import { queueRunTerminal, queueNeedsInput } from '@/lib/notifications/emit';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { settleHeartbeatRun } from '@/lib/heartbeat/quiet';
import { runnerFor } from '@/lib/executor/placement';
import { inTransaction, type AfterCommit } from '@/lib/effects/after-commit';
import { endRun } from './artifact-bucket';

/** `stopped`: a person stopped the run's turn. The run completes, while a
 * coordination request riding on it learns the work is unfinished. */
export type RunOutcome = { ok: true; stopped?: boolean } | { ok: false; errorCode: string; errorMessage: string };

export function finishRunInTransaction(runId: string, outcome: RunOutcome, after: AfterCommit): RunRecord | null {
  const before = getRun(runId);
  if (!before) return null;
  const chatSessionId = before.chatSessionId;
  // The run's telemetry window closes with its turn.
  if (chatSessionId) endRun(runId, chatSessionId);
  if (before.status !== 'queued' && before.status !== 'running') return before;

  if (outcome.ok && !outcome.stopped && before.triggerId && hasAgentApprovalForRun(runId)) {
    outcome = { ok: false, errorCode: 'coordination_approval_required', errorMessage: 'This scheduled job could not complete because a message is waiting for your approval. Open its chat to approve or decline the send.' };
  }

  const record = outcome.ok
    ? markRunCompleted(runId)
    : markRunFailed(runId, { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage });
  if (before.triggerId) setTriggerLastRun(before.triggerId, runId, outcome.ok ? 'completed' : 'failed');

  if (outcome.ok && before.triggerId === RESERVED_TRIGGER_IDS.heartbeat && chatSessionId) {
    // A heartbeat check-in with nothing to report archives its own chat, so it
    // never reaches Unread, and the notifier below skips delivering it. Its
    // harness is closed with it: an archived chat keeps no process.
    try {
      if (settleHeartbeatRun(runId, chatSessionId)) {
        after.tasks.push(() => {
          void runnerFor(chatSessionId).stop(chatSessionId).catch((err: unknown) => {
            console.warn(`[runs] could not close the quiet heartbeat chat ${chatSessionId}:`, err);
          });
        });
      }
    } catch (err) {
      // The run already completed. Failing to archive a quiet check-in only
      // leaves it visible in Unread; it must not flip the run to failed.
      console.warn(`[runs] could not settle heartbeat run ${runId}:`, err);
    }
  }
  if (!outcome.ok && chatSessionId) {
    // Touch the chat's outcome timestamp so a failure before any assistant
    // turn still surfaces in the inbox. The unread derivation only ticks on
    // `agent` / `result` events.
    bumpSessionOutcome(chatSessionId);
  }
  // Notifier: execution.finished / trigger.run_completed (§2.4), queued with
  // the run's own change, sent after commit.
  const queued = queueRunTerminal(runId);
  if (queued) after.notifications.push(queued);
  // Use the existing terminal route when subscribed, falling back to the
  // needs-input route for an unbound scheduled chat. Never send both.
  if (!queued && !outcome.ok && outcome.errorCode === 'coordination_approval_required' && chatSessionId) {
    const attention = queueNeedsInput({ sessionId: chatSessionId, requestId: `scheduled-approval:${runId}`, title: 'Scheduled job needs approval', body: outcome.errorMessage });
    if (attention) after.notifications.push(attention);
  }
  if (settleAgentRequestsForRun(runId, outcome)) {
    after.tasks.push(() => { void import('@/lib/coordination/service').then(({ drainAgentCoordination }) => drainAgentCoordination()); });
  }
  return record ?? null;
}

export function finishRun(runId: string, outcome: RunOutcome): RunRecord | null {
  return inTransaction((after) => finishRunInTransaction(runId, outcome, after));
}
