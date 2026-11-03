import { and, asc, desc, eq, isNotNull, lte, lt, gte, ne, or, isNull, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { getDb } from '@/lib/db';
import { conversationConnections as connections, conversationIdentities as identities, conversationThreads as threads, conversationInputs as inputs, conversationOutputs as outputs } from './schema';
import type { ConversationInput, ConversationOutput, CreateConversationConnection } from '@/db/types';
import { getAgentHistoryEvent, getChatEventById, getRun } from './queries';
import { stableCoordinationId } from '@/lib/coordination/ids';
import { messageText } from '@/lib/notifications/message-text';
import { nameEntity } from '@/lib/notifications/turn-reply';

export function listConversationConnections() { return getDb().select().from(connections).all(); }
export function getConversationConnection(id: string) { return getDb().select().from(connections).where(eq(connections.id, id)).get() ?? null; }
export function createConversationConnection(input: CreateConversationConnection) { return getDb().insert(connections).values(input).returning().get(); }
export function updateConversationConnection(id: string, patch: Partial<Pick<CreateConversationConnection, 'enabled' | 'channels' | 'error' | 'name'>>) {
  return getDb().update(connections).set(patch).where(eq(connections.id, id)).returning().get();
}
export function deleteConversationConnection(id: string) { getDb().delete(connections).where(eq(connections.id, id)).run(); }

export function createConversationLink(input: { connectionId: string; apiKeyId: string; memberId: string | null; codeHash: string }) {
  return getDb().insert(identities).values({ ...input, id: uuidv7(), expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }).returning().get();
}
export function consumeConversationLink(connectionId: string, externalUserId: string, codeHash: string) {
  return getDb().transaction(() => {
    const link = getDb().select().from(identities).where(and(eq(identities.connectionId, connectionId), eq(identities.codeHash, codeHash), gte(identities.expiresAt, new Date().toISOString()))).get();
    if (!link) return null;
    // Keep old input reservations when a person relinks. Deleting their identity
    // would cascade into the inbox and allow an old provider event to run again.
    getDb().update(identities).set({ externalUserId: null }).where(and(eq(identities.connectionId, connectionId), eq(identities.externalUserId, externalUserId))).run();
    return getDb().update(identities).set({ externalUserId, codeHash: null, expiresAt: null }).where(eq(identities.id, link.id)).returning().get();
  });
}
export function conversationIdentity(connectionId: string, externalUserId: string) {
  return getDb().select().from(identities).where(and(eq(identities.connectionId, connectionId), eq(identities.externalUserId, externalUserId))).get() ?? null;
}
export function getConversationIdentity(id: string) { return getDb().select().from(identities).where(eq(identities.id, id)).get() ?? null; }
export function listConversationIdentities(connectionId: string) {
  return getDb().select({ id: identities.id, apiKeyId: identities.apiKeyId, memberId: identities.memberId, externalUserId: identities.externalUserId }).from(identities).where(and(eq(identities.connectionId, connectionId), isNotNull(identities.externalUserId))).all();
}
export function conversationThreadIdentities(threadId: string) {
  const participants = getDb().select({ id: inputs.identityId }).from(inputs).where(eq(inputs.threadId, threadId));
  return getDb().select().from(identities).where(and(inArray(identities.id, participants), isNotNull(identities.externalUserId))).all();
}
export function revokeConversationIdentity(id: string, apiKeyId: string) { getDb().update(identities).set({ externalUserId: null, codeHash: null, expiresAt: null }).where(and(eq(identities.id, id), eq(identities.apiKeyId, apiKeyId))).run(); }
export function findConversationThread(connectionId: string, channelId: string, threadId: string) {
  return getDb().select().from(threads).where(and(eq(threads.connectionId, connectionId), eq(threads.channelId, channelId), eq(threads.threadId, threadId))).get() ?? null;
}
export function ensureConversationThread(connectionId: string, channelId: string, threadId: string) {
  getDb().insert(threads).values({ id: uuidv7(), connectionId, channelId, threadId }).onConflictDoNothing().run();
  return findConversationThread(connectionId, channelId, threadId)!;
}
export function getConversationThread(id: string) { return getDb().select().from(threads).where(eq(threads.id, id)).get() ?? null; }
export function conversationThreadForSession(id: string) { return getDb().select().from(threads).where(eq(threads.sessionId, id)).get() ?? null; }
export function bindConversationThread(id: string, sessionId: string) { getDb().update(threads).set({ sessionId }).where(eq(threads.id, id)).run(); }
export function acceptConversationInput(input: Pick<ConversationInput, 'threadId' | 'identityId' | 'externalEventId' | 'content' | 'kind'>) {
  getDb().insert(inputs).values({ ...input, id: uuidv7(), createdAt: new Date().toISOString(), eventId: stableCoordinationId('conversation-event', input.threadId, input.externalEventId), status: 'queued' }).onConflictDoNothing().run();
  const accepted = getDb().select().from(inputs).where(and(eq(inputs.threadId, input.threadId), eq(inputs.externalEventId, input.externalEventId))).get()!;
  if (accepted.content !== input.content || accepted.identityId !== input.identityId || accepted.kind !== input.kind) throw new Error('This external event already belongs to different input.');
  return accepted;
}
// Stop must overtake queued work, including when a busy thread fills the batch.
export function dueConversationInputs() { return getDb().select().from(inputs).where(eq(inputs.status, 'queued')).orderBy(desc(inputs.kind), asc(inputs.createdAt), asc(inputs.id)).limit(50).all(); }
export function hasQueuedConversationInputs(threadId: string) { return Boolean(getDb().select({ id: inputs.id }).from(inputs).where(and(eq(inputs.threadId, threadId), eq(inputs.status, 'queued'))).limit(1).get()); }
export function getConversationInput(id: string) { return getDb().select().from(inputs).where(eq(inputs.id, id)).get() ?? null; }
export function finishConversationInput(id: string, status: 'accepted' | 'failed', error: string | null = null) {
  getDb().update(inputs).set({ status, error }).where(eq(inputs.id, id)).run();
}
export function cancelQueuedConversationInputs(stop: ConversationInput) {
  getDb().update(inputs).set({ status: 'failed', error: 'Stopped before this message started.' }).where(and(eq(inputs.threadId, stop.threadId), eq(inputs.status, 'queued'),
    or(lt(inputs.createdAt, stop.createdAt), and(eq(inputs.createdAt, stop.createdAt), lt(inputs.id, stop.id))))).run();
}
export function queueConversationOutput(threadId: string, key: string, content: string, kind: ConversationOutput['kind'] = 'reply') {
  const thread = getConversationThread(threadId);
  if (thread && getConversationConnection(thread.connectionId)?.provider === 'slack') {
    // Snapshot transport text before the first send, so retries keep the same parts even if a title changes.
    content = messageText(content, nameEntity, 'slack');
  }
  getDb().insert(outputs).values({ id: uuidv7(), createdAt: new Date().toISOString(), threadId, key, content, kind, status: 'pending' }).onConflictDoNothing().run();
}
export function dueConversationOutputs(threadId?: string) { return getDb().select().from(outputs).where(and(eq(outputs.status, 'pending'), threadId ? eq(outputs.threadId, threadId) : undefined, or(isNull(outputs.nextAttemptAt), lte(outputs.nextAttemptAt, new Date().toISOString())))).orderBy(asc(outputs.createdAt), asc(outputs.id)).limit(50).all(); }
export function updateConversationOutput(id: string, patch: Partial<Pick<ConversationOutput, 'part' | 'status' | 'attempts' | 'nextAttemptAt' | 'error'>>) { getDb().update(outputs).set(patch).where(eq(outputs.id, id)).run(); }
export function getConversationOutput(id: string) { return getDb().select().from(outputs).where(eq(outputs.id, id)).get() ?? null; }
export function retryConversationOutputs(connectionId: string) {
  const linked = getDb().select({ id: threads.id }).from(threads).where(eq(threads.connectionId, connectionId));
  getDb().update(outputs).set({ status: 'pending', nextAttemptAt: null, error: null, attempts: 0 }).where(and(inArray(outputs.threadId, linked), eq(outputs.status, 'failed'))).run();
}
export function conversationOutputsForConnection(connectionId: string, threadId?: string) {
  return getDb().select({ output: outputs }).from(outputs).innerJoin(threads, eq(threads.id, outputs.threadId))
    .where(and(eq(threads.connectionId, connectionId), eq(outputs.status, 'pending'), threadId ? eq(threads.id, threadId) : undefined))
    .orderBy(asc(outputs.createdAt), asc(outputs.id)).limit(50).all().map(row => row.output);
}
export function slackConversationOutputs() {
  return getDb().select({ output: outputs }).from(outputs).innerJoin(threads, eq(threads.id, outputs.threadId)).innerJoin(connections, eq(connections.id, threads.connectionId))
    .where(and(eq(connections.provider, 'slack'), eq(connections.enabled, true), eq(outputs.status, 'pending'), or(isNull(outputs.nextAttemptAt), lte(outputs.nextAttemptAt, new Date().toISOString()))))
    .orderBy(asc(outputs.createdAt), asc(outputs.id)).limit(50).all().map(row => row.output);
}

/** One indexed update per root event, rather than copying every cumulative text revision. */
export function bindConversationRun(sessionId: string, runId: string) {
  getDb().update(threads).set({ lastRunId: runId, responseEventId: null }).where(and(eq(threads.sessionId, sessionId), or(isNull(threads.lastRunId), ne(threads.lastRunId, runId)))).run();
}
export function recordConversationOutput(sessionId: string, runId: string | null | undefined, eventId: string) {
  if (!runId) return;
  getDb().update(threads).set({ lastRunId: runId, responseEventId: eventId }).where(and(eq(threads.sessionId, sessionId), or(isNull(threads.responseEventId), ne(threads.responseEventId, eventId)))).run();
}
export function settleConversationRun(runId: string, outcome: { ok: boolean; stopped?: boolean; errorMessage?: string }) {
  const run = getRun(runId);
  if (!run?.chatSessionId) return false;
  const thread = conversationThreadForSession(run.chatSessionId);
  if (!thread) return false;
  const response = thread.lastRunId === runId && thread.responseEventId ? getAgentHistoryEvent(thread.responseEventId)?.content : null;
  const text = !outcome.ok ? `The work failed: ${outcome.errorMessage ?? 'Inspect this chat in Ri.'}` : outcome.stopped ? 'Stopped. The work is unfinished.' : response || 'The turn finished without a text answer. Open its Ri chat to inspect the saved work.';
  if (text) queueConversationOutput(thread.id, `run:${runId}`, text, outcome.ok ? 'reply' : 'error');
  getDb().update(threads).set({ lastRunId: null, responseEventId: null }).where(and(eq(threads.id, thread.id), eq(threads.lastRunId, runId))).run();
  return true;
}
export function conversationRunsToReconcile() { return getDb().select().from(threads).where(isNotNull(threads.lastRunId)).limit(100).all(); }
export function failConversationMessage(eventId: string, reason: string) {
  const input = getDb().select().from(inputs).where(eq(inputs.eventId, eventId)).get();
  if (!input) return;
  finishConversationInput(input.id, 'failed', reason);
  queueConversationOutput(input.threadId, `refused:${eventId}`, reason, 'error');
}
export function queueConversationHumanMessage(sessionId: string, eventId: string) {
  const thread = conversationThreadForSession(sessionId);
  if (!thread) return;
  const ownInput = getDb().select({ id: inputs.id }).from(inputs).where(eq(inputs.eventId, eventId)).get();
  if (ownInput) return;
  const event = getChatEventById(eventId);
  if (event?.content) queueConversationOutput(thread.id, `human:${eventId}`, `From Ri:\n${event.content}`, 'human');
}
