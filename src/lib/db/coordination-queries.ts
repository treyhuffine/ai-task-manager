import { and, eq, inArray, isNull, lte, or, desc, ne, gt } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { agentRequests, agentDeliveries, chatEvents } from './schema';
import type { AgentRequestRecord, AgentDeliveryRecord, CreateAgentRequestInput } from '@/db/types';
import { stableCoordinationId } from '@/lib/coordination/ids';

const OPEN = ['queued', 'sent', 'waiting'] as const;

export function getAgentRequest(id: string): AgentRequestRecord | null {
  return getDb().select().from(agentRequests).where(eq(agentRequests.id, id)).get() ?? null;
}

export function findAgentRequest(sourceSessionId: string, requestKey: string): AgentRequestRecord | null {
  return getDb().select().from(agentRequests).where(and(eq(agentRequests.sourceSessionId, sourceSessionId), eq(agentRequests.requestKey, requestKey))).get() ?? null;
}

export function createAgentRequest(input: CreateAgentRequestInput): AgentRequestRecord {
  getDb().insert(agentRequests).values({ ...input, status: 'queued', nextAttemptAt: new Date().toISOString() }).onConflictDoNothing().run();
  return getAgentRequest(input.id)!;
}

export function updateAgentRequest(id: string, patch: Partial<Pick<AgentRequestRecord, 'targetSessionId' | 'runId' | 'status' | 'nextAttemptAt' | 'attempts' | 'error' | 'response' | 'responseEventId'>>): void {
  getDb().update(agentRequests).set(patch).where(eq(agentRequests.id, id)).run();
}

export function listAgentRequests(sessionId: string, direction: 'incoming' | 'outgoing' = 'outgoing', limit = 30): AgentRequestRecord[] {
  return getDb().select().from(agentRequests).where(direction === 'incoming'
    ? eq(agentRequests.targetSessionId, sessionId) : eq(agentRequests.sourceSessionId, sessionId)).orderBy(desc(agentRequests.createdAt), desc(agentRequests.id)).limit(limit).all();
}

export function openAgentRequestsForTarget(sessionId: string): AgentRequestRecord[] {
  return getDb().select().from(agentRequests).where(and(eq(agentRequests.targetSessionId, sessionId), inArray(agentRequests.status, [...OPEN]))).limit(100).all();
}

export function hasOutstandingAgentRequests(sessionId: string, parentRequestId?: string): boolean {
  return !!getDb().select({ id: agentRequests.id }).from(agentRequests).where(and(eq(agentRequests.sourceSessionId, sessionId), parentRequestId ? eq(agentRequests.parentRequestId, parentRequestId) : undefined, inArray(agentRequests.kind, ['question', 'delegation']), inArray(agentRequests.status, [...OPEN]))).limit(1).get();
}

export function dueAgentRequests(limit = 25): AgentRequestRecord[] {
  return getDb().select().from(agentRequests).where(and(eq(agentRequests.status, 'queued'), or(isNull(agentRequests.nextAttemptAt), lte(agentRequests.nextAttemptAt, new Date().toISOString())))).orderBy(agentRequests.createdAt, agentRequests.id).limit(limit).all();
}

export function unsettledAgentRequests(limit = 100, afterId?: string): AgentRequestRecord[] {
  return getDb().select().from(agentRequests).where(and(inArray(agentRequests.status, ['sent', 'waiting']), afterId ? gt(agentRequests.id, afterId) : undefined)).orderBy(agentRequests.id).limit(limit).all();
}

export function queueAgentDelivery(request: AgentRequestRecord, kind: AgentDeliveryRecord['kind'], key: string, content: string): void {
  const id = stableCoordinationId('delivery', request.id, key);
  getDb().insert(agentDeliveries).values({ id, requestId: request.id, dedupeKey: key, kind, content, eventId: stableCoordinationId('event', id), status: 'pending', nextAttemptAt: new Date().toISOString() }).onConflictDoNothing().run();
}

export function dueAgentDeliveries(limit = 25): AgentDeliveryRecord[] {
  return getDb().select().from(agentDeliveries).where(and(eq(agentDeliveries.status, 'pending'), or(isNull(agentDeliveries.nextAttemptAt), lte(agentDeliveries.nextAttemptAt, new Date().toISOString())))).orderBy(agentDeliveries.createdAt, agentDeliveries.id).limit(limit).all();
}

export function updateAgentDelivery(id: string, patch: Partial<Pick<AgentDeliveryRecord, 'status' | 'attempts' | 'nextAttemptAt' | 'error' | 'deliveredToSessionId'>>): void {
  getDb().update(agentDeliveries).set(patch).where(eq(agentDeliveries.id, id)).run();
}

export function listAgentDeliveries(requestId: string): AgentDeliveryRecord[] {
  return getDb().select().from(agentDeliveries).where(eq(agentDeliveries.requestId, requestId)).orderBy(agentDeliveries.createdAt).limit(100).all();
}

/** Bound before the runner can report output, for local and worker sends. */
export function bindAgentRequestRun(eventId: string | null | undefined, sessionId: string, runId: string): void {
  if (!eventId) return;
  const message = getDb().select({ sessionId: chatEvents.sessionId, senderSessionId: chatEvents.senderSessionId }).from(chatEvents).where(eq(chatEvents.id, eventId)).get();
  if (message?.sessionId === sessionId && message.senderSessionId) {
    getDb().update(agentRequests).set({ runId, targetSessionId: sessionId, status: 'sent', error: null }).where(and(eq(agentRequests.messageEventId, eventId), eq(agentRequests.sourceSessionId, message.senderSessionId), or(isNull(agentRequests.targetSessionId), eq(agentRequests.targetSessionId, sessionId)), inArray(agentRequests.status, [...OPEN]))).run();
  }
  const reply = getDb().select().from(agentDeliveries).where(eq(agentDeliveries.eventId, eventId)).get();
  const request = reply ? getAgentRequest(reply.requestId) : null;
  if (reply && request?.sourceSessionId === sessionId && request.parentRequestId && reply.kind !== 'blocked' && !hasOutstandingAgentRequests(sessionId, request.parentRequestId)) {
    // A child consultation has answered. The resumed turn continues the
    // original assignment, which was waiting rather than falsely complete.
    getDb().update(agentRequests).set({ runId, status: 'sent', response: null, responseEventId: null }).where(and(eq(agentRequests.id, request.parentRequestId), eq(agentRequests.targetSessionId, sessionId), eq(agentRequests.status, 'waiting'))).run();
  }
}

/** Descendants are bounded by their source chat's existing index. */
export function childAgentRequests(request: AgentRequestRecord): AgentRequestRecord[] {
  if (!request.targetSessionId) return [];
  return getDb().select().from(agentRequests).where(and(eq(agentRequests.sourceSessionId, request.targetSessionId), eq(agentRequests.parentRequestId, request.id), inArray(agentRequests.status, [...OPEN]))).all();
}

/** Only the root assistant output from this exact run can answer a request. */
export function recordAgentRequestOutput(runId: string | null | undefined, eventId: string): void {
  if (!runId) return;
  getDb().update(agentRequests).set({ responseEventId: eventId, response: null }).where(and(eq(agentRequests.runId, runId), inArray(agentRequests.status, ['sent', 'waiting']), or(isNull(agentRequests.responseEventId), ne(agentRequests.responseEventId, eventId)))).run();
}

export function finishAgentRequest(id: string, status: 'completed' | 'failed' | 'cancelled', response: string, responseEventId?: string | null): void {
  getDb().transaction(() => {
    const request = getAgentRequest(id);
    if (!request || !OPEN.includes(request.status as typeof OPEN[number])) return;
    updateAgentRequest(id, { status, response, responseEventId: responseEventId ?? request.responseEventId, error: status === 'completed' ? null : response, nextAttemptAt: null });
    if (request.kind !== 'message') queueAgentDelivery(request, status === 'completed' ? 'response' : status, 'outcome', response);
  });
}

export function settleAgentRequestsForRun(runId: string, outcome: { ok: boolean; stopped?: boolean; errorMessage?: string }): boolean {
  const requests = getDb().select().from(agentRequests).where(and(eq(agentRequests.runId, runId), inArray(agentRequests.status, ['sent', 'waiting']))).all();
  // A stopped run completes for the person who stopped it, but the requester
  // must not read its partial output as finished work.
  const completed = outcome.ok && !outcome.stopped;
  for (const request of requests) {
    if (completed && request.targetSessionId && hasOutstandingAgentRequests(request.targetSessionId, request.id)) {
      updateAgentRequest(request.id, { status: 'waiting' });
    } else {
      const output = request.responseEventId ? getDb().select({ content: chatEvents.content }).from(chatEvents).where(eq(chatEvents.id, request.responseEventId)).get()?.content : null;
      finishAgentRequest(request.id, completed ? 'completed' : 'failed', completed
        ? output?.slice(0, 80_000) || request.response || 'The turn finished without a text answer. Inspect the linked chat for its tools and saved results.'
        : outcome.stopped
          ? 'A person stopped this work before it finished. Inspect the responding chat before continuing.'
          : outcome.errorMessage || 'The requested work failed.', request.responseEventId);
    }
  }
  return requests.length > 0;
}

/** Indexed admission for initial inputs and automatic continuations, without reading bodies. */
export function agentMessageAdmission(eventId: string | null | undefined): { id: string; refusal: string | null } | null {
  if (!eventId) return null;
  const db = getDb();
  const ended = (status: AgentRequestRecord['status']) => ['completed', 'failed', 'cancelled'].includes(status);
  const direct = db.select({ id: agentRequests.id, status: agentRequests.status }).from(agentRequests).where(eq(agentRequests.messageEventId, eventId)).get();
  if (direct) return { id: direct.id, refusal: ended(direct.status) ? 'This agent request has ended. Its work will not be started.' : null };
  const delivery = db.select({ requestId: agentDeliveries.requestId, kind: agentDeliveries.kind }).from(agentDeliveries).where(eq(agentDeliveries.eventId, eventId)).get();
  if (!delivery) return null;
  const request = db.select({ status: agentRequests.status, parentRequestId: agentRequests.parentRequestId }).from(agentRequests).where(eq(agentRequests.id, delivery.requestId)).get();
  let refusal = !request || (delivery.kind === 'blocked' && ended(request.status)) ? 'This request has ended. Its blocked update is no longer current.' : null;
  if (request?.parentRequestId) {
    const parent = db.select({ status: agentRequests.status }).from(agentRequests).where(eq(agentRequests.id, request.parentRequestId)).get();
    if (!parent || ended(parent.status)) refusal = 'The requesting assignment has ended. Its work will not be resumed.';
  }
  return { id: delivery.requestId, refusal };
}

export function agentRequestMessageRefusal(eventId: string | null | undefined): string | null {
  return agentMessageAdmission(eventId)?.refusal ?? null;
}

export function failAgentRequestForMessage(eventId: string, reason: string): boolean {
  const request = getDb().select().from(agentRequests).where(eq(agentRequests.messageEventId, eventId)).get();
  if (request) finishAgentRequest(request.id, 'failed', reason);
  return !!request;
}

export function queueAgentBlockedUpdates(sessionId: string, pendingId: string, detail: string): number {
  let count = 0;
  for (const request of openAgentRequestsForTarget(sessionId)) {
    if (request.kind !== 'message') { queueAgentDelivery(request, 'blocked', `blocked:${pendingId}`, detail); count++; }
  }
  return count;
}
