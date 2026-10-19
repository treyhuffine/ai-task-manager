import { z } from 'zod/v4';
import { router } from '@/lib/trpc/init';
import { callConnectedView, cancelConnectedInvocation, clearConnectedContext, connectedAppsCatalog, connectedViewStatus, decideConnectedApproval, launchConnectedView, navigateConnectedScreen, prepareConnectedLaunch, openConnectedView, readConnectedResource, updateConnectedContext } from './service';
import { connectedFilesRouter } from './files-router';
import { connectedViewerProcedure as p } from './viewer-procedure';

const id = z.uuid();
const args = z.record(z.string(), z.unknown());
export const connectedAppsRouter = router({
  files: connectedFilesRouter,
  catalog: p.query(({ctx}) => connectedAppsCatalog(ctx.key!.apiKeyId)),
  status: p.input(z.object({viewId: id}).strict()).query(({input,ctx}) => connectedViewStatus(input.viewId,ctx.key!.apiKeyId)),
  open: p.input(z.object({captureId: id, chatId: id.optional()}).strict()).mutation(async ({input, ctx}) => {
    const result = await openConnectedView(input.captureId, ctx.key!.apiKeyId, input.chatId);
    await ctx.authorize?.(); return result;
  }),
  // A person opening an app: a global screen (the default, with `{}`), a tab beside a chat, a file's
  // viewer, a settings button or a form preview. Returns the open instance when one is reused.
  prepare: p.input(z.object({serverId: z.string().min(1).max(200), name: z.string().min(1).max(200),
    kind: z.enum(['global', 'thread', 'file', 'settings', 'preview']).optional(), chatId: id.optional(), deepLink: z.string().max(2048).optional(),
    args: args.optional(), file: z.object({handle: z.string().min(1).max(200)}).strict().optional(), fresh: z.boolean().optional()}).strict())
    .mutation(({input: {serverId, name, ...options}, ctx}) => prepareConnectedLaunch(serverId, ctx.key!.apiKeyId, name, options)),
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
  clearContext: p.input(z.object({viewId: id}).strict()).mutation(({input, ctx}) => clearConnectedContext(input.viewId, ctx.key!.apiKeyId)),
  navigate: p.input(z.object({viewId: id, deepLink: z.string().min(1).max(2048)}).strict()).mutation(({input, ctx}) => navigateConnectedScreen(input.viewId, ctx.key!.apiKeyId, input.deepLink)),
  readResource: p.input(z.object({viewId: id, uri: z.string().min(1).max(4096), meta: z.record(z.string(), z.unknown()).optional()}).strict()).mutation(async ({input, ctx}) => {
    const result = await readConnectedResource(input.viewId, ctx.key!.apiKeyId, {uri: input.uri, ...(input.meta ? {_meta: input.meta} : {})});
    await ctx.authorize?.(); return result;
  }),
  approval: p.input(z.object({viewId: id, ids: z.array(id).min(1).max(8), approve: z.boolean()}).strict()).mutation(({input, ctx}) => decideConnectedApproval(input.viewId, ctx.key!.apiKeyId, input.ids, input.approve)),
});
