import { useMemo } from 'react';
import type { ClaudeTaskDetails, ClaudeTaskStatus } from '@agentex/agent';
import type { ChatEventRecord } from '@/db/types';

/**
 * Read-only view of Claude Code's background tasks, derived from events we
 * already store (see docs/claude-code-background-tasks-and-subagents.md). No new
 * storage, no file watching.
 *
 * Decode: agentex 0.0.22 ships `getClaudeTaskDetails(event)` plus the typed
 * `ClaudeTaskDetails`. We use those **types** (`import type`, erased at build),
 * but NOT the runtime function — `@agentex/agent` is a Node SDK that only
 * exports its root, so importing the function would drag the whole SDK into the
 * browser bundle. `decodeClaudeTask` below is a thin client-safe mirror of
 * agentex's decoder, kept field-for-field in sync with it. Server code (the
 * executor adapter) should prefer the real `getClaudeTaskDetails`.
 */

export type BackgroundTaskStatus = ClaudeTaskStatus;

/** `local_bash` = a backgrounded shell/server, `local_agent` = a subagent. */
export type BackgroundTaskType = 'local_bash' | 'local_agent' | 'remote_agent' | string;

export interface BackgroundTask {
  taskId: string;
  /** tool_call id that launched it — links back to the Task/Bash tool row. */
  toolUseId?: string;
  taskType?: BackgroundTaskType;
  /** The command (for a shell) or the subagent's description. */
  description?: string;
  status: ClaudeTaskStatus;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** ISO timestamp of the `task_started` row. */
  startedAt?: string;
  /** ISO timestamp of the most recent event we saw for this task. */
  updatedAt: string;
  /** Still live (not in a terminal status). */
  isActive: boolean;
}

const TERMINAL: ReadonlySet<ClaudeTaskStatus> = new Set([
  'completed',
  'failed',
  'killed',
  'stopped',
]);

const CLAUDE_TASK_PHASES: Record<string, ClaudeTaskDetails['phase']> = {
  task_started: 'started',
  task_progress: 'progress',
  task_updated: 'updated',
  task_notification: 'notification',
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}
function asTaskStatus(v: unknown): ClaudeTaskStatus | null {
  return v === 'pending' ||
    v === 'running' ||
    v === 'paused' ||
    v === 'completed' ||
    v === 'failed' ||
    v === 'killed' ||
    v === 'stopped'
    ? v
    : null;
}

/**
 * Client-safe mirror of `@agentex/agent`'s `getClaudeTaskDetails`. Stateless
 * per-event decode of a stored agentex StreamEvent (`chat_events.raw`): Claude
 * emits task lifecycle as `type:"system"` on the wire, but agentex surfaces it
 * as `type:"unknown"` (only `system`+`init` gets a typed variant), payload on
 * `event.raw`. Returns `null` for anything that isn't a Claude task event.
 */
function decodeClaudeTask(raw: unknown): ClaudeTaskDetails | null {
  const ev = asRecord(raw);
  if (!ev || ev.type !== 'unknown' || ev.providerType !== 'claude') return null;
  const r = asRecord(ev.raw);
  if (!r) return null;
  const phase = CLAUDE_TASK_PHASES[str(r.subtype) ?? ''];
  if (!phase) return null;

  // `task_updated` is a sparse patch: status/description/end_time under `patch`.
  const patch = phase === 'updated' ? asRecord(r.patch) : null;
  const usage = asRecord(r.usage);
  return {
    phase,
    taskId: str(r.task_id) ?? '',
    toolUseId: str(r.tool_use_id) ?? null,
    taskType: str(r.task_type) ?? null,
    subagentType: str(r.subagent_type) ?? null,
    workflowName: str(r.workflow_name) ?? null,
    description: patch ? str(patch.description) ?? null : str(r.description) ?? null,
    status: patch ? asTaskStatus(patch.status) : asTaskStatus(r.status),
    usage: usage
      ? {
          totalTokens: num(usage.total_tokens) ?? null,
          toolUses: num(usage.tool_uses) ?? null,
          durationMs: num(usage.duration_ms) ?? null,
        }
      : null,
    outputFile: str(r.output_file) ?? null,
    summary: str(r.summary) ?? null,
    endTime: patch ? num(patch.end_time) ?? null : null,
  };
}

/**
 * Reduce the raw chat-event list into the current set of background tasks,
 * keyed by `task_id`, latest-event-wins for mutable fields. Pure — exported
 * for testing.
 */
export function deriveBackgroundTasks(events: ChatEventRecord[]): BackgroundTask[] {
  const byId = new Map<string, BackgroundTask>();

  for (const e of events) {
    const d = decodeClaudeTask(e.raw);
    if (!d || !d.taskId) continue;
    const prev = byId.get(d.taskId);

    // status precedence: this event's explicit status > implied "running" on
    // start/progress > whatever we had.
    const status: ClaudeTaskStatus =
      d.status ??
      (d.phase === 'started' || d.phase === 'progress' ? 'running' : prev?.status ?? 'running');

    const next: BackgroundTask = {
      taskId: d.taskId,
      toolUseId: d.toolUseId ?? prev?.toolUseId,
      taskType: d.taskType ?? prev?.taskType,
      description: d.description ?? prev?.description,
      status,
      totalTokens: d.usage?.totalTokens ?? prev?.totalTokens,
      toolUses: d.usage?.toolUses ?? prev?.toolUses,
      durationMs: d.usage?.durationMs ?? prev?.durationMs,
      startedAt: d.phase === 'started' ? e.createdAt : prev?.startedAt,
      updatedAt: e.createdAt,
      isActive: !TERMINAL.has(status),
    };
    byId.set(d.taskId, next);
  }

  // Active first, then most-recently-updated.
  return [...byId.values()].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return a.updatedAt < b.updatedAt ? 1 : -1;
  });
}

export function useBackgroundTasks(events: ChatEventRecord[] | undefined): BackgroundTask[] {
  return useMemo(() => deriveBackgroundTasks(events ?? []), [events]);
}

/** One lifecycle update for a task — drives the detail timeline. */
export interface BackgroundTaskUpdate {
  at: string;
  phase: ClaudeTaskDetails['phase'];
  status?: ClaudeTaskStatus;
  description?: string;
}

export interface BackgroundTaskDetail {
  /** The launching command (Bash) or subagent prompt, if we have the tool_call. */
  command?: string;
  /** The tool_result output (logs), present once the task has produced one. */
  output?: string;
  outputIsError?: boolean;
  /** Lifecycle timeline, oldest-first. */
  updates: BackgroundTaskUpdate[];
}

/**
 * Everything we can show about one task WITHOUT a file watcher — drawn from
 * events already in `chat_events`: the launching `tool_call` (matched by
 * `externalToolCallId` == toolUseId) gives the command, the paired
 * `tool_result` gives captured output/logs, and the decoded task events give
 * the lifecycle timeline. Pure — exported for testing.
 */
export function deriveTaskDetail(
  events: ChatEventRecord[],
  task: BackgroundTask,
): BackgroundTaskDetail {
  const detail: BackgroundTaskDetail = { updates: [] };

  for (const e of events) {
    if (task.toolUseId && e.externalToolCallId === task.toolUseId) {
      if (e.source === 'tool_call' && detail.command === undefined) {
        const input = asRecord(e.toolInput);
        detail.command = str(input?.command) ?? str(input?.prompt) ?? undefined;
      } else if (e.source === 'tool_result') {
        detail.output = e.content ?? undefined;
        detail.outputIsError = e.toolIsError ?? false;
      }
    }

    const d = decodeClaudeTask(e.raw);
    if (!d || d.taskId !== task.taskId) continue;
    detail.updates.push({
      at: e.createdAt,
      phase: d.phase,
      status: d.status ?? undefined,
      description: d.description ?? undefined,
    });
  }

  return detail;
}
