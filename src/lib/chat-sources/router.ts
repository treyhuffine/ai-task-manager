import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, viewerProcedure as p } from '@/lib/trpc/init';
import { chatSources, chatSourcesEnabled } from '@/lib/server/chat-sources';
import { callSourceParams, describeSourceParams } from './actions';
import { getChatSession } from '@/lib/db/queries';
import { requestConnection } from '@/lib/integrations/connection-requests';
import { decodeSource } from './reference';
import { actorFromSessionCredential, sessionCredentialFromHeaders } from '@/lib/orchestrator/session-credential';

const chat = { chatId: z.string().uuid() };
function actorChat(request: Request, target: string) {
  const actor = actorFromSessionCredential(sessionCredentialFromHeaders(request.headers));
  if (actor?.sessionId && actor.sessionId !== target) throw new TRPCError({ code: 'FORBIDDEN', message: 'This reference belongs to another chat' });
  return target;
}
export const chatSourcesRouter = router({
  enabled: p.query(() => ({ enabled: chatSourcesEnabled() })),
  search: p.input(z.object({ ...chat, query: z.string().max(256), filter: z.enum(['app', 'connector']).optional(), groupId: z.string().max(512).optional() }).strict()).query(({ input, ctx }) => chatSources.search(actorChat(ctx.request, input.chatId), input.query, input.filter, input.groupId)),
  resolve: p.input(z.object({ ...chat, refs: z.array(z.string().max(2731)).max(16) }).strict()).query(({ input, ctx }) => chatSources.resolve(actorChat(ctx.request, input.chatId), input.refs, { privateLabels: !actorFromSessionCredential(sessionCredentialFromHeaders(ctx.request.headers)) })),
  describe: p.input(z.object({ ...chat, ...describeSourceParams }).strict()).query(({ input, ctx }) => chatSources.describe(actorChat(ctx.request, input.chatId), input.message_id, input.source_ref, input.action, input.cursor)),
  invoke: p.input(z.object({ ...chat, ...callSourceParams }).strict()).mutation(({ input, ctx }) => chatSources.call(actorChat(ctx.request, input.chatId), input.message_id, input.source_ref, input.action, input.input, input.invocation_id, ctx.request.signal)),
  openView: p.input(z.object({ ...chat, sourceRef: z.string().max(2731) }).strict()).mutation(({ input, ctx }) => {
    if (actorFromSessionCredential(sessionCredentialFromHeaders(ctx.request.headers))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the person using this chat can open the app here' });
    return chatSources.openView(input.chatId, input.sourceRef);
  }),
  requestAccess: p.input(z.object({ ...chat, sourceRef: z.string().max(2731) }).strict()).mutation(async ({ input, ctx }) => {
    if (actorFromSessionCredential(sessionCredentialFromHeaders(ctx.request.headers))) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the person using this chat can request access here' });
    const ref = decodeSource(input.sourceRef);
    const [source] = await chatSources.resolve(input.chatId, [input.sourceRef], { privateLabels: true });
    if (ref.kind !== 'integration' || !['needs_access', 'reconnect'].includes(source.status)) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Manage this app from its details' });
    const session = getChatSession(input.chatId);
    return requestConnection({ sessionId: input.chatId, scopeWorkspaceId: session?.workspaceId ?? null, service: ref.toolkitId, accountPin: { accountId: ref.account.accountId, authConfigId: ref.account.authConfigId ?? undefined }, reason: 'To use this account mentioned in your message.', userAsked: true });
  }),
});
