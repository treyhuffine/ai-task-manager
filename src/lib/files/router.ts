import { z } from 'zod/v4';
import { TRPCError } from '@trpc/server';
import { viewerProcedure, router } from '@/lib/trpc/init';
import { isOperationError } from '@/lib/server/operation';
import { readFilePreview } from './preview';

const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('session'), sessionId: z.string().min(1).max(128), path: z.string().min(1).max(8192) }).strict(),
  z.object({ kind: z.literal('attachment'), fileName: z.string().min(1).max(255), media: z.enum(['audio', 'video']).optional() }).strict(),
]);
export const filePreviewsRouter = router({
  read: viewerProcedure.input(source).query(async ({ input }) => {
    try { return await readFilePreview(input); }
    catch (error) {
      if (isOperationError(error)) throw new TRPCError({ code: error.status === 404 ? 'NOT_FOUND' : error.status === 403 ? 'FORBIDDEN' : error.status === 409 ? 'CONFLICT' : 'BAD_REQUEST', message: error.message, cause: error });
      throw error;
    }
  }),
});
