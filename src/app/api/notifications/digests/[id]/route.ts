import { NextRequest, NextResponse } from 'next/server';
import { getTrigger, updateTrigger, getNotificationChannel } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';

/** Bind a trigger's result to notification channels (spec §2.9). Body: { deliverResultTo: string[] }. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const trigger = getTrigger(id);
  if (!trigger) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { deliverResultTo?: string[] };
  // Keep only channel ids that exist and belong to this user.
  const userId = getNotifierUserId();
  const deliverResultTo = (body.deliverResultTo ?? []).filter((cid) => {
    const ch = getNotificationChannel(cid);
    return ch && ch.userId === userId;
  });
  const updated = updateTrigger(id, { deliverResultTo });
  return NextResponse.json({ trigger: { id, deliverResultTo: updated?.deliverResultTo ?? [] } });
}
