/**
 * Finish a run, once (docs/homes-build.md, "P2.1 The runner split").
 *
 * A run ends when its turn does: the runner reports `turn_result` and the
 * home sink calls this. Scheduled runs also call it for what fails before a
 * turn starts (a worktree that can't be prepared) or after it runs too long.
 * Only a run still queued or running changes, so the second call for the
 * same run (a timeout, then the interrupted turn's result) does nothing.
 */

import type { RunRecord } from '@/db/types';
import { bumpSessionOutcome, getRun, markRunCompleted, markRunFailed, setTriggerLastRun } from '@/lib/db/queries';
import { notifyRunTerminal } from '@/lib/notifications/emit';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { settleHeartbeatRun } from '@/lib/heartbeat/quiet';
import { runnerFor } from '@/lib/executor/placement';
import { endRun } from './artifact-bucket';

export type RunOutcome = { ok: true } | { ok: false; errorCode: string; errorMessage: string };

export function finishRun(runId: string, outcome: RunOutcome): RunRecord | null {
  const before = getRun(runId);
  if (!before) return null;
  const chatSessionId = before.chatSessionId;
  // The run's telemetry window closes with its turn.
  if (chatSessionId) endRun(runId, chatSessionId);
  if (before.status !== 'queued' && before.status !== 'running') return before;

  const after = outcome.ok
    ? markRunCompleted(runId)
    : markRunFailed(runId, { errorCode: outcome.errorCode, errorMessage: outcome.errorMessage });
  if (before.triggerId) setTriggerLastRun(before.triggerId, runId, outcome.ok ? 'completed' : 'failed');

  if (outcome.ok && before.triggerId === RESERVED_TRIGGER_IDS.heartbeat && chatSessionId) {
    // A heartbeat check-in with nothing to report archives its own chat, so it
    // never reaches Unread, and the notifier below skips delivering it. Its
    // harness is closed with it: an archived chat keeps no process.
    try {
      if (settleHeartbeatRun(runId, chatSessionId)) {
        void runnerFor(chatSessionId).stop(chatSessionId).catch((err: unknown) => {
          console.warn(`[runs] could not close the quiet heartbeat chat ${chatSessionId}:`, err);
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
    try { bumpSessionOutcome(chatSessionId); } catch { /* best-effort */ }
  }
  // Notifier (best-effort): execution.finished / trigger.run_completed (§2.4).
  void notifyRunTerminal(runId).catch(() => {});
  return after ?? null;
}
