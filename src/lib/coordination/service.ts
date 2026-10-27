import * as q from '@/lib/db/queries';
import type { AgentRequestRecord, AgentDeliveryRecord, ChatSessionRecord } from '@/db/types';
import type { ActionContext } from '@/lib/orchestrator/types';
import { ActionError } from '@/lib/orchestrator/types';
import { serverFetch, ServerResponseError, ServerTransportError } from '@/lib/orchestrator/server-client';
import { SESSION_CREDENTIAL_ENV, SESSION_CREDENTIAL_HEADER, sessionCredential } from '@/lib/orchestrator/session-credential';
import { assertPersonalCapability, isTeamAuthority } from '@/lib/home/authority';
import { processState } from '@/lib/process-state';
import { perfScope } from '@/lib/perf/recorder';
import { inputIsPreparing } from './input-reservations';
import { retryableCoordinationDispatch } from './retry';
import { addressOf } from './address';
import { stableCoordinationId } from './ids';
import { requestScopedId } from './start-id';
import { startDelegatedExecution } from './start-execution';
import { IMPORT_MIRROR_REFUSAL, isImportMirror } from '@/lib/import/mirror';
import { AGENT_MESSAGE_INSTRUCTIONS, AGENT_REQUEST_REPLY_INSTRUCTIONS } from '@/lib/sessions/chat-message';

const state = processState('coordination.delivery', () => ({ draining: null as Promise<void> | null, again: false, reconcileAfterId: null as string | null, timer: null as ReturnType<typeof setInterval> | null }));

export function personalChat(id: string, userId?: string): ChatSessionRecord {
  assertPersonalCapability('Agent coordination');
  const chat = q.getChatSession(id);
  if (!chat || (userId && chat.userId !== userId)) throw new ActionError('not_found', 'Chat not found.');
  if (chat.surfaceKind === 'team_chat' || chat.surfaceKind === 'result_review') throw new ActionError('unsupported', 'This chat uses a separate restricted tool surface.');
  return chat;
}

export function callerChat(ctx: ActionContext): ChatSessionRecord {
  if (!ctx.actor?.sessionId) throw new ActionError('unsupported', 'This operation requires a signed Ri chat.');
  return personalChat(ctx.actor.sessionId);
}

export { addressOf } from './address';

export function normalizeAddress(target: string, source: ChatSessionRecord, assignment: AgentRequestRecord | null = null): string {
  if (target === 'agent') {
    if (!source.workspaceId) throw new ActionError('invalid_params', 'Name an agent as agent:<workspace id>, or use orchestrator.');
    return `agent:${source.workspaceId}`;
  }
  if (target === 'requester') {
    const incoming = assignment;
    if (!incoming) throw new ActionError('not_found', 'This chat has no active requesting chat.');
    if (!incoming.sourceSessionId) throw new ActionError('not_found', 'The requesting chat is unavailable.');
    return `session:${incoming.sourceSessionId}`;
  }
  if (target === 'orchestrator' || /^(agent|session):[^\s:]+$/.test(target)) return target;
  throw new ActionError('invalid_params', 'Use orchestrator, agent, requester, agent:<workspace id>, or session:<chat id>.');
}

export async function resolveAddress(address: string, userId: string): Promise<ChatSessionRecord> {
  const { ensureMainChat } = await import('@/lib/sessions/main-chat');
  let chat: ChatSessionRecord;
  if (address === 'orchestrator') chat = await ensureMainChat(null);
  else if (address.startsWith('agent:')) {
    const workspaceId = address.slice(6);
    const workspace = q.getWorkspace(workspaceId);
    if (!workspace || workspace.status !== 'active') throw new ActionError('not_found', 'That agent is unavailable or archived.');
    chat = await ensureMainChat(workspaceId);
  } else if (address.startsWith('session:')) chat = personalChat(address.slice(8), userId);
  else throw new ActionError('invalid_params', 'Unknown agent address.');
  personalChat(chat.id, userId);
  if (isImportMirror(chat)) throw new ActionError('conflict', IMPORT_MIRROR_REFUSAL);
  if (chat.status !== 'active') throw new ActionError('conflict', 'The addressed chat is archived.');
  return chat;
}

/** Live work is always owned by the server, including calls from a session CLI. */
export async function inCoordinationServer<T>(ctx: ActionContext, name: string, input: unknown, operation: () => Promise<T> | T): Promise<T> {
  if (ctx.remote !== false) return operation();
  const credential = ctx.actor?.sessionId ? sessionCredential(ctx.actor.sessionId) : process.env[SESSION_CREDENTIAL_ENV];
  const envelope = await serverFetch<{ ok: boolean; result?: T; error?: { code?: string; message?: string } }>(`/orchestrator/actions/${name}`, {
    method: 'POST', body: JSON.stringify(input), headers: credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {},
  });
  if (!envelope.ok) throw new ActionError(envelope.error?.code === 'not_found' ? 'not_found' : envelope.error?.code === 'invalid_params' ? 'invalid_params' : envelope.error?.code === 'unsupported' ? 'unsupported' : 'conflict', envelope.error?.message ?? 'The coordination operation failed.');
  return envelope.result as T;
}

/** Resolve actual producer identity; a chat alone is not an assignment identity. */
export async function verifiedCoordinationRun(source: ChatSessionRecord): Promise<string | null> {
  const placement = q.chatPlacement(source.id);
  if (placement?.isHome !== false) {
    const { producingRun } = await import('@/lib/runner/local-runner');
    const runId = producingRun(source.id);
    if (runId && q.getRun(runId)?.chatSessionId === source.id) return runId;
  }
  const { coordinationProducer } = await import('./run-context');
  const remoteRunId = coordinationProducer(source.id);
  if (placement?.isHome === false && remoteRunId && q.getRun(remoteRunId)?.chatSessionId === source.id && q.getRun(remoteRunId)?.status === 'running') return remoteRunId;
  // A transport cannot invent a run. Ambiguous remote or starting contexts
  // must wait for the runner's verified producing-turn evidence.
  if (q.openAgentRequestsForTarget(source.id).some(request => ['queued', 'working', 'waiting'].includes(request.status))) {
    throw new ActionError('conflict', 'The producing assignment run is not yet verified. Retry after its runner context is available.');
  }
  return null;
}

export async function submitAgentRequest(ctx: ActionContext, input: { target: string; requestId: string; content: string; kind: AgentRequestRecord['kind'] | 'message'; options?: AgentRequestRecord['options']; relatedRequestId?: string }) {
  const source = callerChat(ctx);
  if (source.status !== 'active') throw new ActionError('conflict', 'An archived chat cannot start work.');
  if (isImportMirror(source)) throw new ActionError('conflict', IMPORT_MIRROR_REFUSAL);
  const id = stableCoordinationId('request', source.id, input.requestId);
  const prior = q.getAgentDelivery(id);
  const sourceRunId = prior?.sourceRunId ?? await verifiedCoordinationRun(source);
  const assigned = sourceRunId ? q.assignedAgentRequestsForRun(sourceRunId) : [];
  if (!prior && assigned.length > 1) throw new ActionError('conflict', 'The producing run has ambiguous assignment ownership. Resolve that context before creating dependent work.');
  if (!prior && assigned.some(request => ['failed','cancelled'].includes(request.status))) throw new ActionError('conflict', 'This assigned work has ended. Do not restart it by creating independent requests.');
  const parent = sourceRunId ? q.agentRequestForRun(sourceRunId) : null;
  const address = prior && input.target === 'requester' ? prior.targetAddress : normalizeAddress(input.target, source, parent);
  const content = input.content.trim();
  const options = input.options ?? null;
  if (prior) {
    const request = prior.requestId ? q.getAgentRequest(prior.requestId) : null;
    if (prior.targetAddress !== address || prior.payload.content !== content || prior.payload.relatedRequestId !== input.relatedRequestId || (prior.kind === 'message' ? 'message' : request?.kind) !== input.kind || JSON.stringify(prior.kind === 'message' ? null : request?.options ?? null) !== JSON.stringify(options)) throw new ActionError('conflict', 'This retry key belongs to different intent. Use a new key for a different operation.');
    return prior;
  }
  if (input.relatedRequestId && input.kind !== 'message') throw new ActionError('invalid_params', 'related_request_id is only valid with response:"none".');
  let target: ChatSessionRecord | null = null;
  if (input.kind !== 'delegation') {
    // Resolve exact sessions now. Stable main addresses are pinned by the
    // delivery worker only after authorization, before its first attempt.
    if (address.startsWith('session:')) {
      target = personalChat(address.slice(8), source.userId);
      if (target.status !== 'active') throw new ActionError('conflict', 'The addressed chat is archived.');
      if (isImportMirror(target)) throw new ActionError('conflict', IMPORT_MIRROR_REFUSAL);
    } else if (address.startsWith('agent:')) {
      const workspace = q.getWorkspace(address.slice(6));
      if (!workspace || workspace.status !== 'active') throw new ActionError('not_found', 'The addressed agent is unavailable.');
    }
    if (target?.id === source.id || address === addressOf(source)) throw new ActionError('invalid_params', 'That address resolves to this chat. Continue your own work directly.');
  } else {
    const workspace = options ? q.getWorkspace(options.workspaceId) : null;
    if (!workspace || workspace.status !== 'active') throw new ActionError('not_found', 'The destination agent is unavailable.');
  }
  if (input.relatedRequestId) {
    const related = q.getAgentRequest(input.relatedRequestId);
    if (!related || ![related.sourceSessionId, related.targetSessionId].includes(source.id)) throw new ActionError('unsupported', 'This chat does not participate in that request.');
    const participants = [related.sourceAddress, related.targetAddress, `session:${related.sourceSessionId}`, `session:${related.targetSessionId}`];
    if (!participants.includes(address)) throw new ActionError('unsupported', 'Related steering must be sent to a participant.');
  }
  let ancestor = parent;
  for (let depth = 0; ancestor; depth++) {
    if (depth >= 8) throw new ActionError('conflict', 'Resolve the existing request chain before delegating again.');
    ancestor = ancestor.parentRequestId ? q.getAgentRequest(ancestor.parentRequestId) : null;
  }
  // A stable address is exempt only while it still names the exact requester.
  // Delegation creates another chat, so the requester exemption never covers it.
  if (!target && input.kind !== 'delegation' && parent?.sourceSessionId && address === parent.sourceAddress) {
    const scope = address === 'orchestrator' ? null : address.startsWith('agent:') ? address.slice(6) : undefined;
    const current = scope !== undefined ? q.listMainChats(scope, { status: 'active', limit: 1 })[0] : null;
    if (current?.id === parent.sourceSessionId) target = personalChat(current.id, source.userId);
  }
  const toRequester = input.kind !== 'delegation' && !!parent?.sourceSessionId && target?.id === parent.sourceSessionId;
  const authority = q.agentCoordinationPolicy(source.id);
  const status = toRequester || authority.unrestricted || authority.policy === 'allow' ? 'queued' : 'awaiting_approval';
  const eventId = input.kind === 'delegation' ? requestScopedId('prompt', options!.workspaceId, id) : stableCoordinationId('input', id);
  const prompt = `[Ri agent ${input.kind}. Request ID: ${id}. Requesting chat: ${source.id}.]\n${content}\n\n${input.kind === 'message' ? AGENT_MESSAGE_INSTRUCTIONS : AGENT_REQUEST_REPLY_INSTRUCTIONS}`;
  const delivery = q.createInitiatingAgentDelivery({ id, source, sourceRunId, address, targetSessionId: target?.id ?? null, requestKey: input.requestId, parentRequestId: parent?.id ?? null, kind: input.kind, content, options, eventId, prompt, relatedRequestId: input.relatedRequestId, status });
  void drainAgentCoordination();
  return delivery;
}

function retryAt(attempts: number): string {
  return new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6))).toISOString();
}
async function busy(id: string): Promise<boolean> {
  const executor = await import('@/lib/executor/adapter');
  return executor.isRunning(id) || executor.hasBackgroundTasks(id) || q.hasPendingCoordinationSend(id);
}
function permanent(error: unknown): boolean {
  if (error instanceof ServerTransportError) return false;
  return error instanceof ServerResponseError ? error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status)
    : error instanceof ActionError && ['not_found', 'invalid_params', 'unsupported', 'conflict'].includes(error.code);
}

async function persistDelivery(delivery: AgentDeliveryRecord): Promise<void> {
  try {
    if (delivery.senderKind === 'agent' && ['request','message'].includes(delivery.kind)) {
      const source = delivery.sourceSessionId ? q.getChatSession(delivery.sourceSessionId) : null;
      if (!source || source.status === 'archived' && addressOf(source).startsWith('session:')) {
        q.updateAgentDelivery(delivery.id, {status:'cancelled',error:'The requesting chat closed before delivery.',nextAttemptAt:null});
        if (delivery.kind === 'request' && delivery.requestId) q.finishAgentRequest(delivery.requestId,'cancelled','The requesting chat closed before this work started.');
        return;
      }
    }
    let target = delivery.targetSessionId ? personalChat(delivery.targetSessionId) : null;
    const request = delivery.requestId ? q.getAgentRequest(delivery.requestId) : null;
    if (!target && delivery.attempts > 0) throw new ActionError('not_found', 'The pinned destination is unavailable. This send will not be rerouted.');
    if (!target && request?.kind === 'delegation' && delivery.kind === 'request') {
      const outcome = await startDelegatedExecution(request.id);
      target = personalChat(outcome.sessionId);
    } else if (!target && delivery.payload.launch) {
      target = await createForwardDestination(delivery);
    } else if (!target) {
      const source = delivery.sourceSessionId ? personalChat(delivery.sourceSessionId) : null;
      target = await resolveAddress(delivery.targetAddress, source?.userId ?? 'local');
    }
    if (target.status !== 'active') throw new ActionError('not_found', 'The receiving chat is archived.');
    if (isImportMirror(target)) throw new ActionError('conflict', IMPORT_MIRROR_REFUSAL);
    // Pin before any transcript attempt, including an uncertain acknowledgment.
    q.updateAgentDelivery(delivery.id, { targetSessionId: target.id, attempts: delivery.attempts + 1 });
    if (delivery.kind === 'request' && request) q.updateAgentRequest(request.id, { targetSessionId: target.id });
    q.persistAgentDelivery(delivery.id);
  } catch (error) {
    if (permanent(error)) q.failAgentDelivery(delivery.id, error instanceof Error ? error.message : String(error));
    else {
      const current = q.getAgentDelivery(delivery.id)!;
      q.updateAgentDelivery(delivery.id, { nextAttemptAt: current.targetSessionId ? retryAt(current.attempts) : new Date(Date.now()+5000).toISOString(), error: String(error) });
    }
  }
}
async function createForwardDestination(delivery: AgentDeliveryRecord): Promise<ChatSessionRecord> {
  const launch = delivery.payload.launch!;
  const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
  return dispatchExecutionSession({ ...launch, harness: launch.provider, sessionId: requestScopedId('session', launch.workspaceId, delivery.id), actor: { source: 'human', sessionId: null, apiKeyId: null } });
}

async function dispatchReserved(sessionId: string, run: ReturnType<typeof q.getRun> & {}, messages: AgentDeliveryRecord[], prefix = '', human = false): Promise<void> {
  const { expandMarkers } = await import('@/lib/attachments/expand-markers');
  const { expandEntityMarkers } = await import('@/lib/entity-refs/expand-markers');
  const { withSenderLabel } = await import('@/lib/sessions/sender');
  const executor = await import('@/lib/executor/adapter');
  const savedBatch = q.coordinationDeliveriesForRun(run.id);
  const savedPayload = typeof run.triggerPayload === 'object' && run.triggerPayload ? run.triggerPayload : null;
  if (Array.isArray(savedPayload?.coordinationDeliveryIds)) messages = savedBatch;
  q.reserveCoordinationInputs(run.id, messages);
  const attachments = messages.flatMap(message => message.payload.attachments);
  const text = prefix + messages.map(message => withSenderLabel(message.payload.prompt, message.senderKind === 'agent' ? message.sourceSessionId : null)).join('\n\n');
  const expanded = await expandMarkers(expandEntityMarkers(text, sessionId), attachments);
  const first = messages[0];
  const actor = human ? { source: 'human' as const, sessionId: null, apiKeyId: null } : first?.senderKind === 'agent' && first.sourceSessionId ? { source: 'ai' as const, sessionId: first.sourceSessionId, apiKeyId: null } : { source: 'system' as const, sessionId: null, apiKeyId: null };
  try {
    // Launch returns before background worktree creation finishes. Join the
    // same readiness guard as interactive and scheduled sends before dispatch.
    // Connected-device executions stay on their worker's ordered prepare queue.
    const { ensureWorktreeReady } = await import('@/lib/runs/dispatch');
    const session = q.getChatSession(sessionId);
    const ready = await ensureWorktreeReady(sessionId, session?.executionId ? q.getExecution(session.executionId) ?? null : null);
    if (!ready.ok) throw new ActionError('conflict', ready.error);
    await new Promise<void>((resolve, reject) => {
      void executor.dispatch(sessionId, expanded, { runId: run.id, sourceEventId: run.sourceEventId, coordinationDeliveryIds: messages.map(message => message.id), attachments,
        actor, onTaken: resolve, onQueued: resolve }).then(resolve, reject);
    });
  } catch (error) {
    const { CoordinationHeldError } = await import('./hold');
    if (error instanceof CoordinationHeldError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    if (retryableCoordinationDispatch(error)) {
      q.markRunWaitingForCoordination(run.id);
      for (const message of messages) q.updateAgentDelivery(message.id, { attempts: message.attempts + 1, nextAttemptAt: retryAt(message.attempts), error: reason });
      return;
    }
    q.markRunFailed(run.id, { errorCode: 'agent_error', errorMessage: reason });
    const assigned = q.agentRequestForRun(run.id);
    if (assigned) q.finishAgentRequest(assigned.id, 'failed', reason);
    // Context supplied beside the initiating send keeps its own lifecycle.
    const own = run.sourceEventId ? q.agentDeliveryForEvent(run.sourceEventId) : null;
    if (own) q.failAgentDelivery(own.id, reason);
  }
}

async function activateChat(sessionId: string): Promise<void> {
  const target = q.getChatSession(sessionId);
  if (!target || target.status !== 'active') {
    for (const delivery of q.pendingAgentDeliveries(sessionId)) q.failAgentDelivery(delivery.id, 'The receiving chat is no longer active.');
    return;
  }
  for (const delivery of q.pendingAgentDeliveries(sessionId)) {
    const admission = q.agentMessageAdmission(delivery.eventId);
    if (admission?.refusal) q.failAgentDelivery(delivery.id, admission.refusal);
  }
  const pending = q.pendingAgentDeliveries(sessionId).filter(input => !input.payload.contextOnly && (!input.nextAttemptAt || input.nextAttemptAt <= new Date().toISOString()));
  const isBusy = await busy(sessionId);
  const human = pending.find(delivery => delivery.senderKind === 'human' && !inputIsPreparing(delivery.id));
  if (human) {
    if (isBusy && !await concurrentInput(target)) { q.deferAgentDeliveries(sessionId); return; }
    const producer = await verifiedCoordinationRun(target).catch(() => null);
    const context = q.humanCoordinationContext(sessionId, producer).filter(input => input.id !== human.id);
    const run = q.reserveOrdinaryCoordinationTurn(target.id, human.eventId);
    if (run.status === 'queued' && !q.getSendForEvent(human.eventId)) await dispatchReserved(target.id, run, [human, ...context], '[Material shared by the person and pending context. Reading context does not claim its tracked assignments.]\n\n', true);
    return;
  }
  if (target.coordinationHeldAt) { q.deferAgentDeliveries(sessionId); return; }
  const owned = q.openAgentRequestsForTarget(sessionId);
  if (isBusy) {
    q.deferAgentDeliveries(sessionId);
    // Only explicitly related one-way steering can enter an assignment turn.
    const producer = await verifiedCoordinationRun(target).catch(() => null);
    const assigned = producer ? q.agentRequestForRun(producer) : null;
    if (!producer && owned.some(request => request.runId)) return;
    const steering = pending.filter(delivery => !inputIsPreparing(delivery.id) && delivery.kind === 'message' && (!assigned || delivery.payload.relatedRequestId === assigned.id));
    if (!steering.length) return;
    if (!await concurrentInput(target)) return;
    await activateOrdinary(target, steering);
    return;
  }
  const reserved = owned.filter(request => request.runId && ['queued', 'running'].includes(q.getRun(request.runId)?.status ?? ''));
  for (const request of reserved.length ? reserved : owned) {
    const initial = q.initialAgentDelivery(request.id);
    if (initial && inputIsPreparing(initial.id)) return;
    const reservation = q.reserveAgentRequestTurn(request.id);
    // A reserved or working assignment owns this chat until its input or
    // outcome is reconciled, even while its device mirror says idle.
    if (!reservation) { if (request.runId && ['queued', 'running'].includes(q.getRun(request.runId)?.status ?? '')) return; continue; }
    const prefix = reservation.continuation || reservation.updates.some(update => update.status === 'accepted')
      ? `[Continue assigned request ${request.id}. Inspect the current state, prior human work and supplied messages. Reconcile the user's latest direction. Do not blindly repeat earlier side effects.]\n\n`
      : '';
    await dispatchReserved(sessionId, reservation.run, reservation.updates, prefix);
    return;
  }
  const ordinary = pending.filter(delivery => !inputIsPreparing(delivery.id) && delivery.kind !== 'request' && !q.deliveryNeedsAssignmentContinuation(delivery));
  if (ordinary.length) await activateOrdinary(target, ordinary);
}
async function concurrentInput(target: ChatSessionRecord): Promise<boolean> {
  const { harnessCapabilitiesOn } = await import('@/lib/executor/devices');
  const placement = q.chatPlacement(target.id);
  const cwd = q.getChatSessionWithExecution(target.id)?.execution?.worktreePath ?? (target.workspaceId ? q.getWorkspace(target.workspaceId)?.cwd : undefined);
  return (await harnessCapabilitiesOn(placement ?? { deviceId: '', isHome: true }, target.harness, placement?.isHome === false ? undefined : cwd)).concurrentSend;
}
async function activateOrdinary(target: ChatSessionRecord, messages: AgentDeliveryRecord[]): Promise<void> {
  const first = messages[0];
  const run = q.reserveOrdinaryCoordinationTurn(target.id, first.eventId);
  if (run.status !== 'queued' || q.getSendForEvent(first.eventId)) return;
  await dispatchReserved(target.id, run, messages);
}

/** No accepted work is re-executed to manufacture missing metadata. */
async function reconcileRequests(): Promise<AgentRequestRecord[]> {
  const requests = q.unsettledAgentRequests(100, state.reconcileAfterId ?? undefined);
  state.reconcileAfterId = requests.length === 100 ? requests.at(-1)!.id : null;
  for (const request of requests) {
    if (request.targetSessionId && q.getChatSession(request.targetSessionId)?.status === 'archived') q.finishAgentRequest(request.id, 'failed', 'The responding chat was closed before this request finished.');
    if (!request.runId) continue;
    const run = q.getRun(request.runId);
    if (run?.status === 'completed' && request.status === 'working') q.settleAgentRequestsForRun(run.id, { ok: true });
    else if (run && ['failed', 'cancelled', 'skipped'].includes(run.status)) q.finishAgentRequest(request.id, 'failed', run.errorMessage ?? `Work ${run.status}.`);
  }
  return requests;
}
export function drainAgentCoordination(): Promise<void> {
  if (state.draining) { state.again = true; return state.draining; }
  state.draining = perfScope('timer:agent-coordination', async () => {
    do {
      state.again = false;
      const requests = await reconcileRequests();
      const due = q.dueAgentDeliveries();
      for (const delivery of due) {
        if (delivery.status === 'queued') await persistDelivery(delivery);
        else if (['failed', 'cancelled', 'skipped'].includes(q.getRunForSourceEvent(delivery.eventId)?.status ?? '')) q.failAgentDelivery(delivery.id, 'The reserved input did not reach its harness. Inspect the destination before sending again.');
        else if (!delivery.targetSessionId) q.failAgentDelivery(delivery.id, 'The pinned destination was deleted. This input will not be replayed elsewhere.');
      }
      const sessions = new Set(due.map(delivery => q.getAgentDelivery(delivery.id)?.targetSessionId).filter((id): id is string => !!id));
      for (const request of requests) if (request.targetSessionId && ['queued', 'waiting'].includes(request.status)) sessions.add(request.targetSessionId);
      for (const id of sessions) {
        try { await activateChat(id); }
        catch (error) {
          const { CoordinationHeldError } = await import('./hold');
          if (!(error instanceof CoordinationHeldError)) console.warn('[coordination] activation failed', error);
        }
      }
    } while (state.again);
  }).catch(error => { console.warn('[coordination] delivery failed', error); }).finally(() => { state.draining = null; });
  return state.draining;
}

export function startAgentCoordination(): void {
  if (isTeamAuthority() || state.timer) return;
  recoverAgentCoordination();
  void drainAgentCoordination();
  state.timer = setInterval(() => { void drainAgentCoordination(); }, 2000);
  state.timer.unref?.();
}

export async function stopAgentCoordination(): Promise<void> {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  await state.draining;
}

/** Called after startup has stopped orphaned local harnesses. */
export function recoverAgentCoordination(): void {
  let afterId: string | undefined;
  for (;;) {
    const requests = q.unsettledAgentRequests(100, afterId);
    if (!requests.length) break;
    afterId = requests.at(-1)!.id;
    for (const request of requests) {
      if (!request.runId) {
        // Historical acceptance without a run is not permission to replay.
        continue;
      }
      const run = q.getRun(request.runId);
      const placement = request.targetSessionId ? q.chatPlacement(request.targetSessionId) : null;
      if (run?.status === 'running' && placement?.isHome !== false) {
        q.finishAgentRequest(request.id, 'failed', 'Ri restarted while this work was running. Its execution is interrupted and was not repeated. Inspect the responding chat before continuing.');
      }
    }
  }
}

export async function currentAgentAddresses(chat: ChatSessionRecord) {
  const { currentMainChat } = await import('@/lib/sessions/main-chat');
  return { self: `session:${chat.id}`, orchestrator: { address: 'orchestrator', sessionId: currentMainChat(null)?.id ?? null },
    agent: chat.workspaceId ? { address: `agent:${chat.workspaceId}`, sessionId: currentMainChat(chat.workspaceId)?.id ?? null } : null };
}
