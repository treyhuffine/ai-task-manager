import { getDevice, getSendForEvent } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { deliveryOf } from '@/lib/workers/delivery';
import { withdrawQueuedSend } from '@/lib/workers/undelivered';
import { z as rpcZ } from 'zod/v4';

/**
 * Withdraw a message still waiting in its device's queue (P3.2). Only one
 * that hasn't crossed the delivery boundary: once it's been streamed to the
 * worker it may be running, and only stopping the execution can prevent
 * that. Its run is finished and its turn settled with it, and it shows as
 * not delivered.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id, eventId } = rpcInput.params;
  const send = getSendForEvent(eventId);
  if (!send || send.chatSessionId !== id) {
    return reply({ error: 'not_found', message: 'That message has nothing waiting to withdraw.' }, { status: 404 });
  }
  const onItsWay = () => {
    const name = getDevice(send.deviceId)?.name ?? 'its device';
    return reply(
      { error: 'on_its_way', message: `It's already on its way to ${name}. Stop the execution to keep it from running.` },
      { status: 409 },
    );
  };
  if (send.state === 'sent') return onItsWay();
  if (send.state !== 'queued') {
    return reply({ error: 'not_waiting', message: "It isn't waiting any more." }, { status: 409 });
  }
  const withdrawn = withdrawQueuedSend(send.id);
  // Streamed meanwhile: too late to withdraw.
  if (!withdrawn) return onItsWay();
  const delivery = deliveryOf(withdrawn);
  return delivery ? reply(delivery) : reply({ error: 'not_found' }, { status: 404 });
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "eventId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
