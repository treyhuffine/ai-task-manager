import { getDelivery, getNotificationChannel } from '@/lib/db/queries';
import { notify } from '@/lib/notifications';
import { getNotifierUserId } from '@/lib/notifications/user';
import { reply, type OperationContext } from '@/lib/server/operation';
import { uuidv7 } from 'uuidv7';
import { z as rpcZ } from 'zod/v4';

/**
 * Fire a one-off test notification to a single channel (binding routing, so it ignores the
 * event-toggle matrix). Returns the delivery outcome so the UI can show sent / failed + the error —
 * the fast way to confirm a channel actually works without waiting for a real execution.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const channel = getNotificationChannel(id);
  if (!channel || channel.userId !== getNotifierUserId()) {
    return reply({ error: 'not_found' }, { status: 404 });
  }

  const dedupeKey = `test:${uuidv7()}`; // unique per press → never deduped against a prior test
  const name = channel.label ?? (channel.kind === 'web_push' ? 'Web push' : 'this channel');
  await notify(
    {
      type: 'execution.finished',
      userId: channel.userId,
      dedupeKey,
      title: 'Test notification',
      body: `Your "${name}" channel is working. 🎉`,
      url: '/?settings=notifications',
    },
    { deliverTo: [id] },
  );

  const delivery = getDelivery(dedupeKey, id);
  return reply({
    status: delivery?.status ?? 'unknown',
    ...(delivery?.lastError ? { error: delivery.lastError } : {}),
  });
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
