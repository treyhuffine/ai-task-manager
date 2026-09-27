import { NextRequest, NextResponse } from 'next/server';
import { registerWebPushSubscription } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { defaultChannelEvents } from '@/lib/notifications/events';
import { webPushSubscriptionSchema } from '@/lib/notifications/web-push-contract';
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** Explicit opt-in or repair. Existing channel enabled/events preferences survive. */
export async function POST(request: NextRequest) {
  let body;
  try { body = webPushSubscriptionSchema.safeParse(await readLimitedJson(request, 8192)); }
  catch (error) { return json({ error: 'Could not read this browser subscription.' }, error instanceof RequestBodyTooLargeError ? 413 : 400); }
  if (!body.success) return json({ error: 'A valid HTTPS endpoint and browser subscription keys are required.' }, 400);
  try {
    const { endpoint, keys } = body.data;
    if (!registerWebPushSubscription({ userId: getNotifierUserId(), endpoint, ...keys }, defaultChannelEvents())) {
      return json({ error: 'This browser subscription belongs to another account. Remove it in your browser settings and try again.' }, 409);
    }
    return json({ ok: true });
  } catch { return json({ error: 'Could not save browser notifications. Try enabling them again.' }, 500); }
}
