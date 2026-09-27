import { NextResponse } from 'next/server';
import { listNotificationChannels, listNotificationDeliveries } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { NOTIFICATION_HISTORY_LIMIT, notificationHistoryItem, type NotificationHistoryResponse } from '@/lib/notifications/history';

/** The shared authentication middleware protects this read-only local-user API.
 * Never accept a user/channel selector or expose raw delivery/provider data. */
export function GET() {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const userId = getNotifierUserId();
    const channels = new Map(listNotificationChannels({ userId }).map(channel => [channel.id, channel]));
    const response: NotificationHistoryResponse = {
      deliveries: listNotificationDeliveries(userId, NOTIFICATION_HISTORY_LIMIT).map(row => notificationHistoryItem(row, channels.get(row.channelId))),
      limit: NOTIFICATION_HISTORY_LIMIT,
    };
    return NextResponse.json(response, { headers });
  } catch {
    return NextResponse.json({ error: 'Notification history is unavailable. Try refreshing shortly.' }, { status: 500, headers });
  }
}
