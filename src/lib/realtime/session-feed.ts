/**
 * What a session's stream carries (the per-session route, and the page
 * stream): on open, the chat events missed since `lastEventId`; then every
 * chat event, runtime, background task, pending input, reconcile, delivery
 * and transfer change as it's published; and the current ephemeral state as
 * a seed, then `ready`. Returns the unsubscribe.
 *
 * Subscribed before the replay, so an event published during it still
 * arrives as a live frame; the client dedups chat events on id, and keeps
 * the newest revision of a part.
 *
 * `ready` says whether what was missed was replayed in full (`resumed`):
 * only when all of it fits in one replay, parts revised in place included
 * (found by `revisedSince`, the newest change the client saw). Otherwise
 * nothing is replayed, and the client reads the transcript afresh (P3
 * re-check). Either way `position` is where the transcript stands now, for
 * the client to resume from next time.
 */

import { toChatEventDTO } from '@/lib/api/dto/chat-event';
import { subscribe, sessionChannel, type SessionStreamMessage } from '@/lib/realtime/bus';
import { chatEventsPosition, listChatEventsToResume } from '@/lib/db/queries';
import * as executor from '@/lib/executor/adapter';
import { listForSession as listPendingForSession } from '@/lib/executor/live-state';
import type { ChatEventRecord } from '@/db/types';

export type FeedEmit = (event: string, data: unknown, id?: string) => void;

export function openSessionFeed(
  sessionId: string,
  lastEventId: string | null,
  emit: FeedEmit,
  options: { revisedSince?: string | null } = {},
): () => void {
  // Both the live publish and the resume replay funnel through here, so the
  // projection applies to each. It has to match the GET /events route
  // exactly (lib/api/dto/chat-event).
  const writeChatEvent = (event: ChatEventRecord) => emit('chat_event', toChatEventDTO(event), event.id);

  const unsubscribe = subscribe(sessionChannel(sessionId), (message: SessionStreamMessage) => {
    switch (message.kind) {
      case 'chat_event': writeChatEvent(message.event); break;
      case 'runtime': emit('runtime', { running: message.running }); break;
      case 'background_tasks': emit('background_tasks', { active: message.active, taskIds: message.taskIds }); break;
      case 'pending_input': emit('pending_input', { pending: message.pending }); break;
      case 'reconcile': emit('reconcile', { status: message.status, replayed: message.replayed }); break;
      case 'delivery': emit('delivery', { eventId: message.eventId, delivery: message.delivery }); break;
      case 'transfer': emit('transfer', { transfer: message.transfer }); break;
      case 'session_updated': break;
      case 'device_updated': break;
    }
  });

  // Resume replay: all of what was missed, or nothing and the client reads
  // the transcript afresh.
  let resumed = false;
  if (lastEventId) {
    try {
      const missed = listChatEventsToResume(sessionId, lastEventId, options.revisedSince ?? null);
      for (const row of missed.rows) writeChatEvent(row);
      resumed = missed.complete;
    } catch (err) {
      console.error(`[session feed ${sessionId}] resume failed:`, err);
    }
  }

  // The current ephemeral state: in-process lookups, no DB hit.
  emit('runtime', { running: executor.isRunning(sessionId) });
  emit('background_tasks', { active: executor.hasBackgroundTasks(sessionId), taskIds: executor.listBackgroundTaskIds(sessionId) });
  emit('pending_input', { pending: listPendingForSession(sessionId) });
  emit('ready', { sessionId, resumed, position: chatEventsPosition(sessionId) });
  return unsubscribe;
}
