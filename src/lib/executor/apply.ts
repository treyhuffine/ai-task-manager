/**
 * Applying what a runner reports, at home (docs/homes-build.md, P2.3).
 *
 * One set of functions for every placement: the home's own runner reports
 * through the home sink, which applies each event or signal in its own
 * transaction, and a worker's journaled events arrive at
 * `POST /api/workers/me/events`, where each is applied in a transaction that
 * also advances the computer's journal position. Everything is idempotent by
 * key, so a replay changes nothing:
 *
 * - a chat event inserts by id, and nothing happens on conflict;
 * - a cumulative part replaces only with a higher revision;
 * - a turn result finishes its run only while it's still running;
 * - a native session id is set only when it differs.
 *
 * Notifications are queued inside the transaction, and realtime publishes
 * and waking waiters happen after commit.
 */

import type { StreamEvent, UserInputResponse } from '@agentex/agent';
import type { ChatEventSource, CreateChatEventInput, PermissionMode } from '@/db/types';
import {
  chatPlacement,
  getAckedEventSeq,
  getChatSession,
  heldPlacement,
  insertChatEvent,
  replaceChatEventPart,
  sendForRun,
  sendForTurn,
  setAckedEventSeq,
  updateChatSession,
} from '@/lib/db/queries';
import { publishBackgroundTaskActivity, publishPendingInput, publishRuntime } from '@/lib/realtime/bus';
import { queueNeedsInput } from '@/lib/notifications/emit';
import { recordRunTelemetry } from '@/lib/runs/event-hooks';
import { finishRunInTransaction } from '@/lib/runs/finish';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import { inTransaction, type AfterCommit } from '@/lib/effects/after-commit';
import type { PendingInput } from '@/lib/runner/pending';
import type { RunnerSignal } from '@/lib/runner/types';
import type { WorkerEvent } from '@/lib/workers/protocol';
import { mirrorSignal } from './remote-live';
import { settleTurn } from './turns';

/**
 * A chat event: inserted, or for a cumulative provider part replacing an
 * older revision. A result event it inserted also feeds run telemetry: to
 * `runId` when given (null charges nothing), otherwise to the chat's active
 * run here, which is right only for the home's own runner. Returns whether
 * anything changed.
 */
export function applyChatEvent(row: CreateChatEventInput, opts: { cumulative: boolean; runId?: string | null }): boolean {
  const stored = opts.cumulative ? replaceChatEventPart(row) : insertChatEvent(row);
  if (stored && !opts.cumulative && row.source === 'result' && row.raw && opts.runId !== null) {
    try {
      recordRunTelemetry(row.sessionId, row.raw as unknown as StreamEvent, opts.runId);
    } catch (err) {
      // Dropping a telemetry event is preferable to losing the event itself.
      console.warn(`[runs] telemetry hook failed for ${row.sessionId}:`, err);
    }
  }
  return stored !== null;
}

/**
 * Apply one signal. `from` names the connected computer that reported it,
 * whose live state the home mirrors; absent for the home's own runner, whose
 * state the facade reads directly.
 */
export function applyRunnerSignal(
  chatSessionId: string,
  signal: RunnerSignal,
  after: AfterCommit,
  from: { computerId: string } | null = null,
): void {
  if (from) after.tasks.push(() => mirrorSignal(from.computerId, chatSessionId, signal));
  switch (signal.type) {
    case 'running':
      after.tasks.push(() => publishRuntime(chatSessionId, signal.running));
      return;
    case 'background_tasks':
      after.tasks.push(() => publishBackgroundTaskActivity(chatSessionId, signal.active, signal.taskIds));
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
      recordPendingRequest(chatSessionId, signal.pending, after);
      return;
    case 'pending_resolved':
      recordPendingResponse(chatSessionId, signal.pending, signal.response);
      return;
    case 'pending_changed':
      after.tasks.push(() => publishPendingInput(chatSessionId, signal.pending));
      return;
    case 'turn_result':
      if (signal.runId) finishRunInTransaction(signal.runId, turnOutcome(signal), after);
      after.tasks.push(() => settleTurn(signal.turnId, signal.ok ? null : signal.error ?? 'The turn failed'));
      return;
  }
}

// ─── A worker's journal ───────────────────────────────────────

/**
 * Store a batch of a worker's journaled events, in order, one transaction
 * each, advancing the computer's journal position with it. A position at or
 * below the stored one is a replay and is skipped. A gap stops the batch, and
 * the worker resends from the position returned.
 *
 * An event for a chat that doesn't run on this computer is not applied, and
 * its position still advances: the worker can't make it applicable by
 * resending it, and holding the journal on it would stop everything after.
 */
export function applyWorkerEvents(
  computerId: string,
  events: WorkerEvent[],
): { acked: number; refused: number[] } {
  const refused: number[] = [];
  let acked = getAckedEventSeq(computerId);
  for (const event of [...events].sort((a, b) => a.position - b.position)) {
    if (event.position <= acked) continue;
    if (event.position !== acked + 1) break;
    const outcome = inTransaction((after) => {
      // Read the position again inside the transaction: another request for
      // the same computer may have applied this event already.
      const current = getAckedEventSeq(computerId);
      if (event.position <= current) return { position: current, refused: false };
      if (event.position !== current + 1) return { position: current, refused: false };
      const standing = eventStanding(computerId, event);
      const allowed = standing !== 'refused';
      if (allowed) applyWorkerEvent(computerId, event, after, standing === 'history');
      setAckedEventSeq(computerId, event.position);
      return { position: event.position, refused: !allowed };
    });
    if (outcome.refused) refused.push(event.position);
    if (outcome.position !== event.position) break;
    acked = outcome.position;
  }
  if (refused.length > 0) {
    console.warn(`[workers] ${computerId} sent events for chats that don't run on it, at positions ${refused.join(', ')}`);
  }
  return { acked, refused };
}

/**
 * Whether a computer may report this event, and how it counts (P2 protocol,
 * Fencing and Events): `current` from the chat's placement now, `history`
 * from a placement this computer held before, which is stored because it
 * happened but changes no live state, or `refused`.
 */
function eventStanding(computerId: string, event: WorkerEvent): 'current' | 'history' | 'refused' {
  if (!getChatSession(event.chatSessionId)) return 'refused';
  const placement = chatPlacement(event.chatSessionId);
  if (!placement) return 'refused';
  if (placement.executionId === null) return placement.computerId === computerId && !placement.isHome ? 'current' : 'refused';
  // The worker stamps the generation that ran it. Without one, there's no
  // telling which placement it belongs to, and the one here now isn't a
  // guess worth making (P2 review fixes).
  const generation = event.generation;
  if (generation === null) return 'refused';
  if (placement.computerId === computerId && placement.generation === generation) return 'current';
  return heldPlacement(placement.executionId, computerId, generation) ? 'history' : 'refused';
}

/**
 * The run a worker's event belongs to, when it's the run of one of this
 * computer's sends for that chat. Anything else a worker names about runs or
 * turns is ignored: its chat being its own doesn't make another chat's run
 * or turn its to finish.
 */
function ownRun(computerId: string, chatSessionId: string, runId: string | null | undefined): string | null {
  if (!runId) return null;
  return sendForRun(computerId, chatSessionId, runId) ? runId : null;
}

function applyWorkerEvent(computerId: string, event: WorkerEvent, after: AfterCommit, historyOnly: boolean): void {
  if (event.kind === 'chat_event') {
    // Files a computer names never become chips here: their bytes would be
    // on that computer only (P2.5, "Attachments and artifacts"). A result's
    // cost goes to the run the worker says it came from, when that run is
    // one of its sends, and never to whatever run is active here now: an
    // old placement's result must not charge the new one's run.
    applyChatEvent(
      { ...event.chatEvent, attachments: undefined, id: event.eventId, sessionId: event.chatSessionId },
      { cumulative: event.cumulative, runId: ownRun(computerId, event.chatSessionId, event.runId) },
    );
    return;
  }
  const { signal } = event;
  if (signal.type === 'turn_result') {
    // Bound to the send that started the turn: this computer's, for this
    // chat, from the placement that ran it. Its run is the send's.
    const send = sendForTurn(computerId, event.chatSessionId, signal.turnId);
    if (!send || (send.executionId !== null && send.generation !== event.generation)) {
      console.warn(`[workers] ${computerId} reported a turn it wasn't sent, for ${event.chatSessionId}. Ignored.`);
      return;
    }
    const runId = (send.payload as { runId?: string | null } | null)?.runId ?? null;
    // An old placement's turn still ends its own run. Nothing else it
    // reports touches the placement here now.
    if (historyOnly) {
      if (runId) finishRunInTransaction(runId, turnOutcome(signal), after);
      after.tasks.push(() => settleTurn(signal.turnId, signal.ok ? null : signal.error ?? 'The turn failed'));
      return;
    }
    applyRunnerSignal(event.chatSessionId, { ...signal, runId }, after, { computerId });
    return;
  }
  if (historyOnly) return;
  applyRunnerSignal(event.chatSessionId, signal, after, { computerId });
}

function turnOutcome(signal: Extract<RunnerSignal, { type: 'turn_result' }>) {
  return signal.ok
    ? { ok: true as const }
    : { ok: false as const, errorCode: 'agent_error', errorMessage: signal.error ?? 'The turn failed' };
}

// ─── Pending prompts ──────────────────────────────────────────

/**
 * A prompt the agent is blocked on: a transcript row so the request is
 * visible in chat history (alongside the live overlay), and a notification.
 * The rows' ids come from the request id, so a replayed or retried prompt
 * inserts once.
 */
function recordPendingRequest(chatSessionId: string, pending: PendingInput, after: AfterCommit): void {
  insertChatEvent(buildPendingRequestEvent(chatSessionId, pending));
  // Notifier: the agent is blocked on the human (§2.4).
  const queued = queueNeedsInput({
    sessionId: chatSessionId,
    requestId: pending.requestId,
    title: pending.kind === 'permission' ? `Permission: ${pending.toolName}` : 'Agent has a question',
    body:
      pending.kind === 'permission'
        ? pending.title ?? pending.description ?? 'The agent needs permission to continue.'
        : 'The agent is waiting for your answer.',
  });
  if (queued) after.notifications.push(queued);
}

function recordPendingResponse(chatSessionId: string, pending: PendingInput, response: UserInputResponse): void {
  insertChatEvent(buildPendingResponseEvent(chatSessionId, pending, response));
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
  updateChatSession(chatSessionId, { permissionMode: target, prePlanMode: null });
}

function buildPendingRequestEvent(chatSessionId: string, pending: PendingInput): CreateChatEventInput {
  const base = {
    sessionId: chatSessionId,
    externalEventId: `pending-request:${pending.requestId}`,
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
    externalEventId: `pending-response:${pending.requestId}`,
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
