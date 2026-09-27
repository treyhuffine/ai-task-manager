import type { NotificationChannelRecord, NotificationDeliveryRecord, NotificationDeliveryStatus, StoredRenderedNotification } from '@/db/types';
import { isDesktopNotificationChannel } from './desktop-contract';
import { eventCatalogEntry } from './events';

export const NOTIFICATION_HISTORY_LIMIT = 100;
export type NotificationHistoryStatus = Exclude<NotificationDeliveryStatus, 'pending'> | 'queued' | 'uncertain' | 'expired';
export type NotificationHistoryChannelType = 'desktop' | 'web_push' | 'telegram' | 'in_app' | 'connector' | 'unknown';
export const NOTIFICATION_HISTORY_STATUS_LABELS = {
  queued: 'Queued', sent: 'Sent', failed: 'Failed', uncertain: 'Uncertain', expired: 'Expired', skipped: 'Skipped',
} satisfies Record<NotificationHistoryStatus, string>;
export const NOTIFICATION_HISTORY_CHANNEL_LABELS = {
  desktop: 'Desktop', web_push: 'Browser push', telegram: 'Telegram', in_app: 'In-app', connector: 'Connector', unknown: 'Unavailable channel',
} satisfies Record<NotificationHistoryChannelType, string>;

/** Deliberately omit event bodies, links, credentials, receipts and raw errors. */
export type NotificationHistoryItem = Pick<NotificationDeliveryRecord, 'id' | 'createdAt' | 'updatedAt' | 'sentAt' | 'attempts'> & {
  channel: { id: NotificationChannelRecord['id']; label: string; type: NotificationHistoryChannelType };
  title: StoredRenderedNotification['title'];
  eventLabel: string;
  status: NotificationHistoryStatus;
  detail: string;
};
export interface NotificationHistoryResponse { deliveries: NotificationHistoryItem[]; limit: number }

function displayText(value: string | null | undefined, fallback: string, limit: number) {
  return value?.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) || fallback;
}

function channelType(channel?: NotificationChannelRecord): NotificationHistoryChannelType {
  if (!channel) return 'unknown';
  if (isDesktopNotificationChannel(channel)) return 'desktop';
  if (channel.kind === 'connector') return channel.providerId === 'telegram' ? 'telegram' : 'connector';
  return channel.kind;
}

function historyStatus(row: NotificationDeliveryRecord, type: NotificationHistoryChannelType): NotificationHistoryStatus {
  if (row.status === 'pending') return 'queued';
  if (row.status === 'skipped' && type === 'desktop') {
    if (row.lastError === 'This desktop alert expired while the app was closed.' && row.attempts === 0 && !row.providerMessageId) return 'expired';
    if (/^(?:ack:)?desktop:/.test(row.providerMessageId ?? '')) return 'uncertain';
  }
  return row.status;
}

/** Categorize known failures, never redact-and-return an upstream error. Such
 * messages can contain private push endpoints, tokens or provider responses. */
function failureDetail(row: NotificationDeliveryRecord, type: NotificationHistoryChannelType) {
  const error = row.lastError ?? '';
  if (type === 'desktop') return 'The operating system could not show this alert. Check notification permissions and use a signed Ri build on macOS.';
  if (type === 'web_push' && /no web push subscriptions|all expired\/pruned/i.test(error)) return 'No reachable browser subscriptions remain. Enable browser push on the device where you want alerts.';
  if (/missing config|not configured|vapid|auth_config_required|needs_account|connection.{0,40}(?:missing|not found)|credentials?.{0,20}missing/i.test(error)) return 'Channel configuration is incomplete. Check its connection and notification settings.';
  if (/permission|forbidden|unauthori[sz]ed|auth_required|needs_consent|\b40[13]\b|denied|approval/i.test(error)) return 'The provider rejected permission or authorization. Check the channel connection and permissions.';
  if (/no adapter|unsupported|unavailable|network|fetch failed|econn|enotfound|timed? ?out|timeout|\b50[234]\b/i.test(error)) return 'The notification provider was unavailable. Check connectivity and the channel connection before sending a new test.';
  if (/\b429\b|rate.?limit|too many requests/i.test(error)) return 'The provider limited notification requests. Wait before sending another test.';
  return 'Delivery failed. Check this channel’s setup before sending a new test.';
}

export function notificationHistoryItem(row: NotificationDeliveryRecord, channel?: NotificationChannelRecord): NotificationHistoryItem {
  // A mismatched channel must never contribute another user's label/config.
  const owned = channel?.id === row.channelId && channel.userId === row.userId ? channel : undefined;
  const type = channelType(owned);
  const status = historyStatus(row, type);
  let detail: string;
  if (status === 'sent') {
    detail = type === 'desktop' ? 'The operating system reported showing this alert. This does not confirm it was read.'
      : type === 'web_push' ? 'At least one browser push service accepted this alert. This does not confirm every device received it or that it was shown or read.'
        : type === 'telegram' ? 'Telegram accepted this alert. This does not confirm it was read.'
          : 'The destination accepted this alert. This does not confirm it was shown or read.';
  } else if (status === 'failed') detail = failureDetail(row, type);
  else if (status === 'uncertain') detail = 'Desktop presentation was not confirmed. This alert will not be repeated automatically.';
  else if (status === 'expired') detail = 'This desktop alert aged out before presentation while the app was closed.';
  else if (status === 'skipped') detail = 'This delivery was skipped. No confirmed presentation was recorded.';
  else detail = type === 'desktop' ? 'Waiting for the desktop app to present this alert. Older queued alerts may expire.'
    : 'Delivery is queued. No provider acceptance has been recorded.';
  return {
    id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, sentAt: row.sentAt, attempts: row.attempts,
    channel: { id: row.channelId, type, label: displayText(owned?.label, NOTIFICATION_HISTORY_CHANNEL_LABELS[type], 100) },
    title: displayText(row.rendered?.title ?? row.event.title, 'Untitled notification', 160),
    eventLabel: eventCatalogEntry(row.eventType)?.label ?? 'Other event', status, detail,
  };
}
