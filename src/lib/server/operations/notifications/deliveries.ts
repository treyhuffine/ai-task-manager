import { listNotificationChannels, listNotificationDeliveries } from '@/lib/db/queries';
import { NOTIFICATION_HISTORY_LIMIT, notificationHistoryItem, type NotificationHistoryResponse } from '@/lib/notifications/history';
import { getNotifierUserId } from '@/lib/notifications/user';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** The shared authentication middleware protects this read-only local-user API.
 * Never accept a user/channel selector or expose raw delivery/provider data. */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const userId = getNotifierUserId();
    const channels = new Map(listNotificationChannels({ userId }).map(channel => [channel.id, channel]));
    const response: NotificationHistoryResponse = {
      deliveries: listNotificationDeliveries(userId, NOTIFICATION_HISTORY_LIMIT).map(row => notificationHistoryItem(row, channels.get(row.channelId))),
      limit: NOTIFICATION_HISTORY_LIMIT,
    };
    return reply(response, { headers });
  } catch {
    return reply({ error: 'Notification history is unavailable. Try refreshing shortly.' }, { status: 500, headers });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
