import { z } from 'zod';
import { defineAction, ActionError } from './types';
import { getWorkResult, listWorkResults, getChatSession, getWorkResultAiReviewForSession } from '@/lib/db/queries';
import { workResultActorFromContext } from '@/lib/work-results/http';
import { getWorkResultCapabilities } from '@/lib/work-results/capabilities';
import { workResultAttachmentSchema, workResultLinkSchema, workResultReviewScopeSchema, workResultReviewProvenanceSchema, reviewSelectionShape, workResultBodySchema } from '@/lib/work-results/validation';
import { serverFetch, ServerResponseError } from './server-client';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from './session-credential';
import type { ActionContext } from './types';
import { getWorkResultHandoffContext } from '@/lib/work-results/handoff-context';

const attachmentWireSchema = z.union([
  workResultAttachmentSchema,
  z.object({ file_name: z.string().min(1), original_name: z.string().min(1), mime_type: z.string().min(1), size: z.number().int().positive(), uploaded_at: z.string().min(1) }).strict()
    .transform((value) => ({ fileName: value.file_name, originalName: value.original_name, mimeType: value.mime_type, size: value.size, uploadedAt: value.uploaded_at })),
]);
const linkWireSchema = z.union([
  workResultLinkSchema,
  z.object({ kind: z.literal('preview'), label: z.string().min(1), preview_target_id: z.string().min(1) }).strict()
    .transform((value) => ({ kind: value.kind, label: value.label, previewTargetId: value.preview_target_id })),
]);
const reportContentShape = {
  body: workResultBodySchema, title: z.string().optional(), attachments: z.array(attachmentWireSchema).optional(), links: z.array(linkWireSchema).optional(),
};
export const independentReviewSchema = z.object({
  ...reportContentShape,
  scope: workResultReviewScopeSchema.extend({ requested: workResultReviewScopeSchema.shape.requested.omit({ resultId: true }) }).optional(),
  provenance: workResultReviewProvenanceSchema.optional(),
}).strict();

function signedHeaders(context: ActionContext): Record<string, string> {
  const credential = context.actor?.sessionId ? sessionCredential(context.actor.sessionId) : null;
  return credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {};
}

async function resultServerFetch(path: string, input: Record<string, unknown>, context: ActionContext) {
  try { return await serverFetch(path, { method: 'POST', headers: signedHeaders(context), body: JSON.stringify(input) }); }
  catch (error) {
    if (error instanceof ServerResponseError) {
      const body = error.json();
      const code = body?.code;
      if (code === 'not_found' || code === 'invalid_params' || code === 'conflict' || code === 'unsupported') {
        throw new ActionError(code, typeof body?.error === 'string' ? body.error : error.message, undefined, body?.details);
      }
    }
    throw error;
  }
}

export const resultActions = [
  defineAction({
    name: 'get_handoff_context',
    description: 'Before preparing a handoff for finished meaningful work, read Ri\'s reporting guide and the shared and agent-specific handoff and review preferences. The producing agent is resolved from this signed chat. Read-only. Then save the handoff with report_result. Ordinary questions, progress and confirmations stay in chat.',
    params: {},
    handler: (context) => getWorkResultHandoffContext(workResultActorFromContext(context, true)),
  }),
  defineAction({
    name: 'report_result',
    description: 'Save a durable handoff for useful work after reading get_handoff_context and preparing the handoff with its applicable guidance. Requires a signed producing Ri chat. Use ordinary chat for progress, questions and confirmations. Uploaded files, labeled HTTP(S) URLs and preview references are retained. Saving never accepts, completes or ships work. Retry identical intent with the same request_id.',
    params: { request_id: z.string().min(1).max(200), ...reportContentShape, attention: z.string().optional(), task_ids: z.array(z.string().min(1)).optional(), supersedes_id: z.string().optional(), independent_review: independentReviewSchema.optional() },
    mutating: true,
    handler: async (context, input) => {
      if (!context.actor?.sessionId) throw new ActionError('unsupported', 'Reporting requires a signed producing Ri chat.');
      return resultServerFetch('/results/reports', { requestId: input.request_id, body: input.body, title: input.title, attachments: input.attachments, links: input.links, attention: input.attention, taskIds: input.task_ids, supersedesId: input.supersedes_id, independentReview: input.independent_review }, context);
    },
  }),
  defineAction({
    name: 'get_result', description: 'Read one exact saved result, task associations, decisions, AI reports and successor. Available when creation is disabled.',
    params: { id: z.string().min(1) }, cli: { positional: ['id'] },
    handler: (context, { id }) => {
      const reviewer = context.actor?.sessionId ? getChatSession(context.actor.sessionId) : null;
      if (reviewer?.surfaceKind === 'result_review' && getWorkResultAiReviewForSession(reviewer.id)?.resultId !== id) throw new ActionError('unsupported', 'A background reviewer may inspect only its assigned result.');
      const result = getWorkResult(id, context.actor?.sessionId ? workResultActorFromContext(context).userId : 'local');
      if (!result) throw new ActionError('not_found', 'Result not found.');
      return result;
    },
  }),
  defineAction({
    name: 'list_results', description: 'Find authorized saved primary results, including taskless work and results whose source was removed. Filter exact stored task membership, source chat or execution. AI reports are nested under their target.',
    params: { task_id: z.string().optional(), execution_id: z.string().optional(), source_chat_session_id: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional(), include_superseded: z.boolean().optional() },
    handler: (context, input) => listWorkResults({ taskId: input.task_id, executionId: input.execution_id, sourceChatSessionId: input.source_chat_session_id, limit: input.limit, offset: input.offset, includeSuperseded: input.include_superseded }, context.actor?.sessionId ? workResultActorFromContext(context).userId : 'local'),
  }),
  defineAction({
    name: 'request_result_review', description: 'On an explicit human request, independently inspect an exact saved result in a background harness. Compatible existing evidence can be reused. A deliberate rerun uses a new request_id and rerun=true. Does not accept, complete or repair work.',
    params: { request_id: z.string().min(1).max(200), result_id: z.string().min(1), focus: z.string().optional(), ...reviewSelectionShape, rerun: z.boolean().optional() },
    mutating: true,
    handler: async (context, input) => {
      workResultActorFromContext(context);
      return resultServerFetch(`/results/${encodeURIComponent(input.result_id)}/reviews`, { requestId: input.request_id, focus: input.focus, harness: input.harness, model: input.model, variant: input.variant, effort: input.effort, rerun: input.rerun }, context);
    },
  }),
  defineAction({
    name: 'report_result_review', description: 'Save an immutable AI review with evidence and limits. Only the assigned signed reviewer can complete a Ri-requested review. An implementer can record existing evidence as reported independence. No recursive review or implicit human acceptance.',
    params: { request_id: z.string().min(1).max(200), review_id: z.string().optional(), result_id: z.string().optional(), ...reportContentShape, scope: workResultReviewScopeSchema.optional(), provenance: workResultReviewProvenanceSchema.optional() },
    mutating: true,
    handler: async (context, input) => {
      if (!context.actor?.sessionId) throw new ActionError('unsupported', 'Reporting requires a signed Ri reviewer or producing chat.');
      return resultServerFetch('/results/review-reports', { requestId: input.request_id, reviewId: input.review_id, resultId: input.result_id, body: input.body, title: input.title, attachments: input.attachments, links: input.links, scope: input.scope, provenance: input.provenance }, context);
    },
  }),
];

/** Stable names remain registered in the CLI, while discovery reflects current gates. */
export function discoverableResultActions() {
  const capabilities = getWorkResultCapabilities();
  if (!capabilities.handoffsEnabled) return [];
  return resultActions.filter((action) => ['get_result', 'list_results'].includes(action.name)
    || (['get_handoff_context', 'report_result'].includes(action.name) && capabilities.handoffsEnabled)
    || (['request_result_review', 'report_result_review'].includes(action.name) && capabilities.aiReviewEnabled));
}

/** Stale clients can replay committed work or receive the same clear gate error
 * even when the disabled tool is absent from current discovery. */
export async function handleUndiscoveredResultCall(request: Request): Promise<Response | null> {
  if (request.method !== 'POST') return null;
  const call = await request.clone().json().catch(() => null);
  if (call?.method !== 'tools/call' || typeof call.params?.name !== 'string') return null;
  const name = call.params.name;
  if (!resultActions.some((action) => action.name === name)
    || discoverableResultActions().some((action) => action.name === name)) return null;
  const { runAction } = await import('./dispatch');
  const { mcpCallContext } = await import('./mcp-caller');
  const envelope = await runAction(name, call.params.arguments ?? {}, mcpCallContext(request.headers, { allowMissing: ['report_result', 'report_result_review'].includes(name) }));
  return Response.json({ jsonrpc: '2.0', id: call.id, result: {
    content: [{ type: 'text', text: JSON.stringify(envelope) }], isError: !envelope.ok,
  } });
}
