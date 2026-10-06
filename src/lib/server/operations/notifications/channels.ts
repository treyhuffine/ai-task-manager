import { createNotificationChannel, listNotificationChannels } from '@/lib/db/queries';
import { defaultChannelEvents, MATRIX_EVENT_TYPES } from '@/lib/notifications/events';
import { getNotifierUserId } from '@/lib/notifications/user';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** GET → this user's notification channels. POST → create one (Telegram integration for v1). */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply({ channels: listNotificationChannels({ userId: getNotifierUserId() }) });
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const userId = getNotifierUserId();
  const body = (rpcInput.body) as {
    kind?: 'integration' | 'web_push';
    providerId?: string;
    connectionId?: string;
    label?: string;
    config?: Record<string, unknown>;
    events?: string[];
  };
  if (body.kind !== 'integration') {
    // web_push channels are created via the subscribe flow; only integration channels are added here.
    return reply({ error: "kind must be 'integration'" }, { status: 400 });
  }
  if (body.providerId !== 'telegram') {
    return reply({ error: 'unsupported providerId (telegram only in v1)' }, { status: 400 });
  }
  if (!body.connectionId) return reply({ error: 'connectionId required' }, { status: 400 });
  const chatId = (body.config as { chatId?: unknown } | undefined)?.chatId;
  if (chatId === undefined || chatId === null || chatId === '') {
    return reply({ error: 'config.chatId required' }, { status: 400 });
  }
  const events = (body.events ?? defaultChannelEvents()).filter((e) => (MATRIX_EVENT_TYPES as readonly string[]).includes(e));

  const channel = createNotificationChannel({
    userId,
    kind: 'integration',
    providerId: 'telegram',
    connectionId: body.connectionId,
    ...(body.label?.trim() ? { label: body.label.trim() } : {}),
    config: { chatId },
    events,
    enabled: true,
  });
  return reply({ channel }, { status: 201 });
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "kind": rpcZ.enum(["integration", "web_push"]).optional(), "providerId": rpcZ.string().optional(), "connectionId": rpcZ.string().optional(), "label": rpcZ.string().optional(), "config": rpcZ.record(rpcZ.string(), rpcZ.unknown()).optional(), "events": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
