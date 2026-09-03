/**
 * Workstream coordination for task lifecycle changes.
 *
 * An execution is a durable autonomous workstream that may be associated with
 * many tasks. An `execution_tasks` association is durable context and history —
 * NOT proof that an agent is running right now, not ownership, and not a
 * cancellation boundary. So a task lifecycle change (Complete / Archive / Return
 * to Todo / Move to Consider) must never silently stop, archive, or detach a
 * shared execution still working other tasks.
 *
 * "Genuinely running" comes from live runtime signals (the set of chat sessions
 * with an in-flight turn), never from `executions.status`. When a task's change
 * would displace a genuinely running workstream, the caller must make an
 * explicit choice: keep the workstream running (change only the task, and tell
 * the agent its scope changed) or stop the running agent (interrupt the turn,
 * preserve the execution/worktree/chats/associations) — never a silent default.
 *
 * This module is runtime-agnostic: it takes an injected {@link WorkstreamRuntime}
 * so the exact same orchestration runs in-process for REST (which owns the live
 * handles) and via the server HTTP control path for the CLI/MCP (which do not).
 * It imports only the query layer, so it is safe to load from the CLI process.
 */

import { getTaskExecutions, getExecutionTasks, listChatSessions } from '@/lib/db/queries';
import { isTerminal, normalizeTaskStatus, TaskLifecycleError } from '@/lib/tasks/lifecycle';

/** A genuinely-running workstream associated with the task being changed, plus
 * the other live tasks it is also working (disclosed before any Stop). */
export interface RunningWorkstream {
  executionId: string;
  label: string | null;
  /** Other associated tasks that are not terminal — the collateral a Stop would
   * affect and a Keep-running would leave underway. */
  otherTasks: { id: string; title: string; status: string }[];
}

/** The human's or agent's explicit choice when a change would displace a
 * genuinely running workstream. */
export type RuntimeChoice = 'keep_running' | 'stop_running_agent';

/** What the task did, for the scope-change message sent on keep-running. */
export interface ScopeChange {
  taskId: string;
  taskTitle: string;
  action: 'completed' | 'archived' | 'returned to Todo';
}

/** The runtime side effects coordination needs, injected so REST (in-process)
 * and CLI/MCP (server HTTP) share one orchestration. */
export interface WorkstreamRuntime {
  /** Chat-session ids with an in-flight turn right now, or null when the truth
   * is unknown (server unreachable) — treated as "nothing running", which is
   * correct because the server process owns every harness subprocess. */
  runningSessionIds(): Promise<string[] | null>;
  /** Stop the running agent turns for an execution, preserving its durable
   * record, worktree, chats, and associations. Reports failure honestly. */
  stopExecution(executionId: string): Promise<{ ok: boolean; failures: string[] }>;
  /** Tell a kept-running workstream its scope changed so the agent stops
   * pursuing the changed task. */
  notify(executionId: string, change: ScopeChange): Promise<void>;
}

/** Map the given live running-session set onto the task's associated executions
 * and their collateral tasks. Pure DB read — works from any process. */
export function runningWorkstreamsFor(taskId: string, runningSessionIds: Set<string>): RunningWorkstream[] {
  if (runningSessionIds.size === 0) return [];
  const out: RunningWorkstream[] = [];
  for (const exec of getTaskExecutions(taskId)) {
    // getExecutionTasks/getTaskExecutions are association reads; liveness is the
    // live running set, not execution.status.
    const sessionIds = listChatSessions({ executionId: exec.id }).map((s) => s.id);
    if (!sessionIds.some((id) => runningSessionIds.has(id))) continue;
    const otherTasks = getExecutionTasks(exec.id)
      .filter((t) => t.id !== taskId && !isTerminal(normalizeTaskStatus(t.status)))
      .map((t) => ({ id: t.id, title: t.title, status: t.status }));
    out.push({ executionId: exec.id, label: exec.label ?? null, otherTasks });
  }
  return out;
}

/**
 * The kind of lifecycle change, which decides how a running workstream is
 * handled:
 *  - `displace` (Complete / Archive / Return to Todo) offers the keep/stop
 *    choice.
 *  - `uncommit` (Move to Consider) hard-rejects while genuinely running — you
 *    cannot uncommit work an agent is actively pursuing.
 */
export type ChangeKind = 'displace' | 'uncommit';

export interface CoordinateArgs {
  taskId: string;
  kind: ChangeKind;
  /** Present only for `displace`. */
  choice?: RuntimeChoice;
  /** Present only for `displace` keep-running — the message to send. */
  change?: ScopeChange;
  /** The exact running-execution ids the user was shown when they chose. If the
   * live set has changed since, coordination re-discloses instead of silently
   * stopping (or keeping) a workstream the user never saw. */
  acknowledgedExecutionIds?: string[];
  runtime: WorkstreamRuntime;
}

/**
 * Resolve the runtime side of a task lifecycle change BEFORE the durable
 * transition is applied. Throws {@link TaskLifecycleError} to signal the caller
 * must not proceed:
 *  - `active_execution` with `details.running` when a `displace` needs an
 *    explicit choice, or when a chosen Stop failed (so the task stays unchanged),
 *    or when an `uncommit` is blocked by a running workstream.
 * Returns normally (side effects already applied for keep/stop) when the caller
 * may go ahead and apply the durable transition.
 */
export async function coordinateLifecycleChange(args: CoordinateArgs): Promise<void> {
  const running = await args.runtime.runningSessionIds();
  if (running == null || running.length === 0) return; // nothing live -> proceed
  const workstreams = runningWorkstreamsFor(args.taskId, new Set(running));
  if (workstreams.length === 0) return; // none associated with this task -> proceed

  if (args.kind === 'uncommit') {
    throw new TaskLifecycleError(
      'active_execution',
      'Cannot move this to Consider while an agent is actively working it. Stop the agent or let it finish first.',
      { running: workstreams },
    );
  }

  // displace: require an explicit choice.
  if (args.choice !== 'keep_running' && args.choice !== 'stop_running_agent') {
    throw new TaskLifecycleError(
      'active_execution',
      'An agent workstream is running on this task. Choose keep_running or stop_running_agent.',
      { running: workstreams, requiresChoice: true },
    );
  }

  // If the caller confirmed against a specific disclosed set, re-verify the live
  // set is still exactly that — otherwise a workstream started since the user
  // chose could be stopped (or kept) without disclosure.
  if (args.acknowledgedExecutionIds) {
    const current = new Set(workstreams.map((w) => w.executionId));
    const ack = new Set(args.acknowledgedExecutionIds);
    const changed = current.size !== ack.size || [...current].some((id) => !ack.has(id));
    if (changed) {
      throw new TaskLifecycleError(
        'active_execution',
        'The running workstreams changed since you confirmed. Review and choose again.',
        { running: workstreams, requiresChoice: true },
      );
    }
  }

  if (args.choice === 'stop_running_agent') {
    const failures: string[] = [];
    for (const w of workstreams) {
      const res = await args.runtime.stopExecution(w.executionId);
      if (!res.ok) failures.push(...res.failures);
    }
    if (failures.length > 0) {
      // Runtime stop failed — leave the task lifecycle unchanged, and never
      // claim the agent stopped when it did not.
      throw new TaskLifecycleError(
        'active_execution',
        `Could not stop the running agent, so the task was left unchanged: ${failures.join('; ')}`,
        { running: workstreams, stopFailed: true },
      );
    }
    return;
  }

  // keep_running: change only the task, and tell each workstream its scope
  // changed so the agent stops pursuing it. Notify failures are non-fatal — the
  // task change is still valid — but are surfaced for logging by the runtime.
  if (args.change) {
    for (const w of workstreams) {
      await args.runtime.notify(w.executionId, args.change).catch(() => {});
    }
  }
}
