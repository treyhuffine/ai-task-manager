import { NextRequest, NextResponse } from 'next/server';
import { getConnectorRuntime, getConnectorOwnerId } from '@/lib/connectors/runtime';
import { listNotificationChannels, createNotificationChannel } from '@/lib/db/queries';
import { getNotifierUserId } from '@/lib/notifications/user';
import { defaultChannelEvents } from '@/lib/notifications/events';

/**
 * Deep-link claim: the user tapped `t.me/<bot>?start=<token>` and pressed Start, so the bot received
 * a `/start <token>` message. We poll `get_updates`, match that token, capture the chat id + name,
 * and auto-create (or reuse) the Telegram channel — the user never sees a numeric id. Returns
 * `{ found: false }` if the message hasn't arrived yet so the client can keep polling.
 */
interface TgChat {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  title?: string;
  username?: string;
}

export async function POST(request: NextRequest) {
  const userId = getNotifierUserId();
  const body = (await request.json().catch(() => ({}))) as { connectionId?: string; token?: string; label?: string };
  if (!body.connectionId || !body.token) {
    return NextResponse.json({ error: 'connectionId + token required' }, { status: 400 });
  }

  const outcome = await (await getConnectorRuntime()).runAction<{ updates: unknown[] }>(
    'telegram.get_updates',
    {},
    { ownerId: getConnectorOwnerId(), connectionId: body.connectionId, caller: { type: 'app', id: 'notifier' } },
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason === 'error' ? outcome.message : outcome.reason }, { status: 400 });
  }

  let chat: TgChat | undefined;
  for (const update of outcome.result.updates ?? []) {
    const msg = (update as { message?: { text?: string; chat?: TgChat } }).message;
    if (msg?.text?.trim() === `/start ${body.token}` && msg.chat?.id != null) {
      chat = msg.chat;
      break;
    }
  }
  if (!chat) return NextResponse.json({ found: false });

  const chatId = String(chat.id);
  const name =
    body.label?.trim() ||
    chat.title ||
    [chat.first_name, chat.last_name].filter(Boolean).join(' ') ||
    chat.username ||
    chatId;

  // Reuse if this bot already has a channel for this chat (re-linking is idempotent).
  const existing = listNotificationChannels({ userId, connectionId: body.connectionId }).find(
    (c) => String((c.config as { chatId?: unknown }).chatId) === chatId,
  );
  if (existing) return NextResponse.json({ channel: existing });

  const channel = createNotificationChannel({
    userId,
    kind: 'connector',
    providerId: 'telegram',
    connectionId: body.connectionId,
    label: name,
    config: { chatId },
    events: defaultChannelEvents(),
    enabled: true,
  });
  return NextResponse.json({ channel });
}
