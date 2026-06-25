import { NextRequest, NextResponse } from 'next/server';
import { deleteWebPushSubscriptionByEndpoint } from '@/lib/db/queries';

/** Remove a browser's push subscription (the channel + other browsers are left intact). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
  if (!body.endpoint) return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
  deleteWebPushSubscriptionByEndpoint(body.endpoint);
  return NextResponse.json({ ok: true });
}
