/**
 * How a check-in's findings reach the user: as a note to their main agent, who
 * takes a normal turn and writes to them. The note travels the same durable
 * path agents use to message each other, so it waits while the main agent is
 * busy, and the message is really the main agent's, in its own history, so a
 * reply just continues the conversation. See docs/heartbeat-spec.md §15.
 *
 * CLI-reachable through the trigger module, so nothing here may statically
 * import the executor.
 */

import {
  coordinationDeliveriesForRun,
  createInitiatingAgentDelivery,
  getAgentDelivery,
  getRun,
  getRunForSourceEvent,
  listRecentChatEvents,
  updateChatSession,
} from '@/lib/db/queries';
import { stableCoordinationId } from '@/lib/coordination/ids';
import { turnReply } from '@/lib/notifications/turn-reply';
import { OUTCOME_SOURCES, type AgentDeliveryRecord, type ChatEventSource, type ChatSessionRecord, type RunRecord } from '@/db/types';
import { NO_MESSAGE_REPLY } from './constants';
import { isNoMessageReply } from './prompt';

export type CheckInNoteKind = 'now' | 'daily';

/** Far enough back to cross a declining turn, which does little before it replies. */
const OUTCOME_LOOKBACK = 200;

const DECLINE = `If they already know this, or it no longer matters, reply with exactly ${NO_MESSAGE_REPLY} and nothing else, and they won't see anything.`;

const VOICE = "Write as yourself, the way you'd text someone you work with. Don't mention the check-in, the heartbeat, or this note.";

/** What the main agent reads. The user only sees a link to the check-in, then the reply. */
export function composeMainAgentNote(kind: CheckInNoteKind, note: string): string {
  return kind === 'now'
    ? `A background check-in found something while the user wasn't here. It can't reach them, so you decide whether and how to tell them. Your reply is sent to them as a message right away.\n\n${note}\n\nLead with what matters and what they should do, in a few lines. Check with your tools if you need to. ${VOICE} ${DECLINE}`
    : `Once a day you get what background check-ins found that could wait, and what they changed for the user. Your reply is sent to them as one message.\n\n${note}\n\nCover only what still matters, briefly and most important first. If it's a lot, pick what's worth their attention today. ${VOICE} ${DECLINE}`;
}

function requestKey(runId: string, kind: CheckInNoteKind): string {
  return `heartbeat:${runId}:${kind}`;
}

function deliveryId(sourceSessionId: string, runId: string, kind: CheckInNoteKind): string {
  return stableCoordinationId('request', sourceSessionId, requestKey(runId, kind));
}

/**
 * Queue a note for the main agent, in the same transaction that finishes the
 * check-in, so a crash can't lose it. The drain delivers it once the main agent
 * is idle. App-owned, so it needs no agent coordination approval: turning the
 * heartbeat on is what authorized it.
 */
export function handOffToMainAgent(run: RunRecord, source: ChatSessionRecord, kind: CheckInNoteKind, note: string): AgentDeliveryRecord {
  const id = deliveryId(source.id, run.id, kind);
  return createInitiatingAgentDelivery({
    id,
    source,
    sourceRunId: null,
    address: 'orchestrator',
    targetSessionId: null,
    requestKey: requestKey(run.id, kind),
    parentRequestId: null,
    kind: 'message',
    content: note,
    options: null,
    eventId: stableCoordinationId('input', id),
    prompt: `[Ri agent message. Request ID: ${id}. Requesting chat: ${source.id}.]\n${composeMainAgentNote(kind, note)}`,
    status: 'queued',
    checkIn: { kind, runId: run.id, at: run.startedAt ?? run.queuedAt },
  });
}

/** Whether this note never got as far as the main agent answering it. */
export function checkInNoteFailed(run: Pick<RunRecord, 'id' | 'chatSessionId'>, kind: CheckInNoteKind): boolean {
  if (!run.chatSessionId) return false;
  const delivery = getAgentDelivery(deliveryId(run.chatSessionId, run.id, kind));
  if (!delivery) return false;
  if (['failed', 'cancelled', 'denied'].includes(delivery.status)) return true;
  const turn = getRunForSourceEvent(delivery.eventId);
  return turn?.status === 'failed' || turn?.status === 'cancelled';
}

/** Whether a note this check-in sent couldn't be delivered, so Settings can say so. */
export function checkInHandOffFailed(run: Pick<RunRecord, 'id' | 'chatSessionId'>): boolean {
  return checkInNoteFailed(run, 'now') || checkInNoteFailed(run, 'daily');
}

/** The check-in note a main-chat run answered, if that's what this run was. */
export function checkInNoteForRun(runId: string): AgentDeliveryRecord | null {
  return coordinationDeliveriesForRun(runId).find((delivery) => delivery.payload.checkIn) ?? null;
}

/**
 * The main agent decided a note shouldn't reach the user, so this turn should
 * leave no mark. Its silent reply moved the chat's outcome time, which would
 * show something new, so put that back to the turn before it. Whatever was
 * unread before stays unread, including a message it sent from an earlier
 * check-in, which is the usual reason to decline.
 */
export function settleDeclinedNote(runId: string, chatSessionId: string): void {
  if (!checkInNoteForRun(runId)) return;
  if (!isNoMessageReply(turnReply(chatSessionId))) return;
  const sourceEventId = getRun(runId)?.sourceEventId;
  const events = listRecentChatEvents(chatSessionId, OUTCOME_LOOKBACK);
  const start = events.findIndex((event) => event.id === sourceEventId);
  const previous = start < 0 ? undefined : events.slice(start + 1).find((event) => OUTCOME_SOURCES.has(event.source as ChatEventSource));
  updateChatSession(chatSessionId, { lastOutcomeEventAt: previous?.createdAt ?? null });
}
