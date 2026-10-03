import { RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { getWebPushSubscriptionByEndpoint, listNotificationChannels } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { webPushStatusRequestSchema, type WebPushServerStatus } from '@/lib/notifications/web-push-contract';
import { boundedInput, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Read-only reconciliation. Endpoint/key material stays out of URLs and responses. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  let body;
  try { body = webPushStatusRequestSchema.safeParse(boundedInput(rpcInput.body, 8192)); }
  catch (error) { return reply({ error: 'Could not check this browser subscription.' }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400, headers: { 'Cache-Control': 'no-store' } }); }
  if (!body.success) return reply({ error: 'Send this browser subscription with its keys, or an empty object.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  try {
    const userId = getNotifierUserId();
    const channel = listNotificationChannels({ userId }).find(channel => channel.kind === 'web_push');
    const subscription = 'endpoint' in body.data ? getWebPushSubscriptionByEndpoint(userId, body.data.endpoint) : undefined;
    const status: WebPushServerStatus = {
      registered: !!subscription && 'keys' in body.data && subscription.p256dh === body.data.keys.p256dh && subscription.auth === body.data.keys.auth,
      channel: channel ? { enabled: channel.enabled, events: channel.events } : null,
    };
    return reply(status, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return reply({ error: 'Could not check browser notifications. Reconnect to Ri and retry.' }, { status: 500, headers: { 'Cache-Control': 'no-store' } }); }
}

export const POSTInput = rpcZ.object({ body: rpcZ.union([rpcZ.record(rpcZ.string(), rpcZ.never()), rpcZ.object({ "keys": rpcZ.object({ "p256dh": rpcZ.string(), "auth": rpcZ.string() }).strict(), "endpoint": rpcZ.string() }).strict()]) }).strict();
