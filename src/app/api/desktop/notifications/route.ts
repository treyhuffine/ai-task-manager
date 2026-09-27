import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { uuidv7 } from 'uuidv7';
import { isDesktopRequest } from '@/lib/connectors/desktop-oauth';
import { isInstallationOwner } from '@/lib/service/owner-auth';
import { servicePaths } from '@/lib/service/paths';
import { readLimitedJson } from '@/lib/api/limited-body';
import { getNotifierUserId } from '@/lib/notifications/user';
import { defaultChannelEvents } from '@/lib/notifications/events';
import { DESKTOP_NOTIFICATION_AGE_MS, desktopNotificationPath } from '@/lib/notifications/desktop-contract';
import { notify } from '@/lib/notifications/notify';
import {
  getNotificationChannel, enableDesktopNotificationChannel, updateNotificationChannel,
  claimDesktopNotificationDelivery, acknowledgeDesktopNotificationDelivery, desktopNotificationHistory,
} from '@/lib/db/queries';

const Action = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['enable', 'disable', 'test', 'claim']) }).strict(),
  z.object({ action: z.literal('ack'), id: z.string().max(100), receipt: z.string().max(100),
    status: z.enum(['sent', 'failed', 'skipped']), error: z.string().max(1000).optional() }).strict(),
]);
const channelId = () => `desktop:${servicePaths().id}`;
const since = () => new Date(Date.now() - DESKTOP_NOTIFICATION_AGE_MS).toISOString();
const allowed = (request: NextRequest) => isDesktopRequest(request) && isInstallationOwner(request);
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });

export function GET(request: NextRequest) {
  if (!allowed(request)) return json({ error: 'Use the local owner desktop to manage native notifications.' }, 403);
  const id = channelId();
  const channel = getNotificationChannel(id);
  return json({ channel: channel ?? null, history: channel ? desktopNotificationHistory(id, getNotifierUserId(), since()).map(row => ({
    id: row.id, url: desktopNotificationPath(row.rendered?.url ?? row.event.url), status: row.status, error: row.lastError,
  })) : [] });
}

export async function POST(request: NextRequest) {
  if (!allowed(request)) return json({ error: 'Use the local owner desktop to manage native notifications.' }, 403);
  try {
    const body = Action.parse(await readLimitedJson(request, 4096));
    const id = channelId(); const userId = getNotifierUserId();
    if (body.action === 'enable') return json({ channel: enableDesktopNotificationChannel(id, userId, defaultChannelEvents()) });
    if (body.action === 'disable') return json({ channel: updateNotificationChannel(id, { enabled: false }) });
    if (body.action === 'ack') return json({ acknowledged: acknowledgeDesktopNotificationDelivery({ ...body, channelId: id, userId }) });
    if (body.action === 'claim') {
      const row = claimDesktopNotificationDelivery(id, userId, since());
      return json({ claim: row && row.providerMessageId && row.rendered ? {
        id: row.id, receipt: row.providerMessageId,
        notification: { ...row.rendered, url: desktopNotificationPath(row.rendered.url) },
      } : null });
    }
    if (!getNotificationChannel(id)?.enabled) return json({ error: 'Enable desktop notifications first.' }, 409);
    await notify({ type: 'execution.finished', userId, dedupeKey: `test:${uuidv7()}`, title: 'Ri notifications are ready',
      body: 'Click this notification to return to notification settings.', url: '/?settings=notifications' }, { deliverTo: [id] });
    return json({ queued: true });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Could not update desktop notifications.' }, 400); }
}
