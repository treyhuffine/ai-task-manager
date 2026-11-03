/**
 * Channels store an explicit list of the events they get, so one made before
 * `agent.message` existed wouldn't get it. Add it at boot to channels nobody
 * has changed since the event was added. Adding it updates the channel, so this
 * happens once, and a channel turned off afterwards stays off.
 */
import { listNotificationChannels, updateNotificationChannel } from '@/lib/db/queries';

const AGENT_MESSAGE_ADDED_AT = '2026-11-03T23:00:00.000Z';

export function backfillAgentMessageEvent(): void {
  for (const channel of listNotificationChannels()) {
    const events = channel.events ?? [];
    if (channel.updatedAt >= AGENT_MESSAGE_ADDED_AT || events.includes('agent.message')) continue;
    updateNotificationChannel(channel.id, { events: [...events, 'agent.message'] });
  }
}
