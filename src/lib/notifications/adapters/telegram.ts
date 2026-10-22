/**
 * Telegram IntegrationChannel adapter — delivers a notification by invoking the integration engine's
 * `telegram.send_message` verb with the NARROW notifier caller (auto-allowed by the host approval
 * policy; agent sends stay gated — spec §2.3). The chat_id is the channel's pinned `config.chatId`.
 * The message is the title, the body (a finished run's whole reply) and the link. Nothing is cut:
 * past Telegram's limit for one message, it goes as several, in order.
 */
import { getIntegrationRuntime, getIntegrationOwnerId } from '@/lib/integrations/runtime';
import type { NotificationChannelRecord } from '@/db/types';
import { processState } from '@/lib/process-state';
import type { NotificationChannelAdapter, RenderedNotification } from '../types';
import { NOTIFIER_CALLER } from '../caller';
import { splitText } from '../message-text';

/** Telegram's limit for one message's text. */
export const TELEGRAM_MESSAGE_MAX = 4096;

/** Telegram asks bots to send one chat about a message a second at most. */
export const TELEGRAM_PART_GAP_MS = 1000;

/** How long to wait before sending a part again that Telegram turned away for coming too fast. */
export const TELEGRAM_RATE_LIMIT_WAIT_MS = 5000;

/** Each chat's sends, one notification after another, so two long replies never interleave. */
const chatQueues = processState('notifications.telegram-chat-queues', () => new Map<string, Promise<void>>());

/**
 * Telegram's count, taken cautiously. Accounts differ on what it counts (characters, UTF-16 units,
 * bytes, a line break as two), so this charges every UTF-8 byte, which is never fewer than the
 * others, and each line break twice. English text still gets nearly the whole limit.
 */
export function telegramLength(text: string): number {
  return Buffer.byteLength(text, 'utf8') + (text.match(/\n/g)?.length ?? 0);
}

/**
 * The messages to send: the title, body and link as one text, split where a reader would pause
 * when it's longer than one message holds. Plain text — Telegram auto-links bare URLs, so no
 * parse_mode escaping needed.
 */
export function telegramMessages({ title, body, url }: RenderedNotification): string[] {
  const text = [title, body, url].filter((p) => p !== '').join('\n\n');
  return splitText(text, TELEGRAM_MESSAGE_MAX, telegramLength);
}

export const telegramAdapter: NotificationChannelAdapter = {
  kind: 'integration',
  providerId: 'telegram',

  validateConfig(channel) {
    const chatId = (channel.config as { chatId?: unknown }).chatId;
    if (chatId === undefined || chatId === null || chatId === '') {
      throw new Error('telegram channel is missing config.chatId');
    }
  },

  async deliver(channel, rendered) {
    const chatId = (channel.config as { chatId?: string | number }).chatId!;
    const messages = telegramMessages(rendered);
    const messageIds = await inChatOrder(`${channel.connectionId ?? ''}:${chatId}`, () => sendInOrder(channel, chatId, messages));
    const first = messageIds[0];
    return first !== undefined ? { providerMessageId: String(first) } : {};
  },
};

async function sendInOrder(channel: NotificationChannelRecord, chatId: string | number, messages: string[]) {
  const runtime = await getIntegrationRuntime();
  const send = (text: string) =>
    runtime.runAction<{ messageId?: number | string }>(
      'telegram.send_message',
      { chatId, text },
      {
        ownerId: getIntegrationOwnerId(),
        ...(channel.connectionId ? { connectionId: channel.connectionId } : {}),
        caller: NOTIFIER_CALLER,
      },
    );

  const messageIds: Array<number | string | undefined> = [];
  for (const [i, text] of messages.entries()) {
    if (i > 0) await sleep(TELEGRAM_PART_GAP_MS);
    let outcome = await send(text);
    if (!outcome.ok && outcome.reason === 'error' && outcome.code === 'provider_rate_limited') {
      await sleep(TELEGRAM_RATE_LIMIT_WAIT_MS);
      outcome = await send(text);
    }
    if (!outcome.ok) {
      const detail = outcome.reason === 'error' ? `: ${outcome.message}` : '';
      const progress = messages.length > 1 ? ` after ${i} of ${messages.length} parts` : '';
      throw new Error(`telegram delivery failed (${outcome.reason})${detail}${progress}`);
    }
    messageIds.push(outcome.result?.messageId);
  }
  return messageIds;
}

function inChatOrder<T>(key: string, send: () => Promise<T>): Promise<T> {
  const result = (chatQueues.get(key) ?? Promise.resolve()).then(send);
  const done = result.then(() => undefined, () => undefined);
  chatQueues.set(key, done);
  void done.then(() => {
    if (chatQueues.get(key) === done) chatQueues.delete(key);
  });
  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
