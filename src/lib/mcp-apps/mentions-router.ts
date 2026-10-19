import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, viewerProcedure as p } from '@/lib/trpc/init';
import { actorFromSessionCredential, sessionCredentialFromHeaders } from '@/lib/orchestrator/session-credential';
import { searchAppMentions } from './mentions';

/**
 * @ search for the composer (`mentions.ts`). The person typing searches for
 * the chat they type in. An agent's own credential may only search its own
 * chat, as with chat sources.
 */
export const appMentionsRouter = router({
  search: p.input(z.object({ chatId: z.string().uuid(), query: z.string().max(256) }).strict()).query(({ input, ctx }) => {
    const actor = actorFromSessionCredential(sessionCredentialFromHeaders(ctx.request.headers));
    if (actor?.sessionId && actor.sessionId !== input.chatId) throw new TRPCError({ code: 'FORBIDDEN', message: 'This search belongs to another chat' });
    return searchAppMentions(input.chatId, input.query, ctx.request.signal);
  }),
});
