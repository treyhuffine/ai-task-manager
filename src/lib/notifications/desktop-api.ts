import { readLimitedJson } from '@/lib/api/limited-body';
import {
	acknowledgeDesktopNotificationDelivery,
	claimDesktopNotificationDelivery,
	desktopNotificationHistory,
	enableDesktopNotificationChannel,
	getNotificationChannel,
	updateNotificationChannel,
} from '@/lib/db/queries';
import { DESKTOP_NOTIFICATION_AGE_MS, desktopNotificationPath } from '@/lib/notifications/desktop-contract';
import { defaultChannelEvents } from '@/lib/notifications/events';
import { notify } from '@/lib/notifications/notify';
import { getNotifierUserId } from '@/lib/notifications/user';
import { boundedInput, operationResponse, reply } from '@/lib/server/operation';
import type { NextRequest } from 'next/server';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';

export const desktopNotificationActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['enable', 'disable', 'test', 'claim']) }).strict(),
  z.object({ action: z.literal('ack'), id: z.string().max(100), receipt: z.string().max(100),
    status: z.enum(['sent', 'failed', 'skipped']), error: z.string().max(1000).optional() }).strict(),
]);
const since = () => new Date(Date.now() - DESKTOP_NOTIFICATION_AGE_MS).toISOString();


export function desktopNotificationStatusResult(id: string) {
  const channel = getNotificationChannel(id);
  return reply({ channel: channel ?? null, history: channel ? desktopNotificationHistory(id, getNotifierUserId(), since()).map(row => ({
    id: row.id, url: desktopNotificationPath(row.rendered?.url ?? row.event.url), status: row.status, error: row.lastError,
  })) : [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
}

export async function desktopNotificationActionResult(input: z.input<typeof desktopNotificationActionSchema>, id: string, stillAuthorized: () => boolean = () => true) {
  try {
    const body = desktopNotificationActionSchema.parse(boundedInput(input, 4096));
    if (!stillAuthorized()) return reply({ error: 'This notification channel is no longer authorized.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    const userId = getNotifierUserId();
    if (body.action === 'enable') return reply({ channel: enableDesktopNotificationChannel(id, userId, defaultChannelEvents()) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    if (body.action === 'disable') return reply({ channel: updateNotificationChannel(id, { enabled: false }) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    if (body.action === 'ack') return reply({ acknowledged: acknowledgeDesktopNotificationDelivery({ ...body, channelId: id, userId }) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    if (body.action === 'claim') {
      const row = claimDesktopNotificationDelivery(id, userId, since());
      return reply({ claim: row && row.providerMessageId && row.rendered ? {
        id: row.id, receipt: row.providerMessageId,
        notification: { ...row.rendered, url: desktopNotificationPath(row.rendered.url) },
      } : null }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!getNotificationChannel(id)?.enabled) return reply({ error: 'Enable desktop notifications first.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    await notify({ type: 'execution.finished', userId, dedupeKey: `test:${uuidv7()}`, title: 'Ri notifications are ready',
      body: 'Click this notification to return to notification settings.', url: '/?settings=notifications' }, { deliverTo: [id] });
    return reply({ queued: true }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : 'Could not update desktop notifications.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }); }
}

export function desktopNotificationStatus(id: string) { return operationResponse(desktopNotificationStatusResult(id)); }
export async function desktopNotificationAction(request: NextRequest, id: string, stillAuthorized: () => boolean = () => true) {
  try {
    return operationResponse(await desktopNotificationActionResult(await readLimitedJson(request, 4096) as z.input<typeof desktopNotificationActionSchema>, id, stillAuthorized));
  } catch (error) {
    return operationResponse(reply({ error: error instanceof Error ? error.message : 'Invalid notification action.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } }));
  }
}
