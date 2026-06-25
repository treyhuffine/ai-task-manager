/**
 * The `slack` toolkit — channels, messages, search, users via the Slack Web API.
 * Slack returns HTTP 200 with `{ ok: false, error }` on failure, so each mapper checks `ok`
 * and raises a taxonomy error rather than returning a misleading success.
 */
import { z } from 'zod';
import { action, defineToolkit, httpAction } from '../../core/authoring';
import { collectPages } from '../../core/paginate';
import { ConnectorError } from '../../core/errors';

interface SlackResponse {
  ok?: boolean;
  error?: string;
}

function ok<T extends SlackResponse>(raw: unknown): T {
  const r = (raw ?? {}) as T;
  if (r.ok === false) throw new ConnectorError('provider_error', `slack: ${r.error ?? 'unknown_error'}`);
  return r;
}

export const slackMessaging = defineToolkit({
  id: 'slack',
  providerId: 'slack',
  displayName: 'Slack',
  actions: [
    // Auto-paginated: the agent asks for up to `limit` channels and the action follows Slack's
    // `next_cursor` internally (collectPages, bounded) — no cursor bookkeeping leaks to the model.
    action({
      id: 'slack.list_channels',
      description: 'List channels (public + private) in the workspace.',
      scopes: ['channels:read'],
      input: z.object({ limit: z.number().int().positive().max(1000).default(100) }),
      async execute(ctx, i) {
        type Channel = { id?: string; name?: string; is_private?: boolean };
        const channels = await collectPages<Channel>(
          async (cursor) => {
            const raw = await ctx.http.get('/conversations.list', {
              query: { types: 'public_channel,private_channel', limit: 200, cursor },
            });
            const r = ok<SlackResponse & { channels?: Channel[]; response_metadata?: { next_cursor?: string } }>(raw);
            return { items: r.channels ?? [], nextCursor: r.response_metadata?.next_cursor || undefined };
          },
          { maxItems: i.limit },
        );
        return { channels: channels.map((c) => ({ id: c.id, name: c.name, is_private: !!c.is_private })) };
      },
    }),

    httpAction({
      id: 'slack.post_message',
      description: 'Post a message to a channel.',
      mutating: true,
      risk: 'medium',
      scopes: ['chat:write'],
      input: z.object({ channel: z.string(), text: z.string(), thread_ts: z.string().optional() }),
      request: (i) => ({ method: 'POST', path: '/chat.postMessage', body: { channel: i.channel, text: i.text, thread_ts: i.thread_ts } }),
      output: (raw) => {
        const r = ok<SlackResponse & { ts?: string; channel?: string }>(raw);
        return { ts: r.ts, channel: r.channel };
      },
    }),

    httpAction({
      id: 'slack.search_messages',
      description: 'Search messages across the workspace.',
      scopes: ['search:read'],
      input: z.object({ query: z.string(), count: z.number().int().positive().max(100).default(20) }),
      request: (i) => ({ method: 'GET', path: '/search.messages', query: { query: i.query, count: i.count } }),
      output: (raw) => {
        const r = ok<SlackResponse & { messages?: { matches?: unknown[]; total?: number } }>(raw);
        return { matches: r.messages?.matches ?? [], total: r.messages?.total ?? 0 };
      },
    }),

    httpAction({
      id: 'slack.get_thread',
      description: 'Get the replies in a message thread.',
      scopes: ['channels:history'],
      input: z.object({ channel: z.string(), ts: z.string() }),
      request: (i) => ({ method: 'GET', path: '/conversations.replies', query: { channel: i.channel, ts: i.ts } }),
      output: (raw) => {
        const r = ok<SlackResponse & { messages?: unknown[] }>(raw);
        return { messages: r.messages ?? [] };
      },
    }),

    httpAction({
      id: 'slack.list_users',
      description: 'List members of the workspace.',
      scopes: ['users:read'],
      input: z.object({ limit: z.number().int().positive().max(1000).default(100) }),
      request: (i) => ({ method: 'GET', path: '/users.list', query: { limit: i.limit } }),
      output: (raw) => {
        const r = ok<SlackResponse & { members?: Array<{ id?: string; name?: string; real_name?: string }> }>(raw);
        return { members: (r.members ?? []).map((m) => ({ id: m.id, name: m.name, real_name: m.real_name })) };
      },
    }),
  ],
});
