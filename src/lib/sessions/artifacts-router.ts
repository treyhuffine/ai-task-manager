import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { sharedProcedure, router } from '@/lib/trpc/init';
import { getChatSession, listChatSessions } from '@/lib/db/queries';
import { sessionAuthority, executionAuthority, executionCatalogFilter } from '@/lib/workspaces/access';
import { listExecutionArtifacts } from './execution-artifacts';

export const artifactsRouter = router({
  list: sharedProcedure.input(z.object({
    scope: z.union([
      z.object({ executionId: z.string().min(1).max(128) }).strict(),
      z.object({ sessionId: z.string().min(1).max(128) }).strict(),
    ]),
    cursor: z.object({ createdAt: z.string().min(1).max(64), id: z.string().min(1).max(128) }).strict().nullish(),
    // tRPC's infinite-query client sends this alongside its cursor.
    direction: z.enum(['forward', 'backward']).optional(),
  }).strict()).query(({ input, ctx }) => {
    const scope = input.scope;
    if ('executionId' in scope) executionAuthority(ctx.key, scope.executionId, 'read');
    const visible = executionCatalogFilter(ctx.key);
    const sessionId = 'sessionId' in scope ? scope.sessionId : listChatSessions({ executionId: scope.executionId }).find(visible)?.id;
    if (!sessionId || !getChatSession(sessionId)) throw new TRPCError({ code: 'NOT_FOUND', message: 'Chat not found' });
    sessionAuthority(ctx.key, sessionId, 'read');
    return listExecutionArtifacts(sessionId, input.cursor ?? undefined, visible);
  }),
});
