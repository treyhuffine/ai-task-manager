/**
 * Server-process implementation of {@link WorkstreamRuntime}. It touches the
 * in-memory executor state (the running-sessions set and the cached agent
 * handles), so it only works in the process that owns those handles — the app
 * server. REST routes use this directly; the CLI/MCP reach the same effects
 * through the server HTTP control path (see the orchestrator runtime).
 */

import * as executor from '@/lib/executor/adapter';
import { listRunningSessions } from '@/lib/executor/status-snapshot';
import {
  listChatSessions,
  listRuns,
  markRunCancelled,
  insertChatEvent,
} from '@/lib/db/queries';
import type { WorkstreamRuntime, ScopeChange } from './workstream';

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The chat-session ids of an execution that have an in-flight turn right now. */
export function runningSessionsForExecution(executionId: string): string[] {
  const running = new Set(listRunningSessions());
  return listChatSessions({ executionId }).map((s) => s.id).filter((id) => running.has(id));
}

/**
 * Stop the running agent turns for an execution while preserving its durable
 * record, worktree, chats, and associations. Interrupts each in-flight turn and
 * tears down the in-memory handle, and marks the active run cancelled so a
 * stopped turn is never recorded as a successful completion. Reports failure
 * honestly: if a handle refuses to close, the caller must not claim it stopped.
 */
export async function stopExecutionAgent(executionId: string): Promise<{ ok: boolean; failures: string[] }> {
  const sessionIds = runningSessionsForExecution(executionId);

  // Cancel EVERY queued/running run of the execution first (an execution can
  // have concurrent runs), before their turns' own completions can land, so the
  // durable record reflects a cancellation, not a completion.
  for (const run of listRuns({ executionId, status: ['queued', 'running'] })) {
    markRunCancelled(run.id, 'Stopped by a coordinated task change');
  }

  const failures: string[] = [];
  for (const sid of sessionIds) {
    try {
      await executor.abort(sid); // interrupt the in-flight turn
    } catch (err) {
      failures.push(`${sid} interrupt: ${msg(err)}`);
    }
    const res = await executor.close(sid); // tear down the handle (DB record preserved)
    if (!res.closed) failures.push(`${sid} close: ${res.error ?? 'unknown'}`);
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Tell a kept-running workstream that a task it was pursuing changed lifecycle,
 * so the agent stops pursuing that outcome. Durably recorded in the execution's
 * primary chat so it is in context on the next turn (a turn already in flight
 * cannot be partially interrupted, by design).
 */
export function notifyExecutionScopeChange(executionId: string, change: ScopeChange): void {
  const primary = listChatSessions({ executionId })[0];
  if (!primary) return;
  insertChatEvent({
    sessionId: primary.id,
    role: 'user',
    source: 'user',
    content:
      `[scope change from the human] Task "${change.taskTitle}" (${change.taskId}) was ${change.action}. ` +
      `Stop pursuing that outcome and continue with your other associated work.`,
  });
}

/** The in-process runtime for REST routes running inside the app server. */
export const inProcessWorkstreamRuntime: WorkstreamRuntime = {
  async runningSessionIds() {
    return listRunningSessions();
  },
  stopExecution(executionId) {
    return stopExecutionAgent(executionId);
  },
  async notify(executionId, change) {
    notifyExecutionScopeChange(executionId, change);
  },
};
