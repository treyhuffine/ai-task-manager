/**
 * Adapter registry, keyed by `(kind, providerId)` (spec §2.17) — `kind: 'integration'` spans
 * telegram/slack/…, so it can't key on `kind` alone. Integration adapters are an explicit allowlist;
 * the notifier NEVER infers arbitrary integration tools. Web-push registers here once N7 lands.
 */
import type { NotificationChannelRecord } from '@/db/types';
import type { NotificationChannelAdapter } from '../types';
import { telegramAdapter } from './telegram';
import { webPushAdapter } from './web-push';
import { desktopAdapter } from './desktop';

function adapterKey(kind: string, providerId?: string | null): string {
  return kind === 'integration' ? `integration:${providerId ?? ''}` : kind;
}

const ADAPTERS: NotificationChannelAdapter[] = [telegramAdapter, webPushAdapter, desktopAdapter];

const byKey = new Map<string, NotificationChannelAdapter>(
  ADAPTERS.map((a) => [adapterKey(a.kind, a.providerId), a]),
);

export function resolveAdapter(channel: NotificationChannelRecord): NotificationChannelAdapter | undefined {
  return byKey.get(adapterKey(channel.kind, channel.providerId));
}
