import { getNotificationChannel, getTrigger, updateTrigger } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Bind a trigger's result to notification channels (spec §2.9). Body: { deliverResultTo: string[] }. */
export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const trigger = getTrigger(id);
  if (!trigger) return reply({ error: 'not_found' }, { status: 404 });

  const body = (rpcInput.body) as { deliverResultTo?: string[] };
  // Keep only channel ids that exist and belong to this user.
  const userId = getNotifierUserId();
  const deliverResultTo = (body.deliverResultTo ?? []).filter((cid) => {
    const ch = getNotificationChannel(cid);
    return ch && ch.userId === userId;
  });
  const updated = updateTrigger(id, { deliverResultTo });
  return reply({ trigger: { id, deliverResultTo: updated?.deliverResultTo ?? [] } });
}

export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "deliverResultTo": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
