/**
 * Telegram ConnectorChannel adapter — delivers a notification by invoking the connector engine's
 * `telegram.send_message` verb with the NARROW notifier caller (auto-allowed by the host approval
 * policy; agent sends stay gated — spec §2.3). The chat_id is the channel's pinned `config.chatId`.
 */
import { getConnectorRuntime, getConnectorOwnerId } from '@/lib/connectors/runtime';
import type { NotificationChannelAdapter } from '../types';
import { NOTIFIER_CALLER } from '../caller';

export const telegramAdapter: NotificationChannelAdapter = {
  kind: 'connector',
  providerId: 'telegram',

  validateConfig(channel) {
    const chatId = (channel.config as { chatId?: unknown }).chatId;
    if (chatId === undefined || chatId === null || chatId === '') {
      throw new Error('telegram channel is missing config.chatId');
    }
  },

  async deliver(channel, rendered) {
    const chatId = (channel.config as { chatId?: string | number }).chatId!;
    // Plain text — Telegram auto-links bare URLs, so no parse_mode escaping needed.
    const text = [rendered.title, '', rendered.body, rendered.url].filter((p) => p !== '').join('\n');

    const outcome = await (await getConnectorRuntime()).runAction<{ messageId?: number | string }>(
      'telegram.send_message',
      { chatId, text },
      {
        ownerId: getConnectorOwnerId(),
        ...(channel.connectionId ? { connectionId: channel.connectionId } : {}),
        caller: NOTIFIER_CALLER,
      },
    );

    if (!outcome.ok) {
      const reason = 'reason' in outcome ? outcome.reason : 'unknown';
      const detail = outcome.reason === 'error' ? `: ${outcome.message}` : '';
      throw new Error(`telegram delivery failed (${reason})${detail}`);
    }
    const messageId = outcome.result?.messageId;
    return messageId !== undefined ? { providerMessageId: String(messageId) } : {};
  },
};
