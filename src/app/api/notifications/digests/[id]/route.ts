import { NextRequest, NextResponse } from 'next/server';
import { getSchedule, updateSchedule, getNotificationChannel } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';

/** Bind a schedule's result to notification channels (spec §2.9). Body: { deliverResultTo: string[] }. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const schedule = getSchedule(id);
  if (!schedule) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { deliverResultTo?: string[] };
  // Keep only channel ids that exist and belong to this user.
  const userId = getNotifierUserId();
  const deliverResultTo = (body.deliverResultTo ?? []).filter((cid) => {
    const ch = getNotificationChannel(cid);
    return ch && ch.userId === userId;
  });
  const updated = updateSchedule(id, { deliverResultTo });
  return NextResponse.json({ schedule: { id, deliverResultTo: updated?.deliverResultTo ?? [] } });
}
