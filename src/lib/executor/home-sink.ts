/**
 * The home's runner sink: what a runner reports, applied to the home's
 * records (docs/homes-build.md, "P2.1 The runner split").
 *
 * The local runner reports here in process. From P2.3 a worker's journaled
 * events and signals arrive over HTTP and are applied by the same
 * functions, so every placement behaves the same way.
 */

import { uuidv7 } from 'uuidv7';
import type { StreamEvent, UserInputResponse } from '@agentex/agent';
import type { ChatEventSource, CreateChatEventInput, PermissionMode } from '@/db/types';
import {
  getChatSession,
  insertChatEvent,
  replaceChatEventPart,
  updateChatSession,
} from '@/lib/db/queries';
import { publishBackgroundTaskActivity, publishPendingInput, publishRuntime } from '@/lib/realtime/bus';
import { notifyNeedsInput } from '@/lib/notifications/emit';
import { handleRunStreamEvent } from '@/lib/runs/event-hooks';
import { finishRun } from '@/lib/runs/finish';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import type { PendingInput } from '@/lib/runner/pending';
import { installRunnerSink } from '@/lib/runner/sink';
import type { EventWriter, RunnerSignal, RunnerSink } from '@/lib/runner/types';
import { settleTurn } from './turns';

/**
 * Chat events from a live session. Inserts are idempotent by event id, and
 * run telemetry (cost and summary) is taken from a result event only when
 * it was actually inserted, so a replayed result can't count twice.
 */
const liveWriter: EventWriter = {
  async write(event) {
    const row = insertChatEvent(event);
    if (row && event.source === 'result' && event.raw) {
      await handleRunStreamEventSafe(event.sessionId, event.raw as unknown as StreamEvent);
    }
    return row !== null;
  },
  async replacePart(event) {
    replaceChatEventPart(event);
  },
};

/**
 * Defensive wrapper around the run-telemetry hook (cost + summary; what a run
 * changed is recorded at the action layer, see src/lib/runs/artifact-refs.ts).
 * Errors are swallowed: dropping a telemetry event is preferable to losing
 * the user's turn.
 */
async function handleRunStreamEventSafe(chatSessionId: string, event: StreamEvent): Promise<void> {
  try {
    await handleRunStreamEvent(chatSessionId, event);
  } catch (err) {
    console.warn(`[runs] telemetry hook failed for ${chatSessionId}:`, err);
  }
}

export const homeSink: RunnerSink = {
  writer: liveWriter,
  signal(chatSessionId, signal) {
    applySignal(chatSessionId, signal);
  },
};

/** Install the home sink for the local runner. Idempotent. */
export function installHomeSink(): void {
  installRunnerSink(homeSink);
}

export function applySignal(chatSessionId: string, signal: RunnerSignal): void {
  switch (signal.type) {
    case 'running':
      publishRuntime(chatSessionId, signal.running);
      return;
    case 'background_tasks':
      publishBackgroundTaskActivity(chatSessionId, signal.active, signal.taskIds);
      return;
    case 'inventory':
      // Read through the live-state facade when the slash-command list asks.
      return;
    case 'native_session': {
      const session = getChatSession(chatSessionId);
      if (session && session.externalSessionId !== signal.nativeSessionId) {
        updateChatSession(chatSessionId, { externalSessionId: signal.nativeSessionId });
      }
      return;
    }
    case 'pending_input':
      recordPendingRequest(chatSessionId, signal.pending);
      return;
    case 'pending_resolved':
      recordPendingResponse(chatSessionId, signal.pending, signal.response);
      return;
    case 'pending_changed':
      publishPendingInput(chatSessionId, signal.pending);
      return;
    case 'turn_result':
      if (signal.runId) {
        finishRun(
          signal.runId,
          signal.ok ? { ok: true } : { ok: false, errorCode: 'agent_error', errorMessage: signal.error ?? 'The turn failed' },
        );
      }
      settleTurn(signal.turnId, signal.ok ? null : signal.error ?? 'The turn failed');
      return;
  }
}

// ─── Pending prompts ──────────────────────────────────────────

/**
 * A prompt the agent is blocked on: a transcript row so the request is
 * visible in chat history (alongside the live overlay), and a notification.
 * The row is idempotent — the same tool use id twice (a retry) inserts once.
 */
function recordPendingRequest(chatSessionId: string, pending: PendingInput): void {
  try {
    insertChatEvent(buildPendingRequestEvent(chatSessionId, pending));
  } catch (err) {
    console.error(`[executor] failed to persist pending event for ${chatSessionId}:`, err);
  }
  // Notifier (best-effort): the agent is blocked on the human — fire off the durable request (§2.4).
  void notifyNeedsInput({
    sessionId: chatSessionId,
    requestId: pending.requestId,
    title: pending.kind === 'permission' ? `Permission: ${pending.toolName}` : 'Agent has a question',
    body:
      pending.kind === 'permission'
        ? pending.title ?? pending.description ?? 'The agent needs permission to continue.'
        : 'The agent is waiting for your answer.',
  }).catch(() => {});
}

function recordPendingResponse(chatSessionId: string, pending: PendingInput, response: UserInputResponse): void {
  try {
    insertChatEvent(buildPendingResponseEvent(chatSessionId, pending, response));
  } catch (err) {
    console.error(`[executor] failed to persist response event for ${chatSessionId}:`, err);
  }
  // Auto-revert plan mode on ExitPlanMode allow. Claude transitions its own
  // internal mode when the tool call succeeds, and the runner mirrors it. The
  // session row follows, so the UI flips back to whatever the user had
  // before plan (or `auto_all` if they came in fresh). No CLI recycle needed.
  if (pending.kind === 'permission' && pending.toolName === 'ExitPlanMode' && response.allow) {
    revertFromPlanMode(chatSessionId);
  }
}

function revertFromPlanMode(chatSessionId: string): void {
  const session = getChatSession(chatSessionId);
  if (!session || session.permissionMode !== 'plan') return;
  const target: PermissionMode = (session.prePlanMode as PermissionMode | null) ?? DEFAULT_PERMISSION_MODE;
  try {
    updateChatSession(chatSessionId, {
      permissionMode: target,
      prePlanMode: null,
    });
  } catch (err) {
    console.error(`[executor] failed to revert plan mode for ${chatSessionId}:`, err);
  }
}

function buildPendingRequestEvent(chatSessionId: string, pending: PendingInput): CreateChatEventInput {
  const base = {
    sessionId: chatSessionId,
    externalEventId: uuidv7(),
    externalToolCallId: pending.toolUseId,
    role: 'system',
    createdAt: pending.createdAt,
  };
  if (pending.kind === 'question') {
    return {
      ...base,
      source: 'question_request' satisfies ChatEventSource,
      content: null,
      toolInput: { questions: pending.questions } as Record<string, unknown>,
      raw: { kind: 'question', questions: pending.questions },
    };
  }
  return {
    ...base,
    source: 'permission_request' satisfies ChatEventSource,
    content: pending.title ?? pending.description ?? null,
    toolName: pending.toolName,
    toolInput: pending.input,
    raw: {
      kind: 'permission',
      title: pending.title,
      description: pending.description,
    },
  };
}

function buildPendingResponseEvent(
  chatSessionId: string,
  pending: PendingInput,
  response: UserInputResponse,
): CreateChatEventInput {
  const base = {
    sessionId: chatSessionId,
    externalEventId: uuidv7(),
    externalToolCallId: pending.toolUseId,
    role: 'system',
    createdAt: new Date().toISOString(),
  };
  if (pending.kind === 'question') {
    const answers = (response.updatedInput?.answers ?? null) as Record<string, string> | null;
    return {
      ...base,
      source: 'question_response' satisfies ChatEventSource,
      content: answers ? formatAnswerSummary(answers) : 'declined',
      toolInput: { answers, allow: response.allow } as Record<string, unknown>,
      raw: { allow: response.allow, answers },
    };
  }
  return {
    ...base,
    source: 'permission_response' satisfies ChatEventSource,
    content: response.allow ? 'allowed' : (response.message ?? 'denied'),
    toolName: pending.toolName,
    toolIsError: !response.allow,
    raw: {
      allow: response.allow,
      message: response.message ?? null,
    },
  };
}

function formatAnswerSummary(answers: Record<string, string>): string {
  return Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join('\n');
}
