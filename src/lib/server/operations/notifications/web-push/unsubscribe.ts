import { RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { deleteWebPushSubscriptionForUser } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { webPushEndpointSchema } from '@/lib/notifications/web-push-contract';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Idempotent per-browser removal. Other users, browsers and channel preferences stay intact. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  let body;
  try { body = webPushEndpointSchema.safeParse(boundedInput(rpcInput.body, 8192)); }
  catch (error) { return reply({ error: 'Could not read this browser subscription.' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: { 'Cache-Control': 'no-store' } }); }
  if (!body.success) return reply({ error: 'A valid HTTPS browser subscription endpoint is required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    deleteWebPushSubscriptionForUser(getNotifierUserId(), body.data.endpoint);
    return reply({ ok: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply({ error: 'Could not turn off browser notifications. Please retry.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } }); }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "endpoint": rpcZ.string() }).strict() }).strict();
