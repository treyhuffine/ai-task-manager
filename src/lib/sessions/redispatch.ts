/**
 * Dispatch a message already in the chat, as the messages route would have
 * when it was sent: entity markers expanded, file markers expanded or left
 * for the computer the chat runs on, labeled with the chat that sent it, and
 * tied to its own event so it reaches the harness once (P4.2). Used for the
 * messages a transfer held, delivered once where the work ended up.
 */

import { getChatEventById } from '@/lib/db/queries';
import { expandEntityMarkers } from '@/lib/entity-refs/expand-markers';
import { expandMarkers } from '@/lib/attachments/expand-markers';
import { withSenderLabel } from '@/lib/sessions/sender';
import * as executor from '@/lib/executor/adapter';
import type { Attachment, WorkerCommandActor } from '@/db/types';

export async function redispatchStoredMessage(eventId: string, actor?: WorkerCommandActor): Promise<void> {
  const event = getChatEventById(eventId);
  if (!event || event.role !== 'user' || !event.content) return;
  const attachments = (event.attachments ?? []) as Attachment[];
  const expanded = await expandMarkers(expandEntityMarkers(event.content, event.sessionId), attachments);
  await executor.dispatch(event.sessionId, withSenderLabel(expanded, event.senderSessionId), {
    sourceEventId: event.id,
    attachments,
    actor,
  });
}
