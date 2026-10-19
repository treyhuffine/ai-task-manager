import { TRPCError } from '@trpc/server';
import { getApiKey } from '@/lib/db/queries';
import { viewerProcedure } from '@/lib/trpc/init';

/** A signed-in viewer's procedure for connected app views, rechecked before and after the work. */
export const connectedViewerProcedure = viewerProcedure.use(async ({ctx, next}) => {
  const recheck = () => {
    ctx.authorize?.();
    const key = getApiKey(ctx.key!.apiKeyId);
    if (!key || key.role !== 'sign_in' || key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= Date.now())) throw new TRPCError({code: 'UNAUTHORIZED', message: 'This viewer is no longer signed in'});
  };
  recheck(); const result = await next(); recheck(); return result;
});
