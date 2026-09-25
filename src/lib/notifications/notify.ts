/**
 * notify() — the Notifier dispatcher (spec §2.15/§2.16). Route → persist durable delivery rows
 * (idempotent on (dedupeKey, channelId)) → process all pending/failed for the event's targets
 * inline → record status. NOT fire-and-forget: a row stranded by a crash is retried on the next
 * re-fire, and by the drain below. The whole thing is best-effort — it never throws back into the
 * emitting path.
 *
 * Split in two for durability (docs/homes-build.md, P2.3): `queueNotification` writes the
 * pending rows synchronously, so a caller can do it inside the transaction that caused the
 * notification, and `deliverNotification` sends them after commit. `drainPendingNotifications`
 * sends rows a crash left pending, at startup and periodically. Sending to an outside service is
 * at least once: a crash after the provider accepted a message and before the row is marked
 * sent sends it again.
 */
import {
  listNotificationChannels,
  getNotificationChannel,
  upsertDelivery,
  listProcessableDeliveries,
  markDeliverySent,
  markDeliveryFailed,
  listStrandedDeliveries,
} from '@/lib/db/queries';
import type { NotificationChannelRecord, NotificationDeliveryRecord } from '@/db/types';
import { render } from './render';
import { resolveAdapter as defaultResolveAdapter } from './adapters/registry';
import type { NotificationChannelAdapter, NotificationEvent } from './types';

export interface NotifyOptions {
  /**
   * Binding routing (spec §2.4): deliver to exactly these channel ids (a trigger's
   * `deliverResultTo[]`), bypassing the per-channel `events[]` matrix. Used by
   * `trigger.run_completed` / digests.
   */
  deliverTo?: string[];
}

/** Injectable dependencies — the test seam for a fake adapter resolver. Production uses the default. */
export interface NotifyDeps {
  resolveAdapter?: (channel: NotificationChannelRecord) => NotificationChannelAdapter | undefined;
}

/** A notification whose deliveries are recorded and waiting to be sent. */
export interface QueuedNotification {
  dedupeKey: string;
  channelIds: string[];
}

/**
 * Record a notification's deliveries as pending, synchronously, and return what to send. Null
 * when no channel wants it. Idempotent on (dedupeKey, channelId), so queueing again is harmless.
 */
export function queueNotification(event: NotificationEvent, options: NotifyOptions = {}): QueuedNotification | null {
  const channels = resolveChannels(event, options);
  if (channels.length === 0) return null;
  for (const channel of channels) {
    upsertDelivery({
      userId: event.userId,
      eventType: event.type,
      dedupeKey: event.dedupeKey,
      channelId: channel.id,
      event,
    });
  }
  return { dedupeKey: event.dedupeKey, channelIds: channels.map((c) => c.id) };
}

async function deliverRow(
  delivery: NotificationDeliveryRecord,
  channel: NotificationChannelRecord,
  resolveAdapter: (channel: NotificationChannelRecord) => NotificationChannelAdapter | undefined,
): Promise<void> {
  try {
    const adapter = resolveAdapter(channel);
    if (!adapter) {
      markDeliveryFailed(delivery.id, `no adapter for kind=${channel.kind} provider=${channel.providerId ?? '-'}`);
      return;
    }
    adapter.validateConfig?.(channel);
    const rendered = render(delivery.event as unknown as NotificationEvent, channel);
    const result = await adapter.deliver(channel, rendered);
    markDeliverySent(delivery.id, {
      rendered,
      ...(result.providerMessageId !== undefined ? { providerMessageId: result.providerMessageId } : {}),
    });
  } catch (err) {
    markDeliveryFailed(delivery.id, err instanceof Error ? err.message : String(err));
  }
}

/**
 * Send a queued notification's deliveries: all still processable (pending OR failed), not just
 * the ones queued this time, so a crash-stranded row retries on the next fire (§2.16). Never throws.
 */
export async function deliverNotification(queued: QueuedNotification, deps: NotifyDeps = {}): Promise<void> {
  const resolveAdapter = deps.resolveAdapter ?? defaultResolveAdapter;
  try {
    const deliveries = listProcessableDeliveries(queued.dedupeKey, queued.channelIds);
    await Promise.all(
      deliveries.map(async (delivery) => {
        const channel = getNotificationChannel(delivery.channelId);
        if (!channel || !channel.enabled) return; // removed or turned off between queueing and sending
        await deliverRow(delivery, channel, resolveAdapter);
      }),
    );
  } catch (err) {
    console.error('[notifier] delivery failed', { dedupeKey: queued.dedupeKey, err });
  }
}

export async function notify(event: NotificationEvent, options: NotifyOptions = {}, deps: NotifyDeps = {}): Promise<void> {
  try {
    const queued = queueNotification(event, options);
    if (queued) await deliverNotification(queued, deps);
  } catch (err) {
    // Best-effort: a notifier failure must never break the thing that emitted the event.
    console.error('[notifier] notify failed', { type: event.type, dedupeKey: event.dedupeKey, err });
  }
}

/** How long a pending row waits before the drain treats it as stranded, not in flight. */
export const STRANDED_AFTER_MS = 60_000;

/**
 * Send deliveries a crash left pending: queued in a transaction that committed, never sent.
 * Rows younger than `olderThanMs` are left to the sender that queued them. Returns how many
 * it tried.
 */
export async function drainPendingNotifications(
  opts: { olderThanMs?: number; deps?: NotifyDeps } = {},
): Promise<number> {
  const resolveAdapter = opts.deps?.resolveAdapter ?? defaultResolveAdapter;
  const cutoff = new Date(Date.now() - (opts.olderThanMs ?? STRANDED_AFTER_MS)).toISOString();
  const stranded = listStrandedDeliveries(cutoff);
  await Promise.all(
    stranded.map(async (delivery) => {
      const channel = getNotificationChannel(delivery.channelId);
      if (!channel || !channel.enabled) {
        markDeliveryFailed(delivery.id, 'channel removed or disabled before sending');
        return;
      }
      await deliverRow(delivery, channel, resolveAdapter);
    }),
  );
  return stranded.length;
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
