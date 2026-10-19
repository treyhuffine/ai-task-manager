import { z } from 'zod/v4';
import { router } from '@/lib/trpc/init';
import { agentFileHandle, attachmentHandle, openFileTarget, subscribeHostResource, unsubscribeHostResource, waitHostResource, writeHostResource, type ResourceWrite } from './files';
import { checkedView } from './service';
import { connectedViewerProcedure as p } from './viewer-procedure';

/**
 * Files in connected app views (docs/connected-mcp-apps.md, "Files"): the
 * person choosing a file to open with an app, and a file view's watches,
 * saves and `openai/files/open`. Every view call rechecks the view's account
 * and access first (`checkedView`).
 */
const id = z.uuid();
const uri = z.string().min(1).max(4096);
export const connectedFilesRouter = router({
  /** A host handle for a file the person picked: a chat attachment, or a file in an agent's folder. */
  handle: p.input(z.discriminatedUnion('kind', [
    z.object({kind: z.literal('attachment'), fileName: z.string().min(1).max(255), name: z.string().max(255).optional()}).strict(),
    z.object({kind: z.literal('agent-file'), workspaceId: z.string().min(1).max(200), path: z.string().min(1).max(4096)}).strict(),
  ])).mutation(({input, ctx}) => input.kind === 'attachment'
    ? attachmentHandle(ctx.key!.apiKeyId, input.fileName, input.name)
    : agentFileHandle(ctx.key!.apiKeyId, input.workspaceId, input.path)),
  subscribe: p.input(z.object({viewId: id, uri}).strict()).mutation(async ({input, ctx}) => {
    const {view} = await checkedView(input.viewId, ctx.key!.apiKeyId);
    return subscribeHostResource(view, input.uri);
  }),
  unsubscribe: p.input(z.object({viewId: id, uri}).strict()).mutation(async ({input, ctx}) => {
    const {view} = await checkedView(input.viewId, ctx.key!.apiKeyId);
    unsubscribeHostResource(view, input.uri);
  }),
  /** The long poll behind `notifications/resources/updated`. */
  changes: p.input(z.object({viewId: id, uri, revision: z.number().int().min(0)}).strict()).query(async ({input, ctx, signal}) => {
    const {view} = await checkedView(input.viewId, ctx.key!.apiKeyId);
    return waitHostResource(view, input.uri, input.revision, signal);
  }),
  write: p.input(z.object({viewId: id, uri, ifMatch: z.string().min(1).max(200).optional(), text: z.string().optional(), blob: z.string().optional()}).strict()
    .refine(value => (value.text === undefined) !== (value.blob === undefined), 'Write exactly one of text or blob'))
    .mutation(async ({input: {viewId, ...write}, ctx}) => {
      const {view} = await checkedView(viewId, ctx.key!.apiKeyId);
      const result = await writeHostResource(view, write as ResourceWrite);
      await ctx.authorize?.(); return result;
    }),
  /** `openai/files/open`: where to show the file the view named. */
  open: p.input(z.object({viewId: id, path: z.string().min(1).max(4096)}).strict()).mutation(async ({input, ctx}) => {
    const {view, remote, transport} = await checkedView(input.viewId, ctx.key!.apiKeyId);
    return {...await openFileTarget(view, remote.entry, transport.tools, input.path), chatId: view.capture.chatId ?? null};
  }),
});
