/** Results own durable intent. Existing sessions, runs and executor own execution. */
import { processState } from '@/lib/process-state';
import { localWorkResultSourceFolder } from './source-location';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  chatPlacement, getSendForEvent,
  createChatSession, createWorkResultDecision, createWorkResultAiReview, ensureHarnessSettings,
  ensureWorkResultOperationMessage, getChatEventById, getChatSessionWithExecution,
  getWorkResult, getWorkResultAiReview, getWorkResultAiReviewForSession, getWorkResultAuthorBrief,
  getWorkResultAuthorBriefEvent,
  getWorkResultObservedReviewerModel,
  getExecution,
  getRun, getTask, getUserState, getWorkspace, linkWorkResultAiReviewRuntime,
  listActiveWorkResultAiReviews, listChatEvents, listWorkResultOperationRuns, listWorkResults,
  publishWorkResultOperationState, workResultOperationForMessage, workResultOperationMetadata,
  workResultRequestScopedId,
  transitionWorkResultAiReview, transitionWorkResultOperationRun, withWorkResultRuntimeTransaction,
  validateWorkResultAttachments,
  requeueUnadmittedWorkResultFeedbackRun,
  reportWorkResultAiReview,
  observeWorkResultAiReviewScope,
} from '@/lib/db/queries';
import type {
  Attachment, EffortLevel, WorkResultActor, WorkResultAiReviewRecord, WorkResultDetail,
  WorkResultReviewScope, WorkResultReviewSelection, RunRecord, StoredAttachment,
  WorkResultDecisionRecord,
  WorkResultReviewProvenance,
} from '@/db/types';
import { getAssociatedWorkResultWorkspace, getWorkResultSourceWorkspace } from './reviewer-preferences';
import { resolveWorkResultGuidance, renderWorkResultGuidance } from './handoff-context';
import { builtInHandoffInstructions, handoffCliCommand } from './instructions';
import { preferredWorkResultReviewerSelection, reviewerPreferenceHarness } from './reviewer-selection-defaults';
import type { WorkspaceRecord } from '@/db/types';
import { ActionError } from '@/lib/orchestrator/types';
import { aiReviewEnabled, assertAiReviewEnabled, assertHandoffsEnabled, handoffsEnabled } from './capabilities';
import { getAppRoot } from '@/lib/config/paths';
import { getHarnessModelCatalog, resolveHarnessSelection } from '@/lib/harness/model-discovery';
import { harnessSupportsEffort } from '@/lib/harness/options';
import { getHarnessRuntime } from '@/lib/harness/runtime';
import { isHarnessId, type HarnessId } from '@/lib/harness/registry';
import { budgetGate } from '@/lib/runs/budget';
import { runWith } from '@/lib/runs/artifact-bucket';
import { withApiLease } from '@/lib/runs/rate-lease';
import { listForSession, rejectAllForSession } from '@/lib/executor/pending-input';
import { RESULT_REVIEW_METHOD } from './review-method';
import { isImportMirror } from '@/lib/import/mirror';
import type { WorkResultOperationMetadata } from '@/lib/db/work-result-runtime-queries';

const execFileAsync = promisify(execFile);
const inFlight = processState('work-results.dispatches', () => new Set<string>());
const sessionDispatches = processState('work-results.session-dispatches', () => new Set<string>());

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, canonical(v)]));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function operationId(actor: WorkResultActor, namespace: string, requestId: string): string {
  return workResultRequestScopedId(namespace, actor, requestId);
}

function accessibleResult(actor: WorkResultActor, id: string): WorkResultDetail {
  const detail = getWorkResult(id, actor.userId);
  if (!detail) throw new ActionError('not_found', 'Result not found.');
  return detail;
}

function authoringDestination(actor: WorkResultActor, sessionId: string | null | undefined) {
  if (!sessionId) throw new ActionError('unsupported', 'This result has no available authoring conversation. You can still inspect and save existing output.');
  const session = getChatSessionWithExecution(sessionId);
  if (!session || session.userId !== actor.userId) throw new ActionError('not_found', 'The authoring conversation is unavailable.');
  if (session.surfaceKind === 'result_review') throw new ActionError('unsupported', 'Feedback and preparation must target the producing conversation.');
  if (session.status === 'archived' || session.execution?.status === 'archived') throw new ActionError('conflict', 'Resume the authoring conversation before requesting more work.');
  if (isImportMirror(session)) throw new ActionError('conflict', 'The authoring conversation is currently read-only. Existing output can still be saved.');
  return session;
}

function delivery(run: RunRecord) {
  const op = workResultOperationMetadata(run.triggerPayload);
  return { status: run.status, statusReason: run.statusReason, sessionId: run.chatSessionId,
    messageId: op?.messageId ?? null, runId: run.id, errorCode: run.errorCode, errorMessage: run.errorMessage };
}

export async function prepareWorkResultHandoff(actor: WorkResultActor, input: {
  requestId: string; sourceChatSessionId: string; sourceEventId?: string; resultId?: string;
}) {
  const messageId = operationId(actor, 'handoff_preparation_message', input.requestId);
  const runId = operationId(actor, 'handoff_preparation_run', input.requestId);
  const requestHash = hash(input);
  const prior = getChatEventById(messageId);
  const priorRun = getRun(runId);
  if (prior || priorRun) {
    const meta = workResultOperationMetadata(priorRun?.triggerPayload) ?? workResultOperationMetadata(prior?.raw);
    if (meta?.requestHash !== requestHash || (prior && prior.sessionId !== input.sourceChatSessionId)) {
      throw new ActionError('conflict', 'This preparation request key already names different work.');
    }
    if (!priorRun) throw new ActionError('conflict', 'Preparation activity has been pruned. Use a deliberate new request.');
    return { ...delivery(priorRun), idempotentReplay: true, resultId: meta.resultId ?? null };
  }
  assertHandoffsEnabled();
  const session = authoringDestination(actor, input.sourceChatSessionId);
  const pending = listWorkResultOperationRuns().find((run) => {
    const meta = workResultOperationMetadata(run.triggerPayload);
    return run.chatSessionId === session.id && meta?.kind === 'handoff_preparation'
      && meta.actorUserId === actor.userId && meta.resultId === (input.resultId ?? null)
      && meta.sourceEventId === (input.sourceEventId ?? null);
  });
  if (pending) return { ...delivery(pending), idempotentReplay: true, resultId: input.resultId ?? null };
  const existingResult = input.resultId ? accessibleResult(actor, input.resultId) : null;
  if (existingResult && existingResult.result.sourceChatSessionId !== session.id) {
    throw new ActionError('invalid_params', 'Update handoff must continue its recorded authoring conversation.');
  }
  if (existingResult?.successorId) throw new ActionError('conflict', 'A newer handoff already exists. Open that exact result before updating.');
  const source = input.sourceEventId ? getChatEventById(input.sourceEventId) : null;
  if (input.sourceEventId && (!source || source.sessionId !== session.id || source.source !== 'agent')) {
    throw new ActionError('not_found', 'The selected authoring output is unavailable.');
  }
  // A missing handoff recovery can reuse the exact saved output without another turn.
  if (!input.resultId && source) {
    const same = listWorkResults({ sourceChatSessionId: session.id, sourceEventId: source.id,
      includeSuperseded: true, limit: 1 }, actor.userId)[0];
    if (same) return { sessionId: session.id, messageId: null, runId: null, status: 'completed' as const,
      statusReason: 'handoff_exists', idempotentReplay: true, resultId: same.id };
  }
  const prompt = [
    'Prepare a durable handoff for the selected work. Explain what changed or was produced, gather useful existing evidence, and identify important limitations and decisions. Make relevant existing files or preview accessible. Reuse checks and artifacts. Do not redo implementation merely to fill a handoff. This request does not ask for independent AI critique.',
    'The handoff context for this assignment is supplied below. Use this captured guidance for this request without fetching a replacement.',
    builtInHandoffInstructions(),
    renderWorkResultGuidance(resolveWorkResultGuidance(actor.userId,
      getWorkResultSourceWorkspace(actor.userId, session.id, session.executionId))),
    `Finish by calling report_result with request_id ${JSON.stringify(input.requestId)}.`,
    ...(existingResult ? [`Update only exact result ${existingResult.result.id}, using supersedes_id ${existingResult.result.id}. Preserve the existing snapshot. Create a successor only for meaningful changed content.\n\nExisting handoff:\n${existingResult.result.body}`] : []),
    ...(source ? [`Selected source output ${source.id}:\n${source.content ?? ''}`] : []),
  ].join('\n\n');
  const meta: WorkResultOperationMetadata = { kind: 'handoff_preparation', requestId: input.requestId,
    requestHash, actorUserId: actor.userId, actorSessionId: actor.sessionId ?? null,
    messageId, resultId: input.resultId ?? null, sourceEventId: input.sourceEventId ?? null };
  const saved = ensureWorkResultOperationMessage(actor, { id: messageId, runId, sessionId: session.id,
    content: prompt, attachments: source?.attachments ?? [], metadata: meta });
  void dispatchQueuedWorkResultOperations(session.id);
  return { ...delivery(saved.run), idempotentReplay: saved.idempotentReplay, resultId: input.resultId ?? null };
}

export async function sendWorkResultFeedback(actor: WorkResultActor, input: {
  requestId: string; resultId: string; disposition: 'accepted' | 'changes_requested' | 'dismissed';
  note?: string; context?: NonNullable<WorkResultDecisionRecord['context']>; attachments?: Attachment[];
}) {
  const detail = accessibleResult(actor, input.resultId);
  const priorReview = detail.reviews.find((review) => review.id === operationId(actor, 'result_disposition', input.requestId));
  if (priorReview) {
    // Query replay checks the original submitted intent before inspecting a
    // removed source, retained file or disabled capability.
    const saved = createWorkResultDecision(actor, input);
    if (saved.review.feedbackSessionId) void dispatchQueuedWorkResultOperations(saved.review.feedbackSessionId);
    return { ...saved, delivery: getWorkResultFeedbackDelivery(actor, saved.review) };
  }
  if (input.disposition !== 'changes_requested') {
    const saved = createWorkResultDecision(actor, input);
    return { ...saved, delivery: null };
  }
  if (!input.note?.trim()) throw new ActionError('invalid_params', 'Request changes requires feedback.');
  const uploaded = validateWorkResultAttachments(input.note, input.attachments ?? [], actor.userId);
  if (input.context?.reviewId) {
    const review = getWorkResultAiReview(input.context.reviewId, actor.userId);
    if (review?.resultId !== detail.result.id) throw new ActionError('invalid_params', 'The selected AI findings belong to another result.');
  }
  if (input.context?.attachmentFileName && ![...(detail.result.attachments ?? []), ...uploaded]
    .some((file) => file.fileName === input.context!.attachmentFileName)) {
    throw new ActionError('invalid_params', 'The selected file is not attached to this result or feedback.');
  }
  if (input.context?.previewTargetId && !detail.result.links.some((link) => link.kind === 'preview' && link.previewTargetId === input.context!.previewTargetId)) {
    throw new ActionError('invalid_params', 'The selected preview is not part of this result.');
  }
  const messageId = operationId(actor, 'result_feedback_message', input.requestId);
  const runId = operationId(actor, 'result_feedback_run', input.requestId);
  const prior = getChatEventById(messageId);
  const requestHash = hash(input);
  if (!prior) assertHandoffsEnabled();
  const destinationId = prior?.sessionId ?? detail.result.sourceChatSessionId;
  const session = destinationId ? getChatSessionWithExecution(destinationId) : null;
  if (session && (session.userId !== actor.userId || session.surfaceKind === 'result_review')) throw new ActionError('not_found', 'The feedback destination is unavailable.');
  if (!session) {
    const saved = createWorkResultDecision(actor, input);
    return { ...saved, delivery: { status: 'failed', statusReason: 'target_unavailable',
      sessionId: null, messageId: null, runId: null } };
  }
  const prompt = [
    `The user requests changes to exact saved result ${input.resultId} (/results/${input.resultId}).`,
    `Saved handoff:\n${detail.result.body}`, `User feedback:\n${input.note.trim()}`,
    ...(input.context !== undefined ? [`Selected inspection context:\n${JSON.stringify(input.context)}`] : []),
    'Respond in this producing conversation. Preserve the prior handoff. If you materially update the deliverable, save a successor naming its exact supersedes_id. Do not accept work or complete a task on behalf of the user.',
  ].join('\n\n');
  const meta: WorkResultOperationMetadata = { kind: 'result_feedback', requestId: input.requestId,
    requestHash, actorUserId: actor.userId, actorSessionId: actor.sessionId ?? null, messageId, resultId: input.resultId };
  const saved = withWorkResultRuntimeTransaction(() => {
    const disposition = createWorkResultDecision(actor, { ...input, feedbackSessionId: session.id, feedbackMessageId: messageId });
    const operation = ensureWorkResultOperationMessage(actor, { id: messageId, runId, sessionId: session.id,
      content: prompt, attachments: [...(detail.result.attachments ?? []), ...uploaded], metadata: meta });
    return { ...disposition, operation };
  });
  void dispatchQueuedWorkResultOperations(session.id);
  return { review: saved.review, idempotentReplay: saved.idempotentReplay, delivery: delivery(saved.operation.run) };
}

export interface WorkResultReviewRequestInput {
  requestId: string; resultId: string; focus?: string; harness?: HarnessId; model?: string;
  variant?: string | null; effort?: EffortLevel | null; rerun?: boolean;
}

/** Explicit settings fail closed. Inherited cross-harness settings never form a mixed tuple. */
export async function resolveWorkResultReviewerSelection(input: WorkResultReviewRequestInput, cwd: string, context?: WorkResultDetail | WorkspaceRecord): Promise<WorkResultReviewSelection> {
  const defaults = getUserState();
  const agent = context ? ('result' in context ? getAssociatedWorkResultWorkspace(context) : context) : null;
  const harness = reviewerPreferenceHarness(input, agent?.reviewDefaults, defaults);
  if (!isHarnessId(harness)) throw new ActionError('unsupported', `Harness ${harness} is unavailable.`);
  const settings = ensureHarnessSettings(harness);
  const preferred = preferredWorkResultReviewerSelection(input, agent?.reviewDefaults, defaults, settings);
  try {
    const selection = await resolveHarnessSelection(harness, preferred, { cwd, repairInvalidModel: false });
    if (preferred.effort != null && (!harnessSupportsEffort(harness) || selection.effort !== preferred.effort)) {
      throw new Error(`Effort ${preferred.effort} is unavailable for ${harness} model ${selection.model}. Choose a compatible effort before reviewing.`);
    }
    if (preferred.variant != null && selection.variant !== preferred.variant) {
      throw new Error(`Variant ${preferred.variant} is unavailable for ${harness} model ${selection.model}. Choose a compatible variant before reviewing.`);
    }
    const model = (await getHarnessModelCatalog(harness, { cwd })).find((entry) => entry.id === selection.model);
    if (preferred.effort != null && model?.supportedEfforts && !model.supportedEfforts.includes(preferred.effort)) {
      throw new Error(`Effort ${preferred.effort} is unavailable for model ${selection.model}. Choose a compatible effort before reviewing.`);
    }
    return { harness, model: selection.model, variant: selection.variant, effort: selection.effort,
      explicit: { ...(input.harness !== undefined ? { harness: input.harness } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.variant !== undefined ? { variant: input.variant } : {}),
        ...(input.effort !== undefined ? { effort: input.effort } : {}) } };
  } catch (error) {
    throw new ActionError('unsupported', error instanceof Error ? error.message : 'Reviewer selection is unavailable.');
  }
}

function storedAttachments(files: Attachment[] | null): StoredAttachment[] {
  return (files ?? []).map((file) => ({ file_name: file.fileName, original_name: file.originalName,
    mime_type: file.mimeType, size: file.size, uploaded_at: file.uploadedAt }));
}

export async function captureWorkResultReviewScope(detail: WorkResultDetail): Promise<WorkResultReviewScope> {
  const result = detail.result;
  const session = result.sourceChatSessionId ? getChatSessionWithExecution(result.sourceChatSessionId) : null;
  const execution = result.sourceExecutionId ? getExecution(result.sourceExecutionId) : null;
  const sourceWorkspace = getWorkResultSourceWorkspace(result.userId, result.sourceChatSessionId, result.sourceExecutionId);
  const worktreePath = localWorkResultSourceFolder(session, execution, sourceWorkspace);
  let repository: string | null = null;
  const limitations: string[] = [];
  if (result.sourceExecutionId && (!worktreePath || !existsSync(worktreePath))) limitations.push('The producing execution directory is unavailable.');
  if (worktreePath && existsSync(worktreePath)) repository = realpathSync(worktreePath);
  else if (session?.workspaceId && !session.executionId && chatPlacement(session.id)?.isHome !== false) {
    const workspace = getWorkspace(session.workspaceId);
    if (workspace && existsSync(workspace.cwd)) repository = realpathSync(workspace.cwd);
  }
  if (result.codeRevision && result.codeRevision.workingTreeState !== 'clean' && !result.codeRevision.checkpointRef) {
    limitations.push('No exact clean revision or working-copy checkpoint binds the saved code. Live working-copy inspection cannot establish exact freshness.');
  }
  if (result.links.length) limitations.push('Live links and previews may change after capture.');
  const original = result.sourceChatSessionId ? getWorkResultAuthorBriefEvent(result.sourceChatSessionId,
    result.sourceEventId, result.createdAt) : null;
  const taskFiles = detail.taskIds.flatMap((id) => getTask(id)?.attachments ?? []);
  const retained = new Map([...(result.attachments ?? []), ...(original?.attachments ?? []), ...taskFiles]
    .map((file) => [file.fileName, file]));
  const scope: WorkResultReviewScope = { requested: { resultId: result.id, repository, baseSha: session?.baseSha ?? execution?.baseSha ?? null,
    codeRevision: result.codeRevision, attachments: storedAttachments([...retained.values()]),
    capturedAt: new Date().toISOString(), limitations } };
  scope.observed = await observeWorkResultReviewScope({ scope });
  return scope;
}

/** Evidence can be reused only for the exact known version and requested reviewer/focus. */
export function compatibleWorkResultReviewEvidence(
  review: WorkResultAiReviewRecord, scope: WorkResultReviewScope, selection: WorkResultReviewSelection, focus?: string,
): boolean {
  if (review.status !== 'completed' || !review.reportResultId || review.provenance.independence !== 'observed'
    || review.focus !== (focus?.trim() || null) || review.scope.requested.resultId !== scope.requested.resultId) return false;
  const tuple = (value: WorkResultReviewSelection) => [value.harness, value.model, value.variant, value.effort];
  if (hash(tuple(review.selection)) !== hash(tuple(selection))) return false;
  if (review.scope.requested.repository !== scope.requested.repository
    || review.scope.requested.baseSha !== scope.requested.baseSha
    || hash(review.scope.requested.attachments) !== hash(scope.requested.attachments)) return false;
  if (!scope.requested.codeRevision) return !review.scope.requested.codeRevision && !scope.requested.repository;
  const expected = scope.requested.codeRevision;
  const prior = review.scope.observed?.codeRevision;
  const now = scope.observed?.codeRevision;
  // Dirty copies without an exact checkpoint never establish compatible fresh code evidence.
  return expected.workingTreeState === 'clean' && !!expected.commitSha
    && prior?.workingTreeState === 'clean' && now?.workingTreeState === 'clean'
    && prior.commitSha === expected.commitSha && now.commitSha === expected.commitSha
    && review.scope.observed?.drift === false && scope.observed?.drift === false;
}

export function buildWorkResultReviewBrief(detail: WorkResultDetail, scope: WorkResultReviewScope, focus?: string): string {
  const source = detail.result.sourceChatSessionId ? getWorkResultAuthorBrief(detail.result.sourceChatSessionId,
    detail.result.sourceEventId, detail.result.createdAt) : null;
  const tasks = detail.taskIds.map((id) => getTask(id)).filter((task) => !!task);
  return [ RESULT_REVIEW_METHOD,
    renderWorkResultGuidance(resolveWorkResultGuidance(detail.result.userId, getAssociatedWorkResultWorkspace(detail))),
    `Exact target result: ${detail.result.id} (/results/${detail.result.id}).`,
    `Original request:\n${source ?? 'The original conversation request is unavailable. Assess the retained handoff and explicitly linked task requirements, and disclose this limitation.'}`,
    ...tasks.map((task) => `Linked task requirements: ${task!.title}\n${task!.body ?? ''}`),
    ...(focus?.trim() ? [`Requested focus:\n${focus.trim()}`] : []),
    `Saved handoff:\n${detail.result.body}`,
    `Durable files:\n${(detail.result.attachments ?? []).map((file) => `${file.originalName}: [[file:${file.fileName}]]`).join('\n') || 'No retained files.'}`,
    `Retained request and task files:\n${scope.requested.attachments.map((file) => `${file.original_name}: [[file:${file.file_name}]]`).join('\n') || 'No additional retained files.'}`,
    `Saved links:\n${JSON.stringify(detail.result.links)}`,
    `Requested inspection scope:\n${JSON.stringify(scope.requested)}`,
    'Inspect the actual material, record what you inspected, and keep requested and observed scope distinct. A missing original brief, unavailable code, dirty-unbound revision or mutable preview is a limitation, not proof that the current work matches this snapshot.',
  ].join('\n\n');
}

export function assignedWorkResultReviewBrief(detail: WorkResultDetail, scope: WorkResultReviewScope, reviewId: string, requestId: string, mcpSupported: boolean, focus?: string): string {
  const completion = mcpSupported
    ? `Finish by calling report_result_review with review_id ${JSON.stringify(reviewId)} and request_id ${JSON.stringify(`${requestId}:report`)}. When the results MCP is attached, use its report_result_review tool. The exact CLI path is ${handoffCliCommand()} agent report_result_review --input '<JSON object>'. Include request_id, review_id and body as an inline JSON object. No temporary file is required.`
    : `This harness has no supported host MCP attachment. Finish by returning only one JSON object, with no Markdown fence or other text: ${JSON.stringify({ ri_result_review_report: 'v1', request_id: `${requestId}:report`, review_id: reviewId, body: 'Your complete Markdown review report, including findings and inspection limitations.' })}. Keep the marker and assigned IDs exact. Put the complete review inside body. Ri reads this explicitly assigned completion envelope and saves it on the server. Do not run the CLI or make a network request to submit this report.`;
  return `${buildWorkResultReviewBrief(detail, scope, focus)}\n\nAssigned review_id: ${reviewId}. ${completion} The app server owns report persistence, so this does not authorize writing the implementation checkout or leaving read-only mode. Report only this assigned target. Do not use report_result.`;
}

/** One shared deterministic runtime binding for manual and saved automatic requests. */
export function bindWorkResultReviewRuntime(actor: WorkResultActor, review: WorkResultAiReviewRecord, requestId: string, detail: WorkResultDetail, rerun = false): string {
  const sessionId = operationId(actor, 'result_review_session', requestId);
  if (review.reviewerSessionId && review.runId) return review.reviewerSessionId;
  if (review.status !== 'queued' || !review.brief || !review.selection.harness) throw new ActionError('conflict', 'This saved review is not eligible for runtime binding.');
  const messageId = operationId(actor, 'result_review_message', requestId);
  const runId = operationId(actor, 'result_review_run', requestId);
  const source = detail.result.sourceChatSessionId ? getChatSessionWithExecution(detail.result.sourceChatSessionId) : null;
  const execution = detail.result.sourceExecutionId ? getExecution(detail.result.sourceExecutionId) : null;
  withWorkResultRuntimeTransaction(() => {
    const current = getWorkResultAiReview(review.id, actor.userId);
    if (current?.reviewerSessionId && current.runId) return;
    if (current?.status !== 'queued') throw new ActionError('conflict', 'This review is no longer queued.');
    createChatSession({ id: sessionId, userId: actor.userId, harness: review.selection.harness!, type: 'execution',
      surfaceKind: 'result_review', surfaceRef: review.id, label: 'AI review',
      workspaceId: source?.workspaceId ?? execution?.workspaceId ?? null,
      executionId: null,
      permissionMode: 'plan', model: review.selection.model, modelVariant: review.selection.variant, effort: review.selection.effort });
    ensureWorkResultOperationMessage(actor, { id: messageId, runId, sessionId, content: review.brief!,
      attachments: review.scope.requested.attachments.map((file) => ({ fileName: file.file_name,
        originalName: file.original_name, mimeType: file.mime_type, size: file.size, uploadedAt: file.uploaded_at })), metadata: {
        kind: 'result_ai_review', requestId, requestHash: review.requestHash, actorUserId: actor.userId,
        actorSessionId: actor.sessionId ?? null, messageId, resultId: detail.result.id, reviewId: review.id, rerun,
      } });
    linkWorkResultAiReviewRuntime(review.id, { reviewerSessionId: sessionId, runId }, actor.userId);
  });
  return sessionId;
}

export async function requestWorkResultAiReview(actor: WorkResultActor, input: WorkResultReviewRequestInput) {
  const detail = accessibleResult(actor, input.resultId);
  if (actor.sessionId && getWorkResultAiReviewForSession(actor.sessionId, actor.userId)) {
    throw new ActionError('unsupported', 'A reviewer cannot launch another reviewer. Report your assigned review.');
  }
  // Preserve resolved choices on retry before resolving changed defaults or reading live code.
  const intent = { resultId: input.resultId, focus: input.focus?.trim() || null,
    harness: input.harness, model: input.model, variant: input.variant, effort: input.effort, rerun: !!input.rerun };
  const reviewId = operationId(actor, 'request_result_review', input.requestId);
  const prior = getWorkResultAiReview(reviewId, actor.userId);
  if (prior) {
    // Storage owns the canonical intent check, including replay-before-gate.
    const replay = createWorkResultAiReview(actor, { ...input, selection: prior.selection, scope: prior.scope,
      provenance: prior.provenance, brief: prior.brief ?? '', requestIntent: intent });
    const reusedId = prior.provenance.reusedReviewId;
    const canonical = reusedId ? getWorkResultAiReview(reusedId, actor.userId) : null;
    return canonical ? { ...replay, review: canonical } : replay;
  }
  assertAiReviewEnabled();
  const scope = await captureWorkResultReviewScope(detail);
  const cwd = scope.requested.repository ?? getAppRoot();
  const selection = await resolveWorkResultReviewerSelection(input, cwd, detail);
  const runtime = await getHarnessRuntime(selection.harness!, { cwd });
  if (!runtime.capabilities.sessions.supported || !runtime.capabilities.planMode.supported) {
    throw new ActionError('unsupported', runtime.capabilities.sessions.reason ?? 'The selected reviewer cannot safely inspect this work in a fresh read-only session.');
  }
  if ((selection.effort && runtime.capabilities.reasoningEffort?.supported === false)
    || (selection.variant && runtime.capabilities.modelVariants?.supported === false)) {
    throw new ActionError('unsupported', 'The selected harness cannot apply these reviewer settings. Choose compatible settings before reviewing.');
  }
  const brief = assignedWorkResultReviewBrief(detail, scope, reviewId, input.requestId, !!runtime.capabilities.mcp?.supported, input.focus);
  const existingEvidence = !input.rerun
    ? detail.aiReviews.find((review) => compatibleWorkResultReviewEvidence(review, scope, selection, input.focus)) : null;
  assertAiReviewEnabled();
  const saved = withWorkResultRuntimeTransaction(() => {
    const created = createWorkResultAiReview(actor, { ...input, selection, scope, brief,
      requestIntent: intent, provenance: { method: 'fresh_session', independence: 'unknown',
        limitations: ['The installed harness adapter has no supported native independent-review API. Ri uses a fresh read-only session.', 'Actual provider model and effort are unknown until observed.'] } });
    if (!created.reused && !created.idempotentReplay && existingEvidence) {
      // Retain this request identity and resolved selection without attaching
      // one report to two rows or leaving an active uniqueness slot occupied.
      transitionWorkResultAiReview(created.review.id, ['queued'], 'cancelled', {
        statusReason: 'reused_existing_review', provenance: { ...created.review.provenance,
          reusedReviewId: existingEvidence.id },
      }, actor.userId);
      return { ...created, review: existingEvidence, reused: true };
    }
    return created;
  });
  if (saved.reused || saved.idempotentReplay) return saved;
  const review = saved.review;
  let sessionId: string;
  try {
    sessionId = bindWorkResultReviewRuntime(actor, review, input.requestId, detail, !!input.rerun);
  } catch (error) {
    transitionWorkResultAiReview(review.id, ['queued'], 'failed', { statusReason: 'dispatch_failed' }, actor.userId);
    throw error;
  }
  void dispatchQueuedWorkResultOperations(sessionId);
  return { ...saved, review: getWorkResultAiReview(review.id, actor.userId)! };
}

const reviewerCompletionEnvelope = z.object({
  ri_result_review_report: z.literal('v1'), request_id: z.string().min(1),
  review_id: z.string().min(1), body: z.string().refine((value) => !!value.trim(), 'Report body is required'), title: z.string().optional(),
}).strict();

/** An explicit assigned transport for adapters without MCP, never ordinary final-answer classification. */
export async function completeWorkResultReviewFromTurn(sessionId: string, summary: string | null): Promise<boolean> {
  const session = getChatSessionWithExecution(sessionId);
  if (!session || session.surfaceKind !== 'result_review' || !summary) return false;
  const review = getWorkResultAiReviewForSession(sessionId, session.userId);
  const run = review?.runId ? getRun(review.runId) : null;
  const op = workResultOperationMetadata(run?.triggerPayload);
  if (!review || session.surfaceRef !== review.id || !op || op.kind !== 'result_ai_review'
    || op.reviewId !== review.id || run?.chatSessionId !== sessionId) return false;
  let value: unknown;
  try { value = JSON.parse(summary); } catch { return false; }
  const parsed = reviewerCompletionEnvelope.safeParse(value);
  if (!parsed.success || parsed.data.review_id !== review.id || parsed.data.request_id !== `${op.requestId}:report`) return false;
  const observation = review.status === 'running' ? await observeWorkResultReviewScope(review) : undefined;
  if (review.status === 'running') observeWorkResultReviewProvenance(review);
  reportWorkResultAiReview({ userId: session.userId, source: 'ai', sessionId, runId: run.id }, {
    requestId: parsed.data.request_id, reviewId: review.id,
    body: parsed.data.body, ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
  }, observation);
  return true;
}

/** Recheck exact clean scope at admission and after asynchronous provider startup. */
export async function verifyQueuedWorkResultReviewScope(runId: string): Promise<boolean> {
  const run = getRun(runId);
  const op = workResultOperationMetadata(run?.triggerPayload);
  if (!run || !['queued', 'running'].includes(run.status) || !op) return false;
  if (op.kind !== 'result_ai_review' || !op.reviewId) return true;
  const review = getWorkResultAiReview(op.reviewId, op.actorUserId);
  if (!review || !['queued', 'running'].includes(review.status)) return false;
  const expected = review.scope.requested.codeRevision;
  if (!expected?.commitSha || expected.workingTreeState !== 'clean') return true;
  const observation = await observeWorkResultReviewScope(review);
  if (observation) observeWorkResultAiReviewScope(review.id, observation, op.actorUserId);
  if (observation?.drift !== true) return true;
  transitionWorkResultOperationRun(run.id, ['queued', 'running'], 'failed', { statusReason: 'target_changed' });
  transitionWorkResultAiReview(review.id, ['queued', 'running'], 'failed', { statusReason: 'target_changed',
    provenance: { ...review.provenance, limitations: [...(review.provenance.limitations ?? []),
      'The requested clean code revision no longer matches the live directory. This request did not inspect a different revision.'] } }, op.actorUserId);
  publishWorkResultOperationState(run.id);
  return false;
}

/** Final provider-boundary admission, called after discovery and immediately before spawn/send. */
export function admitWorkResultOperationDispatch(runId: string, sessionId: string, isAuthorRunning?: (id: string) => boolean): boolean {
  return withWorkResultRuntimeTransaction(() => {
    const run = getRun(runId);
    const op = workResultOperationMetadata(run?.triggerPayload);
    if (!run || !op || run.chatSessionId !== sessionId || run.status !== 'queued') return false;
    const session = getChatSessionWithExecution(sessionId);
    if (!session || session.userId !== op.actorUserId || session.status !== 'active'
      || session.execution?.status === 'archived' || isImportMirror(session)) {
      transitionWorkResultOperationRun(runId, ['queued'], 'failed', { statusReason: 'target_unavailable' });
      if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'failed', { statusReason: 'target_unavailable' }, op.actorUserId);
      publishWorkResultOperationState(runId);
      return false;
    }
    const enabled = op.kind === 'result_feedback' || (op.kind === 'result_ai_review' ? aiReviewEnabled() : handoffsEnabled());
    if (!enabled) {
      transitionWorkResultOperationRun(runId, ['queued'], 'cancelled', { statusReason: 'feature_disabled' });
      if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'cancelled', { statusReason: 'feature_disabled' }, op.actorUserId);
      publishWorkResultOperationState(runId);
      return false;
    }
    if (budgetGate() === 'block') {
      transitionWorkResultOperationRun(runId, ['queued'], 'failed', { statusReason: 'budget_exceeded' });
      if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'failed', { statusReason: 'budget_exceeded' }, op.actorUserId);
      publishWorkResultOperationState(runId);
      return false;
    }
    if (op.reviewId) {
      const review = getWorkResultAiReview(op.reviewId, op.actorUserId);
      if (!review || review.status !== 'queued' || review.reviewerSessionId !== sessionId || review.runId !== runId) return false;
      const target = getWorkResult(review.resultId, op.actorUserId);
      if (!target || target.successorId) {
        transitionWorkResultOperationRun(runId, ['queued'], 'failed', { statusReason: 'target_superseded' });
        transitionWorkResultAiReview(review.id, ['queued'], 'failed', { statusReason: 'target_superseded' }, op.actorUserId);
        return false;
      }
      if (review.provenance.automaticWorkspaceId) {
        const preference = getWorkspace(review.provenance.automaticWorkspaceId);
        if (preference?.reviewBeforeHandoff !== true) {
          transitionWorkResultOperationRun(run.id, ['queued'], 'cancelled', { statusReason: 'preference_disabled' });
          transitionWorkResultAiReview(review.id, ['queued'], 'cancelled', { statusReason: 'preference_disabled' }, op.actorUserId);
          return false;
        }
        if (target.result.sourceChatSessionId && isAuthorRunning?.(target.result.sourceChatSessionId)) {
          transitionWorkResultOperationRun(run.id, ['queued'], 'queued', { statusReason: 'waiting_for_author' });
          publishWorkResultOperationState(run.id);
          return false;
        }
      }
      // Recheck for compatible completed evidence before occupying a running slot.
      const compatible = !op.rerun && target.aiReviews.find((other) => other.id !== review.id
        && compatibleWorkResultReviewEvidence(other, review.scope, review.selection, review.focus ?? undefined));
      if (compatible) {
        transitionWorkResultAiReview(review.id, ['queued'], 'cancelled', { statusReason: 'reused_existing_review',
          provenance: { ...review.provenance, reusedReviewId: compatible.id } }, op.actorUserId);
        transitionWorkResultOperationRun(runId, ['queued'], 'cancelled', { statusReason: 'reused_existing_review' });
        return false;
      }
      if (!transitionWorkResultAiReview(review.id, ['queued'], 'running', { provenance: {
        ...review.provenance, method: 'fresh_session', independence: 'observed',
        observedHarness: session.harness, observedModel: null, observedEffort: null,
      } }, op.actorUserId)) return false;
    }
    const admitted = transitionWorkResultOperationRun(runId, ['queued'], 'running', { statusReason: null });
    publishWorkResultOperationState(runId);
    return !!admitted;
  });
}

/** Setup awaits do not authorize a cancelled operation to spawn or submit a message. */
export function canContinueWorkResultOperationDispatch(runId: string, sessionId: string, isAuthorRunning?: (id: string) => boolean): boolean {
  const run = getRun(runId);
  const op = workResultOperationMetadata(run?.triggerPayload);
  const session = getChatSessionWithExecution(sessionId);
  if (!run || run.status !== 'running' || run.chatSessionId !== sessionId || !op
    || !session || session.userId !== op.actorUserId || session.status !== 'active'
    || session.execution?.status === 'archived' || isImportMirror(session)) return false;
  if (!op.reviewId) return true;
  const review = getWorkResultAiReview(op.reviewId, op.actorUserId);
  const sourceId = review?.provenance.automaticWorkspaceId ? getWorkResult(review.resultId, op.actorUserId)?.result.sourceChatSessionId : null;
  if (sourceId && isAuthorRunning?.(sourceId)) {
    transitionWorkResultOperationRun(run.id, ['running'], 'failed', { statusReason: 'authoring_resumed' });
    if (review) transitionWorkResultAiReview(review.id, ['running'], 'failed', { statusReason: 'authoring_resumed' }, op.actorUserId);
    publishWorkResultOperationState(run.id);
    return false;
  }
  return review?.status === 'running' && review.runId === runId
    && review.reviewerSessionId === sessionId && session.surfaceRef === review.id;
}

export async function dispatchQueuedWorkResultOperations(sessionId?: string): Promise<void> {
  const executor = await import('@/lib/executor/adapter');
  for (const run of listWorkResultOperationRuns(['queued'])) {
    if (sessionId && run.chatSessionId !== sessionId) continue;
    const op = workResultOperationMetadata(run.triggerPayload)!;
    if (!run.chatSessionId) {
      transitionWorkResultOperationRun(run.id, ['queued'], 'failed', { statusReason: 'target_unavailable' });
      if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'failed', { statusReason: 'target_unavailable' }, op.actorUserId);
      continue;
    }
    if (inFlight.has(run.id)) continue;
    if (op.reviewId) {
      const review = getWorkResultAiReview(op.reviewId, op.actorUserId);
      const authorId = review?.provenance.automaticWorkspaceId ? getWorkResult(review.resultId, op.actorUserId)?.result.sourceChatSessionId : null;
      if (authorId && (executor.isRunning(authorId) || executor.hasBackgroundTasks?.(authorId))) continue;
    }
    if ((op.kind === 'result_ai_review' && !aiReviewEnabled()) || (op.kind === 'handoff_preparation' && !handoffsEnabled())) {
      admitWorkResultOperationDispatch(run.id, run.chatSessionId);
      continue;
    }
    const destination = getChatSessionWithExecution(run.chatSessionId);
    if (!destination || destination.status !== 'active' || destination.execution?.status === 'archived'
      || isImportMirror(destination)) {
      transitionWorkResultOperationRun(run.id, ['queued'], 'failed', { statusReason: 'target_unavailable' });
      if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'failed', { statusReason: 'target_unavailable' }, op.actorUserId);
      publishWorkResultOperationState(run.id);
      continue;
    }
    if (executor.isRunning(run.chatSessionId) || sessionDispatches.has(run.chatSessionId)) continue;
    const event = getChatEventById(op.messageId);
    if (!event) {
      transitionWorkResultOperationRun(run.id, ['queued'], 'failed', { statusReason: 'message_unavailable' });
      if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'failed', { statusReason: 'message_unavailable' }, op.actorUserId);
      continue;
    }
    inFlight.add(run.id);
    sessionDispatches.add(run.chatSessionId);
    void (async () => {
      try {
        await withApiLease(() => runWith(run.id, event.sessionId, () => executor.dispatch(event.sessionId, event.content ?? '',
          { internalCall: true, runId: run.id, sourceEventId: event.id, attachments: event.attachments ?? [], resultOperationRunId: run.id })));
        const current = getRun(run.id);
        if (op.kind === 'result_ai_review' && op.reviewId) {
          const review = getWorkResultAiReview(op.reviewId, op.actorUserId);
          if (review?.status === 'running') {
            const cancelled = current?.status === 'cancelled';
            transitionWorkResultAiReview(review.id, ['running'], cancelled ? 'cancelled' : 'failed',
              { statusReason: cancelled ? 'runtime_cancelled' : 'missing_report' }, op.actorUserId);
            if (!cancelled) transitionWorkResultOperationRun(run.id, ['queued', 'running', 'completed'], 'failed', { statusReason: 'missing_report' });
          } else if (review?.status === 'completed') transitionWorkResultOperationRun(run.id, ['running'], 'completed');
        } else if (current?.status === 'running' || current?.status === 'completed') {
          // Preparation must save a result, not merely finish a harness turn.
          const reportId = workResultRequestScopedId('report_result', { userId: op.actorUserId,
            source: 'ai', sessionId: event.sessionId }, op.requestId);
          const saved = op.kind === 'handoff_preparation' ? !!getWorkResult(reportId, op.actorUserId) : true;
          transitionWorkResultOperationRun(run.id, ['running', 'completed'], saved ? 'completed' : 'failed',
            saved ? {} : { statusReason: 'missing_handoff' });
        }
      } catch (error) {
        const waiting = getRun(run.id);
        if (waiting?.status === 'queued' && waiting.statusReason === 'waiting_for_author') return;
        const reason = error instanceof Error ? error.message : String(error);
        const uncertain = op.kind === 'result_feedback' && !!getRun(run.id)?.startedAt;
        transitionWorkResultOperationRun(run.id, ['queued', 'running'], 'failed', { statusReason: uncertain ? 'delivery_uncertain' : 'dispatch_failed', errorCode: 'result_dispatch_failed', errorMessage: reason });
        if (op.reviewId) {
          const cancelled = getRun(run.id)?.status === 'cancelled';
          transitionWorkResultAiReview(op.reviewId, ['queued', 'running'], cancelled ? 'cancelled' : 'failed',
            { statusReason: cancelled ? 'runtime_cancelled' : 'dispatch_failed' }, op.actorUserId);
        }
      } finally {
        publishWorkResultOperationState(run.id);
        inFlight.delete(run.id);
        if (run.chatSessionId) sessionDispatches.delete(run.chatSessionId);
        if (run.chatSessionId) void dispatchQueuedWorkResultOperations(run.chatSessionId);
      }
    })();
  }
}

export async function cancelWorkResultAiReview(actor: WorkResultActor, reviewId: string) {
  const review = getWorkResultAiReview(reviewId, actor.userId);
  if (!review) throw new ActionError('not_found', 'AI review not found.');
  if (!['queued', 'running'].includes(review.status)) return review;
  const cancelled = transitionWorkResultAiReview(review.id, ['queued', 'running'], 'cancelled', { statusReason: 'user_cancelled' }, actor.userId);
  if (!cancelled) return getWorkResultAiReview(reviewId, actor.userId)!;
  if (review.runId) {
    transitionWorkResultOperationRun(review.runId, ['queued', 'running'], 'cancelled', { statusReason: 'user_cancelled' });
    publishWorkResultOperationState(review.runId);
  }
  // A review has a dedicated context. Never stop the producing conversation.
  if (review.status === 'running' && review.reviewerSessionId) {
    const session = getChatSessionWithExecution(review.reviewerSessionId);
    if (session?.surfaceKind === 'result_review' && session.surfaceRef === review.id) {
      const executor = await import('@/lib/executor/adapter');
      rejectAllForSession(session.id, 'The AI review was cancelled.');
      await executor.abort(session.id);
    }
  }
  return getWorkResultAiReview(reviewId, actor.userId)!;
}

export function cancelWorkResultPreparation(actor: WorkResultActor, messageId: string) {
  const run = workResultOperationForMessage(messageId);
  const meta = workResultOperationMetadata(run?.triggerPayload);
  if (!run || !meta || meta.kind !== 'handoff_preparation' || meta.actorUserId !== actor.userId) throw new ActionError('not_found', 'Preparation not found.');
  // Running preparation shares implementation authority. Cancelling its request cannot abort ordinary work.
  transitionWorkResultOperationRun(run.id, ['queued'], 'cancelled', { statusReason: 'user_cancelled' });
  publishWorkResultOperationState(run.id);
  return delivery(getRun(run.id)!);
}

export function cancelQueuedPreparationsForSession(sessionId: string): void {
  for (const run of listWorkResultOperationRuns(['queued'])) {
    const meta = workResultOperationMetadata(run.triggerPayload);
    if (run.chatSessionId !== sessionId || meta?.kind !== 'handoff_preparation') continue;
    transitionWorkResultOperationRun(run.id, ['queued'], 'cancelled', { statusReason: 'authoring_stopped' });
    publishWorkResultOperationState(run.id);
  }
}

/** Ordinary Stop retains sent feedback but requires explicit delivery recovery. */
export function stopQueuedWorkResultFeedbackForSession(sessionId: string): void {
  for (const run of listWorkResultOperationRuns(['queued'])) {
    const meta = workResultOperationMetadata(run.triggerPayload);
    if (run.chatSessionId !== sessionId || meta?.kind !== 'result_feedback') continue;
    transitionWorkResultOperationRun(run.id, ['queued'], 'failed', { statusReason: 'authoring_stopped' });
    publishWorkResultOperationState(run.id);
  }
}

/** A normal conversation Stop also covers an admitted operation still preparing its handle. */
export function stopActiveWorkResultOperationsForSession(sessionId: string): void {
  for (const run of listWorkResultOperationRuns(['running'])) {
    if (run.chatSessionId !== sessionId) continue;
    const meta = workResultOperationMetadata(run.triggerPayload)!;
    transitionWorkResultOperationRun(run.id, ['running'], 'cancelled', { statusReason: 'authoring_stopped' });
    if (meta.reviewId) transitionWorkResultAiReview(meta.reviewId, ['running'], 'cancelled',
      { statusReason: 'runtime_cancelled' }, meta.actorUserId);
    publishWorkResultOperationState(run.id);
  }
}

export async function getWorkResultAiReviewActivity(actor: WorkResultActor, reviewId: string) {
  const review = getWorkResultAiReview(reviewId, actor.userId);
  if (!review) throw new ActionError('not_found', 'AI review not found.');
  const session = review.reviewerSessionId ? getChatSessionWithExecution(review.reviewerSessionId) : null;
  if (!session || session.userId !== actor.userId || session.surfaceKind !== 'result_review' || session.surfaceRef !== review.id) {
    return { review, session: null, run: review.runId ? getRun(review.runId) ?? null : null,
      pending: [], events: [], activityAvailable: false, limitation: 'Reviewer activity is unavailable or has been pruned. The saved report, scope and terminal outcome remain available.' };
  }
  return { review, session, run: review.runId ? getRun(review.runId) ?? null : null,
    pending: listForSession(session.id), events: listChatEvents(session.id, { limit: 100 }),
    runtime: await (async () => { const executor = await import('@/lib/executor/adapter');
      return { running: executor.isRunning(session.id), backgroundTasks: executor.hasBackgroundTasks(session.id),
        backgroundTaskIds: executor.listBackgroundTaskIds(session.id) }; })(), activityAvailable: true, limitation: null };
}

export function getWorkResultFeedbackDelivery(actor: WorkResultActor, review: WorkResultDecisionRecord) {
  if (review.userId !== actor.userId) throw new ActionError('not_found', 'Feedback not found.');
  if (!review.feedbackMessageId) return review.disposition === 'changes_requested'
    ? { status: 'failed', statusReason: 'target_unavailable', sessionId: review.feedbackSessionId,
      messageId: null, runId: null, canRetry: false, errorCode: null, errorMessage: null } : null;
  const run = workResultOperationForMessage(review.feedbackMessageId);
  if (run && !run.chatSessionId && ['queued', 'running'].includes(run.status)) return {
    ...delivery(run), status: 'unavailable', statusReason: 'target_unavailable', canRetry: false,
  };
  return run ? { ...delivery(run), canRetry: run.status === 'failed' && !run.startedAt
    && !!run.chatSessionId && !!getChatEventById(review.feedbackMessageId) }
    : { status: 'unavailable', statusReason: 'activity_pruned',
      sessionId: review.feedbackSessionId, messageId: review.feedbackMessageId, runId: null,
      canRetry: false, errorCode: null, errorMessage: null };
}

/** Retry only delivery known never to have reached its provider. Keep its exact message. */
export async function retryWorkResultFeedback(actor: WorkResultActor, input: { resultId: string; reviewId: string }) {
  const detail = accessibleResult(actor, input.resultId);
  const review = detail.reviews.find((row) => row.id === input.reviewId);
  if (!review || review.disposition !== 'changes_requested') throw new ActionError('not_found', 'Saved feedback not found.');
  const run = review.feedbackMessageId ? workResultOperationForMessage(review.feedbackMessageId) : null;
  const meta = workResultOperationMetadata(run?.triggerPayload);
  if (!run || !meta || meta.kind !== 'result_feedback' || meta.resultId !== detail.result.id
    || meta.actorUserId !== actor.userId || !run.chatSessionId || !review.feedbackMessageId
    || !getChatEventById(review.feedbackMessageId)) {
    throw new ActionError('unsupported', 'The original feedback delivery is unavailable. The saved feedback remains readable.');
  }
  // Resolving the original destination never substitutes another conversation,
  // and retains the existing stop, takeover and read-only boundaries.
  authoringDestination(actor, run.chatSessionId);
  if (run.status === 'queued' || run.status === 'running' || run.status === 'completed') return { review, delivery: getWorkResultFeedbackDelivery(actor, review) };
  if (run.startedAt) throw new ActionError('conflict', 'This feedback may already have reached its authoring conversation. Inspect that conversation before sending a deliberate follow-up.');
  const queued = requeueUnadmittedWorkResultFeedbackRun(run.id);
  if (!queued) throw new ActionError('conflict', 'This feedback is no longer eligible for delivery retry.');
  publishWorkResultOperationState(run.id);
  void dispatchQueuedWorkResultOperations(run.chatSessionId);
  return { review, delivery: getWorkResultFeedbackDelivery(actor, review) };
}

/** Called on gate changes so a rapid disable/re-enable cannot replay a pending queue. */
export function reconcileWorkResultCapabilities(): void {
  for (const run of listWorkResultOperationRuns(['queued'])) {
    const op = workResultOperationMetadata(run.triggerPayload)!;
    const disabled = op.kind === 'handoff_preparation' ? !handoffsEnabled()
      : op.kind === 'result_ai_review' ? !aiReviewEnabled() : false;
    if (!disabled) continue;
    transitionWorkResultOperationRun(run.id, ['queued'], 'cancelled', { statusReason: 'feature_disabled' });
    if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued'], 'cancelled', { statusReason: 'feature_disabled' }, op.actorUserId);
    publishWorkResultOperationState(run.id);
  }
  // A request persisted immediately before its runtime binding is also new work.
  for (const review of listActiveWorkResultAiReviews()) {
    if (review.status === 'queued' && !aiReviewEnabled()) {
      transitionWorkResultAiReview(review.id, ['queued'], 'cancelled', { statusReason: 'feature_disabled' }, review.userId);
    }
  }
}

/** Recovery records interruption instead of silently reissuing a feature request. */
export function recoverWorkResultOperations(): void {
  // Run before generic orphan recovery at boot. A feature message whose
  // process-owned dispatch disappeared is retained for explicit recovery.
  for (const run of listWorkResultOperationRuns()) {
    if (inFlight.has(run.id)) continue;
    const op = workResultOperationMetadata(run.triggerPayload)!;
    // Durable worker delivery outlives the home's dispatch waiter. The
    // owning worker's result signal settles it after a home restart.
    const command = getSendForEvent(op.messageId);
    if (run.chatSessionId && chatPlacement(run.chatSessionId)?.isHome === false && command
      && ['queued', 'sent', 'delivered'].includes(command.state)) continue;
    const disabled = op.kind === 'handoff_preparation' ? !handoffsEnabled()
      : op.kind === 'result_ai_review' ? !aiReviewEnabled() : false;
    const cancelled = run.status === 'queued' && disabled;
    transitionWorkResultOperationRun(run.id, ['queued', 'running'], cancelled ? 'cancelled' : 'failed', {
      statusReason: cancelled ? 'feature_disabled' : run.status === 'running' && op.kind === 'result_feedback' ? 'delivery_uncertain' : 'interrupted',
      ...(cancelled ? {} : { errorCode: 'process_restart', errorMessage: 'The runtime was interrupted. This saved request was not silently relaunched.' }),
    });
    if (op.reviewId) transitionWorkResultAiReview(op.reviewId, ['queued', 'running'], cancelled ? 'cancelled' : 'failed',
      { statusReason: cancelled ? 'feature_disabled' : 'interrupted' }, op.actorUserId);
    publishWorkResultOperationState(run.id);
  }
  for (const review of listActiveWorkResultAiReviews()) {
    if (review.runId && inFlight.has(review.runId)) continue;
    const run = review.runId ? getRun(review.runId) : null;
    if (!run || !['queued', 'running'].includes(run.status)) {
      const disabled = review.status === 'queued' && !aiReviewEnabled();
      transitionWorkResultAiReview(review.id, ['queued', 'running'], disabled ? 'cancelled' : 'failed',
        { statusReason: disabled ? 'feature_disabled' : 'interrupted' }, review.userId);
      if (run) publishWorkResultOperationState(run.id);
    }
  }
}

/** Capture live observations separately from immutable requested scope. */
export async function observeWorkResultReviewScope(review: Pick<WorkResultAiReviewRecord, 'scope'>): Promise<WorkResultReviewScope['observed']> {
  const requested = review.scope.requested;
  const cwd = requested.repository;
  if (!cwd) return { attachments: requested.attachments, capturedAt: new Date().toISOString(),
    drift: null, limitations: ['No repository was associated with this target.'] };
  if (!existsSync(cwd)) return { repository: cwd, capturedAt: new Date().toISOString(), drift: true,
    limitations: ['The requested repository directory is unavailable.'] };
  try {
    const [head, dirty] = await Promise.all([
      execFileAsync('git', ['rev-parse', 'HEAD'], { cwd }),
      execFileAsync('git', ['status', '--porcelain'], { cwd }),
    ]);
    const codeRevision = { commitSha: head.stdout.trim(), workingTreeState: dirty.stdout.trim() ? 'dirty' as const : 'clean' as const,
      capturedAt: new Date().toISOString() };
    const expected = requested.codeRevision;
    const shaChanged = !!expected?.commitSha && expected.commitSha !== codeRevision.commitSha;
    const stateChanged = !!expected && expected.workingTreeState !== 'unknown'
      && expected.workingTreeState !== codeRevision.workingTreeState;
    const exactCleanMatch = !!expected?.commitSha && expected.workingTreeState === 'clean'
      && codeRevision.workingTreeState === 'clean' && !shaChanged;
    return { repository: cwd, codeRevision, baseSha: requested.baseSha, attachments: requested.attachments,
      capturedAt: codeRevision.capturedAt, drift: shaChanged || stateChanged ? true : exactCleanMatch ? false : null,
      limitations: [...(codeRevision.workingTreeState === 'dirty' ? ['Dirty working-copy contents have no exact checkpoint.'] : []),
        ...(!exactCleanMatch && !shaChanged && !stateChanged ? ['No exact requested working-copy identity was available for comparison.'] : [])] };
  } catch {
    return { repository: cwd, attachments: requested.attachments, capturedAt: new Date().toISOString(), drift: null,
      limitations: ['Repository revision could not be observed.'] };
  }
}

/** Snapshot trustworthy adapter telemetry while the authenticated request is running. */
export function observeWorkResultReviewProvenance(review: WorkResultAiReviewRecord): WorkResultReviewProvenance {
  const session = review.reviewerSessionId ? getChatSessionWithExecution(review.reviewerSessionId) : null;
  const run = review.runId ? getRun(review.runId) : null;
  if (!session || session.surfaceKind !== 'result_review' || session.surfaceRef !== review.id
    || run?.chatSessionId !== session.id || !workResultOperationMetadata(run.triggerPayload)) return review.provenance;
  const observedModel = getWorkResultObservedReviewerModel(session.id) ?? run.model ?? null;
  const provenance: WorkResultReviewProvenance = { ...review.provenance, method: 'fresh_session',
    independence: 'observed', observedHarness: session.harness, observedModel,
    // The adapter does not expose an applied-effort acknowledgement.
    observedEffort: null };
  transitionWorkResultAiReview(review.id, ['running'], 'running', { provenance }, review.userId);
  return provenance;
}


/** The home settles durable operations from runner signals, even after its process restarted. */
export async function settleWorkResultOperationTurn(sessionId: string, runId: string | null, outcome: { ok: boolean; summary?: string | null }): Promise<void> {
  const run = runId ? getRun(runId) : null;
  const op = workResultOperationMetadata(run?.triggerPayload);
  if (!run || !op || run.chatSessionId !== sessionId) return;
  if (op.kind === 'result_ai_review' && op.reviewId) {
    if (outcome.ok && outcome.summary) await completeWorkResultReviewFromTurn(sessionId, outcome.summary);
    const review = getWorkResultAiReview(op.reviewId, op.actorUserId);
    if (review?.status !== 'running') return;
    const cancelled = getRun(run.id)?.status === 'cancelled';
    transitionWorkResultAiReview(review.id, ['running'], cancelled ? 'cancelled' : 'failed',
      { statusReason: cancelled ? 'runtime_cancelled' : outcome.ok ? 'missing_report' : 'runtime_failed' }, op.actorUserId);
    if (!cancelled && outcome.ok) transitionWorkResultOperationRun(run.id, ['running', 'completed'], 'failed', { statusReason: 'missing_report' });
    publishWorkResultOperationState(run.id);
  } else if (op.kind === 'handoff_preparation' && outcome.ok && getRun(run.id)?.status !== 'cancelled') {
    const reportId = workResultRequestScopedId('report_result', { userId: op.actorUserId, source: 'ai', sessionId }, op.requestId);
    if (!getWorkResult(reportId, op.actorUserId)) transitionWorkResultOperationRun(run.id, ['running', 'completed'], 'failed', { statusReason: 'missing_handoff' });
    publishWorkResultOperationState(run.id);
  }
}
