import { NextRequest, NextResponse } from 'next/server';
import { getWebPushSubscriptionByEndpoint, listNotificationChannels } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { webPushStatusRequestSchema, type WebPushServerStatus } from '@/lib/notifications/web-push-contract';
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** Read-only reconciliation. Endpoint/key material stays out of URLs and responses. */
export async function POST(request: NextRequest) {
  let body;
  try { body = webPushStatusRequestSchema.safeParse(await readLimitedJson(request, 8192)); }
  catch (error) { return json({ error: 'Could not check this browser subscription.' }, error instanceof RequestBodyTooLargeError ? 413 : 400); }
  if (!body.success) return json({ error: 'Send this browser subscription with its keys, or an empty object.' }, 400);
  try {
    const userId = getNotifierUserId();
    const channel = listNotificationChannels({ userId }).find(channel => channel.kind === 'web_push');
    const subscription = 'endpoint' in body.data ? getWebPushSubscriptionByEndpoint(userId, body.data.endpoint) : undefined;
    const status: WebPushServerStatus = {
      registered: !!subscription && 'keys' in body.data && subscription.p256dh === body.data.keys.p256dh && subscription.auth === body.data.keys.auth,
      channel: channel ? { enabled: channel.enabled, events: channel.events } : null,
    };
    return json(status);
  } catch { return json({ error: 'Could not check browser notifications. Reconnect to Ri and retry.' }, 500); }
}
