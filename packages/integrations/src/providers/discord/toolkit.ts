/**
 * The `discord` toolkit. Reads (guilds/channels/messages) plus a best-effort post. Scopes are
 * action-level: `guilds` to list servers, `messages.read` to read; identity is always granted.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { DISCORD_SCOPES } from './provider';

export const discordToolkit = defineToolkit({
  id: 'discord',
  providerId: 'discord',
  displayName: 'Discord',
  actions: [
    httpAction({
      id: 'discord.list_guilds',
      description: 'List the Discord servers (guilds) the user belongs to.',
      scopes: [DISCORD_SCOPES.guilds],
      input: z.object({}),
      request: () => ({ method: 'GET', path: '/users/@me/guilds' }),
      output: (raw) => {
        const r = (raw as Array<{ id?: string; name?: string }>) ?? [];
        return { guilds: r.map((g) => ({ id: g.id, name: g.name })) };
      },
    }),

    httpAction({
      id: 'discord.list_channels',
      description: 'List channels in a guild.',
      input: z.object({ guildId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/guilds/${encodeURIComponent(i.guildId)}/channels` }),
      output: (raw) => {
        const r = (raw as Array<{ id?: string; name?: string; type?: number }>) ?? [];
        return { channels: r.map((c) => ({ id: c.id, name: c.name, type: c.type })) };
      },
    }),

    httpAction({
      id: 'discord.get_messages',
      description: 'Get recent messages from a channel.',
      scopes: [DISCORD_SCOPES.messagesRead],
      input: z.object({ channelId: z.string(), limit: z.number().int().positive().max(100).default(25) }),
      request: (i) => ({
        method: 'GET',
        path: `/channels/${encodeURIComponent(i.channelId)}/messages`,
        query: { limit: i.limit },
      }),
      output: (raw) => ({ messages: (raw as unknown[]) ?? [] }),
    }),

    httpAction({
      id: 'discord.post_message',
      description:
        'Post a message to a channel. Note: posting usually requires a bot token (Authorization: Bot <token>); this uses the OAuth user token — a bot-token variant is a future option.',
      mutating: true,
      risk: 'medium',
      input: z.object({ channelId: z.string(), content: z.string() }),
      request: (i) => ({
        method: 'POST',
        path: `/channels/${encodeURIComponent(i.channelId)}/messages`,
        body: { content: i.content },
      }),
      output: (raw) => {
        const r = raw as { id?: string };
        return { id: r.id };
      },
    }),
  ],
});
