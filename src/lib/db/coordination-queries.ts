import { and, eq, inArray, isNull, lte, or, desc, ne, gt, sql } from 'drizzle-orm';
import { publishChatEvent } from '@/lib/realtime/bus';
import { getDb } from '@/lib/db';
import { agentCoordinationRequests as requests, agentCoordinationDeliveries as deliveries, chatSessions, executions, workspaces, userState, workerCommands } from './schema';
import type { AgentRequestRecord, ChatEventRecord, AgentDeliveryRecord, CreateAgentRequestInput, CreateAgentDeliveryInput, RunRecord } from '@/db/types';
import { inputIsPreparing } from '@/lib/coordination/input-reservations';
import { addressOf } from '@/lib/coordination/address';
import { coordinationProducer } from '@/lib/coordination/run-context';
import { stableCoordinationId } from '@/lib/coordination/ids';
import { AGENT_RESPONSE_INSTRUCTIONS, AGENT_BLOCKED_INSTRUCTIONS, CHAT_MESSAGE_SENT } from '@/lib/sessions/chat-message';
import { createRun, getChatSession, getChatEventById, getRun, getRunForSourceEvent, getSendForEvent, insertChatEvent, updateRun, WAITING_FOR_COORDINATION } from './queries';

const OPEN = ['queued', 'working', 'waiting'] as const;
const TERMINAL = ['completed', 'failed', 'cancelled'];
const now = () => new Date().toISOString();
export const isOpenAgentRequest = (request: AgentRequestRecord) => !TERMINAL.includes(request.status);

export function getAgentRequest(id: string): AgentRequestRecord | null {
  return getDb().select().from(requests).where(eq(requests.id, id)).get() ?? null;
}
export function findAgentRequest(sourceSessionId: string, requestKey: string): AgentRequestRecord | null {
  return getDb().select().from(requests).where(and(eq(requests.sourceSessionId, sourceSessionId), eq(requests.requestKey, requestKey))).get() ?? null;
}
export function createAgentRequest(input: CreateAgentRequestInput): AgentRequestRecord {
  getDb().insert(requests).values({ ...input, status: 'queued' }).onConflictDoNothing().run();
  return getAgentRequest(input.id)!;
}
export function updateAgentRequest(id: string, patch: Partial<Pick<AgentRequestRecord, 'targetSessionId' | 'runId' | 'status' | 'responseEventId'>>): void {
  getDb().update(requests).set(patch).where(eq(requests.id, id)).run();
}
export function listAgentRequests(sessionId: string, direction: 'incoming' | 'outgoing' = 'outgoing', limit = 30): AgentRequestRecord[] {
  return getDb().select().from(requests).where(eq(direction === 'incoming' ? requests.targetSessionId : requests.sourceSessionId, sessionId)).orderBy(desc(requests.createdAt), desc(requests.id)).limit(limit).all();
}
export function openAgentRequestsForTarget(sessionId: string): AgentRequestRecord[] {
  return getDb().select().from(requests).where(and(eq(requests.targetSessionId, sessionId), inArray(requests.status, [...OPEN]))).orderBy(requests.createdAt, requests.id).limit(100).all();
}
export function assignedAgentRequestsForRun(runId: string): AgentRequestRecord[] {
  return getDb().select().from(requests).where(eq(requests.runId, runId)).limit(2).all();
}
export function agentRequestForRun(runId: string): AgentRequestRecord | null {
  return getDb().select().from(requests).where(and(eq(requests.runId, runId), inArray(requests.status, [...OPEN]))).get() ?? null;
}
export function hasOutstandingAgentRequests(sessionId: string, parentRequestId?: string): boolean {
  return !!getDb().select({ id: requests.id }).from(requests).where(and(eq(requests.sourceSessionId, sessionId), parentRequestId ? eq(requests.parentRequestId, parentRequestId) : undefined, inArray(requests.status, [...OPEN]))).limit(1).get();
}
export function unsettledAgentRequests(limit = 100, afterId?: string): AgentRequestRecord[] {
  return getDb().select().from(requests).where(and(inArray(requests.status, [...OPEN]), afterId ? gt(requests.id, afterId) : undefined)).orderBy(requests.id).limit(limit).all();
}
export function childAgentRequests(request: AgentRequestRecord): AgentRequestRecord[] {
  return getDb().select().from(requests).where(and(eq(requests.parentRequestId, request.id), inArray(requests.status, [...OPEN]))).all();
}
export function getAgentDelivery(id: string): AgentDeliveryRecord | null {
  return getDb().select().from(deliveries).where(eq(deliveries.id, id)).get() ?? null;
}
export function agentDeliveryForEvent(eventId: string): AgentDeliveryRecord | null {
  return getDb().select().from(deliveries).where(eq(deliveries.eventId, eventId)).get() ?? null;
}
export function initialAgentDelivery(requestId: string): AgentDeliveryRecord | null {
  return getDb().select().from(deliveries).where(and(eq(deliveries.requestId, requestId), eq(deliveries.kind, 'request'))).get() ?? null;
}
export function terminalAgentDelivery(requestId: string): AgentDeliveryRecord | null {
  return getDb().select().from(deliveries).where(and(eq(deliveries.requestId, requestId), inArray(deliveries.kind, ['answer', 'failed', 'cancelled']))).get() ?? null;
}
export function createAgentDelivery(input: CreateAgentDeliveryInput): AgentDeliveryRecord {
  getDb().insert(deliveries).values(input).onConflictDoNothing().run();
  return getAgentDelivery(input.id)!;
}
export function updateAgentDelivery(id: string, patch: Partial<Pick<AgentDeliveryRecord, 'status' | 'attempts' | 'nextAttemptAt' | 'error' | 'targetSessionId' | 'acceptedByRunId' | 'continuationRunId'>>): void {
  getDb().update(deliveries).set(patch).where(eq(deliveries.id, id)).run();
}
export function listAgentDeliveries(requestId: string): AgentDeliveryRecord[] {
  return getDb().select().from(deliveries).where(eq(deliveries.requestId, requestId)).orderBy(deliveries.createdAt, deliveries.id).limit(100).all();
}
export function dueAgentDeliveries(limit = 50): AgentDeliveryRecord[] {
  return getDb().select().from(deliveries).where(and(inArray(deliveries.status, ['queued', 'delivered']), sql`coalesce(json_extract(${deliveries.payload}, '$.contextOnly'), 0) = 0`, or(isNull(deliveries.nextAttemptAt), lte(deliveries.nextAttemptAt, now())))).orderBy(deliveries.createdAt, deliveries.id).limit(limit).all();
}
export function pendingAgentDeliveries(sessionId: string): AgentDeliveryRecord[] {
  return getDb().select().from(deliveries).where(and(eq(deliveries.targetSessionId, sessionId), eq(deliveries.status, 'delivered'))).orderBy(deliveries.createdAt, deliveries.id).limit(200).all();
}
/** Durable sends reserve their complete input batch before preparation. */
export function reserveCoordinationInputs(runId: string, inputs: AgentDeliveryRecord[]): void {
  const run = getRun(runId);
  if (!run) throw new Error('Run not found.');
  const payload = typeof run.triggerPayload === 'object' && run.triggerPayload ? run.triggerPayload : {};
  updateRun(runId, { triggerPayload: { ...payload, coordinationDeliveryIds: inputs.map(input => input.id) } });
}
export function reservedCoordinationInputs(sessionId: string): Set<string> {
  const reserved = new Set<string>();
  for (const input of pendingAgentDeliveries(sessionId)) {
    const run = input.continuationRunId ? getRun(input.continuationRunId) : getRunForSourceEvent(input.eventId);
    if (!run || !['queued', 'running'].includes(run.status)) continue;
    reserved.add(input.id);
    const ids = typeof run.triggerPayload === 'object' && run.triggerPayload ? run.triggerPayload.coordinationDeliveryIds : null;
    if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') reserved.add(id);
  }
  // A remote input can be queued on a human run, whose source event is not
  // itself a coordination event. Its persisted command reserves that batch.
  const sends = getDb().select({ payload: workerCommands.payload }).from(workerCommands).where(and(eq(workerCommands.chatSessionId, sessionId), eq(workerCommands.kind, 'send'), inArray(workerCommands.state, ['queued', 'sent', 'delivered']))).all();
  for (const send of sends) {
    const ids = (send.payload as { coordinationDeliveryIds?: string[] })?.coordinationDeliveryIds;
    for (const id of ids ?? []) reserved.add(id);
  }
  return reserved;
}
/** A human may steer the current assignment without importing other work. */
export function humanCoordinationContext(sessionId: string, producingRunId: string | null): AgentDeliveryRecord[] {
  const reserved = reservedCoordinationInputs(sessionId);
  const assigned = producingRunId ? agentRequestForRun(producingRunId) : null;
  const assignmentPending = !producingRunId && openAgentRequestsForTarget(sessionId).some(request => request.runId && ['queued', 'running'].includes(getRun(request.runId)?.status ?? ''));
  return pendingAgentDeliveries(sessionId).filter(input => !reserved.has(input.id) && !inputIsPreparing(input.id) && (input.payload.contextOnly || !assignmentPending && (!assigned || input.kind === 'message' && input.payload.relatedRequestId === assigned.id || !!input.requestId && getAgentRequest(input.requestId)?.parentRequestId === assigned.id && input.kind !== 'request')));
}
export function pendingAgentApprovals(sessionId: string): AgentDeliveryRecord[] {
  return getDb().select().from(deliveries).where(and(eq(deliveries.sourceSessionId, sessionId), eq(deliveries.status, 'awaiting_approval'))).orderBy(deliveries.createdAt, deliveries.id).limit(100).all();
}

/** Preference mutations are intentionally separate from generic agent update actions. */
export function agentCoordinationPolicy(sessionId: string) {
  const db = getDb();
  const chat = getChatSession(sessionId);
  if (!chat) throw new Error('Chat not found.');
  const execution = chat.executionId ? db.select({ policy: executions.agentCoordinationPolicy }).from(executions).where(eq(executions.id, chat.executionId)).get() : null;
  const workspace = chat.workspaceId ? db.select({ policy: workspaces.agentCoordinationPolicy }).from(workspaces).where(eq(workspaces.id, chat.workspaceId)).get() : null;
  const global = db.select({ policy: userState.agentCoordinationPolicy }).from(userState).where(eq(userState.id, 1)).get();
  const levels = [{ source: 'chat', value: chat.agentCoordinationPolicy }, { source: 'execution', value: execution?.policy }, { source: 'agent', value: workspace?.policy }, { source: 'global', value: global?.policy }] as const;
  const effective = levels.find(level => level.value != null);
  return { policy: effective?.value ?? 'ask', source: effective?.source ?? 'default', levels, heldAt: chat.coordinationHeldAt };
}
export function setAgentCoordinationPolicy(scope: 'global' | 'agent' | 'execution' | 'chat', id: string, policy: 'ask' | 'allow' | null): void {
  const db = getDb();
  if (scope === 'global') db.update(userState).set({ agentCoordinationPolicy: policy }).where(eq(userState.id, 1)).run();
  else if (scope === 'agent') db.update(workspaces).set({ agentCoordinationPolicy: policy }).where(eq(workspaces.id, id)).run();
  else if (scope === 'execution') db.update(executions).set({ agentCoordinationPolicy: policy }).where(eq(executions.id, id)).run();
  else db.update(chatSessions).set({ agentCoordinationPolicy: policy }).where(eq(chatSessions.id, id)).run();
}
/** Publish only committed transcript changes, including approval/control audits. */
function withCoordinationEvents<T>(write: (events: ChatEventRecord[]) => T): T {
  const events: ChatEventRecord[] = [];
  const result = getDb().transaction(() => write(events));
  for (const event of events) publishChatEvent(event);
  return result;
}
export function coordinationAudit(sessionId: string, id: string, type: string, data: unknown, events?: ChatEventRecord[]): void {
  insertChatEvent({ id: stableCoordinationId('audit', id, type), sessionId, role: 'system', source: 'system', content: type, raw: { agentCoordination: data } }, events);
}
export function setAgentCoordinationHold(sessionId: string, held: boolean): void {
  withCoordinationEvents(events => {
    const chat = getChatSession(sessionId);
    if (!chat || !!chat.coordinationHeldAt === held) return;
    const heldAt = held ? now() : null;
    getDb().update(chatSessions).set({ coordinationHeldAt: heldAt }).where(eq(chatSessions.id, sessionId)).run();
    if (!held) getDb().update(deliveries).set({ nextAttemptAt: now() }).where(and(eq(deliveries.targetSessionId, sessionId), eq(deliveries.status, 'delivered'))).run();
    coordinationAudit(sessionId, `${sessionId}:${now()}`, 'coordination_hold', { held, heldAt }, events);
  });
}
export function decideAgentDelivery(id: string, decision: 'allow' | 'always' | 'deny'): AgentDeliveryRecord {
  return withCoordinationEvents(events => {
    const delivery = getAgentDelivery(id);
    if (!delivery) throw new Error('Delivery not found.');
    if (delivery.status !== 'awaiting_approval') return delivery;
    if (!delivery.sourceSessionId) throw new Error('The requesting chat is unavailable.');
    if (decision === 'always') setAgentCoordinationPolicy('chat', delivery.sourceSessionId, 'allow');
    updateAgentDelivery(id, { status: decision === 'deny' ? 'denied' : 'queued', nextAttemptAt: decision === 'deny' ? null : now() });
    if (decision === 'deny' && delivery.kind === 'request' && delivery.requestId) finishAgentRequest(delivery.requestId, 'cancelled', 'The human declined this send. Stand down and do not manufacture a new retry key for unchanged intent.');
    coordinationAudit(delivery.sourceSessionId, id, 'coordination_decision', { deliveryId: id, decision }, events);
    return getAgentDelivery(id)!;
  });
}

/** Receiving event, outgoing receipt and delivered state commit together. */
export function persistAgentDelivery(id: string): AgentDeliveryRecord {
  const broadcasts: ChatEventRecord[] = [];
  const result = getDb().transaction(() => {
    const delivery = getAgentDelivery(id)!;
    if (delivery.status !== 'queued') return delivery;
    if (!delivery.targetSessionId) throw new Error('The destination must be pinned before delivery.');
    const saved = getChatEventById(delivery.eventId);
    if (saved && (saved.sessionId !== delivery.targetSessionId || saved.content !== delivery.payload.prompt || (saved.senderSessionId ?? null) !== (delivery.senderKind === 'agent' ? delivery.sourceSessionId : null) || saved.role !== (delivery.senderKind === 'system' ? 'system' : 'user'))) throw new Error('The delivery event belongs to different intent.');
    insertChatEvent({ id: delivery.eventId, sessionId: delivery.targetSessionId, role: delivery.senderKind === 'system' ? 'system' : 'user', source: delivery.senderKind === 'system' ? 'error' : 'user', senderSessionId: delivery.senderKind === 'agent' ? delivery.sourceSessionId : null, content: delivery.payload.prompt, attachments: delivery.payload.attachments,
      raw: { agentCoordination: { deliveryId: delivery.id, kind: delivery.kind, senderKind: delivery.senderKind, sourceSessionId: delivery.sourceSessionId, sourceEventId: delivery.sourceEventId, requestId: delivery.requestId, content: delivery.payload.content, directions: delivery.payload.directions, originalRequest: delivery.payload.originalRequest, relatedRequestId: delivery.payload.relatedRequestId, lateFollowup: !!delivery.payload.relatedRequestId && !isOpenAgentRequest(getAgentRequest(delivery.payload.relatedRequestId) ?? {status: 'completed'} as AgentRequestRecord) } } }, broadcasts);
    if (delivery.sourceSessionId && delivery.senderKind !== 'agent') insertChatEvent({ id: stableCoordinationId('sent', delivery.eventId), sessionId: delivery.sourceSessionId, role: 'system', source: 'system', content: CHAT_MESSAGE_SENT,
      raw: { chatMessageSent: { version: 1, targetSessionId: delivery.targetSessionId, targetEventId: delivery.eventId, preview: delivery.payload.content.slice(0, 240) } } }, broadcasts);
    updateAgentDelivery(id, { status: 'delivered', error: null, nextAttemptAt: now() });
    return getAgentDelivery(id)!;
  });
  for (const event of broadcasts) publishChatEvent(event);
  return result;
}

export function queueAgentDelivery(request: AgentRequestRecord, kind: 'answer' | 'blocked' | 'failed' | 'cancelled', key: string, content: string, humanDirected = false): AgentDeliveryRecord {
  const id = stableCoordinationId('delivery', request.id, key);
  const originalRequest = initialAgentDelivery(request.id)?.payload.content ?? 'Original request unavailable.';
  const initial = initialAgentDelivery(request.id);
  const originalForModel = originalRequest.length > 20_000 && initial ? `${originalRequest.slice(0, 4000)}\n[Original request continues. Read get_chat_event id:${initial.eventId} in pages for the complete text.]` : originalRequest;
  const answerForModel = content.length > 80_000 && request.responseEventId ? `${content.slice(0, 4000)}\n[The full answer is saved in message ${request.responseEventId}. Use get_chat_event with that ID and page until next_offset is null before acting on the complete answer.]` : content;
  const prompt = `[Ri agent request ${request.id}: ${kind === 'answer' ? 'response' : kind}.]\nRequest: ${originalForModel}\nResponding chat: ${request.targetSessionId ?? 'Ri coordination service (work could not start)'}\n${answerForModel}${humanDirected ? '\n\nHuman direction intervened. Reconcile the user’s latest direction before continuing.' : ''}\n\n${kind === 'blocked' ? AGENT_BLOCKED_INSTRUCTIONS : AGENT_RESPONSE_INSTRUCTIONS}`;
  const sourceEventId = kind === 'answer' ? request.responseEventId : null;
  return createAgentDelivery({ id, requestId: request.id, kind, senderKind: kind === 'answer' && request.runId && request.targetSessionId ? 'agent' : 'system', sourceSessionId: request.targetSessionId, sourceRunId: request.runId, sourceEventId, targetAddress: request.sourceAddress, eventId: stableCoordinationId('event', id), payload: { version: 1, content, prompt, attachments: (sourceEventId ? getChatEventById(sourceEventId)?.attachments : null) ?? [], originalRequest, humanDirected }, status: 'queued', nextAttemptAt: now() });
}
export function finishAgentRequest(id: string, status: 'completed' | 'failed' | 'cancelled', response: string, responseEventId?: string | null): void {
  getDb().transaction(() => {
    const request = getAgentRequest(id);
    if (!request || !isOpenAgentRequest(request)) return;
    updateAgentRequest(id, { status, responseEventId: responseEventId ?? request.responseEventId });
    const humanDirected = !!(request.runId && getChatEventById(stableCoordinationId('audit', request.runId, 'coordination_human_direction')));
    queueAgentDelivery(getAgentRequest(id)!, status === 'completed' ? 'answer' : status, 'outcome', response, humanDirected);
    getDb().update(deliveries).set({ status: 'cancelled', nextAttemptAt: null }).where(and(eq(deliveries.requestId, id), inArray(deliveries.status, ['awaiting_approval', 'queued', 'delivered']), eq(deliveries.kind, 'request'))).run();
  });
}
export function failAgentDelivery(id: string, reason: string): void {
  withCoordinationEvents(events => {
    const delivery = getAgentDelivery(id);
    if (!delivery || ['accepted', 'denied', 'cancelled', 'failed'].includes(delivery.status)) return;
    updateAgentDelivery(id, { status: 'failed', error: reason, nextAttemptAt: null });
    if (delivery.senderKind === 'human' && delivery.sourceSessionId) coordinationAudit(delivery.sourceSessionId, delivery.id, 'coordination_send_failed', { deliveryId: delivery.id }, events);
    if (delivery.kind === 'request' && delivery.requestId) finishAgentRequest(delivery.requestId, 'failed', reason);
  });
}
export function recordAgentRequestOutput(runId: string | null | undefined, eventId: string): void {
  if (!runId) return;
  const event = getChatEventById(eventId);
  if (!event || event.source !== 'agent' || event.role !== 'assistant' || event.externalParentToolCallId || getRun(runId)?.chatSessionId !== event.sessionId) return;
  getDb().update(requests).set({ responseEventId: eventId }).where(and(eq(requests.runId, runId), eq(requests.targetSessionId, event.sessionId), inArray(requests.status, [...OPEN]), or(isNull(requests.responseEventId), ne(requests.responseEventId, eventId)))).run();
}
export function settleAgentRequestsForRun(runId: string, outcome: { ok: boolean; stopped?: boolean; errorMessage?: string }): boolean {
  const assigned = agentRequestForRun(runId);
  if (!assigned || assigned.status === 'queued') return false;
  if (outcome.ok && !outcome.stopped && assigned.targetSessionId && (hasOutstandingAgentRequests(assigned.targetSessionId, assigned.id) || unhandledAgentContinuationUpdates(assigned.id).length > 0)) updateAgentRequest(assigned.id, { status: 'waiting' });
  else finishAgentRequest(assigned.id, outcome.ok && !outcome.stopped ? 'completed' : 'failed', outcome.ok && !outcome.stopped
    ? (assigned.responseEventId ? getChatEventById(assigned.responseEventId)?.content : null) || 'The turn finished without a text answer. Inspect its linked chat for saved results.'
    : outcome.stopped ? 'A person stopped this work before it finished. Inspect the responding chat before continuing.' : outcome.errorMessage || 'The requested work failed.');
  return true;
}

/** Each reservation is durable, including an initial request already read by a human. */
export function reserveAgentRequestTurn(requestId: string): { run: RunRecord; updates: AgentDeliveryRecord[]; continuation: boolean } | null {
  return getDb().transaction(() => {
    const request = getAgentRequest(requestId);
    if (!request || !request.targetSessionId || !['queued', 'waiting'].includes(request.status)) return null;
    if (request.runId) {
      const run = getRun(request.runId);
      if (run?.status === 'running' || (run?.sourceEventId && getSendForEvent(run.sourceEventId))) return null;
      if (run?.status === 'queued' && coordinationDeliveriesForRun(run.id).some(input => input.nextAttemptAt && input.nextAttemptAt > now())) return null;
      if (run?.status === 'queued') return { run, updates: coordinationDeliveriesForRun(run.id), continuation: !!getDb().select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.continuationRunId, run.id)).limit(1).get() };
    }
    const initial = initialAgentDelivery(request.id);
    if (!initial || !['delivered', 'accepted'].includes(initial.status)) return null;
    const children = getDb().select({ id: requests.id }).from(requests).where(eq(requests.parentRequestId, request.id)).all();
    const updates = children.flatMap(child => listAgentDeliveries(child.id).filter(delivery => !['request', 'message'].includes(delivery.kind) && ['delivered', 'accepted'].includes(delivery.status) && !delivery.continuationRunId && delivery.targetSessionId === request.targetSessionId));
    updates.push(...getDb().select().from(deliveries).where(and(eq(deliveries.requestId, request.id), eq(deliveries.kind, 'message'), eq(deliveries.targetSessionId, request.targetSessionId), inArray(deliveries.status, ['delivered', 'accepted']), isNull(deliveries.continuationRunId))).orderBy(deliveries.createdAt, deliveries.id).all());
    if (request.status === 'waiting' && !updates.length) return null;
    const continuation = request.status === 'waiting';
    const eventId = continuation ? stableCoordinationId('resume', request.id, ...updates.map(update => update.id)) : initial.eventId;
    const session = getChatSession(request.targetSessionId)!;
    const run = getRunForSourceEvent(eventId) ?? createRun({ id: stableCoordinationId('run', eventId), triggerId: null, workspaceId: session.workspaceId, executionId: session.executionId, chatSessionId: session.id, harness: session.harness, triggerKind: 'manual', triggerPayload: null, scheduledFor: null, status: 'queued', statusReason: WAITING_FOR_COORDINATION, sourceEventId: eventId });
    updateAgentRequest(request.id, { runId: run.id, status: 'queued', responseEventId: null });
    for (const update of updates) updateAgentDelivery(update.id, { continuationRunId: run.id });
    return { run, updates: continuation ? updates : [initial, ...updates], continuation };
  });
}
export function coordinationDeliveriesForRun(runId: string): AgentDeliveryRecord[] {
  const reserved = getRun(runId);
  const ids = typeof reserved?.triggerPayload === 'object' && reserved.triggerPayload ? reserved.triggerPayload.coordinationDeliveryIds : null;
  if (Array.isArray(ids)) return ids.filter((id): id is string => typeof id === 'string').map(getAgentDelivery).filter((input): input is AgentDeliveryRecord => !!input);
  const continued = getDb().select().from(deliveries).where(eq(deliveries.continuationRunId, runId)).orderBy(deliveries.createdAt, deliveries.id).all();
  if (continued.length) return continued;
  const run = getRun(runId);
  const initial = run?.sourceEventId ? agentDeliveryForEvent(run.sourceEventId) : null;
  return initial ? [initial] : [];
}
export function acceptAgentDeliveriesForRun(runId: string, sessionId: string, deliveryIds?: string[], producingRunId?: string | null): void {
  getDb().transaction(() => {
    const run = getRun(runId);
    if (run?.chatSessionId !== sessionId) throw new Error('The accepting run belongs to another chat.');
    const selected = deliveryIds ? deliveryIds.map(getAgentDelivery).filter((value): value is AgentDeliveryRecord => !!value) : coordinationDeliveriesForRun(runId);
    for (const delivery of selected) {
      if (delivery.targetSessionId !== sessionId) throw new Error('The supplied delivery belongs to another chat.');
      const related = delivery.kind === 'message' && delivery.payload.relatedRequestId ? getAgentRequest(delivery.payload.relatedRequestId) : null;
      if (related && isOpenAgentRequest(related) && related.runId === (producingRunId ?? runId)) updateAgentDelivery(delivery.id, { continuationRunId: related.runId });
      if (delivery.status === 'delivered') updateAgentDelivery(delivery.id, { status: 'accepted', acceptedByRunId: runId, nextAttemptAt: null, error: null });
    }
    const assigned = agentRequestForRun(runId);
    if (assigned) updateAgentRequest(assigned.id, { status: 'working' });
  });
}
export function agentMessageAdmission(eventId: string | null | undefined, acceptingRunId?: string | null, suppliedIds?: string[]): { id: string; refusal: string | null; held: boolean } | null {
  if (!eventId) return null;
  const delivery = agentDeliveryForEvent(eventId);
  const run = !delivery ? getRunForSourceEvent(eventId) : null;
  const request = delivery?.requestId ? getAgentRequest(delivery.requestId) : run ? getDb().select().from(requests).where(eq(requests.runId, run.id)).get() ?? null : null;
  if (!delivery && !request && !suppliedIds?.length) return null;
  const target = delivery?.targetSessionId ?? request?.targetSessionId ?? run?.chatSessionId;
  let refusal = delivery && ['denied', 'failed', 'cancelled', 'awaiting_approval'].includes(delivery.status) ? 'This delivery is not authorized for admission.' : null;
  if (!delivery && request && !isOpenAgentRequest(request)) refusal = 'This assigned continuation has ended.';
  if (delivery?.kind === 'request' && request && !isOpenAgentRequest(request)) refusal = 'This agent request has ended.';
  if (delivery?.kind === 'blocked' && request && !isOpenAgentRequest(request)) refusal = 'This request has ended. Its blocked update is no longer current.';
  if (request?.parentRequestId && delivery && !['request', 'message'].includes(delivery.kind)) {
    const parent = getAgentRequest(request.parentRequestId);
    if (!parent || !isOpenAgentRequest(parent)) refusal = 'The requesting assignment has ended.';
  }
  if (acceptingRunId) {
    for (const input of suppliedIds?.length ? suppliedIds.map(getAgentDelivery) : [delivery]) {
      if (input?.acceptedByRunId && input.acceptedByRunId !== acceptingRunId && input.continuationRunId !== acceptingRunId && !(input.kind === 'request' && input.requestId && getAgentRequest(input.requestId)?.runId === acceptingRunId)) refusal = 'This input was already accepted by another run.';
    }
  }
  return { id: delivery?.id ?? request?.id ?? run!.id, refusal, held: !!(target && getChatSession(target)?.coordinationHeldAt) };
}
export function agentRequestMessageRefusal(eventId: string | null | undefined): string | null {
  return agentMessageAdmission(eventId)?.refusal ?? null;
}
export function failAgentRequestForMessage(eventId: string, reason: string): boolean {
  const delivery = agentDeliveryForEvent(eventId);
  if (delivery) failAgentDelivery(delivery.id, reason);
  return !!delivery;
}
export function queueAgentBlockedUpdates(sessionId: string, pendingId: string, detail: string, producingRunId = coordinationProducer(sessionId)): number {
  const request = producingRunId ? agentRequestForRun(producingRunId) : null;
  const assigned = request?.targetSessionId === sessionId && request.status === 'working' ? [request] : [];
  for (const request of assigned) queueAgentDelivery(request, 'blocked', `blocked:${pendingId}`, detail);
  return assigned.length;
}

/** Settle before SET NULL removes routing provenance. Never resolve a cleared pinned target. */
export function settleCoordinationForDeletedChat(sessionId: string): void {
  getDb().transaction(() => {
    const participating = getDb().select().from(requests).where(and(or(eq(requests.sourceSessionId, sessionId), eq(requests.targetSessionId, sessionId)), inArray(requests.status, [...OPEN]))).all();
    for (const request of participating) if (isOpenAgentRequest(request)) finishAgentRequest(request.id, 'cancelled', 'A participating chat was deleted.');
    getDb().update(deliveries).set({ status: 'cancelled', error: 'A participating chat was deleted.', nextAttemptAt: null }).where(and(or(eq(deliveries.sourceSessionId, sessionId), eq(deliveries.targetSessionId, sessionId)), inArray(deliveries.status, ['awaiting_approval', 'queued', 'delivered']))).run();
  });
}

export function relatedCoordinationChats(sessionId: string) {
  const rows = getDb().select({ sourceSessionId: deliveries.sourceSessionId, targetSessionId: deliveries.targetSessionId }).from(deliveries).where(or(eq(deliveries.sourceSessionId, sessionId), eq(deliveries.targetSessionId, sessionId))).orderBy(desc(deliveries.createdAt)).limit(100).all();
  return [...new Set(rows.flatMap(row => [row.sourceSessionId, row.targetSessionId]).filter((id): id is string => !!id && id !== sessionId))].map(getChatSession).filter((chat): chat is NonNullable<typeof chat> => !!chat);
}

export function createInitiatingAgentDelivery(input: {
  id: string; source: NonNullable<ReturnType<typeof getChatSession>>; sourceRunId: string | null; address: string; targetSessionId: string | null;
  requestKey: string; parentRequestId: string | null; kind: AgentRequestRecord['kind'] | 'message'; content: string; options: AgentRequestRecord['options'];
  eventId: string; prompt: string; relatedRequestId?: string; status: 'queued' | 'awaiting_approval';
}): AgentDeliveryRecord {
  return withCoordinationEvents(events => {
    const existing = getAgentDelivery(input.id);
    if (existing) return existing;
    const request = input.kind === 'message' ? null : createAgentRequest({ id: input.id, sourceSessionId: input.source.id, sourceAddress: addressOf(input.source), targetAddress: input.address, targetSessionId: input.targetSessionId, requestKey: input.requestKey, parentRequestId: input.parentRequestId, kind: input.kind, options: input.options });
    const delivery = createAgentDelivery({ id: input.id, requestId: request?.id ?? input.relatedRequestId, kind: request ? 'request' : 'message', senderKind: 'agent', sourceSessionId: input.source.id, sourceRunId: input.sourceRunId, targetAddress: input.address, targetSessionId: input.targetSessionId, eventId: input.eventId,
      payload: { version: 1, content: input.content, prompt: input.prompt, attachments: [], requestKey: input.requestKey, ...(input.relatedRequestId ? { relatedRequestId: input.relatedRequestId } : {}) }, status: input.status, nextAttemptAt: input.status === 'queued' ? now() : null });
    if (input.status === 'awaiting_approval') coordinationAudit(input.source.id, input.id, 'coordination_proposed', { deliveryId: delivery.id, status: delivery.status }, events);
    return delivery;
  });
}
export function reserveOrdinaryCoordinationTurn(sessionId: string, eventId: string): RunRecord {
  return getDb().transaction(() => {
    const session = getChatSession(sessionId)!;
    return getRunForSourceEvent(eventId) ?? createRun({ id: stableCoordinationId('run', eventId), triggerId: null, workspaceId: session.workspaceId, executionId: session.executionId, chatSessionId: sessionId, harness: session.harness, triggerKind: 'manual', triggerPayload: null, scheduledFor: null, status: 'queued', statusReason: WAITING_FOR_COORDINATION, sourceEventId: eventId });
  });
}
export function deliveryNeedsAssignmentContinuation(delivery: AgentDeliveryRecord): boolean {
  if (!delivery.requestId || delivery.kind === 'request') return false;
  if (delivery.kind === 'message') {
    const related = getAgentRequest(delivery.requestId);
    return !!related && isOpenAgentRequest(related) && related.targetSessionId === delivery.targetSessionId && !delivery.continuationRunId;
  }
  const child = getAgentRequest(delivery.requestId);
  const parent = child?.parentRequestId ? getAgentRequest(child.parentRequestId) : null;
  return !!parent && isOpenAgentRequest(parent) && !delivery.continuationRunId && parent.targetSessionId === delivery.targetSessionId;
}
export function noteCoordinationHumanDirection(runId: string, sessionId: string): void {
  if (agentRequestForRun(runId)) coordinationAudit(sessionId, runId, 'coordination_human_direction', { runId });
}
export function initializeAgentChildPolicy(sourceSessionId: string, childSessionId: string): void {
  withCoordinationEvents(events => {
    const auditId = stableCoordinationId('audit', childSessionId, 'coordination_initialized');
    if (getChatEventById(auditId)) return;
    const source = agentCoordinationPolicy(sourceSessionId);
    const destination = agentCoordinationPolicy(childSessionId);
    const restriction = destination.levels.find(level => (level.source === 'execution' || level.source === 'agent') && level.value === 'ask');
    const child = getChatSession(childSessionId)!;
    const policy = child.agentCoordinationPolicy ?? (restriction ? 'ask' : source.policy);
    setAgentCoordinationPolicy('chat', childSessionId, policy);
    coordinationAudit(childSessionId, childSessionId, 'coordination_initialized', { policy, source: child.agentCoordinationPolicy != null ? 'existing chat override' : restriction ? `destination ${restriction.source}` : `creator ${source.source}`, sourceSessionId }, events);
  });
}

/** Search small session metadata, never rank the transcript table for a picker. */
export function coordinationChatTargets(input: { search?: string; workspaceId?: string; excludeSessionId?: string; limit?: number }) {
  const term = input.search?.trim();
  return getDb().select({ id: chatSessions.id, label: sql<string | null>`COALESCE(${chatSessions.label},${executions.label})`, type: chatSessions.type, workspaceId: chatSessions.workspaceId, agentName: workspaces.name, lastActivityAt: chatSessions.lastActivityAt, updatedAt: chatSessions.updatedAt, harness: chatSessions.harness })
    .from(chatSessions).leftJoin(workspaces, eq(chatSessions.workspaceId, workspaces.id)).leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .where(and(eq(chatSessions.userId, 'local'), eq(chatSessions.status, 'active'), or(isNull(chatSessions.surfaceKind), inArray(chatSessions.surfaceKind, ['main', 'execution'])),
      input.excludeSessionId ? ne(chatSessions.id, input.excludeSessionId) : undefined,
      input.workspaceId ? eq(chatSessions.workspaceId, input.workspaceId) : undefined,
      term ? sql`(${chatSessions.label} LIKE ${`%${term}%`} OR ${workspaces.name} LIKE ${`%${term}%`} OR ${executions.label} LIKE ${`%${term}%`})` : undefined))
    .orderBy(desc(sql`julianday(COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.updatedAt}))`), desc(chatSessions.id)).limit(Math.min(input.limit ?? 80, 100)).all();
}

export function unhandledAgentContinuationUpdates(requestId: string): AgentDeliveryRecord[] {
  const request = getAgentRequest(requestId);
  const children = getDb().select({ id: requests.id }).from(requests).where(eq(requests.parentRequestId, requestId)).all();
  const updates = children.flatMap(child => listAgentDeliveries(child.id).filter(delivery => !['request', 'message'].includes(delivery.kind) && ['queued', 'delivered', 'accepted'].includes(delivery.status) && !delivery.continuationRunId));
  if (request?.targetSessionId) updates.push(...getDb().select().from(deliveries).where(and(eq(deliveries.requestId, requestId), eq(deliveries.kind, 'message'), eq(deliveries.targetSessionId, request.targetSessionId), inArray(deliveries.status, ['queued', 'delivered', 'accepted']), isNull(deliveries.continuationRunId))).all());
  return updates;
}

export function deferAgentDeliveries(sessionId: string): void {
  getDb().update(deliveries).set({ nextAttemptAt: new Date(Date.now() + 5000).toISOString() }).where(and(eq(deliveries.targetSessionId, sessionId), eq(deliveries.status, 'delivered'))).run();
}
export function pendingAgentDeliveryCount(sessionId: string): number {
  return getDb().select({ count: sql<number>`count(*)` }).from(deliveries).where(and(eq(deliveries.targetSessionId, sessionId), eq(deliveries.status, 'delivered'))).get()!.count;
}
export function stopCoordinationRunsForChat(sessionId: string, producingRunId = coordinationProducer(sessionId)): void {
  getDb().transaction(() => {
    for (const request of openAgentRequestsForTarget(sessionId)) if (request.runId === producingRunId && request.status === 'working') finishAgentRequest(request.id, 'failed', 'A person stopped this work before it finished.');
  });
}

export function incomingAgentDeliveryState(sessionId: string): Record<string, 'delivered' | 'failed' | 'cancelled'> {
  const rows = getDb().select({id:deliveries.id,status:deliveries.status}).from(deliveries).where(and(eq(deliveries.targetSessionId,sessionId),inArray(deliveries.status,['delivered','failed','cancelled']))).orderBy(desc(deliveries.createdAt), desc(deliveries.id)).limit(200).all();
  return Object.fromEntries(rows.map(row=>[row.id,row.status as 'delivered' | 'failed' | 'cancelled']));
}

/** A reservation does not become interrupted work until native acceptance. */
export function isUnacceptedCoordinationRun(runId: string): boolean {
  const assigned = agentRequestForRun(runId);
  if (assigned?.status === 'queued') return true;
  const inputs = coordinationDeliveriesForRun(runId);
  return inputs.length > 0 && inputs.every(input => input.status === 'delivered');
}

/** A sleeping device's durable input queue is busy even without a live mirror. */
export function hasPendingCoordinationSend(sessionId: string): boolean {
  return !!getDb().select({ id: workerCommands.id }).from(workerCommands).where(and(eq(workerCommands.chatSessionId, sessionId), eq(workerCommands.kind, 'send'), inArray(workerCommands.state, ['queued', 'sent']))).limit(1).get();
}

/** Preserve a complete decision without starting work. Normal human input
 * reservations and native acceptance consume it exactly once. */
export function preserveSystemContext(sessionId: string, key: string, content: string): AgentDeliveryRecord {
  const id = stableCoordinationId('system-context', sessionId, key);
  return withCoordinationEvents(events => {
    const existing = getAgentDelivery(id);
    if (existing) return existing;
    const eventId = stableCoordinationId('event', id);
    const delivery = createAgentDelivery({ id, kind: 'message', senderKind: 'system', targetAddress: `session:${sessionId}`, targetSessionId: sessionId, eventId,
      payload: { version: 1, content, prompt: content, attachments: [], contextOnly: true }, status: 'delivered' });
    const shown = `${content}\n\nThis decision is saved. It will be supplied as context with your next message after recovery.`;
    insertChatEvent({ id: eventId, sessionId, role: 'system', source: 'error', content: shown,
      raw: { agentCoordination: { deliveryId: id, senderKind: 'system', kind: 'message', content: shown } } }, events);
    return delivery;
  });
}
