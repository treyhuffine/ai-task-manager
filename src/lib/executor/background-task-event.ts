/**
 * Client-safe background-task lifecycle decoding.
 *
 * Agentex 0.0.33+ emits a provider-neutral `background_task` StreamEvent.
 * Older stored Claude events used the forward-compatible `unknown` envelope,
 * so the decoder keeps that legacy path for existing transcripts.
 *
 * This module deliberately has no Agentex import. It is shared by the server
 * executor state and browser-side transcript reducer without pulling the Node
 * SDK into the client bundle.
 */

export type BackgroundTaskPhase =
  | 'started'
  | 'progress'
  | 'completed'
  // Legacy Claude phases retained for stored 0.0.32-and-earlier events.
  | 'updated'
  | 'notification';

export type BackgroundTaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  // Claude historically reported this terminal spelling in task patches.
  | 'killed';

export interface DecodedBackgroundTaskEvent {
  phase: BackgroundTaskPhase;
  taskId: string;
  taskType: string | null;
  status: BackgroundTaskStatus | null;
  description: string | null;
  summary: string | null;
  parentTaskId: string | null;
  providerType: string | null;
  /** Claude launch tool id, available on legacy events and normalized raw. */
  toolUseId: string | null;
  usage: {
    totalTokens: number | null;
    toolUses: number | null;
    durationMs: number | null;
  } | null;
}

export const TERMINAL_BACKGROUND_TASK_STATUSES: ReadonlySet<BackgroundTaskStatus> = new Set([
  'completed',
  'failed',
  'stopped',
  'killed',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function status(value: unknown): BackgroundTaskStatus | null {
  return value === 'pending'
    || value === 'running'
    || value === 'paused'
    || value === 'completed'
    || value === 'failed'
    || value === 'stopped'
    || value === 'killed'
    ? value
    : null;
}

function usageFrom(raw: Record<string, unknown> | null): DecodedBackgroundTaskEvent['usage'] {
  const usage = asRecord(raw?.usage);
  if (!usage) return null;
  return {
    totalTokens: num(usage.total_tokens) ?? num(usage.totalTokens),
    toolUses: num(usage.tool_uses) ?? num(usage.toolUses),
    durationMs: num(usage.duration_ms) ?? num(usage.durationMs),
  };
}

/** Decode one normalized or legacy background-task lifecycle event. */
export function decodeBackgroundTaskEvent(value: unknown): DecodedBackgroundTaskEvent | null {
  const event = asRecord(value);
  if (!event) return null;

  if (event.type === 'background_task') {
    const phase = event.phase;
    if (phase !== 'started' && phase !== 'progress' && phase !== 'completed') return null;
    const taskId = str(event.taskId);
    if (!taskId) return null;

    // Agentex keeps the provider payload on `raw`. Read optional Claude-only
    // detail from it so the existing command/output sheet remains useful.
    const raw = asRecord(event.raw);
    const patch = asRecord(raw?.patch);
    return {
      phase,
      taskId,
      taskType: str(event.taskType),
      status: status(event.status),
      description: str(event.description) ?? str(patch?.description),
      summary: str(event.summary) ?? str(raw?.summary),
      parentTaskId: str(event.parentTaskId),
      providerType: str(event.providerType),
      toolUseId: str(event.toolUseId) ?? str(raw?.tool_use_id),
      usage: usageFrom(raw),
    };
  }

  // Compatibility with Agentex <=0.0.32. Claude surfaced task lifecycle as
  // an `unknown` StreamEvent with the CLI system payload nested under `raw`.
  if (event.type !== 'unknown' || event.providerType !== 'claude') return null;
  const raw = asRecord(event.raw);
  if (!raw) return null;
  const subtype = str(raw.subtype);
  const phase: BackgroundTaskPhase | null =
    subtype === 'task_started' ? 'started'
      : subtype === 'task_progress' ? 'progress'
        : subtype === 'task_updated' ? 'updated'
          : subtype === 'task_notification' ? 'notification'
            : null;
  if (!phase) return null;

  const taskId = str(raw.task_id);
  if (!taskId) return null;
  const patch = phase === 'updated' ? asRecord(raw.patch) : null;
  return {
    phase,
    taskId,
    taskType: str(raw.task_type),
    status: patch ? status(patch.status) : status(raw.status),
    description: patch ? str(patch.description) : str(raw.description),
    summary: str(raw.summary),
    parentTaskId: str(raw.parent_task_id),
    providerType: 'claude',
    toolUseId: str(raw.tool_use_id),
    usage: usageFrom(raw),
  };
}

/**
 * Whether this lifecycle update means the task is still active. Explicit
 * terminal status wins, followed by the provider-neutral terminal phase.
 */
export function isActiveBackgroundTaskEvent(event: DecodedBackgroundTaskEvent): boolean {
  if (event.status && TERMINAL_BACKGROUND_TASK_STATUSES.has(event.status)) return false;
  return event.phase !== 'completed';
}
