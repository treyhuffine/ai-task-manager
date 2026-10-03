import { getChatSession } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { deliveriesForChat } from '@/lib/workers/delivery';
import { z as rpcZ } from 'zod/v4';

/**
 * Where each message this chat sent to a device elsewhere stands, by chat
 * event id (P3.2). Empty for a chat at home: its messages reach the harness
 * as they're sent. Live changes come on the session stream as `delivery`.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  if (!getChatSession(id)) return reply({ error: 'not_found' }, { status: 404 });
  return reply(deliveriesForChat(id));
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
