import { RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { registerWebPushSubscription } from '@/lib/db/queries';
import { defaultChannelEvents } from '@/lib/notifications/events';
import { getNotifierUserId } from '@/lib/notifications/user';
import { webPushSubscriptionSchema } from '@/lib/notifications/web-push-contract';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Explicit opt-in or repair. Existing channel enabled/events preferences survive. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  let body;
  try { body = webPushSubscriptionSchema.safeParse(boundedInput(rpcInput.body, 8192)); }
  catch (error) { return reply({ error: 'Could not read this browser subscription.' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: { 'Cache-Control': 'no-store' } }); }
  if (!body.success) return reply({ error: 'A valid HTTPS endpoint and browser subscription keys are required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    const { endpoint, keys } = body.data;
    if (!registerWebPushSubscription({ userId: getNotifierUserId(), endpoint, ...keys }, defaultChannelEvents())) {
      return reply({ error: 'This browser subscription belongs to another account. Remove it in your browser settings and try again.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    return reply({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply({ error: 'Could not save browser notifications. Try enabling them again.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } }); }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "keys": rpcZ.object({ "p256dh": rpcZ.string(), "auth": rpcZ.string() }).strict(), "endpoint": rpcZ.string() }).strict() }).strict();
