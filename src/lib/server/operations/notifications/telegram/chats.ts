import { getIntegrationOwnerId, getIntegrationRuntime } from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

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

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!connectionId) return reply({ error: 'connectionId required' }, { status: 400 });

  const outcome = await (await getIntegrationRuntime()).runAction<{ updates: unknown[] }>(
    'telegram.get_updates',
    {},
    { ownerId: getIntegrationOwnerId(), connectionId, caller: { type: 'app', id: 'notifier' } },
  );
  if (!outcome.ok) {
    return reply({ error: outcome.reason === 'error' ? outcome.message : outcome.reason }, { status: 400 });
  }

  const seen = new Map<string, string>();
  for (const update of outcome.result.updates ?? []) {
    const chat = (update as { message?: { chat?: TgChat } }).message?.chat;
    if (chat?.id === undefined || chat.id === null) continue;
    const name =
      chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
    seen.set(String(chat.id), name);
  }

  return reply({ chats: [...seen.entries()].map(([chatId, name]) => ({ chatId, name })) });
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "connectionId": rpcZ.string().optional() }).strict().optional() }).strict().default({});
