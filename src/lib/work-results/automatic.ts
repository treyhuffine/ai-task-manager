import { localWorkResultSourceFolder } from './source-location';
import { processState } from '@/lib/process-state';
import { existsSync, realpathSync } from 'node:fs';
import {
  getChatSessionWithExecution, getExecution, getWorkResult, getWorkResultAuthorBriefEvent,
  getTask, getUserState, getWorkspace, ensureHarnessSettings, listActiveWorkResultAiReviews, workResultRequestScopedId,
  transitionWorkResultAiReview, validateWorkResultAttachments, transitionWorkResultOperationRun, publishWorkResultOperationState,
} from '@/lib/db/queries';
import type { WorkResultActor, WorkResultAiReviewRecord, WorkResultDetail, WorkResultReviewScope, WorkResultReviewSelection } from '@/db/types';
import type { WorkResultOrigin } from './queries';
import { aiReviewEnabled } from './capabilities';
import { getAppRoot } from '@/lib/config/paths';
import { getHarnessRuntime } from '@/lib/harness/runtime';
import { ActionError } from '@/lib/orchestrator/types';
import { getWorkResultSourceWorkspace } from './reviewer-preferences';
import { preferredWorkResultReviewerSelection, reviewerPreferenceHarness } from './reviewer-selection-defaults';
import {
  assignedWorkResultReviewBrief, bindWorkResultReviewRuntime, compatibleWorkResultReviewEvidence,
  dispatchQueuedWorkResultOperations, resolveWorkResultReviewerSelection,
} from './runtime';

const processing = processState('work-results.automatic', () => new Set<string>());

function cancelAutomaticReview(review: WorkResultAiReviewRecord, reason: string): void {
  if (!transitionWorkResultAiReview(review.id, ['queued'], 'cancelled', { statusReason: reason }, review.userId)) return;
  if (review.runId) {
    transitionWorkResultOperationRun(review.runId, ['queued'], 'cancelled', { statusReason: reason });
    publishWorkResultOperationState(review.runId);
  }
}

/** Disabling a preference retires saved queues, without interrupting admitted work. */
export function reconcileAutomaticWorkResultReviewPreferences(workspaceId: string): void {
  if (getWorkspace(workspaceId)?.reviewBeforeHandoff === true) return;
  for (const review of listActiveWorkResultAiReviews()) {
    if (review.provenance.automaticWorkspaceId === workspaceId) cancelAutomaticReview(review, 'preference_disabled');
  }
}

/** Capture the final saved snapshot and files inside its transaction. No model call. */
function savedAutomaticScope(detail: WorkResultDetail): WorkResultReviewScope {
  const result = detail.result;
  const source = result.sourceChatSessionId ? getChatSessionWithExecution(result.sourceChatSessionId) : null;
  const execution = result.sourceExecutionId ? getExecution(result.sourceExecutionId) : null;
  const workspace = getWorkResultSourceWorkspace(result.userId, result.sourceChatSessionId, result.sourceExecutionId);
  const path = localWorkResultSourceFolder(source, execution, workspace);
  const repository = path && existsSync(path) ? realpathSync(path) : null;
  const original = result.sourceChatSessionId ? getWorkResultAuthorBriefEvent(result.sourceChatSessionId, result.sourceEventId, result.createdAt) : null;
  const files = new Map([...(result.attachments ?? []), ...(original?.attachments ?? []),
    ...detail.taskIds.flatMap((id) => getTask(id)?.attachments ?? [])].map((file) => [file.fileName, file]));
  const unavailableFiles: string[] = [];
  const attachments = [...files.values()].filter((file) => {
    try { validateWorkResultAttachments('', [file], result.userId); return true; }
    catch { unavailableFiles.push(`A retained review input is unavailable: ${file.originalName}.`); return false; }
  }).map((file) => ({ file_name: file.fileName, original_name: file.originalName,
    mime_type: file.mimeType, size: file.size, uploaded_at: file.uploadedAt }));
  const limitations = [
    ...(path && !repository ? ['The producing directory is unavailable.'] : []),
    ...(result.codeRevision?.workingTreeState !== 'clean' && result.codeRevision
      ? ['No exact clean revision binds the saved working copy. Live inspection cannot establish exact freshness.'] : []),
    ...(result.links.length ? ['Live links and previews may change after capture.'] : []),
    ...unavailableFiles,
  ];
  const requested = { resultId: result.id, repository, baseSha: source?.baseSha ?? execution?.baseSha ?? null,
    codeRevision: result.codeRevision, attachments, capturedAt: result.createdAt, limitations };
  return { requested, observed: { repository, baseSha: requested.baseSha, codeRevision: null,
    attachments, capturedAt: result.createdAt, limitations, drift: null } };
}

/** A server-only plan. Preference failure is durable without blocking the handoff. */
export async function prepareAutomaticWorkResultReview(actor: WorkResultActor, sourceSessionId?: string | null): Promise<WorkResultOrigin['automaticReview']> {
  if (!aiReviewEnabled() || !sourceSessionId) return undefined;
  const source = getChatSessionWithExecution(sourceSessionId);
  if (!source || source.userId !== actor.userId || source.surfaceKind === 'result_review') return undefined;
  const workspace = getWorkResultSourceWorkspace(actor.userId, source.id, source.executionId);
  if (workspace?.reviewBeforeHandoff !== true) return undefined;
  const cwd = localWorkResultSourceFolder(source, source.execution, workspace) ?? getAppRoot();
  let selection: WorkResultReviewSelection;
  let mcpSupported = false;
  let unavailable: string | null = null;
  try {
    selection = await resolveWorkResultReviewerSelection({ requestId: 'automatic-policy', resultId: 'pending' }, cwd, workspace);
    const runtime = await getHarnessRuntime(selection.harness!, { cwd });
    if (!runtime.capabilities.sessions.supported || !runtime.capabilities.planMode.supported) {
      throw new ActionError('unsupported', 'The saved reviewer cannot safely inspect this work in a fresh read-only session.');
    }
    if ((selection.effort && !runtime.capabilities.reasoningEffort.supported)
      || (selection.variant && !runtime.capabilities.modelVariants.supported)) {
      throw new ActionError('unsupported', 'The saved reviewer settings are unavailable. Change this agent\'s review defaults before trying again.');
    }
    mcpSupported = !!runtime.capabilities.mcp?.supported;
  } catch (error) {
    unavailable = error instanceof Error ? error.message : String(error);
    const normal = getUserState();
    const harness = reviewerPreferenceHarness({}, workspace.reviewDefaults, normal);
    const preferred = preferredWorkResultReviewerSelection({}, workspace.reviewDefaults, normal, ensureHarnessSettings(harness));
    selection = { harness: preferred.harness, model: preferred.model,
      variant: preferred.variant, effort: preferred.effort };
  }
  return (detail) => {
    // Preference changes and gate changes during catalog discovery do not grant new work.
    if (!aiReviewEnabled() || getWorkspace(workspace.id)?.reviewBeforeHandoff !== true) return null;
    const scope = savedAutomaticScope(detail);
    const compatible = detail.aiReviews.find((review) => compatibleWorkResultReviewEvidence(review, scope, selection));
    if (compatible) return null;
    const requestId = `automatic-result:${detail.result.id}`;
    const automaticActor: WorkResultActor = { userId: actor.userId, source: 'system' };
    const reviewId = workResultRequestScopedId('request_result_review', automaticActor, requestId);
    const files = new Set(scope.requested.attachments.map((file) => file.file_name));
    const brief = assignedWorkResultReviewBrief(detail, scope, reviewId, requestId, mcpSupported)
      .replace(/\[\[file:([^\]]+)\]\]/g, (marker, fileName: string) => files.has(fileName) ? marker : `[Unavailable review input: ${fileName}]`)
      .replace(/\/api\/attachments\/([A-Za-z0-9_-]+\.[A-Za-z0-9]+)/g,
        (url, fileName: string) => files.has(fileName) ? url : `[Unavailable review input: ${fileName}]`);
    const missingInputs = scope.requested.limitations?.filter((limit) => limit.startsWith('A retained review input is unavailable:')) ?? [];
    return { requestId, resultId: detail.result.id, selection, scope,
      brief,
      requestIntent: { resultId: detail.result.id, automaticWorkspaceId: workspace.id },
      provenance: { method: 'fresh_session', independence: 'unknown', automaticWorkspaceId: workspace.id,
        automaticRequestId: requestId, limitations: [...missingInputs, ...(unavailable ? [unavailable] : [
          'The installed adapter uses a fresh read-only review session. Actual provider model and effort are unknown until observed.',
        ])] }, ...(unavailable ? { failureReason: 'reviewer_unavailable' } : missingInputs.length ? { failureReason: 'review_inputs_unavailable' } : {}) };
  };
}

/** Only saved opt-in requests can dispatch, and only after the producing turn is quiet. */
export async function dispatchAutomaticWorkResultReviews(sourceSessionId?: string): Promise<void> {
  const executor = await import('@/lib/executor/adapter');
  for (const review of listActiveWorkResultAiReviews()) {
    if (review.status !== 'queued' || !review.provenance.automaticWorkspaceId
      || !review.provenance.automaticRequestId || processing.has(review.id)) continue;
    const detail = getWorkResult(review.resultId, review.userId);
    if (sourceSessionId && detail?.result.sourceChatSessionId !== sourceSessionId) continue;
    if (!aiReviewEnabled() || getWorkspace(review.provenance.automaticWorkspaceId)?.reviewBeforeHandoff !== true) {
      cancelAutomaticReview(review, aiReviewEnabled() ? 'preference_disabled' : 'feature_disabled');
      continue;
    }
    if (!detail || detail.successorId) {
      cancelAutomaticReview(review, 'target_superseded');
      continue;
    }
    const sourceId = detail.result.sourceChatSessionId;
    const source = sourceId ? getChatSessionWithExecution(sourceId) : null;
    if (!source || source.userId !== review.userId || source.status !== 'active'
      || source.execution?.status === 'archived') {
      transitionWorkResultAiReview(review.id, ['queued'], 'failed', { statusReason: 'target_unavailable' }, review.userId);
      continue;
    }
    if (executor.isRunning(source.id) || executor.hasBackgroundTasks?.(source.id)) continue;
    processing.add(review.id);
    try {
      const sessionId = bindWorkResultReviewRuntime({ userId: review.userId, source: 'system' }, review,
        review.provenance.automaticRequestId, detail);
      await dispatchQueuedWorkResultOperations(sessionId);
    } catch (error) {
      transitionWorkResultAiReview(review.id, ['queued'], 'failed', { statusReason: 'dispatch_failed',
        provenance: { ...review.provenance, limitations: [...(review.provenance.limitations ?? []), error instanceof Error ? error.message : String(error)] } }, review.userId);
    } finally { processing.delete(review.id); }
  }
}

export function cancelQueuedAutomaticReviewsForAuthor(sourceSessionId: string): void {
  for (const review of listActiveWorkResultAiReviews()) {
    if (review.status !== 'queued' || !review.provenance.automaticWorkspaceId) continue;
    const detail = getWorkResult(review.resultId, review.userId);
    if (detail?.result.sourceChatSessionId === sourceSessionId) {
      cancelAutomaticReview(review, 'authoring_stopped');
    }
  }
}
