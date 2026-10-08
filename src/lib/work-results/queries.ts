/** Feature-owned storage. The public query facade reexports these functions. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { and, desc, eq, inArray, isNull, isNotNull, notExists } from 'drizzle-orm';
import { getDb, getRawDb } from '@/lib/db';
import {
  workResults, workResultTasks, workResultDecisions, workResultAiReviews,
  chatSessions, chatEvents, executions, executionTasks, tasks, previewTargets, runs,
} from '@/lib/db/schema';
import type {
  Attachment, WorkResultActor, WorkResultRecord, WorkResultDetail, WorkResultDecisionRecord,
  WorkResultAiReviewRecord, WorkResultLink, WorkResultCodeRevision, WorkResultReviewSelection,
  WorkResultReviewScope, WorkResultReviewProvenance,
} from '@/db/types';
import { hydrateRow, dehydrateAttachments } from '@/lib/db/hydrate';
import { camelizeKeys } from '@/lib/case/keys';
import { getAttachmentsDir } from '@/lib/config/paths';
import { isAllowedMime, resolveMime, extForFile } from '@/lib/attachments/mime';
import { extractReferencedFileNames } from '@/lib/attachments/derive';
import { ActionError } from '@/lib/orchestrator/types';
import { APP_SHORT_ID } from '@/constants/app';
import { publishChatEvent } from '@/lib/realtime/bus';
import { assertHandoffsEnabled, assertAiReviewEnabled, handoffsEnabled, aiReviewEnabled } from './capabilities';
import { listWorkResultOperationRuns, workResultOperationMetadata } from '@/lib/db/work-result-runtime-queries';

function transaction<T>(fn: () => T): T {
  if (getRawDb().inTransaction) return fn();
  return getDb().transaction(fn, { behavior: 'immediate' });
}

/** Hash-derived retry IDs are not chronological. Millisecond monotonic creation
 * times keep append-only decisions in actual write order, including fast retries. */
function featureTimestamp(): string {
  const db = getDb();
  const latest = [
    db.select({ at: workResults.createdAt }).from(workResults).orderBy(desc(workResults.createdAt)).limit(1).get()?.at,
    db.select({ at: workResultDecisions.createdAt }).from(workResultDecisions).orderBy(desc(workResultDecisions.createdAt)).limit(1).get()?.at,
    db.select({ at: workResultAiReviews.createdAt }).from(workResultAiReviews).orderBy(desc(workResultAiReviews.createdAt)).limit(1).get()?.at,
  ].flatMap((at) => at && Number.isFinite(Date.parse(at)) ? [Date.parse(at) + 1] : []);
  return new Date(Math.max(Date.now(), ...latest)).toISOString();
}

/** Canonical JSON preserves absent versus explicit values, sorts object keys. */
export function workResultIntentHash(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(
      Object.entries(v).filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
    );
    return v;
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

/** Stable identities never contain credentials, connection IDs, or claimed actor IDs. */
export function workResultRequestScopedId(namespace: string, actor: WorkResultActor, requestId: string): string {
  if (!requestId.trim() || requestId.length > 256) throw new ActionError('invalid_params', 'A stable request_id of at most 256 characters is required.');
  if (!actor.userId || (actor.source === 'ai' && !actor.sessionId)) {
    throw new ActionError('invalid_params', 'Agent reporting requires an authenticated session.');
  }
  const caller = actor.source === 'ai' ? ['agent', actor.sessionId] : [actor.source, actor.userId];
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify([APP_SHORT_ID, namespace, actor.userId, caller, requestId])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x80;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function validateActor(actor: WorkResultActor): void {
  // This branch's established authority is the local personal home. Future homes
  // authorization belongs at its existing boundary, not a parallel permissions model.
  if (actor.userId !== 'local') throw new ActionError('not_found', 'The requested personal authority is unavailable.');
  if (actor.source === 'ai' && !actor.sessionId) throw new ActionError('invalid_params', 'Agent reporting requires a signed session identity.');
  if (actor.sessionId) {
    const session = getDb().select().from(chatSessions).where(eq(chatSessions.id, actor.sessionId)).get();
    if (!session || session.userId !== actor.userId) throw new ActionError('not_found', 'The caller session is unavailable.');
    if (actor.executionId && actor.executionId !== session.executionId) throw new ActionError('invalid_params', 'Caller execution does not match the signed session.');
  }
}

function ownResult(id: string, userId: string): WorkResultRecord {
  const row = hydrateRow(getDb().select().from(workResults).where(and(eq(workResults.id, id), eq(workResults.userId, userId))).get());
  if (!row) throw new ActionError('not_found', 'Result not found.');
  return row;
}

function sourceSession(id: string, userId: string) {
  const row = getDb().select().from(chatSessions).where(and(eq(chatSessions.id, id), eq(chatSessions.userId, userId))).get();
  if (!row) throw new ActionError('not_found', 'The source conversation is unavailable.');
  return row;
}

function assertReplay(hash: string, storedHash: string): void {
  if (hash !== storedHash) throw new ActionError('conflict', 'This request_id was already used with different intent. Use a new request_id for changed work.');
}

/** Gallery entries are intentional roots, even when the body has no file marker. */
export function validateWorkResultAttachments(body: string, attachments: Attachment[], userId: string): Attachment[] {
  if (userId !== 'local') throw new ActionError('not_found', 'Attachments are unavailable in this authority.');
  const out = new Map<string, Attachment>();
  for (const file of attachments) {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(file.fileName) || !file.originalName.trim()
      || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 50 * 1024 * 1024
      || !Number.isFinite(Date.parse(file.uploadedAt)) || !isAllowedMime(file.mimeType)
      || resolveMime(file.mimeType, file.originalName) !== file.mimeType
      || path.extname(file.fileName).slice(1).toLowerCase() !== extForFile(file.mimeType, file.originalName)) {
      throw new ActionError('invalid_params', 'Invalid attachment metadata. Use an existing Ri upload record.');
    }
    const filePath = path.join(getAttachmentsDir(), file.fileName);
    let stat: fs.Stats;
    try { stat = fs.lstatSync(filePath); } catch { throw new ActionError('not_found', `Uploaded attachment is unavailable: ${file.originalName}`); }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== file.size) throw new ActionError('invalid_params', 'Attachment does not match a regular uploaded file.');
    const previous = out.get(file.fileName);
    if (previous && workResultIntentHash(previous) !== workResultIntentHash(file)) throw new ActionError('conflict', 'Conflicting metadata for the same attachment.');
    out.set(file.fileName, file);
  }
  const names = [...extractReferencedFileNames(body), ...[...body.matchAll(/\[\[file:([A-Za-z0-9_-]+\.[A-Za-z0-9]+)\]\]/g)].map((m) => m[1])];
  for (const name of names) if (!out.has(name)) throw new ActionError('invalid_params', `Referenced attachment lacks an uploaded record: ${name}`);
  return [...out.values()];
}

const validateAttachments = validateWorkResultAttachments;

function validateLinks(links: WorkResultLink[], userId: string): void {
  for (const link of links) {
    if (!link.label.trim()) throw new ActionError('invalid_params', 'Links require a label.');
    if (link.kind === 'url') {
      let url: URL;
      try { url = new URL(link.url); } catch { throw new ActionError('invalid_params', 'Invalid result URL.'); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ActionError('invalid_params', 'Result URLs must use HTTP or HTTPS without credentials.');
    } else if (link.kind === 'preview') {
      const preview = getDb().select({ executionId: previewTargets.executionId }).from(previewTargets).where(eq(previewTargets.id, link.previewTargetId)).get();
      const execution = preview ? getDb().select().from(executions).where(and(eq(executions.id, preview.executionId), eq(executions.userId, userId))).get() : null;
      if (!execution) throw new ActionError('not_found', 'The preview is unavailable in this authority.');
    } else throw new ActionError('invalid_params', 'Unsupported result link.');
  }
}

export interface ReportWorkResultInput {
  requestId: string;
  body: string;
  title?: string;
  attention?: string;
  attachments?: Attachment[];
  links?: WorkResultLink[];
  taskIds?: string[];
  supersedesId?: string;
  independentReview?: Omit<ExistingWorkResultReviewInput, 'scope'> & {
    scope?: Omit<WorkResultReviewScope, 'requested'> & {
      requested: Omit<WorkResultReviewScope['requested'], 'resultId'>;
    };
  };
}

export interface WorkResultOrigin {
  sourceChatSessionId?: string | null;
  sourceEventId?: string | null;
  /** Trusted execution-computer observation, never a caller assertion. */
  codeRevision?: WorkResultCodeRevision | null;
  /** Server-owned policy preparation, committed atomically with a new primary snapshot. */
  automaticReview?: (detail: WorkResultDetail) => (CreateWorkResultAiReviewInput & { failureReason?: string }) | null;
}

export interface ExistingWorkResultReviewInput {
  body: string;
  title?: string;
  attachments?: Attachment[];
  links?: WorkResultLink[];
  scope?: WorkResultReviewScope;
  provenance?: WorkResultReviewProvenance;
  selection?: WorkResultReviewSelection;
}

function submittedResultIntent(input: ReportWorkResultInput, origin: WorkResultOrigin) {
  return {
    ...input,
    taskIds: input.taskIds === undefined ? undefined : [...new Set(input.taskIds)].sort(),
    sourceChatSessionId: origin.sourceChatSessionId,
    sourceEventId: origin.sourceEventId,
    // Observed code state is intentionally excluded from retry intent.
  };
}

export function createWorkResult(actor: WorkResultActor, input: ReportWorkResultInput, origin: WorkResultOrigin = {}): { result: WorkResultRecord; idempotentReplay: boolean } {
  const id = workResultRequestScopedId('report_result', actor, input.requestId);
  const hash = workResultIntentHash(submittedResultIntent(input, origin));
  const committed = transaction(() => {
    const previous = getDb().select().from(workResults).where(and(eq(workResults.id, id), eq(workResults.userId, actor.userId))).get();
    if (previous) { assertReplay(hash, previous.requestHash); return { result: hydrateRow(previous), idempotentReplay: true }; }
    validateActor(actor);
    const preparation = actor.source === 'ai' && actor.sessionId
      ? listWorkResultOperationRuns(['running']).find((run) => {
        const metadata = workResultOperationMetadata(run.triggerPayload);
        return run.chatSessionId === actor.sessionId && metadata?.kind === 'handoff_preparation'
          && metadata.requestId === input.requestId && metadata.actorUserId === actor.userId;
      }) : undefined;
    const preparationMetadata = workResultOperationMetadata(preparation?.triggerPayload);
    if (preparationMetadata && (preparationMetadata.resultId ?? undefined) !== input.supersedesId) {
      throw new ActionError('conflict', 'This preparation request must save the exact admitted handoff target.');
    }
    if (preparationMetadata && origin.sourceEventId && origin.sourceEventId !== preparationMetadata.sourceEventId) {
      throw new ActionError('conflict', 'This preparation request names a different selected source output.');
    }
    if (!handoffsEnabled()) {
      if (!preparationMetadata) assertHandoffsEnabled();
    }
    if (!input.body.trim()) throw new ActionError('invalid_params', 'A handoff needs nonempty Markdown.');
    if (actor.source === 'ai' && getWorkResultAiReviewForSession(actor.sessionId!, actor.userId)) {
      throw new ActionError('unsupported', 'Reviewer sessions must use report_result_review for their assigned target.');
    }
    if (actor.source === 'ai' && origin.sourceChatSessionId && origin.sourceChatSessionId !== actor.sessionId) throw new ActionError('invalid_params', 'An agent cannot report another session as its origin.');
    const sessionId = origin.sourceChatSessionId ?? actor.sessionId ?? null;
    const session = sessionId ? sourceSession(sessionId, actor.userId) : null;
    if (session?.surfaceKind === 'result_review') throw new ActionError('unsupported', 'Reviewer output belongs to its assigned AI review, not a primary handoff.');
    const executionId = session?.executionId ?? null;
    if (executionId) {
      const execution = getDb().select().from(executions).where(and(eq(executions.id, executionId), eq(executions.userId, actor.userId))).get();
      if (!execution) throw new ActionError('not_found', 'The source execution is unavailable.');
    }
    const selectedSourceEventId = origin.sourceEventId ?? preparationMetadata?.sourceEventId ?? null;
    const selectedSourceEvent = selectedSourceEventId ? getDb().select().from(chatEvents).where(eq(chatEvents.id, selectedSourceEventId)).get() : undefined;
    if (origin.sourceEventId) {
      const event = selectedSourceEvent;
      if (!event || event.sessionId !== sessionId) throw new ActionError('not_found', 'The selected output is unavailable in this conversation.');
      if (actor.source === 'human' && (event.source !== 'agent' || !event.content?.trim() || event.content !== input.body)) {
        throw new ActionError('invalid_params', 'Save as handoff preserves the exact selected agent answer. Omit the source event to save separately authored content.');
      }
    }
    const prior = input.supersedesId ? ownResult(input.supersedesId, actor.userId) : null;
    if (prior) {
      const successor = getDb().select({ id: workResults.id }).from(workResults).where(eq(workResults.supersedesId, prior.id)).get();
      if (successor) throw new ActionError('conflict', 'This handoff already has a successor. Inspect the exact current snapshot.', undefined, { resultId: successor.id });
      if (getDb().select().from(workResultAiReviews).where(eq(workResultAiReviews.reportResultId, prior.id)).get()) throw new ActionError('invalid_params', 'AI reports cannot be replaced as primary handoffs.');
    }
    const priorTaskIds = prior ? getDb().select({ id: workResultTasks.taskId }).from(workResultTasks).where(eq(workResultTasks.resultId, prior.id)).all().map((r) => r.id).sort() : [];
    let taskIds = input.taskIds;
    if (taskIds === undefined && prior) taskIds = priorTaskIds;
    if (taskIds === undefined && session?.surfaceKind === 'task' && session.surfaceRef) {
      const contentTask = getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.id, session.surfaceRef)).get();
      if (!contentTask) throw new ActionError('not_found', 'The producing task is unavailable.');
      taskIds = [contentTask.id];
    }
    if (taskIds === undefined && executionId) {
      const associated = getDb().select({ id: tasks.id }).from(executionTasks).innerJoin(tasks, eq(tasks.id, executionTasks.taskId)).where(eq(executionTasks.executionId, executionId)).all();
      taskIds = associated.length === 1 ? [associated[0].id] : [];
    }
    taskIds = [...new Set(taskIds ?? [])].sort();
    for (const taskId of taskIds) if (!getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get()) throw new ActionError('not_found', 'A linked task is unavailable in this authority.');
    const sourceAttachments = actor.source === 'human' && origin.sourceEventId && selectedSourceEvent
      ? hydrateRow(selectedSourceEvent).attachments ?? [] : [];
    const attachments = validateAttachments(input.body, input.attachments ?? sourceAttachments, actor.userId);
    if (actor.source === 'human' && origin.sourceEventId && input.attachments !== undefined) {
      const original = validateAttachments(input.body, sourceAttachments, actor.userId);
      const manifest = (files: Attachment[]) => [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));
      if (workResultIntentHash(manifest(attachments)) !== workResultIntentHash(manifest(original))) {
        throw new ActionError('invalid_params', 'Save as handoff preserves the exact selected answer attachments.');
      }
    }
    const links = input.links ?? [];
    validateLinks(links, actor.userId);
    const codeIdentity = (revision: WorkResultCodeRevision | null | undefined) => revision?.checkpointRef
      ? ['checkpoint', revision.commitSha, revision.checkpointRef]
      : revision?.workingTreeState === 'clean' && revision.commitSha ? ['commit', revision.commitSha] : null;
    const nextCodeIdentity = codeIdentity(origin.codeRevision);
    const knownCodeChanged = nextCodeIdentity !== null && workResultIntentHash(nextCodeIdentity) !== workResultIntentHash(codeIdentity(prior?.codeRevision));
    if (prior && !knownCodeChanged && workResultIntentHash({ body: prior.body, title: prior.title, attention: prior.attention, links: prior.links, attachments: prior.attachments, taskIds: priorTaskIds })
      === workResultIntentHash({ body: input.body, title: input.title ?? null, attention: input.attention ?? null, links, attachments, taskIds })) {
      throw new ActionError('conflict', 'The saved handoff already contains this content. View the existing handoff.');
    }
    const now = featureTimestamp();
    const result = hydrateRow(getDb().insert(workResults).values({
      createdAt: now, updatedAt: now,
      id, userId: actor.userId, actorSource: actor.source, actorUserId: actor.userId,
      actorSessionId: actor.sessionId ?? null, sourceChatSessionId: sessionId,
      sourceExecutionId: executionId,
      sourceEventId: selectedSourceEvent?.sessionId === sessionId ? selectedSourceEvent.id : null,
      requestHash: hash, title: input.title ?? null, body: input.body, attention: input.attention ?? null,
      attachments: dehydrateAttachments(attachments) ?? [], links, codeRevision: origin.codeRevision ?? null,
      supersedesId: input.supersedesId ?? null,
    }).returning().get());
    for (const taskId of taskIds) getDb().insert(workResultTasks).values({ id: workResultRequestScopedId(`result_task:${taskId}`, actor, input.requestId), createdAt: now, updatedAt: now, resultId: id, taskId }).run();
    if (sessionId) getDb().insert(chatEvents).values({
      id: workResultRequestScopedId('result_event', actor, input.requestId), sessionId,
      createdAt: now, updatedAt: now,
      role: 'assistant', source: 'work_result', raw: { resultId: id }, attachments: [],
    }).run();
    if (input.independentReview) recordExistingReview(actor, {
      ...input.independentReview,
      scope: input.independentReview.scope ? { ...input.independentReview.scope, requested: { ...input.independentReview.scope.requested, resultId: id } } : undefined,
      requestId: `nested:${input.requestId}`, resultId: id,
    }, true);
    if (origin.automaticReview && aiReviewEnabled()) {
      const request = origin.automaticReview(getWorkResult(id, actor.userId)!);
      if (request) {
        const automatic = createWorkResultAiReview({ userId: actor.userId, source: 'system' }, request);
        if (request.failureReason && !automatic.reused) transitionWorkResultAiReview(automatic.review.id, ['queued'], 'failed',
          { statusReason: request.failureReason }, actor.userId);
      }
    }
    return { result, idempotentReplay: false };
  });
  if (!committed.idempotentReplay && !getRawDb().inTransaction) {
    const event = getDb().select().from(chatEvents).where(eq(chatEvents.id, workResultRequestScopedId('result_event', actor, input.requestId))).get();
    if (event) publishChatEvent(hydrateRow(event));
  }
  return committed;
}

export function getWorkResult(id: string, userId = 'local'): WorkResultDetail | undefined {
  const result = hydrateRow(getDb().select().from(workResults).where(and(eq(workResults.id, id), eq(workResults.userId, userId))).get());
  if (!result) return undefined;
  const successor = hydrateRow(getDb().select().from(workResults).where(and(eq(workResults.supersedesId, id), eq(workResults.userId, userId))).get()) ?? null;
  return {
    result,
    taskIds: getDb().select({ id: workResultTasks.taskId }).from(workResultTasks).where(eq(workResultTasks.resultId, id)).all().map((r) => r.id),
    reviews: getDb().select().from(workResultDecisions).where(and(eq(workResultDecisions.resultId, id), eq(workResultDecisions.userId, userId))).orderBy(desc(workResultDecisions.createdAt), desc(workResultDecisions.id)).all().map((row) => hydrateRow(row)),
    aiReviews: getDb().select().from(workResultAiReviews).where(and(eq(workResultAiReviews.resultId, id), eq(workResultAiReviews.userId, userId))).orderBy(desc(workResultAiReviews.createdAt), desc(workResultAiReviews.id)).all()
      .map((review) => ({ ...review, report: review.reportResultId ? hydrateRow(getDb().select().from(workResults).where(and(eq(workResults.id, review.reportResultId), eq(workResults.userId, userId))).get()) ?? null : null })),
    supersedes: result.supersedesId ? hydrateRow(getDb().select().from(workResults).where(and(eq(workResults.id, result.supersedesId), eq(workResults.userId, userId))).get()) ?? null : null,
    successor, successorId: successor?.id ?? null,
    reviewTargetId: getDb().select({ id: workResultAiReviews.resultId }).from(workResultAiReviews).where(and(eq(workResultAiReviews.reportResultId, id), eq(workResultAiReviews.userId, userId))).get()?.id ?? null,
  };
}

export interface ListWorkResultsInput {
  query?: string;
  taskId?: string;
  executionId?: string;
  sourceChatSessionId?: string;
  sourceEventId?: string;
  includeSuperseded?: boolean;
  limit?: number;
  offset?: number;
}

export function listWorkResults(input: ListWorkResultsInput = {}, userId = 'local'): WorkResultRecord[] {
  const db = getDb();
  const conditions = [eq(workResults.userId, userId), notExists(db.select({ id: workResultAiReviews.id }).from(workResultAiReviews).where(eq(workResultAiReviews.reportResultId, workResults.id)))];
  if (input.taskId) conditions.push(inArray(workResults.id, db.select({ id: workResultTasks.resultId }).from(workResultTasks).where(eq(workResultTasks.taskId, input.taskId))));
  if (input.executionId) conditions.push(eq(workResults.sourceExecutionId, input.executionId));
  if (input.sourceChatSessionId) conditions.push(eq(workResults.sourceChatSessionId, input.sourceChatSessionId));
  if (input.sourceEventId) conditions.push(eq(workResults.sourceEventId, input.sourceEventId));
  // Use an aliased successor table so this predicate is correlated correctly.
  const successorIds = db.select({ id: workResults.supersedesId }).from(workResults).where(and(eq(workResults.userId, userId), isNotNull(workResults.supersedesId)));
  const rows = db.select().from(workResults).where(and(...conditions)).orderBy(desc(workResults.createdAt), desc(workResults.id)).all();
  const replaced = input.includeSuperseded ? new Set<string>() : new Set(successorIds.all().map((r) => r.id));
  const query = input.query?.toLocaleLowerCase();
  return rows.filter((r) => !replaced.has(r.id) && (!query || `${r.title ?? ''}\n${r.body}`.toLocaleLowerCase().includes(query))).slice(Math.max(0, input.offset ?? 0), Math.max(0, input.offset ?? 0) + Math.max(1, Math.min(100, input.limit ?? 30))).map((r) => hydrateRow(r));
}

export interface WorkResultDispositionInput {
  requestId: string;
  resultId: string;
  disposition: WorkResultDecisionRecord['disposition'];
  note?: string;
  feedbackSessionId?: string;
  feedbackMessageId?: string;
  context?: NonNullable<WorkResultDecisionRecord['context']>;
  attachments?: Attachment[];
}

export function createWorkResultDecision(actor: WorkResultActor, input: WorkResultDispositionInput): { review: WorkResultDecisionRecord; idempotentReplay: boolean } {
  const id = workResultRequestScopedId('result_disposition', actor, input.requestId);
  // Runtime destination/message identity is derived and persisted separately.
  // Pruning that provenance cannot change a replay of the submitted decision.
  const hash = workResultIntentHash({ requestId: input.requestId, resultId: input.resultId,
    disposition: input.disposition, note: input.note, context: input.context, attachments: input.attachments });
  return transaction(() => {
    const old = getDb().select().from(workResultDecisions).where(and(eq(workResultDecisions.id, id), eq(workResultDecisions.userId, actor.userId))).get();
    if (old) { assertReplay(hash, old.requestHash); return { review: hydrateRow(old), idempotentReplay: true }; }
    validateActor(actor);
    assertHandoffsEnabled();
    const result = ownResult(input.resultId, actor.userId);
    if (input.disposition === 'changes_requested' && !input.note?.trim()) throw new ActionError('invalid_params', 'Request changes requires feedback.');
    const attachments = validateAttachments(input.note ?? '', input.attachments ?? [], actor.userId);
    if (input.context) {
      if (Object.entries(input.context).some(([key, value]) => !['reviewId', 'attachmentFileName', 'previewTargetId'].includes(key)
        || typeof value !== 'string' || !value.trim())) throw new ActionError('invalid_params', 'Feedback context must name an exact retained inspection.');
      if (input.context.reviewId && getWorkResultAiReview(input.context.reviewId, actor.userId)?.resultId !== result.id) {
        throw new ActionError('invalid_params', 'The selected AI findings belong to another result.');
      }
      if (input.context.attachmentFileName && ![...(result.attachments ?? []), ...attachments]
        .some((file) => file.fileName === input.context!.attachmentFileName)) {
        throw new ActionError('invalid_params', 'The selected file is not attached to this result or feedback.');
      }
      if (input.context.previewTargetId && !result.links.some((link) => link.kind === 'preview' && link.previewTargetId === input.context!.previewTargetId)) {
        throw new ActionError('invalid_params', 'The selected preview is not part of this result.');
      }
    }
    if (Boolean(input.feedbackSessionId) !== Boolean(input.feedbackMessageId)) throw new ActionError('invalid_params', 'Feedback needs its exact destination and message identity.');
    if (input.feedbackSessionId) {
      const destination = sourceSession(input.feedbackSessionId, actor.userId);
      if (destination.id !== result.sourceChatSessionId || destination.surfaceKind === 'result_review') throw new ActionError('conflict', 'Feedback must preserve its exact producing conversation.');
    }
    const now = featureTimestamp();
    const review = hydrateRow(getDb().insert(workResultDecisions).values({
      createdAt: now, updatedAt: now,
      id, userId: actor.userId, resultId: result.id, requestHash: hash, disposition: input.disposition,
      actorSource: actor.source, actorUserId: actor.userId, actorSessionId: actor.sessionId ?? null,
      note: input.note ?? null, attachments: dehydrateAttachments(attachments) ?? [], context: input.context ?? null,
      feedbackSessionId: input.feedbackSessionId ?? null, feedbackMessageId: input.feedbackMessageId ?? null,
    }).returning().get());
    return { review, idempotentReplay: false };
  });
}

export function getWorkResultAiReview(id: string, userId = 'local'): WorkResultAiReviewRecord | undefined {
  return getDb().select().from(workResultAiReviews).where(and(eq(workResultAiReviews.id, id), eq(workResultAiReviews.userId, userId))).get();
}

export function getWorkResultAiReviewForSession(sessionId: string, userId = 'local'): WorkResultAiReviewRecord | undefined {
  return getDb().select().from(workResultAiReviews).where(and(eq(workResultAiReviews.reviewerSessionId, sessionId), eq(workResultAiReviews.userId, userId))).orderBy(desc(workResultAiReviews.createdAt), desc(workResultAiReviews.id)).get();
}

export function listActiveWorkResultAiReviews(userId = 'local'): WorkResultAiReviewRecord[] {
  return getDb().select().from(workResultAiReviews).where(and(eq(workResultAiReviews.userId, userId), inArray(workResultAiReviews.status, ['queued', 'running']))).all();
}

/** Trusted runtime observation never rewrites requested scope or terminal evidence. */
export function observeWorkResultAiReviewScope(id: string, observed: NonNullable<WorkResultReviewScope['observed']>, userId = 'local'): WorkResultAiReviewRecord | undefined {
  return transaction(() => {
    const review = getWorkResultAiReview(id, userId);
    if (!review || !['queued', 'running'].includes(review.status)) return undefined;
    if (observed.attachments) validateAttachments('', camelizeKeys(observed.attachments), userId);
    return getDb().update(workResultAiReviews).set({ scope: { ...review.scope, observed } }).where(and(
      eq(workResultAiReviews.id, id), eq(workResultAiReviews.userId, userId), inArray(workResultAiReviews.status, ['queued', 'running']),
    )).returning().get();
  });
}

export interface CreateWorkResultAiReviewInput {
  requestId: string;
  resultId: string;
  focus?: string;
  selection: WorkResultReviewSelection;
  scope: WorkResultReviewScope;
  provenance: WorkResultReviewProvenance;
  brief: string;
  /** Original explicit overrides, focus and rerun. Excludes changing defaults. */
  requestIntent?: unknown;
}

function validateScope(scope: WorkResultReviewScope, resultId: string, userId: string): void {
  if (scope.requested.resultId !== resultId) throw new ActionError('invalid_params', 'Review scope must name its exact target.');
  validateAttachments('', camelizeKeys(scope.requested.attachments), userId);
  if (scope.observed?.attachments) validateAttachments('', camelizeKeys(scope.observed.attachments), userId);
  if (scope.reported?.attachments) validateAttachments('', camelizeKeys(scope.reported.attachments), userId);
}

export function createWorkResultAiReview(actor: WorkResultActor, input: CreateWorkResultAiReviewInput): { review: WorkResultAiReviewRecord; idempotentReplay: boolean; reused: boolean } {
  const id = workResultRequestScopedId('request_result_review', actor, input.requestId);
  const hash = workResultIntentHash(input.requestIntent ?? { resultId: input.resultId, focus: input.focus, explicit: input.selection.explicit });
  return transaction(() => {
    const old = getWorkResultAiReview(id, actor.userId);
    if (old) {
      assertReplay(hash, old.requestHash);
      const canonical = old.provenance.reusedReviewId ? getWorkResultAiReview(old.provenance.reusedReviewId, actor.userId) : null;
      return { review: canonical ?? old, idempotentReplay: true, reused: true };
    }
    validateActor(actor);
    assertAiReviewEnabled();
    ownResult(input.resultId, actor.userId);
    if (!input.brief.trim()) throw new ActionError('invalid_params', 'A requested AI review needs a durable original brief.');
    if (actor.sessionId && getWorkResultAiReviewForSession(actor.sessionId, actor.userId)) throw new ActionError('unsupported', 'Reviewer sessions cannot request another reviewer.');
    if (getDb().select().from(workResultAiReviews).where(eq(workResultAiReviews.reportResultId, input.resultId)).get()) throw new ActionError('unsupported', 'AI review reports are nested evidence and cannot request reviews.');
    validateScope(input.scope, input.resultId, actor.userId);
    validateAttachments(input.brief, camelizeKeys(input.scope.requested.attachments), actor.userId);
    const active = getDb().select().from(workResultAiReviews).where(and(eq(workResultAiReviews.resultId, input.resultId), eq(workResultAiReviews.userId, actor.userId), inArray(workResultAiReviews.status, ['queued', 'running']))).get();
    if (active) {
      if (active.focus === (input.focus ?? null) && workResultIntentHash(active.selection) === workResultIntentHash(input.selection)) {
        const now = featureTimestamp();
        getDb().insert(workResultAiReviews).values({
          id, createdAt: now, updatedAt: now, userId: actor.userId, resultId: input.resultId,
          actorSource: actor.source, actorUserId: actor.userId, actorSessionId: actor.sessionId ?? null,
          requestHash: hash, focus: input.focus ?? null, brief: input.brief, selection: input.selection,
          scope: input.scope, provenance: { ...input.provenance, reusedReviewId: active.id },
          status: 'cancelled', statusReason: 'reused_existing_review',
        }).run();
        return { review: active, idempotentReplay: false, reused: true };
      }
      throw new ActionError('conflict', 'An incompatible AI review is already active for this handoff.', undefined, { reviewId: active.id });
    }
    const now = featureTimestamp();
    const review = getDb().insert(workResultAiReviews).values({
      createdAt: now, updatedAt: now,
      id, userId: actor.userId, resultId: input.resultId, actorSource: actor.source,
      actorUserId: actor.userId, actorSessionId: actor.sessionId ?? null, requestHash: hash,
      focus: input.focus ?? null, brief: input.brief, selection: input.selection, scope: input.scope,
      provenance: input.provenance, status: 'queued',
    }).returning().get();
    return { review, idempotentReplay: false, reused: false };
  });
}

export function linkWorkResultAiReviewRuntime(id: string, input: { reviewerSessionId: string; runId: string }, userId = 'local'): WorkResultAiReviewRecord {
  return transaction(() => {
    const review = getWorkResultAiReview(id, userId);
    if (!review) throw new ActionError('not_found', 'AI review not found.');
    if (review.status !== 'queued') {
      if (review.reviewerSessionId === input.reviewerSessionId && review.runId === input.runId) return review;
      throw new ActionError('conflict', 'Only a queued review can bind its runtime.');
    }
    if (review.reviewerSessionId && review.reviewerSessionId !== input.reviewerSessionId || review.runId && review.runId !== input.runId) throw new ActionError('conflict', 'This AI review already has an assigned runtime.');
    sourceSession(input.reviewerSessionId, userId);
    const run = getDb().select().from(runs).where(eq(runs.id, input.runId)).get();
    if (!run || run.chatSessionId !== input.reviewerSessionId) throw new ActionError('invalid_params', 'Reviewer run must belong to its assigned session.');
    return getDb().update(workResultAiReviews).set({ ...input, provenance: {
      ...review.provenance, reviewerSessionId: input.reviewerSessionId, runtimeRunId: input.runId,
    } }).where(eq(workResultAiReviews.id, id)).returning().get();
  });
}

/** Conditional projections never resurrect terminal requests or complete without a report. */
export function transitionWorkResultAiReview(id: string, expected: WorkResultAiReviewRecord['status'] | WorkResultAiReviewRecord['status'][], status: WorkResultAiReviewRecord['status'], patch: { statusReason?: string | null; provenance?: WorkResultReviewProvenance } = {}, userId = 'local'): WorkResultAiReviewRecord | undefined {
  return transaction(() => {
    const review = getWorkResultAiReview(id, userId);
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!review || !allowed.includes(review.status) || !['queued', 'running'].includes(review.status)) return undefined;
    if (status === 'completed' && !review.reportResultId) throw new ActionError('conflict', 'Completion requires a committed review report.');
    if (status === 'queued') throw new ActionError('conflict', 'A review cannot be silently requeued. Create a deliberate new attempt.');
    return getDb().update(workResultAiReviews).set({ ...patch, status }).where(and(eq(workResultAiReviews.id, id), eq(workResultAiReviews.userId, userId), inArray(workResultAiReviews.status, allowed))).returning().get();
  });
}

export interface ReportWorkResultAiReviewInput extends ExistingWorkResultReviewInput {
  requestId: string;
  reviewId?: string;
  resultId?: string;
}

const unknownSelection: WorkResultReviewSelection = { harness: null, model: null, variant: null, effort: null };

function importedScope(result: WorkResultRecord): WorkResultReviewScope {
  return { requested: { resultId: result.id, codeRevision: result.codeRevision, attachments: dehydrateAttachments(result.attachments) ?? [], capturedAt: new Date().toISOString(), limitations: ['Review scope and independent execution were reported by the author.'] } };
}

function insertReport(actor: WorkResultActor, input: ReportWorkResultAiReviewInput, target: WorkResultRecord, scope: WorkResultReviewScope, reviewId: string): WorkResultRecord {
  if (!input.body.trim()) throw new ActionError('invalid_params', 'An AI review requires a nonempty report.');
  const id = workResultRequestScopedId(`review_report:${reviewId}`, actor, input.requestId);
  const hash = workResultIntentHash(input);
  const old = getDb().select().from(workResults).where(and(eq(workResults.id, id), eq(workResults.userId, actor.userId))).get();
  if (old) { assertReplay(hash, old.requestHash); return hydrateRow(old); }
  const attachments = validateAttachments(input.body, input.attachments ?? [], actor.userId);
  validateLinks(input.links ?? [], actor.userId);
  validateScope(scope, target.id, actor.userId);
  // A review report owns no task memberships and creates no primary work_result event.
  const now = featureTimestamp();
  return hydrateRow(getDb().insert(workResults).values({
    createdAt: now, updatedAt: now,
    id, userId: actor.userId, actorSource: actor.source, actorUserId: actor.userId,
    actorSessionId: actor.sessionId ?? null, sourceChatSessionId: actor.sessionId ?? null,
    sourceExecutionId: null, sourceEventId: null, requestHash: hash,
    title: input.title ?? 'AI review', body: input.body, attachments: dehydrateAttachments(attachments) ?? [],
    links: input.links ?? [], codeRevision: scope.observed?.codeRevision ?? null,
  }).returning().get());
}

function recordExistingReview(actor: WorkResultActor, input: ReportWorkResultAiReviewInput & { resultId: string }, admittedParent = false): { review: WorkResultAiReviewRecord; report: WorkResultRecord; idempotentReplay: boolean } {
  const id = workResultRequestScopedId('record_result_review', actor, input.requestId);
  const hash = workResultIntentHash(input);
  const old = getWorkResultAiReview(id, actor.userId);
  if (old) {
    assertReplay(hash, old.requestHash);
    return { review: old, report: ownResult(old.reportResultId!, actor.userId), idempotentReplay: true };
  }
  validateActor(actor);
  if (!admittedParent) assertHandoffsEnabled();
  const target = ownResult(input.resultId, actor.userId);
  if (actor.sessionId && getWorkResultAiReviewForSession(actor.sessionId, actor.userId)) throw new ActionError('unsupported', 'An assigned reviewer must report to its exact review_id.');
  if (getDb().select().from(workResultAiReviews).where(eq(workResultAiReviews.reportResultId, target.id)).get()) throw new ActionError('unsupported', 'Review reports cannot recursively create independent reviews.');
  const submittedScope = input.scope ?? importedScope(target);
  const scope: WorkResultReviewScope = {
    requested: submittedScope.requested,
    ...(submittedScope.observed ? { reported: submittedScope.observed } : {}),
  };
  // A signed author authenticates the reporter, never a separate reviewer.
  const provenance: WorkResultReviewProvenance = {
    method: input.provenance?.method ?? 'reported_review', independence: 'reported',
    observedHarness: input.provenance?.observedHarness ?? null,
    observedModel: input.provenance?.observedModel ?? null,
    observedEffort: input.provenance?.observedEffort ?? null,
    nativeReviewId: input.provenance?.nativeReviewId ?? null,
    limitations: input.provenance?.limitations ?? [],
    ...(actor.source === 'ai' && actor.sessionId ? { reporterSessionId: actor.sessionId } : {}),
  };
  const report = insertReport(actor, input, target, scope, id);
  const now = featureTimestamp();
  const review = getDb().insert(workResultAiReviews).values({
    createdAt: now, updatedAt: now,
    id, userId: actor.userId, resultId: target.id, actorSource: actor.source, actorUserId: actor.userId,
    actorSessionId: actor.sessionId ?? null, requestHash: hash, brief: null,
    selection: input.selection ?? unknownSelection, scope, provenance, status: 'completed', reportResultId: report.id,
  }).returning().get();
  return { review, report, idempotentReplay: false };
}

export function reportWorkResultAiReview(actor: WorkResultActor, input: ReportWorkResultAiReviewInput, observation?: WorkResultReviewScope['observed']): { review: WorkResultAiReviewRecord; report: WorkResultRecord; idempotentReplay: boolean } {
  return transaction(() => {
    if (!input.reviewId) {
      if (!input.resultId) throw new ActionError('invalid_params', 'Provide an assigned review_id or an accessible result_id.');
      return recordExistingReview(actor, { ...input, resultId: input.resultId });
    }
    const review = getWorkResultAiReview(input.reviewId, actor.userId);
    if (!review) throw new ActionError('not_found', 'AI review not found.');
    if (review.reportResultId) {
      const id = workResultRequestScopedId(`review_report:${review.id}`, actor, input.requestId);
      if (id !== review.reportResultId) throw new ActionError('conflict', 'Only the original reviewer completion can replay this report.');
      const report = ownResult(review.reportResultId, actor.userId);
      assertReplay(workResultIntentHash(input), report.requestHash);
      return { review, report, idempotentReplay: true };
    }
    if (actor.source !== 'ai' || !actor.sessionId || actor.sessionId !== review.reviewerSessionId) throw new ActionError('conflict', 'Only the authenticated assigned reviewer can submit this report.');
    if (input.resultId && input.resultId !== review.resultId) throw new ActionError('invalid_params', 'Review target cannot change.');
    const target = ownResult(review.resultId, actor.userId);
    validateActor(actor);
    if (review.status !== 'running') throw new ActionError('conflict', 'This review is not running. Late reports cannot reopen terminal requests.');
    if (input.scope && workResultIntentHash(input.scope.requested) !== workResultIntentHash(review.scope.requested)) throw new ActionError('conflict', 'The original requested review scope is immutable.');
    // The report hash covers submitted intent only. Dynamic observations never
    // change a replay, and reported SHA/checkpoint assertions never become facts.
    const scope: WorkResultReviewScope = { requested: review.scope.requested, observed: {
      ...(observation ?? { codeRevision: null, repository: null, baseSha: null, drift: null }),
      limitations: [...(observation?.limitations ?? ['Actual review scope was not observed by Ri.']), ...(input.scope?.observed?.limitations ?? [])],
    }, ...(input.scope?.observed ? { reported: input.scope.observed } : {}) };
    const provenance: WorkResultReviewProvenance = {
      ...review.provenance,
      ...(input.provenance?.limitations ? { limitations: [...new Set([
        ...(review.provenance.limitations ?? []), ...input.provenance.limitations,
      ])] } : {}),
      // The runtime owns observed identity and independence. Caller evidence adds limits only.
    };
    const report = insertReport(actor, input, target, scope, review.id);
    const completed = getDb().update(workResultAiReviews).set({ reportResultId: report.id, status: 'completed', statusReason: null, scope, provenance })
      .where(and(eq(workResultAiReviews.id, review.id), eq(workResultAiReviews.status, 'running'), isNull(workResultAiReviews.reportResultId))).returning().get();
    if (!completed) throw new ActionError('conflict', 'Review completion lost its running authority.');
    return { review: completed, report, idempotentReplay: false };
  });
}

/** Public wire action retains its established report_result_review name. */
export const reportWorkResultReview = reportWorkResultAiReview;

/** Source-independent roots, including the exact prepared payload retained on
 * existing runtime rows. Deliberately unaffected by capability switches. */
export function getAllWorkResultAttachmentFileNames(): Set<string> {
  const files = new Set<string>();
  const add = (fileName: unknown) => {
    if (typeof fileName === 'string' && /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(fileName)) files.add(fileName);
  };
  for (const row of getDb().select({ attachments: workResults.attachments }).from(workResults).all()) {
    for (const file of row.attachments) add(file.file_name);
  }
  for (const row of getDb().select({ attachments: workResultDecisions.attachments }).from(workResultDecisions).all()) {
    for (const file of row.attachments) add(file.file_name);
  }
  for (const { scope } of getDb().select({ scope: workResultAiReviews.scope }).from(workResultAiReviews).all()) {
    for (const file of [...scope.requested.attachments, ...(scope.observed?.attachments ?? []), ...(scope.reported?.attachments ?? [])]) add(file.file_name);
  }
  for (const { triggerPayload } of getDb().select({ triggerPayload: runs.triggerPayload }).from(runs).all()) {
    if (!workResultOperationMetadata(triggerPayload) || !triggerPayload || typeof triggerPayload !== 'object') continue;
    const attachments = triggerPayload.attachments;
    if (!Array.isArray(attachments)) continue;
    for (const file of attachments) if (file && typeof file === 'object') add(file.file_name);
  }
  return files;
}
