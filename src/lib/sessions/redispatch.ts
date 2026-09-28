/**
 * Dispatch a message already in the chat, as the messages route would have
 * when it was sent: entity markers expanded, file markers expanded or left
 * for the computer the chat runs on, labeled with the chat that sent it, and
 * tied to its own event so it reaches the harness once (P4.2). Used for the
 * messages a transfer held, delivered once where the work ended up. A
 * scheduled fire's message goes as its run, under its time limit (P3
 * re-check).
 */

import { getChatEventById, heldFireFor } from '@/lib/db/queries';
import { deliverHeldFire } from '@/lib/runs/dispatch';
import { expandEntityMarkers } from '@/lib/entity-refs/expand-markers';
import { expandMarkers } from '@/lib/attachments/expand-markers';
import { withSenderLabel } from '@/lib/sessions/sender';
import * as executor from '@/lib/executor/adapter';
import type { Attachment, WorkerCommandActor } from '@/db/types';

export async function redispatchStoredMessage(
  eventId: string,
  actor?: WorkerCommandActor,
  opts: { heldFor?: string; onAccepted?: () => void } = {},
): Promise<void> {
  const event = getChatEventById(eventId);
  if (!event || event.role !== 'user' || !event.content) {
    opts.onAccepted?.();
    return;
  }
  const attachments = (event.attachments ?? []) as Attachment[];
  const expanded = await expandMarkers(expandEntityMarkers(event.content, event.sessionId), attachments);
  // Resolves once the harness (or its computer's queue) has it, not when the
  // turn is over: messages delivered one after another keep their order
  // without each waiting on the last one's whole turn. Only `onAccepted`
  // says it was taken. A dispatch that failed, or ended without anything
  // taking it, rejects, so the caller keeps it (P4 re-check and final
  // re-check).
  const fire = heldFireFor(event.id);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const accept = () => {
      if (settled) return;
      settled = true;
      opts.onAccepted?.();
      resolve();
    };
    const message = withSenderLabel(expanded, event.senderSessionId);
    const options = { sourceEventId: event.id, attachments, actor, heldFor: opts.heldFor, onAccepted: accept };
    (fire ? deliverHeldFire(fire, message, options) : executor.dispatch(event.sessionId, message, options))
      .then(
        () => {
          if (settled) return;
          settled = true;
          reject(new Error("Nothing took it: it's still held."));
        },
        (err: unknown) => {
          if (!settled) {
            settled = true;
            reject(err);
          } else {
            console.warn(`[redispatch] ${event.id}'s turn failed:`, err);
          }
        },
      );
  });
}
