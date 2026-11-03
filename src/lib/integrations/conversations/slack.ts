import WebSocket from 'ws';
import { z } from 'zod/v4';
import * as q from '@/lib/db/queries';
import type { ConversationConnection, ConversationThread } from '@/db/types';
import { processState } from '@/lib/process-state';
import { splitText } from '@/lib/notifications/message-text';
import { stableCoordinationId } from '@/lib/coordination/ids';
import { readConversationSecrets } from './secrets';
import { acceptExternalConversation, authorizedConversationThread, drainConversations } from './service';

export class SlackConversationError extends Error {
  constructor(readonly code: string, readonly retryAfter = 5) { super(`Slack: ${code}`); }
}
export async function slackApi<T extends object = Record<string, unknown>>(token: string, method: string, body: object = {}): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  if (response.status === 429) throw new SlackConversationError('ratelimited', Math.max(1, Number(response.headers.get('retry-after')) || 5));
  if (!response.ok) throw new SlackConversationError(`http_${response.status}`);
  const result = await response.json() as T & { ok?: boolean; error?: string };
  if (!result.ok) throw new SlackConversationError(result.error ?? 'unknown_error');
  return result;
}

export function slackConversationManifest(name: string) {
  const appName = z.string().trim().min(1).max(35).parse(name);
  const botName = appName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'ri';
  return { display_information: { name: appName }, features: {
    app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
    bot_user: { display_name: botName },
    agent_view: { agent_description: 'Talk to your Ri orchestrator or team agent.' },
  },
    oauth_config: { scopes: { bot: ['app_mentions:read', 'chat:write', 'im:history', 'channels:history', 'groups:history', 'assistant:write'] } },
    settings: { socket_mode_enabled: true, event_subscriptions: { bot_events: ['app_home_opened', 'app_mention', 'message.im', 'message.channels', 'message.groups', 'agent_session_stopped'] } } };
}

const slackEvent = z.object({ type: z.string(), user: z.string().optional(), bot_id: z.string().optional(), subtype: z.string().optional(),
  channel: z.string().optional(), channel_id: z.string().optional(), channel_type: z.string().optional(), ts: z.string().optional(), thread_ts: z.string().optional(), text: z.string().optional(),
  agent_session: z.object({ channel_id: z.string(), thread_ts: z.string().optional() }).optional() });

export function acceptSlackEvent(connection: ConversationConnection, payload: unknown) {
  const envelope = z.object({ team_id: z.string(), event_id: z.string(), event: slackEvent }).parse(payload);
  if (envelope.team_id !== connection.externalWorkspaceId) throw new Error('This Slack workspace is not connected here.');
  const event = envelope.event;
  if (event.user === connection.externalAgentId || event.bot_id || event.subtype) return;
  const stopped = event.type === 'agent_session_stopped';
  if (!stopped && !['message', 'app_mention'].includes(event.type)) return;
  const channel = event.channel ?? event.channel_id ?? event.agent_session?.channel_id;
  const root = event.thread_ts ?? event.agent_session?.thread_ts;
  if (!channel || !event.user || !(root || event.ts)) return;
  const direct = event.channel_type === 'im' || channel.startsWith('D');
  const content = stopped ? 'stop' : (event.text ?? '').replaceAll(`<@${connection.externalAgentId}>`, '').trim();
  return acceptExternalConversation({ connectionId: connection.id, channelId: channel, threadId: root ?? event.ts!,
    externalUserId: event.user, externalEventId: stopped ? envelope.event_id : event.ts!, content, direct,
    mentioned: event.type === 'app_mention' || (event.text ?? '').includes(`<@${connection.externalAgentId}>`), stop: stopped });
}

interface SocketEntry { socket: WebSocket | null; nextAttempt: number; opening: boolean }
const state = processState('integrations.conversation-slack', () => ({ sockets: new Map<string, SocketEntry>() }));

export async function refreshSlackSockets() {
  const enabled = q.listConversationConnections().filter(connection => connection.enabled && connection.provider === 'slack');
  for (const [id, entry] of state.sockets) if (!enabled.some(connection => connection.id === id)) { state.sockets.delete(id); entry.socket?.close(); }
  for (const connection of enabled) {
    let entry = state.sockets.get(connection.id);
    if (!entry) { entry = { socket: null, nextAttempt: 0, opening: false }; state.sockets.set(connection.id, entry); }
    if (entry.socket || entry.opening || entry.nextAttempt > Date.now()) continue;
    entry.opening = true;
    try {
      const { appToken } = await readConversationSecrets(connection.id);
      if (!appToken) throw new Error('Add an app-level Slack token with connections:write.');
      const { url } = await slackApi<{ url: string }>(appToken, 'apps.connections.open');
      const target = new URL(url);
      if (target.protocol !== 'wss:' || !target.hostname.endsWith('.slack.com')) throw new Error('Slack returned an invalid Socket Mode address.');
      const socket = new WebSocket(url, { maxPayload: 1024 * 1024, handshakeTimeout: 15_000 });
      entry.socket = socket;
      const captured = entry;
      socket.on('open', () => { q.updateConversationConnection(connection.id, { error: null }); });
      socket.on('error', () => { q.updateConversationConnection(connection.id, { error: 'Slack Socket Mode disconnected. Ri will retry the connection.' }); socket.close(); });
      socket.on('close', () => { captured.socket = null; captured.nextAttempt = Date.now() + 5000; });
      socket.on('message', data => {
        try {
          const packet = JSON.parse(data.toString()) as { type?: string; envelope_id?: string; payload?: unknown };
          if (packet.type === 'disconnect') { socket.close(); return; }
          if (packet.type !== 'events_api' || !packet.envelope_id) return;
          // Save accepted input before ACK. Slack can retry when persistence fails.
          const accepted = acceptSlackEvent(q.getConversationConnection(connection.id) ?? { ...connection, enabled: false }, packet.payload);
          socket.send(JSON.stringify({ envelope_id: packet.envelope_id }));
          if (accepted && !accepted.accepted) {
            const event = (packet.payload as { event: { type: string; channel: string; user: string; thread_ts?: string } }).event;
            if (event.type === 'app_mention' || event.channel?.startsWith('D') || accepted.linked) {
              void readConversationSecrets(connection.id).then(async ({ botToken }) => {
                if (botToken) await slackApi(botToken, event.channel.startsWith('D') ? 'chat.postMessage' : 'chat.postEphemeral', { channel: event.channel, user: event.user, text: accepted.reason, ...(event.thread_ts ? { thread_ts: event.thread_ts } : {}) });
              }).catch(() => {});
            }
          }
          void drainConversations();
        } catch (error) {
          q.updateConversationConnection(connection.id, { error: error instanceof Error ? error.message : 'A Slack event could not be accepted.' });
        }
      });
    } catch (error) {
      entry.nextAttempt = Date.now() + 15_000;
      q.updateConversationConnection(connection.id, { error: error instanceof Error ? error.message : 'Slack could not connect.' });
    } finally { entry.opening = false; }
  }
}
export function closeSlackSockets() { for (const entry of state.sockets.values()) entry.socket?.close(); state.sockets.clear(); }
export function reconnectSlackSocket(id: string) { const entry = state.sockets.get(id); state.sockets.delete(id); entry?.socket?.close(); }

export async function slackSessionStatus(connection: ConversationConnection, thread: ConversationThread, status: 'processing' | 'active' | 'suspended' | 'closed') {
  const { botToken } = await readConversationSecrets(connection.id);
  if (!botToken) return;
  await slackApi(botToken, 'agents.sessions.setStatus', { channel_id: thread.channelId, ...(thread.threadId === 'dm' ? {} : { thread_ts: thread.threadId }), status });
}
export async function deliverSlackOutputs() {
  for (const output of q.slackConversationOutputs()) {
    const thread = q.getConversationThread(output.threadId);
    const connection = thread && q.getConversationConnection(thread.connectionId);
    if (!thread || connection?.provider !== 'slack') continue;
    try {
      authorizedConversationThread(connection.id, thread.id);
      const { botToken } = await readConversationSecrets(connection.id);
      if (!botToken) throw new Error('The Slack bot token is missing.');
      const parts = splitText(output.content, 3000, text => text.length);
      for (let part = output.part; part < parts.length; part++) {
        await slackApi(botToken, 'chat.postMessage', { channel: thread.channelId, ...(thread.threadId === 'dm' ? {} : { thread_ts: thread.threadId }),
          text: parts[part], client_msg_id: stableCoordinationId('slack-part', output.id, String(part)), unfurl_links: false, unfurl_media: false });
        q.updateConversationOutput(output.id, { part: part + 1 });
      }
      q.updateConversationOutput(output.id, { status: 'sent', error: null });
      q.updateConversationConnection(connection.id, { error: null });
      await slackSessionStatus(connection, thread, output.kind === 'question' ? 'suspended' : 'active').catch(() => {});
    } catch (error) {
      const failed = error instanceof SlackConversationError && ['invalid_auth', 'token_revoked', 'channel_not_found', 'not_in_channel', 'account_inactive'].includes(error.code);
      const delay = error instanceof SlackConversationError ? error.retryAfter * 1000 : 30_000;
      q.updateConversationOutput(output.id, { status: failed ? 'failed' : 'pending', attempts: output.attempts + 1,
        nextAttemptAt: new Date(Date.now() + Math.min(300_000, delay * 2 ** Math.min(output.attempts, 5))).toISOString(), error: error instanceof Error ? error.message : 'Slack delivery failed.' });
      q.updateConversationConnection(connection.id, { error: error instanceof Error ? error.message : 'Slack delivery failed.' });
    }
  }
}
