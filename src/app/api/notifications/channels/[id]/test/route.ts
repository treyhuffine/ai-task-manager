import { NextRequest, NextResponse } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { getNotificationChannel, getDelivery } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { notify } from '@/lib/notifications';

/**
 * Fire a one-off test notification to a single channel (binding routing, so it ignores the
 * event-toggle matrix). Returns the delivery outcome so the UI can show sent / failed + the error —
 * the fast way to confirm a channel actually works without waiting for a real execution.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const channel = getNotificationChannel(id);
  if (!channel || channel.userId !== getNotifierUserId()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const dedupeKey = `test:${uuidv7()}`; // unique per press → never deduped against a prior test
  const name = channel.label ?? (channel.kind === 'web_push' ? 'Web push' : 'this channel');
  await notify(
    {
      type: 'execution.finished',
      userId: channel.userId,
      dedupeKey,
      title: 'Test notification',
      body: `Your "${name}" channel is working. 🎉`,
      url: '/notifications',
    },
    { deliverTo: [id] },
  );

  const delivery = getDelivery(dedupeKey, id);
  return NextResponse.json({
    status: delivery?.status ?? 'unknown',
    ...(delivery?.lastError ? { error: delivery.lastError } : {}),
  });
}
