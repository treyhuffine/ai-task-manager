import { TRPCError } from '@trpc/server';
import { viewerProcedure } from '@/lib/trpc/init';
import { getApiKey } from '@/lib/db/queries';

/**
 * A connected app procedure: a signed-in viewer, rechecked before and after
 * the work, so a key revoked mid-request cannot carry an app's result or a
 * form's answer.
 */
export const connectedViewerProcedure = viewerProcedure.use(async ({ctx, next}) => {
  const recheck = () => {
    ctx.authorize?.();
    const key = getApiKey(ctx.key!.apiKeyId);
    if (!key || key.role !== 'sign_in' || key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= Date.now())) throw new TRPCError({code: 'UNAUTHORIZED', message: 'This viewer is no longer signed in'});
  };
  recheck(); const result = await next(); recheck(); return result;
});
