import { NextRequest, NextResponse } from 'next/server';
import { getConnectorRuntime, getConnectorOwnerId } from '@/lib/connectors/runtime';

/**
 * Discover chat ids for a Telegram bot connection by polling `getUpdates` — the user messages the
 * bot once, then we surface the distinct chats so they can pick instead of hunting for a numeric id.
 * `get_updates` is non-mutating, so it runs through the normal (auto-allowed) gate.
 */
interface TgChat {
  id?: number | string;
  first_name?: string;
  last_name?: string;
  title?: string;
  username?: string;
}

export async function GET(request: NextRequest) {
  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 });

  const outcome = await (await getConnectorRuntime()).runAction<{ updates: unknown[] }>(
    'telegram.get_updates',
    {},
    { ownerId: getConnectorOwnerId(), connectionId, caller: { type: 'app', id: 'notifier' } },
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason === 'error' ? outcome.message : outcome.reason }, { status: 400 });
  }

  const seen = new Map<string, string>();
  for (const update of outcome.result.updates ?? []) {
    const chat = (update as { message?: { chat?: TgChat } }).message?.chat;
    if (chat?.id === undefined || chat.id === null) continue;
    const name =
      chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
    seen.set(String(chat.id), name);
  }

  return NextResponse.json({ chats: [...seen.entries()].map(([chatId, name]) => ({ chatId, name })) });
}
