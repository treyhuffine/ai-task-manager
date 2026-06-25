/**
 * Adapter registry, keyed by `(kind, providerId)` (spec §2.17) — `kind: 'connector'` spans
 * telegram/slack/…, so it can't key on `kind` alone. Connector adapters are an explicit allowlist;
 * the notifier NEVER infers arbitrary connector tools. Web-push registers here once N7 lands.
 */
import type { NotificationChannelRecord } from '@/db/types';
import type { NotificationChannelAdapter } from '../types';
import { telegramAdapter } from './telegram';
import { webPushAdapter } from './web-push';

function adapterKey(kind: string, providerId?: string | null): string {
  return kind === 'connector' ? `connector:${providerId ?? ''}` : kind;
}

const ADAPTERS: NotificationChannelAdapter[] = [telegramAdapter, webPushAdapter];

const byKey = new Map<string, NotificationChannelAdapter>(
  ADAPTERS.map((a) => [adapterKey(a.kind, a.providerId), a]),
);

export function resolveAdapter(channel: NotificationChannelRecord): NotificationChannelAdapter | undefined {
  return byKey.get(adapterKey(channel.kind, channel.providerId));
}
