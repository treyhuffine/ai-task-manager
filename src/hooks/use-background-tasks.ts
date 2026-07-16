import { useMemo } from 'react';
import type { ChatEventRecord } from '@/db/types';
import {
  decodeBackgroundTaskEvent,
  TERMINAL_BACKGROUND_TASK_STATUSES,
  type BackgroundTaskPhase,
  type BackgroundTaskStatus,
} from '@/lib/executor/background-task-event';

/**
 * Provider-neutral read-only view of background tasks, derived from lifecycle
 * metadata already stored in chat_events. No extra persistence or file watching.
 */

export type { BackgroundTaskStatus } from '@/lib/executor/background-task-event';

/** Legacy Claude task kinds plus provider-neutral `process` and `subagent`. */
export type BackgroundTaskType = 'local_bash' | 'local_agent' | 'remote_agent' | string;

export interface BackgroundTask {
  taskId: string;
  providerType?: string;
  /** tool_call id that launched it — links back to the Task/Bash tool row. */
  toolUseId?: string;
  taskType?: BackgroundTaskType;
  /** The command (for a shell) or the subagent's description. */
  description?: string;
  summary?: string;
  parentTaskId?: string;
  status: BackgroundTaskStatus;
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
/**
 * Reduce the raw chat-event list into the current set of background tasks,
 * keyed by task id, latest-event-wins for mutable fields. Pure — exported
 * for testing.
 */
export function deriveBackgroundTasks(events: ChatEventRecord[]): BackgroundTask[] {
  const byId = new Map<string, BackgroundTask>();

  for (const e of events) {
    const d = decodeBackgroundTaskEvent(e.raw);
    if (!d || !d.taskId) continue;
    const prev = byId.get(d.taskId);

    // status precedence: this event's explicit status > implied "running" on
    // start/progress > whatever we had.
    const status: BackgroundTaskStatus =
      d.status ??
      (d.phase === 'completed'
        ? 'completed'
        : d.phase === 'started' || d.phase === 'progress'
          ? 'running'
          : prev?.status ?? 'running');

    const next: BackgroundTask = {
      taskId: d.taskId,
      providerType: d.providerType ?? prev?.providerType,
      toolUseId: d.toolUseId ?? prev?.toolUseId,
      taskType: d.taskType ?? prev?.taskType,
      description: d.description ?? prev?.description,
      summary: d.summary ?? prev?.summary,
      parentTaskId: d.parentTaskId ?? prev?.parentTaskId,
      status,
      totalTokens: d.usage?.totalTokens ?? prev?.totalTokens,
      toolUses: d.usage?.toolUses ?? prev?.toolUses,
      durationMs: d.usage?.durationMs ?? prev?.durationMs,
      startedAt: d.phase === 'started' ? e.createdAt : prev?.startedAt,
      updatedAt: e.createdAt,
      isActive: !TERMINAL_BACKGROUND_TASK_STATUSES.has(status),
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
  phase: BackgroundTaskPhase;
  status?: BackgroundTaskStatus;
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

    const d = decodeBackgroundTaskEvent(e.raw);
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
