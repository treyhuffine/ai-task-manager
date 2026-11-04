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

/** Far enough back to cross a declining turn, which does little before it replies. */
const OUTCOME_LOOKBACK = 200;

const DECLINE = `If they already know this, or it no longer matters, reply with exactly ${NO_MESSAGE_REPLY} and nothing else, and they won't see anything.`;

const VOICE = "Write as yourself, the way you'd text someone you work with. Don't mention the check-in, the heartbeat, or this note.";

/** What the main agent reads. The user only sees a link to the check-in, then the reply. */
export function composeMainAgentNote(note: string, options: { first?: boolean } = {}): string {
  const first = options.first ? " This is the first message they've had from a check-in, so add one line saying you check in on a schedule and they can change or stop it in Settings > Heartbeat." : '';
  return `A background check-in has something for the user while they're away. It can't reach them, so you decide whether and how to tell them. Your reply is sent to them as a message right away.\n\n${note}\n\nLead with what matters and what they should do, as briefly as the content allows. Check with your tools if you need to. ${VOICE}${first} ${DECLINE}`;
}

function deliveryId(sourceSessionId: string, runId: string): string {
  return stableCoordinationId('request', sourceSessionId, `heartbeat:${runId}:now`);
}

/**
 * Queue a note for the main agent, in the same transaction that finishes the
 * check-in, so a crash can't lose it. The drain delivers it once the main agent
 * is idle. App-owned, so it needs no agent coordination approval: turning the
 * heartbeat on is what authorized it.
 */
export function handOffToMainAgent(run: RunRecord, source: ChatSessionRecord, note: string, options: { first?: boolean } = {}): AgentDeliveryRecord {
  const id = deliveryId(source.id, run.id);
  return createInitiatingAgentDelivery({
    id,
    source,
    sourceRunId: null,
    address: 'orchestrator',
    targetSessionId: null,
    requestKey: `heartbeat:${run.id}:now`,
    parentRequestId: null,
    kind: 'message',
    content: note,
    options: null,
    eventId: stableCoordinationId('input', id),
    prompt: `[Ri agent message. Request ID: ${id}. Requesting chat: ${source.id}.]\n${composeMainAgentNote(note, options)}`,
    status: 'queued',
    checkIn: { runId: run.id, at: run.startedAt ?? run.queuedAt },
  });
}

/** Whether this check-in's note never got as far as the main agent answering it. */
export function checkInNoteFailed(run: Pick<RunRecord, 'id' | 'chatSessionId'>): boolean {
  if (!run.chatSessionId) return false;
  const delivery = getAgentDelivery(deliveryId(run.chatSessionId, run.id));
  if (!delivery) return false;
  if (['failed', 'cancelled', 'denied'].includes(delivery.status)) return true;
  const turn = getRunForSourceEvent(delivery.eventId);
  return turn?.status === 'failed' || turn?.status === 'cancelled';
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
