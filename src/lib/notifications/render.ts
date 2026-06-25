/**
 * Render an event into the neutral, channel-ready shape (spec §2.17). The only channel-specific
 * concern here is the deep-link base: external channels (Telegram, email) need an absolute,
 * phone-reachable URL; same-origin channels (web push) keep it relative. We reuse the app's
 * existing base-url resolution (remote tunnel → LAN), and OMIT the link when only localhost is
 * available rather than ship a dead `/executions/…` a phone can't open.
 */
import type { NotificationChannelRecord } from '@/db/types';
import { getRemoteBaseUrl, getLanBaseUrl } from '@/lib/auth/bootstrap';
import type { NotificationEvent, RenderedNotification } from './types';

/** Channel kinds reached OFF this device — they need an absolute URL. */
const EXTERNAL_KINDS = new Set<NotificationChannelRecord['kind']>(['connector']);

export function render(event: NotificationEvent, channel: NotificationChannelRecord): RenderedNotification {
  return { title: event.title, body: event.body, url: resolveUrl(event.url, channel.kind) };
}

function resolveUrl(path: string, kind: NotificationChannelRecord['kind']): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path; // already absolute
  if (!EXTERNAL_KINDS.has(kind)) return path; // same-origin (web_push/in_app): relative is fine
  // External: prefer the user's remote tunnel, then LAN. Localhost is useless on a phone → omit.
  const base = getRemoteBaseUrl() ?? getLanBaseUrl();
  if (!base) return '';
  return `${base.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}
