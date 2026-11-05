import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { uuidv7 } from 'uuidv7';
import * as q from '@/lib/db/queries';
import { router, sharedProcedure as p } from '@/lib/trpc/init';
import type { RequestKey } from '@/lib/auth/request-key';
import { requireTeamCapability } from '@/lib/team/capability-authority';
import { hasTeamCapability } from '@/lib/team/capabilities';
import { conversationHash, newConversationToken, saveConversationSecrets, deleteConversationSecrets } from './secrets';
import { slackApi, slackConversationManifest, reconnectSlackSocket } from './slack';
import { drainConversations } from './service';
import { getLocalBaseUrl, getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';

function human(key: RequestKey | null) {
  if (!key || key.sessionChatId || !['member', 'viewer'].includes(key.scope)) throw new TRPCError({ code: 'FORBIDDEN', message: 'Manage conversation connections from your signed-in Ri screen.' });
  return key;
}
function manage(key: RequestKey | null) {
  human(key);
  if (q.getHome()?.kind === 'team') requireTeamCapability(key, 'manageSignIns');
}
const id = z.object({ id: z.uuid() }).strict();
export const conversationIntegrationsRouter = router({
  forSession: p.input(z.object({ sessionId: z.string().min(1) }).strict()).query(({ ctx, input }) => {
    if (q.getHome()?.kind === 'team') authorizeTeamExecution(ctx.key, { chatId: input.sessionId, operation: 'read' });
    const thread = q.conversationThreadForSession(input.sessionId);
    const connection = thread ? q.getConversationConnection(thread.connectionId) : null;
    return connection && thread ? { provider: connection.provider, name: connection.name, enabled: connection.enabled, channelId: thread.channelId, team: q.getHome()?.kind === 'team' } : null;
  }),
  list: p.query(({ ctx }) => {
    const key = human(ctx.key);
    const team = q.getHome()?.kind === 'team';
    const canManage = !team || hasTeamCapability(key.memberId ? q.getMember(key.memberId) : null, 'manageSignIns');
    return { team, canManage, connections: q.listConversationConnections().map(connection => ({ ...connection,
      identities: q.listConversationIdentities(connection.id).filter(identity => canManage || identity.apiKeyId === key.apiKeyId).map(identity => ({ id: identity.id, externalUserId: identity.externalUserId, memberId: identity.memberId, mine: identity.apiKeyId === key.apiKeyId })) })),
      agents: q.listWorkspaces({ status: 'active' }).map(agent => ({ id: agent.id, name: agent.name })) };
  }),
  manifest: p.input(z.object({ name: z.string().trim().min(1).max(35) }).strict()).query(({ input }) => slackConversationManifest(input.name)),
  create: p.input(z.object({ provider: z.enum(['slack', 'buzz']), name: z.string().trim().min(1).max(60), workspaceId: z.string().nullable(),
    channels: z.array(z.string().trim().min(1).max(100)).max(100), botToken: z.string().optional(), appToken: z.string().optional(), relay: z.string().optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      manage(ctx.key);
      const key = human(ctx.key);
      if (q.getHome()?.kind === 'team' && !input.workspaceId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select the team agent this connection serves.' });
      if (input.workspaceId && q.getWorkspace(input.workspaceId)?.status !== 'active') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Select an active Ri agent.' });
      if (q.getHome()?.kind === 'team' && !input.channels.length) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Specify a channel intended to be visible to the whole Ri team.' });
      let externalWorkspaceId: string;
      let externalAgentId: string;
      const connectionId = uuidv7();
      const bridgeToken = input.provider === 'buzz' ? newConversationToken() : undefined;
      if (input.provider === 'slack') {
        if (!input.botToken?.startsWith('xoxb-') || !input.appToken?.startsWith('xapp-')) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add a bot token (xoxb-) and an app-level Socket Mode token (xapp-).' });
        const bot = await slackApi<{ team_id: string; user_id: string }>(input.botToken, 'auth.test');
        externalWorkspaceId = bot.team_id; externalAgentId = bot.user_id;
      } else {
        if (!input.channels.length || input.channels.some(channel => !z.uuid().safeParse(channel).success)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Specify the Buzz channel UUIDs this bridge can use.' });
        const relay = z.url().parse(input.relay);
        if (!['ws:', 'wss:', 'http:', 'https:'].includes(new URL(relay).protocol)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use your Buzz relay URL.' });
        externalWorkspaceId = relay; externalAgentId = connectionId;
      }
      await saveConversationSecrets(connectionId, { botToken: input.botToken, appToken: input.appToken, bridgeToken });
      try {
        const connection = q.createConversationConnection({ id: connectionId, provider: input.provider, name: input.name, workspaceId: input.workspaceId,
          enabled: true, externalWorkspaceId, externalAgentId, channels: input.channels });
        if (input.provider === 'buzz') {
          // The explicitly authorized ACP host acts as this person. Never scrape member identity from prompt text.
          const code = newConversationToken();
          q.createConversationLink({ connectionId, apiKeyId: key.apiKeyId, memberId: key.memberId ?? null, codeHash: conversationHash(code) });
          q.consumeConversationLink(connectionId, 'acp-host', conversationHash(code));
        }
        void drainConversations();
        return { connection, bridgeToken, bridgeUrl: new URL(`/api/integrations/conversations/acp/${connectionId}`, getRemoteBaseUrl() ?? getLocalBaseUrl()).toString() };
      } catch (error) { deleteConversationSecrets(connectionId); throw error; }
    }),
  setEnabled: p.input(id.extend({ enabled: z.boolean() })).mutation(({ ctx, input }) => { manage(ctx.key); q.updateConversationConnection(input.id, { enabled: input.enabled }); void drainConversations(); return { ok: true }; }),
  reconnectSlack: p.input(id.extend({ botToken: z.string().startsWith('xoxb-'), appToken: z.string().startsWith('xapp-') })).mutation(async ({ ctx, input }) => {
    manage(ctx.key);
    const connection = q.getConversationConnection(input.id);
    if (connection?.provider !== 'slack') throw new TRPCError({ code: 'NOT_FOUND' });
    const bot = await slackApi<{ team_id: string; user_id: string }>(input.botToken, 'auth.test');
    if (bot.team_id !== connection.externalWorkspaceId || bot.user_id !== connection.externalAgentId) throw new TRPCError({ code: 'CONFLICT', message: 'Use tokens for this same Slack app and workspace. Add a separate connection for another identity.' });
    await saveConversationSecrets(connection.id, { botToken: input.botToken, appToken: input.appToken });
    q.updateConversationConnection(connection.id, { enabled: true, error: null });
    q.retryConversationOutputs(connection.id); reconnectSlackSocket(connection.id); void drainConversations();
    return { ok: true };
  }),
  retryDelivery: p.input(id).mutation(({ ctx, input }) => { manage(ctx.key); q.retryConversationOutputs(input.id); void drainConversations(); return { ok: true }; }),
  remove: p.input(id).mutation(({ ctx, input }) => { manage(ctx.key); q.deleteConversationConnection(input.id); deleteConversationSecrets(input.id); void drainConversations(); return { ok: true }; }),
  link: p.input(id).mutation(({ ctx, input }) => {
    const key = human(ctx.key);
    const connection = q.getConversationConnection(input.id);
    if (!connection?.enabled) throw new TRPCError({ code: 'NOT_FOUND' });
    const code = newConversationToken();
    q.createConversationLink({ connectionId: input.id, apiKeyId: key.apiKeyId, memberId: key.memberId ?? null, codeHash: conversationHash(code) });
    let bridgeCommand: string | null = null;
    if (connection.provider === 'buzz') {
      const url = new URL(`/api/integrations/conversations/acp/${connection.id}`, getRemoteBaseUrl() ?? getLocalBaseUrl()).toString();
      const body = JSON.stringify({ operation: 'prompt', channelId: connection.channels[0], threadId: 'link', eventId: code, text: `link ${code}` });
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
      bridgeCommand = `curl --fail-with-body ${quote(url)} -H "Authorization: Bearer \${RI_CONVERSATION_TOKEN}" -H 'Content-Type: application/json' --data-binary ${quote(body)}`;
    }
    return { command: `link ${code}`, bridgeCommand, expiresInMinutes: 10 };
  }),
  unlink: p.input(id).mutation(({ ctx, input }) => { const key = human(ctx.key); q.revokeConversationIdentity(input.id, key.apiKeyId); return { ok: true }; }),
});
