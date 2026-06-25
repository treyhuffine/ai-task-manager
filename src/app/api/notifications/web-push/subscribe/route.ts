import { NextRequest, NextResponse } from 'next/server';
import { upsertWebPushSubscription, listNotificationChannels, createNotificationChannel } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { defaultChannelEvents } from '@/lib/notifications/events';

/**
 * Store a browser's push subscription and ensure the single `web_push` channel exists for this user
 * (the "all my browsers" channel). Body is a `PushSubscription.toJSON()`: { endpoint, keys }.
 */
export async function POST(request: NextRequest) {
  const userId = getNotifierUserId();
  const body = (await request.json().catch(() => ({}))) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: 'endpoint + keys.p256dh + keys.auth required' }, { status: 400 });
  }

  upsertWebPushSubscription({ userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth });

  if (!listNotificationChannels({ userId }).some((c) => c.kind === 'web_push')) {
    createNotificationChannel({ userId, kind: 'web_push', config: {}, events: defaultChannelEvents(), enabled: true });
  }

  return NextResponse.json({ ok: true });
}
