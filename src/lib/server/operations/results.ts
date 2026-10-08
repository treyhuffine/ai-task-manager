import { z } from 'zod/v4';
import { createWorkResult, getWorkResult, getWorkResultCompletionOptions, listWorkResults, getPreviewTargetById, getExecution, workResultRequestScopedId } from '@/lib/db/queries';
import { reply, failureResponse, type OperationContext } from '@/lib/server/operation';
import { workResultActorFromRequest, workResultErrorResponse } from '@/lib/work-results/http';
import { getWorkResultCapabilities, setWorkResultCapabilities, assertHandoffsEnabled } from '@/lib/work-results/capabilities';
import { getAssociatedWorkResultWorkspace } from '@/lib/work-results/reviewer-preferences';
import { observeWorkResultCodeRevision } from '@/lib/work-results/observe';
import { prepareAutomaticWorkResultReview, dispatchAutomaticWorkResultReviews } from '@/lib/work-results/automatic';
import { saveWorkResultSchema, workResultDecisionSchema, requestAiReviewSchema, prepareWorkResultSchema } from '@/lib/work-results/validation';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { ActionError } from '@/lib/orchestrator/types';

const id = z.string().min(1);
const requestId = z.string().min(1).max(200);
const attachment = z.object({ fileName: id, originalName: id, mimeType: id, size: z.number().int().positive().max(50 * 1024 * 1024), uploadedAt: id }).strict();
export const resultIdInput = z.object({ id }).strict();
export const reviewIdInput = z.object({ reviewId: id }).strict();
export const capabilitiesInput = z.object({ handoffsEnabled: z.boolean().optional(), aiReviewEnabled: z.boolean().optional() }).strict();
export const listInput = z.object({ taskId: id.optional(), executionId: id.optional(), sourceChatSessionId: id.optional(), sourceEventId: id.optional(), query: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional(), includeSuperseded: z.boolean().optional() }).strict();
export const saveInput = z.object({ requestId, body: z.string(), sourceChatSessionId: id.optional(), sourceEventId: id.optional(), title: z.string().optional(), attachments: z.array(attachment).optional(), links: z.array(z.discriminatedUnion('kind', [z.object({ kind: z.literal('url'), label: id, url: z.url() }).strict(), z.object({ kind: z.literal('preview'), label: id, previewTargetId: id }).strict()])).optional(), attention: z.string().optional(), taskIds: z.array(id).optional(), supersedesId: id.optional() }).strict();
export const prepareInput = z.object({ requestId, sourceChatSessionId: id, sourceEventId: id.optional(), resultId: id.optional() }).strict();
export const cancelPreparationInput = z.object({ messageId: id }).strict();
export const decisionInput = z.object({ id, requestId, disposition: z.enum(['accepted', 'changes_requested', 'dismissed']), note: z.string().optional(), context: z.object({ reviewId: id.optional(), attachmentFileName: id.optional(), previewTargetId: id.optional() }).strict().optional(), attachments: z.array(attachment).optional() }).strict();
export const completeInput = z.object({ id, requestId, taskId: id.optional(), expectedStatusChangedCount: z.number().int().nonnegative(), note: z.string().optional(), acknowledgedChildIds: z.array(id).optional(), runtimeChoice: z.enum(['keep_running', 'stop_running_agent']).optional(), acknowledgedExecutionIds: z.array(id).optional() }).strict();
export const retryFeedbackInput = z.object({ id, reviewId: id }).strict();
export const requestReviewInput = z.object({ id, requestId, focus: z.string().optional(), harness: z.enum(KNOWN_HARNESS_IDS).optional(), model: id.optional(), variant: id.nullable().optional(), effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable().optional(), rerun: z.boolean().optional() }).strict();
export const previewInput = z.object({ id, targetId: id }).strict();
export const openPreviewInput = previewInput.extend({ remote: z.boolean().optional() });

/** Shared domain boundary. REST and tRPC supply the same verified headers. */
async function operation<T>(work: () => T | Promise<T>) {
  try { return reply(await work()); }
  catch (error) { return failureResponse(workResultErrorResponse(error)); }
}
function actor(context: OperationContext, method: 'GET' | 'POST' | 'PATCH') {
  return workResultActorFromRequest({ ...context, method });
}

export async function capabilities(_input: Record<string, never>, _context: OperationContext) {
  return reply(getWorkResultCapabilities());
}
export async function setCapabilities(input: z.infer<typeof capabilitiesInput>, context: OperationContext) {
  return operation(async () => {
    if (actor(context, 'PATCH').source !== 'human') throw new ActionError('unsupported', 'Only the human owner can change pilot capabilities.');
    const result = setWorkResultCapabilities(input);
    const { reconcileWorkResultCapabilities } = await import('@/lib/work-results/runtime');
    await reconcileWorkResultCapabilities();
    return result;
  });
}
export async function list(input: z.infer<typeof listInput>, context: OperationContext) {
  return operation(() => listWorkResults(input, actor(context, 'GET').userId));
}
export async function get(input: z.infer<typeof resultIdInput>, context: OperationContext) {
  return operation(async () => {
    const caller = actor(context, 'GET');
    const result = getWorkResult(input.id, caller.userId);
    if (!result) throw new ActionError('not_found', 'Result not found.');
    const { getWorkResultFeedbackDelivery } = await import('@/lib/work-results/runtime');
    const workspace = getAssociatedWorkResultWorkspace(result);
    const associatedWorkspace = workspace ? { id: workspace.id, name: workspace.name, reviewDefaults: workspace.reviewDefaults, reviewBeforeHandoff: workspace.reviewBeforeHandoff } : null;
    return { ...result, associatedWorkspace, completionOptions: getWorkResultCompletionOptions(input.id, caller.userId), feedbackDelivery: Object.fromEntries(result.reviews.map((decision) => [decision.id, getWorkResultFeedbackDelivery(caller, decision)])) };
  });
}
export async function save(input: z.infer<typeof saveInput>, context: OperationContext) {
  return operation(async () => {
    const caller = actor(context, 'POST');
    const value = saveWorkResultSchema.parse(input);
    const previous = getWorkResult(workResultRequestScopedId('report_result', caller, value.requestId), caller.userId);
    if (!previous) assertHandoffsEnabled();
    const sourceId = value.sourceChatSessionId ?? caller.sessionId;
    const codeRevision = previous ? undefined : await observeWorkResultCodeRevision(sourceId, caller.userId);
    const automaticReview = previous ? undefined : await prepareAutomaticWorkResultReview(caller, sourceId);
    const saved = createWorkResult(caller, value, { sourceChatSessionId: value.sourceChatSessionId, sourceEventId: value.sourceEventId, codeRevision, automaticReview });
    if (!saved.idempotentReplay) void dispatchAutomaticWorkResultReviews(value.sourceChatSessionId).catch(() => {});
    return { resultId: saved.result.id, url: `/results/${saved.result.id}`, replayed: saved.idempotentReplay };
  });
}
export async function prepare(input: z.infer<typeof prepareInput>, context: OperationContext) {
  return operation(async () => {
    const { prepareWorkResultHandoff } = await import('@/lib/work-results/runtime');
    const prepared = await prepareWorkResultHandoff(actor(context, 'POST'), prepareWorkResultSchema.parse(input));
    return { ...prepared, replayed: prepared.idempotentReplay };
  });
}
export async function cancelPreparation(input: z.infer<typeof cancelPreparationInput>, context: OperationContext) {
  return operation(async () => (await import('@/lib/work-results/runtime')).cancelWorkResultPreparation(actor(context, 'POST'), input.messageId));
}
export async function decide({ id, ...input }: z.infer<typeof decisionInput>, context: OperationContext) {
  return operation(async () => {
    const { sendWorkResultFeedback } = await import('@/lib/work-results/runtime');
    return (await sendWorkResultFeedback(actor(context, 'POST'), { ...workResultDecisionSchema.parse(input), resultId: id })).review;
  });
}
export async function complete({ id, ...input }: z.infer<typeof completeInput>, context: OperationContext) {
  return operation(async () => (await import('@/lib/work-results/completion')).acceptAndCompleteWorkResult(actor(context, 'POST'), { ...input, resultId: id }));
}
export async function retryFeedback(input: z.infer<typeof retryFeedbackInput>, context: OperationContext) {
  return operation(async () => (await import('@/lib/work-results/runtime')).retryWorkResultFeedback(actor(context, 'POST'), { resultId: input.id, reviewId: input.reviewId }));
}
export async function requestReview({ id, ...input }: z.infer<typeof requestReviewInput>, context: OperationContext) {
  return operation(async () => {
    const { requestWorkResultAiReview } = await import('@/lib/work-results/runtime');
    const saved = await requestWorkResultAiReview(actor(context, 'POST'), { ...requestAiReviewSchema.parse(input), resultId: id });
    return { reviewId: saved.review.id, status: saved.review.status, url: `/results/${id}`, reused: saved.reused, replayed: saved.idempotentReplay };
  });
}
export async function review(input: z.infer<typeof reviewIdInput>, context: OperationContext) {
  return operation(async () => (await import('@/lib/work-results/runtime')).getWorkResultAiReviewActivity(actor(context, 'GET'), input.reviewId));
}
export async function cancelReview(input: z.infer<typeof reviewIdInput>, context: OperationContext) {
  return operation(async () => (await import('@/lib/work-results/runtime')).cancelWorkResultAiReview(actor(context, 'POST'), input.reviewId));
}
function authorizedTarget(context: OperationContext, input: z.infer<typeof previewInput>, method: 'GET' | 'POST') {
  const caller = actor(context, method);
  const result = getWorkResult(input.id, caller.userId);
  if (!result || !result.result.links.some((link) => link.kind === 'preview' && link.previewTargetId === input.targetId)) throw new ActionError('not_found', 'This result does not contain that preview.');
  const target = getPreviewTargetById(input.targetId);
  const execution = target ? getExecution(target.executionId) : null;
  if (!target || !execution || execution.userId !== caller.userId) throw new ActionError('not_found', 'The original preview is unavailable. The saved result and files remain readable.');
  return target;
}
export async function preview(input: z.infer<typeof previewInput>, context: OperationContext) {
  return operation(async () => {
    const target = authorizedTarget(context, input, 'GET');
    return (await import('@/lib/preview/service')).getPreviewState(target.executionId, target.service);
  });
}
export async function openPreview(input: z.infer<typeof openPreviewInput>, context: OperationContext) {
  return operation(async () => {
    const target = authorizedTarget(context, input, 'POST');
    return (await import('@/lib/preview/service')).resolvePreview(target.executionId, { service: target.service, remote: input.remote ?? false });
  });
}
