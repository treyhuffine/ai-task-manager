/**
 * What's live across the home's runners: running flags, background tasks,
 * command inventories and pending prompts (docs/homes-build.md, "P2.1 The
 * runner split"). Routes, the rail and health read here rather than from a
 * runner directly. Every session runs on the home's own computer until P2.4,
 * so this reads the local runner. From P2.4 it merges each connected
 * computer's reported state.
 *
 * Light on purpose: it imports no agent engine, so status routes stay cheap
 * to compile.
 */

export {
  activeSendCount,
  getSessionInventory,
  hasBackgroundTasks,
  hasHarnessSession,
  isRunning,
  listBackgroundTaskIds,
  listBackgroundTaskSessions,
  listRunningSessions,
} from '@/lib/runner/live-state';
export { getPending, listForSession, listSessionsWithPending } from '@/lib/runner/pending';
