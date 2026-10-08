/** Durable delivery for result-origin work, using the existing event and run records. */
import { and, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { getDb } from './index';
import { chatEvents, runs, workResultAiReviews, chatSessions } from './schema';
import {
  createRun, getChatEventById, getChatSessionWithExecution, getRun, insertChatEvent,
  bumpSessionOutcome,
} from './queries';
import { ActionError } from '@/lib/orchestrator/types';
import type { Attachment, WorkResultActor, RunRecord } from '@/db/types';
import { publishChatEvent } from '@/lib/realtime/bus';
import { dehydrateAttachments } from './hydrate';

export interface WorkResultOperationMetadata {
  kind: 'handoff_preparation' | 'result_feedback' | 'result_ai_review';
  requestId: string;
  requestHash: string;
  actorUserId: string;
  actorSessionId: string | null;
  messageId: string;
  resultId?: string | null;
  sourceEventId?: string | null;
  reviewId?: string | null;
  rerun?: boolean;
}

export function workResultOperationMetadata(value: unknown): WorkResultOperationMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = record.resultOperation;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const op = candidate as WorkResultOperationMetadata;
  return ['handoff_preparation', 'result_feedback', 'result_ai_review'].includes(op.kind)
    && typeof op.requestId === 'string' && typeof op.requestHash === 'string'
    && typeof op.actorUserId === 'string' && typeof op.messageId === 'string'
    ? op : null;
}

export function withWorkResultRuntimeTransaction<T>(operation: () => T): T {
  return getDb().transaction(operation, { behavior: 'immediate' });
}

export function ensureWorkResultOperationMessage(actor: WorkResultActor, input: {
  id: string;
  runId: string;
  sessionId: string;
  content: string;
  attachments?: Attachment[];
  metadata: WorkResultOperationMetadata;
}): { event: NonNullable<ReturnType<typeof getChatEventById>>; run: RunRecord; idempotentReplay: boolean } {
  return withWorkResultRuntimeTransaction(() => {
    const session = getChatSessionWithExecution(input.sessionId);
    if (!session || session.userId !== actor.userId) throw new ActionError('not_found', 'The authoring session is unavailable.');
    const existing = getChatEventById(input.id);
    if (existing) {
      const metadata = workResultOperationMetadata(existing.raw);
      if (existing.sessionId !== input.sessionId || existing.content !== input.content
        || metadata?.requestHash !== input.metadata.requestHash) {
        throw new ActionError('conflict', 'This request key was already used for different result work.');
      }
      const run = getRun(input.runId);
      if (!run) throw new ActionError('conflict', 'The saved delivery runtime is no longer available. Start a deliberate new request.');
      return { event: existing, run, idempotentReplay: true };
    }
    const event = insertChatEvent({
      id: input.id, sessionId: input.sessionId, role: 'user', source: 'user',
      senderSessionId: actor.source === 'ai' ? actor.sessionId : null,
      content: input.content, attachments: input.attachments ?? [],
      raw: { resultOperation: input.metadata }, createdAt: new Date().toISOString(),
    });
    if (!event) throw new ActionError('conflict', 'The result message could not be saved.');
    const run = createRun({
      id: input.runId, harness: session.harness, triggerKind: 'manual',
      triggerId: null, chatSessionId: session.id, workspaceId: session.workspaceId,
      executionId: session.executionId, status: 'queued',
      triggerPayload: { resultOperation: input.metadata, content: input.content,
        attachments: dehydrateAttachments(input.attachments ?? []) ?? [] },
    });
    return { event, run, idempotentReplay: false };
  });
}

/** Conditional transitions prevent cancellation, callbacks and retries from resurrecting work. */
export function transitionWorkResultOperationRun(
  id: string, expected: RunRecord['status'][], status: RunRecord['status'],
  patch: { statusReason?: string | null; errorCode?: string | null; errorMessage?: string | null } = {},
): RunRecord | undefined {
  const now = new Date().toISOString();
  return getDb().update(runs).set({
    status, ...patch,
    ...(status === 'running' ? { startedAt: now } : {}),
    ...(['completed', 'failed', 'cancelled', 'skipped'].includes(status) ? { completedAt: now } : {}),
  }).where(and(eq(runs.id, id), inArray(runs.status, expected))).returning().get();
}

export function listWorkResultOperationRuns(statuses: RunRecord['status'][] = ['queued', 'running']): RunRecord[] {
  return getDb().select().from(runs).where(and(
    inArray(runs.status, statuses), sql`json_extract(${runs.triggerPayload}, '$.resultOperation.kind') IS NOT NULL`,
  )).all();
}

/** User-requested retry preserves the existing message and requires proof of no admission. */
export function requeueUnadmittedWorkResultFeedbackRun(id: string): RunRecord | undefined {
  return getDb().update(runs).set({ status: 'queued', statusReason: null,
    completedAt: null, errorCode: null, errorMessage: null }).where(and(
    eq(runs.id, id), eq(runs.status, 'failed'), sql`${runs.startedAt} IS NULL`,
    sql`json_extract(${runs.triggerPayload}, '$.resultOperation.kind') = 'result_feedback'`,
  )).returning().get();
}

export function workResultOperationForMessage(messageId: string): RunRecord | undefined {
  return getDb().select().from(runs).where(
    sql`json_extract(${runs.triggerPayload}, '$.resultOperation.messageId') = ${messageId}`,
  ).get();
}

export function workResultOperationForSession(sessionId: string, kind: WorkResultOperationMetadata['kind']): RunRecord | undefined {
  return getDb().select().from(runs).where(and(
    eq(runs.chatSessionId, sessionId), inArray(runs.status, ['queued', 'running']),
    sql`json_extract(${runs.triggerPayload}, '$.resultOperation.kind') = ${kind}`,
  )).get();
}

/** Original human request only, never the implementation transcript. */
export function getWorkResultAuthorBrief(sessionId: string, sourceEventId?: string | null, capturedAt?: string): string | null {
  return getWorkResultAuthorBriefEvent(sessionId, sourceEventId, capturedAt)?.content ?? null;
}

export function getWorkResultAuthorBriefEvent(sessionId: string, sourceEventId?: string | null, capturedAt?: string) {
  const source = sourceEventId ? getChatEventById(sourceEventId) : null;
  const cutoff = source?.sessionId === sessionId ? source.createdAt : capturedAt;
  const instant = (value: string) => Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  const cutoffMs = cutoff ? instant(cutoff) : Infinity;
  if (Number.isNaN(cutoffMs)) return null;
  const candidates: Array<{ id: string; createdAt: string }> = [];

  // Timestamp formats are individually chronological. Read each through the
  // session/created_at index, then compare their instants in JS. Ordering by
  // julianday or filtering raw JSON in SQL ranks/parses a whole long session.
  for (const separator of [' ', 'T']) {
    const ceiling = Number.isFinite(cutoffMs)
      ? new Date(cutoffMs).toISOString().slice(0, 19).replace('T', separator) + (separator === 'T' ? 'Z' : '.999')
      : null;
    let cursor: { id: string; createdAt: string } | undefined;
    while (true) {
      const page = getDb().select({ id: chatEvents.id, createdAt: chatEvents.createdAt, raw: chatEvents.raw })
        .from(chatEvents).where(and(
          eq(chatEvents.sessionId, sessionId), eq(chatEvents.role, 'user'), eq(chatEvents.source, 'user'),
          sql`substr(${chatEvents.createdAt}, 11, 1) = ${separator}`,
          ceiling ? lte(chatEvents.createdAt, ceiling) : undefined,
          cursor ? or(lt(chatEvents.createdAt, cursor.createdAt),
            and(eq(chatEvents.createdAt, cursor.createdAt), lt(chatEvents.id, cursor.id))) : undefined,
        )).orderBy(desc(chatEvents.createdAt), desc(chatEvents.id)).limit(64).all();
      const original = page.filter((row) => instant(row.createdAt) <= cutoffMs && !workResultOperationMetadata(row.raw))
        .sort((a, b) => instant(b.createdAt) - instant(a.createdAt) || b.id.localeCompare(a.id))[0];
      if (original) {
        candidates.push(original);
        break;
      }
      if (page.length < 64) break;
      cursor = page[page.length - 1];
    }
  }
  const row = candidates.sort((a, b) => instant(b.createdAt) - instant(a.createdAt) || b.id.localeCompare(a.id))[0];
  return row ? getChatEventById(row.id) : null;
}

/** Delivery state stays on the run, and is projected onto the existing message for inspection. */
export function publishWorkResultOperationState(runId: string): void {
  const run = getRun(runId);
  const metadata = workResultOperationMetadata(run?.triggerPayload);
  if (!run || !metadata) return;
  const event = getChatEventById(metadata.messageId);
  if (!event) return;
  const raw = { resultOperation: { ...metadata, runId, status: run.status, statusReason: run.statusReason } };
  getDb().update(chatEvents).set({ raw }).where(eq(chatEvents.id, event.id)).run();
  if (run.status === 'failed') bumpSessionOutcome(event.sessionId);
  publishChatEvent({ ...event, raw });
}

/** Separate attention projections never turn an internal reviewer into an ordinary chat. */
export function listWorkResultReviewAttentionSessions(userId = 'local') {
  return getDb().select({
    sessionId: chatSessions.id, reviewId: workResultAiReviews.id, resultId: workResultAiReviews.resultId,
    status: workResultAiReviews.status, statusReason: workResultAiReviews.statusReason,
    label: chatSessions.label, lastOutcomeEventAt: chatSessions.lastOutcomeEventAt,
    lastViewedAt: chatSessions.lastViewedAt,
  }).from(workResultAiReviews).innerJoin(chatSessions, and(
    eq(chatSessions.id, workResultAiReviews.reviewerSessionId), eq(chatSessions.surfaceKind, 'result_review'),
  )).where(and(eq(workResultAiReviews.userId, userId), eq(chatSessions.userId, userId),
    eq(chatSessions.status, 'active'), inArray(workResultAiReviews.status, ['queued', 'running', 'failed']),
  )).all();
}

/** Provider-origin init/result telemetry only. Never use the requested session tuple as an observation. */
export function getWorkResultObservedReviewerModel(sessionId: string): string | null {
  const row = getDb().select({ raw: chatEvents.raw }).from(chatEvents).where(and(
    eq(chatEvents.sessionId, sessionId), inArray(chatEvents.source, ['system', 'result']),
    sql`json_type(${chatEvents.raw}, '$.model') = 'text'`,
  )).orderBy(sql`${chatEvents.createdAt} DESC`, sql`${chatEvents.id} DESC`).limit(1).get();
  const raw = row?.raw as Record<string, unknown> | undefined;
  return typeof raw?.model === 'string' && raw.model.trim() ? raw.model : null;
}
