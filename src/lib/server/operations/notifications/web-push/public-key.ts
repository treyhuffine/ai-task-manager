import { getVapidKeys } from '@/lib/notifications/web-push/vapid';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** The VAPID public key the browser needs to subscribe to push. */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply({ publicKey: getVapidKeys().publicKey });
}

export const GETInput = rpcZ.object({}).strict().default({});
