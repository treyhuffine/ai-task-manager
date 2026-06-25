/**
 * notify() — the Notifier dispatcher (spec §2.15/§2.16). Route → persist durable delivery rows
 * (idempotent on (dedupeKey, channelId)) → process all pending/failed for the event's targets
 * inline → record status. NOT fire-and-forget: a row stranded by a crash is retried on the next
 * re-fire (self-heals without a background worker). The whole thing is best-effort — it never
 * throws back into the emitting path.
 */
import {
  listNotificationChannels,
  getNotificationChannel,
  upsertDelivery,
  listProcessableDeliveries,
  markDeliverySent,
  markDeliveryFailed,
} from '@/lib/db/queries';
import type { NotificationChannelRecord } from '@/db/types';
import { render } from './render';
import { resolveAdapter as defaultResolveAdapter } from './adapters/registry';
import type { NotificationChannelAdapter, NotificationEvent } from './types';

export interface NotifyOptions {
  /**
   * Binding routing (spec §2.4): deliver to exactly these channel ids (a schedule's
   * `deliverResultTo[]`), bypassing the per-channel `events[]` matrix. Used by
   * `schedule.run_completed` / digests.
   */
  deliverTo?: string[];
}

/** Injectable dependencies — the test seam for a fake adapter resolver. Production uses the default. */
export interface NotifyDeps {
  resolveAdapter?: (channel: NotificationChannelRecord) => NotificationChannelAdapter | undefined;
}

export async function notify(event: NotificationEvent, options: NotifyOptions = {}, deps: NotifyDeps = {}): Promise<void> {
  const resolveAdapter = deps.resolveAdapter ?? defaultResolveAdapter;
  try {
    const channels = resolveChannels(event, options);
    if (channels.length === 0) return;

    // 1. Persist intent — idempotent on (dedupeKey, channelId).
    for (const channel of channels) {
      upsertDelivery({
        userId: event.userId,
        eventType: event.type,
        dedupeKey: event.dedupeKey,
        channelId: channel.id,
        event,
      });
    }

    // 2. Process ALL still-processable rows for this event's targets (pending OR failed) —
    //    not just rows inserted this call, so a crash-stranded row retries on re-fire (§2.16).
    const channelById = new Map(channels.map((c) => [c.id, c]));
    const deliveries = listProcessableDeliveries(event.dedupeKey, [...channelById.keys()]);

    await Promise.all(
      deliveries.map(async (delivery) => {
        const channel = channelById.get(delivery.channelId);
        if (!channel) return; // channel removed between upsert and process
        try {
          const adapter = resolveAdapter(channel);
          if (!adapter) {
            markDeliveryFailed(delivery.id, `no adapter for kind=${channel.kind} provider=${channel.providerId ?? '-'}`);
            return;
          }
          adapter.validateConfig?.(channel);
          const rendered = render(event, channel);
          const result = await adapter.deliver(channel, rendered);
          markDeliverySent(delivery.id, {
            rendered,
            ...(result.providerMessageId !== undefined ? { providerMessageId: result.providerMessageId } : {}),
          });
        } catch (err) {
          markDeliveryFailed(delivery.id, err instanceof Error ? err.message : String(err));
        }
      }),
    );
  } catch (err) {
    // Best-effort: a notifier failure must never break the thing that emitted the event.
    console.error('[notifier] notify failed', { type: event.type, dedupeKey: event.dedupeKey, err });
  }
}

/** Matrix routing (default) or binding routing (opts.deliverTo) → the enabled target channels. */
function resolveChannels(event: NotificationEvent, options: NotifyOptions): NotificationChannelRecord[] {
  if (options.deliverTo) {
    return options.deliverTo
      .map((id) => getNotificationChannel(id))
      .filter((c): c is NotificationChannelRecord => !!c && c.enabled && c.userId === event.userId);
  }
  return listNotificationChannels({ userId: event.userId, enabled: true }).filter((c) =>
    (c.events ?? []).includes(event.type),
  );
}
