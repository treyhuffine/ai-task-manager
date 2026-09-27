import { NextRequest, NextResponse } from 'next/server';
import { deleteWebPushSubscriptionForUser } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { webPushEndpointSchema } from '@/lib/notifications/web-push-contract';
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';

const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

/** Idempotent per-browser removal. Other users, browsers and channel preferences stay intact. */
export async function POST(request: NextRequest) {
  let body;
  try { body = webPushEndpointSchema.safeParse(await readLimitedJson(request, 8192)); }
  catch (error) { return json({ error: 'Could not read this browser subscription.' }, error instanceof RequestBodyTooLargeError ? 413 : 400); }
  if (!body.success) return json({ error: 'A valid HTTPS browser subscription endpoint is required.' }, 400);
  try {
    deleteWebPushSubscriptionForUser(getNotifierUserId(), body.data.endpoint);
    return json({ ok: true });
  } catch { return json({ error: 'Could not turn off browser notifications. Please retry.' }, 500); }
}
