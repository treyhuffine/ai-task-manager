/**
 * Typed emission helpers the app's lifecycle code calls at durable state transitions (spec §2.4).
 * They build the `NotificationEvent` (stable dedupeKey, title/body/deep-link) and hand it to
 * `notify()`. All best-effort — callers `void` them; nothing here throws into the lifecycle path.
 */
import type { RunRecord } from '@/db/types';
import { getRun, getExecution, getTrigger, getChatSession, getUserState } from '@/lib/db/queries';
import { notify, queueNotification, type NotifyOptions, type QueuedNotification } from './notify';
import type { NotificationEvent } from './types';
import { FULL_BODY_MAX, LINE_BODY_MAX, fitText, messageText, oneLine } from './message-text';
import { turnReply, turnReplyText, nameEntity } from './turn-reply';
import { checkInNoteForRun } from '@/lib/heartbeat/handoff';
import { isNoMessageReply } from '@/lib/heartbeat/prompt';
import { resolveOrchestratorName } from '@/lib/orchestrator/name';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';

/**
 * A run reached a terminal status. Picks the event by target:
 *   - orchestrator-target scheduled run (no execution) → `trigger.run_completed` (binding routing,
 *     delivered to the trigger's `deliverResultTo[]`);
 *   - any execution run (manual or scheduled) → `execution.finished` (matrix routing);
 *   - the main agent's turn on a heartbeat check-in's note → `agent.message` (matrix routing).
 * A check-in itself never notifies: what it found reaches the user as the main agent's message.
 * dedupeKey is the runId, so calling this from multiple terminal call-sites never double-sends.
 */
export function runTerminalNotification(runId: string): { event: NotificationEvent; options?: NotifyOptions } | null {
  const run = getRun(runId);
  if (!run || (run.status !== 'completed' && run.status !== 'failed')) return null;
  if (run.triggerId === RESERVED_TRIGGER_IDS.heartbeat) return null;
  const ok = run.status === 'completed';
  const note = !run.executionId && !run.triggerId ? checkInNoteForRun(runId) : null;
  if (note) return agentMessageNotification(run, note);
  const trigger = run.triggerId ? getTrigger(run.triggerId) : undefined;

  if (!run.executionId && trigger?.targetKind === 'orchestrator') {
    const deliverTo = trigger.deliverResultTo ?? [];
    if (deliverTo.length === 0) return null; // digest not bound to any channel
    return {
      event: {
        type: 'trigger.run_completed',
        userId: trigger.userId,
        dedupeKey: `trigger.run_completed:${runId}`,
        title: trigger.name,
        ...runText(run, ok ? 'Scheduled run completed.' : 'Scheduled run failed.'),
        url: `/triggers/${trigger.id}`,
      },
      options: { deliverTo },
    };
  }

  if (!run.executionId) return null;
  const execution = getExecution(run.executionId);
  if (!execution) return null;
  return {
    event: {
      type: 'execution.finished',
      userId: execution.userId,
      dedupeKey: `execution.finished:${runId}`,
      title: `${ok ? '✅' : '❌'} ${execution.label ?? 'Execution'}`,
      ...runText(run, ok ? 'Execution completed.' : 'Execution failed.'),
      // Deep-link opens the chat where the transcript lives. The home route is
      // the only surface that renders a session (`?session=<chatSessionId>`);
      // there is no `/executions/<id>` page. `runs.chatSessionId` is the exact
      // chat that ran (null for orchestration/content chats → fall back to home).
      url: run.chatSessionId ? `/?session=${run.chatSessionId}` : '/',
    },
  };
}

/**
 * The main agent told the user something from a check-in: its own message,
 * whole. It stays silent if the agent declined. If its turn failed, the
 * check-in's note goes out instead, so something urgent still arrives.
 */
function agentMessageNotification(run: RunRecord, note: NonNullable<ReturnType<typeof checkInNoteForRun>>): { event: NotificationEvent } | null {
  const chat = run.chatSessionId ? getChatSession(run.chatSessionId) : undefined;
  if (!chat) return null;
  const name = resolveOrchestratorName(getUserState()?.orchestratorName);
  const failed = run.status !== 'completed';
  if (!failed && isNoMessageReply(turnReply(chat.id))) return null;
  const text = failed ? messageText(note.payload.content, nameEntity) : turnReplyText(chat.id);
  if (!text) return null;
  const body = fitText(oneLine(text), LINE_BODY_MAX);
  const fullBody = fitText(text, FULL_BODY_MAX);
  return {
    event: {
      type: 'agent.message',
      userId: chat.userId,
      dedupeKey: `agent.message:${run.id}`,
      title: failed ? 'Heartbeat' : name,
      ...(fullBody === body ? { body } : { body, fullBody }),
      // Home is where the main agent lives.
      url: failed && note.sourceSessionId ? `/?session=${note.sourceSessionId}` : '/',
    },
  };
}

/**
 * What a finished run says: its reply as one `body` line every channel can show, and whole as
 * `fullBody` for channels with room for it (render.ts). The reply is the turn that just ended,
 * so a turn that wrote nothing never sends an earlier one's. Without one, a failed run says why.
 */
function runText(run: RunRecord, fallback: string): Pick<NotificationEvent, 'body' | 'fullBody'> {
  const reply = run.chatSessionId ? turnReplyText(run.chatSessionId) : run.summary;
  const approvalBlock = run.status === 'failed' && run.errorCode === 'coordination_approval_required' ? run.errorMessage?.trim() : null;
  const text = approvalBlock || reply || (run.status === 'failed' && run.errorMessage?.trim()) || fallback;
  const body = fitText(oneLine(text), LINE_BODY_MAX);
  const fullBody = fitText(text, FULL_BODY_MAX);
  return fullBody === body ? { body } : { body, fullBody };
}

/**
 * A run reached a terminal status: notify now. `queueRunTerminal` is the same notification
 * recorded inside a transaction, to send after commit.
 */
export async function notifyRunTerminal(runId: string): Promise<void> {
  const built = runTerminalNotification(runId);
  if (built) await notify(built.event, built.options);
}

export function queueRunTerminal(runId: string): QueuedNotification | null {
  const built = runTerminalNotification(runId);
  return built ? queueNotification(built.event, built.options) : null;
}

/** An agent asked the human for input (a permission/question request was persisted, spec §2.4). */
export interface NeedsInputArgs {
  sessionId: string;
  requestId: string;
  title: string;
  body: string;
}

function needsInputNotification(args: NeedsInputArgs): NotificationEvent | null {
  const session = getChatSession(args.sessionId);
  if (!session) return null;
  return {
    type: 'execution.needs_input',
    userId: session.userId,
    dedupeKey: `execution.needs_input:${args.requestId}`,
    title: args.title,
    body: args.body,
    // `?session=` opens the chat that needs input; `args.sessionId` is already
    // that chat's id (there is no `/executions/<id>` page).
    url: `/?session=${args.sessionId}`,
  };
}

export async function notifyNeedsInput(args: NeedsInputArgs): Promise<void> {
  const event = needsInputNotification(args);
  if (event) await notify(event);
}

/** The needs-input notification recorded inside a transaction, to send after commit. */
export function queueNeedsInput(args: NeedsInputArgs): QueuedNotification | null {
  const event = needsInputNotification(args);
  return event ? queueNotification(event) : null;
}
