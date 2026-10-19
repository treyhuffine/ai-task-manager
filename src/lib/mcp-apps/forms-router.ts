import { z } from 'zod/v4';
import { router } from '@/lib/trpc/init';
import { connectedViewerProcedure as p } from './viewer-procedure';
import { answerConnectedForm, connectedFormFile, connectedFormPreview, getConnectedForm, listViewForms, prepareConnectedFormPreview } from './elicitation';

const id = z.uuid();
const name = z.string().min(1).max(200);

/** Forms an MCP server asked a person to fill (docs/connected-mcp-apps.md, "Forms"). */
export const connectedFormsRouter = router({
  get: p.input(z.object({formId: id}).strict()).query(({input, ctx}) => getConnectedForm(input.formId, ctx.key!.apiKeyId)),
  forView: p.input(z.object({viewId: id}).strict()).query(({input, ctx}) => listViewForms(input.viewId, ctx.key!.apiKeyId)),
  answer: p.input(z.object({formId: id, answer: z.discriminatedUnion('action', [
    z.object({action: z.literal('accept'), content: z.record(z.string(), z.unknown())}).strict(),
    z.object({action: z.enum(['decline', 'cancel'])}).strict(),
  ])}).strict()).mutation(({input, ctx}) => answerConnectedForm(input.formId, ctx.key!.apiKeyId, input.answer)),
  file: p.input(z.object({formId: id, field: name, pick: z.union([
    z.object({attachment: z.string().min(1).max(200)}).strict(),
    z.object({folder: z.string().min(1).max(4096), path: z.string().max(4096).optional()}).strict(),
  ])}).strict()).mutation(({input, ctx}) => connectedFormFile(input.formId, ctx.key!.apiKeyId, input.field, input.pick)),
  preview: p.input(z.object({formId: id, uri: z.string().min(1).max(4096)}).strict()).query(({input, ctx}) => connectedFormPreview(input.formId, ctx.key!.apiKeyId, input.uri)),
  openPreview: p.input(z.object({formId: id, name, args: z.record(z.string(), z.unknown())}).strict())
    .mutation(({input, ctx}) => prepareConnectedFormPreview(input.formId, ctx.key!.apiKeyId, input.name, input.args)),
});
