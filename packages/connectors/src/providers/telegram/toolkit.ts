/**
 * The `telegram` toolkit — the delivery verbs for a bot. `send_message` is the one a
 * notification layer would call. Non-OAuth → no action `scopes`. Every response is the Telegram
 * `{ ok, result }` envelope, unwrapped here.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { telegramResult } from './provider';

export const telegramToolkit = defineToolkit({
  id: 'telegram',
  providerId: 'telegram',
  displayName: 'Telegram',
  actions: [
    httpAction({
      id: 'telegram.send_message',
      description: 'Send a text message to a Telegram chat (the primary notification verb).',
      mutating: true,
      risk: 'low',
      input: z.object({
        chatId: z.union([z.string(), z.number()]).describe('Chat id or @channelusername'),
        text: z.string(),
        parseMode: z.enum(['Markdown', 'MarkdownV2', 'HTML']).optional(),
        disableNotification: z.boolean().optional().describe('Deliver silently (no sound)'),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/sendMessage',
        body: {
          chat_id: i.chatId,
          text: i.text,
          ...(i.parseMode ? { parse_mode: i.parseMode } : {}),
          ...(i.disableNotification ? { disable_notification: i.disableNotification } : {}),
        },
      }),
      output: (raw) => {
        const r = telegramResult<{ message_id: number; chat: { id: number } }>(raw);
        return { messageId: r.message_id, chatId: r.chat.id };
      },
    }),

    httpAction({
      id: 'telegram.send_photo',
      description: 'Send a photo (by URL or file_id) to a Telegram chat, with an optional caption.',
      mutating: true,
      risk: 'low',
      input: z.object({
        chatId: z.union([z.string(), z.number()]),
        photo: z.string().describe('Photo URL or Telegram file_id'),
        caption: z.string().optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/sendPhoto',
        body: { chat_id: i.chatId, photo: i.photo, ...(i.caption ? { caption: i.caption } : {}) },
      }),
      output: (raw) => {
        const r = telegramResult<{ message_id: number }>(raw);
        return { messageId: r.message_id };
      },
    }),

    httpAction({
      id: 'telegram.get_me',
      description: "Get the bot's own identity (id, username).",
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/getMe' }),
      output: (raw) => telegramResult<{ id: number; username?: string; first_name?: string }>(raw),
    }),

    httpAction({
      id: 'telegram.get_updates',
      description: 'Poll for incoming updates (messages sent to the bot) — e.g. to discover a chat id.',
      input: z.object({
        offset: z.number().int().optional(),
        limit: z.number().int().positive().max(100).default(25),
      }),
      request: (i) => ({ method: 'GET', path: '/getUpdates', query: { offset: i.offset, limit: i.limit } }),
      output: (raw) => ({ updates: telegramResult<unknown[]>(raw) }),
    }),
  ],
});
