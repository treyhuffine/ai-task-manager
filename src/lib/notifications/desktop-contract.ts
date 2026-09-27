import type { NotificationChannelRecord, NotificationDeliveryRecord, StoredRenderedNotification } from '@/db/types';

export const DESKTOP_NOTIFICATION_AGE_MS = 24 * 60 * 60_000;
export const DESKTOP_NOTIFICATION_BATCH = 5;

export function isDesktopNotificationChannel(channel: Pick<NotificationChannelRecord, 'kind' | 'config'>) {
  return channel.kind === 'in_app' && channel.config.surface === 'desktop';
}

/** Native notification links are navigation only, never downloads, API calls,
 * external URLs, pairing fragments or a source of native filesystem access. */
export function desktopNotificationPath(raw: string): string {
  if (!raw.startsWith('/') || raw.startsWith('//') || /[\\\r\n\0]/.test(raw)) return '/';
  try {
    const url = new URL(raw, 'https://ri.invalid');
    const decoded = decodeURIComponent(url.pathname);
    if (url.origin !== 'https://ri.invalid' || /%2f/i.test(url.pathname) || /[\\\r\n\0%]/.test(decoded) || decoded.startsWith('//') || /^\/(api|_next)(\/|$)/i.test(decoded)) return '/';
    return `${url.pathname}${url.search}`;
  } catch { return '/'; }
}

export interface DesktopNotificationClaim {
  id: NotificationDeliveryRecord['id'];
  receipt: string;
  notification: StoredRenderedNotification;
}
export interface DesktopNotificationStatus {
  supported: boolean;
  enabled: boolean;
  channelId?: string;
  error?: string;
}
export type DesktopNotificationAction = 'status' | 'enable' | 'disable' | 'test';
