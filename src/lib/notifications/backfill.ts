/**
 * Channels store an explicit list of the events they get, so one made before an
 * event existed wouldn't get it. Add it at boot to channels nobody has changed
 * since the event was added. Adding it updates the channel, so this happens
 * once, and a channel turned off afterwards stays off.
 */
import type { NotificationEventType } from './events';
import { listNotificationChannels, updateNotificationChannel } from '@/lib/db/queries';

const ADDED_AT: Array<[NotificationEventType, string]> = [
  ['agent.message', '2026-11-03T23:00:00.000Z'],
  ['system.disk_low', '2026-11-04T22:00:00.000Z'],
];

export function backfillNewEvents(): void {
  for (const channel of listNotificationChannels()) {
    const events = channel.events ?? [];
    // One pass per channel: adding the first would update it past the second.
    const missing = ADDED_AT.filter(([event, addedAt]) => channel.updatedAt < addedAt && !events.includes(event));
    if (missing.length > 0) updateNotificationChannel(channel.id, { events: [...events, ...missing.map(([event]) => event)] });
  }
}
