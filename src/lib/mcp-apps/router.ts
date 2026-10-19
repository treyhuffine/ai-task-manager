import { z } from 'zod/v4';
import { viewerProcedure, router } from '@/lib/trpc/init';
import { TRPCError } from '@trpc/server';
import { getApiKey } from '@/lib/db/queries';
import { callConnectedView, cancelConnectedInvocation, connectedAppsCatalog, connectedViewStatus, decideConnectedApproval, launchConnectedView, prepareConnectedLaunch, openConnectedView, updateConnectedContext } from './service';

const id = z.uuid();
const args = z.record(z.string(), z.unknown());
const p = viewerProcedure.use(async ({ctx, next}) => {
  const recheck = () => {
    ctx.authorize?.();
    const key = getApiKey(ctx.key!.apiKeyId);
    if (!key || key.role !== 'sign_in' || key.revokedAt || (key.expiresAt && Date.parse(key.expiresAt) <= Date.now())) throw new TRPCError({code: 'UNAUTHORIZED', message: 'This viewer is no longer signed in'});
  };
  recheck(); const result = await next(); recheck(); return result;
});
export const connectedAppsRouter = router({
  catalog: p.query(({ctx}) => connectedAppsCatalog(ctx.key!.apiKeyId)),
  status: p.input(z.object({viewId: id}).strict()).query(({input,ctx}) => connectedViewStatus(input.viewId,ctx.key!.apiKeyId)),
  open: p.input(z.object({captureId: id, chatId: id.optional()}).strict()).mutation(async ({input, ctx}) => {
    const result = await openConnectedView(input.captureId, ctx.key!.apiKeyId, input.chatId);
    await ctx.authorize?.(); return result;
  }),
  // Opens a standalone screen (a global entrypoint) with `{}`. Other tools run from chat.
  prepare: p.input(z.object({serverId: z.string().min(1).max(200), name: z.string().min(1).max(200)}).strict()).mutation(({input,ctx}) => prepareConnectedLaunch(input.serverId,ctx.key!.apiKeyId,input.name)),
  launch: p.input(z.object({viewId: id}).strict()).mutation(async ({input, ctx}) => {
    const result = await launchConnectedView(input.viewId, ctx.key!.apiKeyId);
    await ctx.authorize?.(); return result;
  }),
  invoke: p.input(z.object({viewId: id, name: z.string().min(1).max(200), args, invocationId: id}).strict()).mutation(async ({input, ctx}) => {
    const result = await callConnectedView(input.viewId, ctx.key!.apiKeyId, input.name, input.args, input.invocationId);
    await ctx.authorize?.(); return result;
  }),
  cancel: p.input(z.object({viewId: id, invocationId: id}).strict()).mutation(({input, ctx}) => cancelConnectedInvocation(input.viewId, ctx.key!.apiKeyId, input.invocationId)),
  context: p.input(z.object({viewId: id, context: z.unknown()}).strict()).mutation(({input, ctx}) => updateConnectedContext(input.viewId, ctx.key!.apiKeyId, input.context)),
  approval: p.input(z.object({viewId: id, ids: z.array(id).min(1).max(8), approve: z.boolean()}).strict()).mutation(({input, ctx}) => decideConnectedApproval(input.viewId, ctx.key!.apiKeyId, input.ids, input.approve)),
});
