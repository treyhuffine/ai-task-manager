import * as q from '@/lib/db/queries';
import type { AgentRequestRecord, AgentDeliveryRecord, ChatSessionRecord } from '@/db/types';
import type { ActionContext } from '@/lib/orchestrator/types';
import { ActionError } from '@/lib/orchestrator/types';
import { serverFetch, ServerResponseError } from '@/lib/orchestrator/server-client';
import { SESSION_CREDENTIAL_ENV, SESSION_CREDENTIAL_HEADER, sessionCredential } from '@/lib/orchestrator/session-credential';
import { assertPersonalCapability, isTeamAuthority } from '@/lib/home/authority';
import { processState } from '@/lib/process-state';
import { perfScope } from '@/lib/perf/recorder';
import { stableCoordinationId } from './ids';
import { requestScopedId } from './start-id';

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

export function addressOf(chat: ChatSessionRecord): string {
  return chat.type === 'orchestration' && !chat.executionId && !chat.createdByRunId && (!chat.surfaceKind || chat.surfaceKind === 'main')
    ? chat.workspaceId ? `agent:${chat.workspaceId}` : 'orchestrator'
    : `session:${chat.id}`;
}

export function normalizeAddress(target: string, source: ChatSessionRecord): string {
  if (target === 'agent') {
    if (!source.workspaceId) throw new ActionError('invalid_params', 'Name an agent as agent:<workspace id>, or use orchestrator.');
    return `agent:${source.workspaceId}`;
  }
  if (target === 'requester') {
    const incoming = q.openAgentRequestsForTarget(source.id).find(request => request.status === 'sent');
    if (!incoming) throw new ActionError('not_found', 'This chat has no active requesting chat.');
    return incoming.sourceAddress;
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

export async function submitAgentRequest(ctx: ActionContext, input: { target: string; requestId: string; content: string; kind: AgentRequestRecord['kind']; options?: AgentRequestRecord['options'] }) {
  const source = callerChat(ctx);
  if (source.status !== 'active') throw new ActionError('conflict', 'An archived chat cannot start work.');
  const prior = q.findAgentRequest(source.id, input.requestId);
  const address = prior && input.target === 'requester' ? prior.targetAddress : normalizeAddress(input.target, source);
  const content = input.content.trim();
  const options = input.options ?? null;
  if (prior) {
    if (prior.targetAddress !== address || prior.content !== content || prior.kind !== input.kind || JSON.stringify(prior.options) !== JSON.stringify(options)) throw new ActionError('conflict', 'This request ID already belongs to different intent. Use a new request ID.');
    return prior;
  }
  let target: ChatSessionRecord | null = null;
  if (input.kind !== 'delegation') {
    target = await resolveAddress(address, source.userId);
    if (target.id === source.id) throw new ActionError('invalid_params', 'That address resolves to this chat. Continue your own work directly.');
  } else {
    const workspace = options ? q.getWorkspace(options.workspaceId) : null;
    if (!workspace || workspace.status !== 'active') throw new ActionError('not_found', 'The agent for this delegation is unavailable.');
  }
  const parent = q.openAgentRequestsForTarget(source.id).find(request => request.status === 'sent');
  let ancestor = parent;
  for (let depth = 0; ancestor; depth++) {
    if (depth >= 8) throw new ActionError('conflict', 'This request chain is too deep. Resolve the existing requests before delegating again.');
    ancestor = ancestor.parentRequestId ? q.getAgentRequest(ancestor.parentRequestId) ?? undefined : undefined;
  }
  const id = stableCoordinationId('request', source.id, input.requestId);
  const request = q.createAgentRequest({ id, sourceSessionId: source.id, sourceAddress: addressOf(source), targetAddress: address, targetSessionId: target?.id ?? null,
    requestKey: input.requestId, parentRequestId: parent?.id, kind: input.kind, content, options,
    messageEventId: input.kind === 'delegation' ? requestScopedId('prompt', options!.workspaceId, id) : stableCoordinationId('input', id) });
  if (request.content !== content || request.targetAddress !== address || request.kind !== input.kind || JSON.stringify(request.options) !== JSON.stringify(options)) {
    throw new ActionError('conflict', 'This request ID already belongs to different intent. Use a new request ID.');
  }
  void drainAgentCoordination();
  return request;
}

function senderHeaders(id: string): Record<string, string> {
  const credential = sessionCredential(id);
  if (!credential) throw new ActionError('unsupported', 'The sending chat no longer has a valid credential.');
  return { [SESSION_CREDENTIAL_HEADER]: credential };
}

function retryAt(attempts: number): string {
  return new Date(Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6))).toISOString();
}

async function busy(id: string): Promise<boolean> {
  const executor = await import('@/lib/executor/adapter');
  return executor.isRunning(id) || executor.hasBackgroundTasks(id);
}

async function dispatchRequest(request: AgentRequestRecord): Promise<void> {
  try {
    const source = personalChat(request.sourceSessionId);
    if (source.status !== 'active' && request.sourceAddress.startsWith('session:')) {
      q.finishAgentRequest(request.id, 'cancelled', 'The requesting chat was closed before this work started.');
      return;
    }
    if (request.kind === 'delegation') {
      const { runAction } = await import('@/lib/orchestrator/dispatch');
      const outcome = await runAction('start_execution', { ...request.options, requestId: request.id, prompt: requestPrompt(request) }, { remote: true, actor: { source: 'ai', sessionId: source.id } });
      if (!outcome.ok) throw new ServerResponseError(outcome.error.code === 'not_found' ? 404 : outcome.error.code === 'unsupported' ? 403 : 409, JSON.stringify(outcome.error), outcome.error.message);
      const current = q.getAgentRequest(request.id);
      q.updateAgentRequest(request.id, { targetSessionId: outcome.result.sessionId, ...(current?.status === 'queued' ? { status: 'sent' as const } : {}), nextAttemptAt: null });
      return;
    }
    const target = await resolveAddress(request.targetAddress, source.userId);
    if (await busy(target.id)) {
      q.updateAgentRequest(request.id, { nextAttemptAt: new Date(Date.now() + 5000).toISOString() });
      return;
    }
    q.updateAgentRequest(request.id, { targetSessionId: target.id });
    await serverFetch(`/sessions/${target.id}/messages`, { method: 'POST', headers: senderHeaders(source.id), body: JSON.stringify({ id: request.messageEventId, content: requestPrompt(request) }) });
    if (q.getAgentRequest(request.id)?.status === 'queued') q.updateAgentRequest(request.id, { status: 'sent', nextAttemptAt: null });
  } catch (error) {
    if (permanent(error)) q.finishAgentRequest(request.id, 'failed', error instanceof Error ? error.message : String(error));
    else q.updateAgentRequest(request.id, { attempts: request.attempts + 1, nextAttemptAt: retryAt(request.attempts), error: String(error) });
  }
}

export function requestPrompt(request: AgentRequestRecord): string {
  return `[Ri agent ${request.kind}. Request ID: ${request.id}. Requesting chat: ${request.sourceSessionId}.]
${request.content}

${request.kind === 'message' ? 'This is an informational message. Respond when useful.' : 'Answer this request in your final response, or use reply_agent_request with this request ID. Ri returns the answer to the requesting chat automatically. If you need another agent, use ask_agent and finish your turn while waiting. Its answer resumes this chat. Keep work and consultations visible in their chats.'}`;
}

function permanent(error: unknown): boolean {
  return error instanceof ServerResponseError ? [400, 403, 404, 409].includes(error.status)
    : error instanceof ActionError && ['not_found', 'invalid_params', 'unsupported', 'conflict'].includes(error.code);
}

async function deliverUpdate(delivery: AgentDeliveryRecord): Promise<void> {
  const request = q.getAgentRequest(delivery.requestId);
  if (!request) return;
  if (delivery.kind === 'blocked' && ['completed', 'failed', 'cancelled'].includes(request.status)) {
    q.updateAgentDelivery(delivery.id, { status: 'failed', error: 'This request already ended. Its old blocked-state update was not delivered.', nextAttemptAt: null });
    return;
  }
  if (request.parentRequestId && q.getAgentRequest(request.parentRequestId)?.status === 'cancelled') {
    q.updateAgentDelivery(delivery.id, { status: 'failed', error: 'The requesting assignment was cancelled. No continuation was started.', nextAttemptAt: null });
    return;
  }
  try {
    const source = personalChat(request.sourceSessionId);
    const destination = delivery.deliveredToSessionId
      ? personalChat(delivery.deliveredToSessionId, source.userId)
      : await resolveAddress(request.sourceAddress, source.userId);
    if (await busy(destination.id)) {
      q.updateAgentDelivery(delivery.id, { nextAttemptAt: new Date(Date.now() + 5000).toISOString() });
      return;
    }
    if (destination.status !== 'active') throw new ActionError('not_found', 'The receiving chat was closed before delivery was acknowledged.');
    q.updateAgentDelivery(delivery.id, { deliveredToSessionId: destination.id });
    const content = `[Ri agent request ${request.id}: ${delivery.kind}.]
Request: ${request.content}
Responding chat: ${request.targetSessionId ?? 'Ri coordination service (work could not start)'}
${delivery.content}

${delivery.kind === 'blocked' ? 'Inspect get_pending_input for the responding chat. Answer questions only within the user\'s intent. Human-only permission approvals remain with the user.' : 'Continue the original work using this outcome. This is a response to your earlier request, not a new user instruction.'}`;
    if (request.targetSessionId) {
      personalChat(request.targetSessionId, source.userId);
      await serverFetch(`/sessions/${destination.id}/messages`, { method: 'POST', headers: senderHeaders(request.targetSessionId), body: JSON.stringify({ id: delivery.eventId, content }) });
    } else {
      // A launch failure has no responding chat. Record it truthfully as a
      // system event, and deliver only in the server that owns the runner.
      // The run's indexed sourceEventId prevents replay after uncertain ACKs.
      q.insertChatEvent({ id: delivery.eventId, sessionId: destination.id, role: 'system', source: 'error', content });
      if (!q.getRunForSourceEvent(delivery.eventId)) {
        const executor = await import('@/lib/executor/adapter');
        await new Promise<void>((resolve, reject) => {
          void executor.dispatch(destination.id, content, { sourceEventId: delivery.eventId,
            actor: { source: 'system', sessionId: null, apiKeyId: null }, onTaken: resolve, onQueued: resolve }).then(resolve, reject);
        });
      }
    }
    q.updateAgentDelivery(delivery.id, { status: 'sent', deliveredToSessionId: destination.id, error: null, nextAttemptAt: null });
  } catch (error) {
    q.updateAgentDelivery(delivery.id, { status: permanent(error) ? 'failed' : 'pending', attempts: delivery.attempts + 1, nextAttemptAt: retryAt(delivery.attempts), error: String(error) });
  }
}

/** Reconcile durable outcomes without replaying an uncertain running turn. */
async function reconcileRequests(): Promise<void> {
  const requests = q.unsettledAgentRequests(100, state.reconcileAfterId ?? undefined);
  state.reconcileAfterId = requests.length === 100 ? requests.at(-1)!.id : null;
  for (const request of requests) {
    if (request.targetSessionId && q.getChatSession(request.targetSessionId)?.status === 'archived') {
      q.finishAgentRequest(request.id, 'failed', 'The responding chat was closed before this request finished. Inspect its history before starting new work.');
      continue;
    }
    if (!request.runId) continue;
    const run = q.getRun(request.runId);
    if (run?.status === 'completed' && request.status !== 'waiting') q.settleAgentRequestsForRun(run.id, { ok: true });
    else if (run && ['failed', 'cancelled', 'skipped'].includes(run.status)) q.settleAgentRequestsForRun(run.id, { ok: false, errorMessage: run.errorMessage ?? `Work ${run.status}.` });
  }
}

export function drainAgentCoordination(): Promise<void> {
  if (state.draining) { state.again = true; return state.draining; }
  state.draining = perfScope('timer:agent-coordination', async () => {
    do {
      state.again = false;
      await reconcileRequests();
      for (const request of q.dueAgentRequests()) await dispatchRequest(request);
      for (const delivery of q.dueAgentDeliveries()) await deliverUpdate(delivery);
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
        q.updateAgentRequest(request.id, { status: 'queued', nextAttemptAt: new Date().toISOString() });
        continue;
      }
      const run = q.getRun(request.runId);
      const placement = request.targetSessionId ? q.chatPlacement(request.targetSessionId) : null;
      if (run && ['queued', 'running'].includes(run.status) && placement?.isHome !== false) {
        q.finishAgentRequest(request.id, 'failed', 'The home restarted while this work was running. Its execution is interrupted and was not repeated. Inspect the responding chat before continuing.');
      }
    }
  }
}

export async function currentAgentAddresses(chat: ChatSessionRecord) {
  const { currentMainChat } = await import('@/lib/sessions/main-chat');
  return { self: `session:${chat.id}`, orchestrator: { address: 'orchestrator', sessionId: currentMainChat(null)?.id ?? null },
    agent: chat.workspaceId ? { address: `agent:${chat.workspaceId}`, sessionId: currentMainChat(chat.workspaceId)?.id ?? null } : null };
}
