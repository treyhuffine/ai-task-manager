import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import type { AgentDeliveryRecord, ChatSessionRecord } from '@/db/types';
import { runAction } from '@/lib/orchestrator/dispatch';
import { drainAgentCoordination } from '@/lib/coordination/service';
import { finishRun } from '@/lib/runs/finish';
import { applyChatEvent } from '@/lib/executor/apply';
import { forwardToChat } from '@/lib/coordination/human';

const fake = vi.hoisted(() => ({ busy: new Set<string>(), producers: new Map<string, string>(), concurrentSend: true, dispatch: vi.fn(), abort: vi.fn(), launch: vi.fn() }));
vi.mock('@/lib/runner/local-runner', async original => ({ ...await original<object>(), producingRun: (id: string) => fake.producers.get(id) ?? null }));
vi.mock('@/lib/executor/devices', async original => ({ ...await original<object>(), harnessCapabilitiesOn: async () => ({ sessions: true, concurrentSend: fake.concurrentSend }) }));
vi.mock('@/lib/executor/adapter', () => ({ isRunning: (id: string) => fake.busy.has(id), hasBackgroundTasks: () => false, dispatch: fake.dispatch, abort: fake.abort }));
vi.mock('@/lib/sessions/dispatch', () => ({ WorkspaceNotFoundForDispatch: class extends Error {}, DeviceUnavailableForDispatch: class extends Error {}, TaskNotStartableForDispatch: class extends Error {}, dispatchExecutionSession: (...args: unknown[]) => fake.launch(...args) }));

let home: TestHome;
let main: ChatSessionRecord;
let agent: ReturnType<typeof q.createWorkspace>;
let agentMain: ChatSessionRecord;
let accepted: Array<{ sessionId: string; content: string; eventId: string; runId: string }>;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-coord-review-' });
  q.setAgentCoordinationPolicy('global', '1', 'allow');
  main = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  agent = q.createWorkspace({ name: 'Frontend', cwd: home.root, isGit: false, filesToCopy: [] });
  agentMain = q.createChatSession({ type: 'orchestration', harness: 'claude', workspaceId: agent.id });
  accepted = []; fake.busy.clear(); fake.producers.clear(); fake.concurrentSend = true; fake.dispatch.mockReset(); fake.abort.mockReset(); fake.launch.mockReset();
  fake.dispatch.mockImplementation(async (sessionId: string, content: string, options: { runId: string; sourceEventId: string; coordinationDeliveryIds: string[]; onTaken?: () => void }) => {
    q.markRunStarted(options.runId);
    q.acceptAgentDeliveriesForRun(options.runId, sessionId, options.coordinationDeliveryIds, fake.producers.get(sessionId));
    fake.busy.add(sessionId); fake.producers.set(sessionId, options.runId);
    accepted.push({ sessionId, content, eventId: options.sourceEventId, runId: options.runId });
    options.onTaken?.();
  });
  fake.launch.mockImplementation(async (input) => {
    const existing = q.getChatSessionWithExecution(input.sessionId);
    if (existing) return existing;
    const session = q.createExecutionWithChat({ workspaceId: input.workspaceId, chatSessionId: input.sessionId, harness: input.harness ?? 'claude', label: input.label, permissionMode: input.permissionMode }).session;
    if (input.actor.source === 'ai') q.initializeAgentChildPolicy(input.actor.sessionId, session.id);
    return q.getChatSessionWithExecution(session.id)!;
  });
});
afterEach(async () => { await drainAgentCoordination(); await home.cleanup(); });
function act(chat: ChatSessionRecord, name: string, input: unknown) {
  return runAction(name, input, { remote: true, actor: { source: 'ai', sessionId: chat.id } });
}
async function send(chat: ChatSessionRecord, input: Record<string, unknown> = {}): Promise<AgentDeliveryRecord> {
  const result = await act(chat, 'message_agent', { response: 'required', target: `session:${agentMain.id}`, request_id: uuidv7(), content: 'Review the change.', ...input });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  await drainAgentCoordination();
  return q.getAgentDelivery((result.result as { id: string }).id)!;
}
async function complete(sessionId: string, content: string) {
  const row = accepted.filter(r => r.sessionId === sessionId).at(-1)!;
  applyChatEvent({ id: uuidv7(), sessionId, role: 'assistant', source: 'agent', content }, { cumulative: false, runId: row.runId });
  fake.busy.delete(sessionId); fake.producers.delete(sessionId);
  finishRun(row.runId, { ok: true });
  await drainAgentCoordination();
}

it('F1: delegate_work into the requester agent skips Ask approval (third chat treated as requester)', async () => {
  // agentMain (address agent:<W>) asks a worker chat B. B is explicitly Ask.
  const b = q.createChatSession({ type: 'content', harness: 'claude' });
  q.setAgentCoordinationPolicy('chat', b.id, 'ask');
  const initial = await send(agentMain, { target: `session:${b.id}` });
  expect(initial.status).toBe('accepted');
  expect(q.getAgentRequest(initial.requestId!)!.sourceAddress).toBe(`agent:${agent.id}`);
  // Control: delegating into an unrelated agent asks first.
  const other = q.createWorkspace({ name: 'Other', cwd: home.root, isGit: false, filesToCopy: [] });
  const control = await act(b, 'delegate_work', { workspace_id: other.id, request_id: 'control', prompt: 'Build a new thing.' });
  expect(control).toMatchObject({ ok: true, result: { status: 'awaiting_approval' } });
  // Delegating into the requester's agent creates a NEW chat, a third party.
  const res = await act(b, 'delegate_work', { workspace_id: agent.id, request_id: 'bypass', prompt: 'Build a new thing.' });
  expect(res.ok, JSON.stringify(res)).toBe(true);
  await drainAgentCoordination();
  if (!res.ok) throw new Error(res.error.message);
  const delivery = q.getAgentDelivery((res.result as { id: string }).id)!;
  expect(delivery.status).toBe('awaiting_approval');
});

it('F2: a scheduled orchestration chat gets a stable orchestrator return address, so its answer lands in the main chat', async () => {
  const fire = q.createRun({ harness: 'claude', triggerKind: 'manual', status: 'completed' });
  const scheduled = q.createChatSession({ type: 'orchestration', harness: 'claude', createdByRunId: fire.id });
  expect(q.getChatSession(scheduled.id)!.createdByRunId).toBe(fire.id);
  const initial = await send(scheduled);
  const request = q.getAgentRequest(initial.requestId!)!;
  await complete(agentMain.id, 'Here is the answer.');
  const answer = q.terminalAgentDelivery(request.id)!;
  expect(answer.targetSessionId).toBe(scheduled.id);
});

it('F3: a human forward into a busy chat that cannot take concurrent input fails an unrelated pending assignment', async () => {
  fake.busy.add(agentMain.id); // a human-directed turn is running
  const initial = await send(main); // R2 arrives, waits because busy
  expect(initial.status).toBe('delivered');
  fake.dispatch.mockImplementationOnce(async () => { const { ExecutorError } = await import('@/lib/runner/errors'); throw new ExecutorError('already_running', 'This provider does not support concurrent send.'); });
  const material = q.insertChatEvent({ sessionId: main.id, source: 'agent', role: 'assistant', content: 'Something worth sharing' })!;
  await forwardToChat({ sendId: 'fwd', sourceEventId: material.id, directions: 'Look at this.', target: agentMain.id });
  await drainAgentCoordination();
  const request = q.getAgentRequest(initial.requestId!)!;
  expect(request.status).toBe('queued');
});

it('F10: Stop on a human turn in a held chat fails an assignment whose reserved run never started', async () => {
  fake.dispatch.mockImplementationOnce(async (_sessionId: string, _content: string, options: { runId: string }) => {
    q.setAgentCoordinationHold(agentMain.id, true); // Hold switched on between reservation and admission
    q.markRunWaitingForCoordination(options.runId);
    const { CoordinationHeldError } = await import('@/lib/coordination/hold');
    throw new CoordinationHeldError();
  });
  const initial = await send(main);
  const before = q.getAgentRequest(initial.requestId!)!;
  expect(before.status).toBe('queued');
  expect(q.getRun(before.runId!)).toMatchObject({ status: 'queued', statusReason: q.WAITING_FOR_COORDINATION });
  q.stopCoordinationRunsForChat(agentMain.id); // what abort(chat, human) does when the person stops their own turn
  const after = q.getAgentRequest(initial.requestId!)!;
  expect(after.status).toBe('queued');
});

it('requires approval for a stable agent address after the requester main chat is replaced', async () => {
  const worker = q.createChatSession({ type: 'content', harness: 'claude' });
  q.setAgentCoordinationPolicy('chat', worker.id, 'ask');
  await send(agentMain, { target: `session:${worker.id}` });
  q.updateChatSession(agentMain.id, { status: 'archived' });
  const replacement = q.createChatSession({ type: 'orchestration', workspaceId: agent.id, harness: 'claude' });
  const result = await act(worker, 'message_agent', { target: `agent:${agent.id}`, request_id: 'replacement', content: 'Unrelated contact.', response: 'none' });
  expect(result).toMatchObject({ ok: true, result: { status: 'awaiting_approval' } });
  expect(q.listChatEvents(replacement.id)).toHaveLength(0);
});

it('records a failed human forward in its source flow without failing its context', async () => {
  fake.concurrentSend = false;
  fake.busy.add(agentMain.id);
  const waiting = await send(main);
  const material = q.insertChatEvent({ sessionId: main.id, role: 'assistant', source: 'agent', content: 'Forwarded review.' })!;
  const forward = await forwardToChat({ sendId: 'failed-forward', sourceEventId: material.id, directions: '', target: agentMain.id });
  await drainAgentCoordination();
  q.failAgentDelivery(forward.id, 'The destination is unavailable.');
  q.failAgentDelivery(forward.id, 'The destination is unavailable.');
  expect(q.listChatEvents(main.id).filter(event => event.content === 'coordination_send_failed')).toHaveLength(1);
  expect(q.listChatEvents(main.id).find(event => event.content === 'coordination_send_failed')?.raw).toMatchObject({ agentCoordination: { deliveryId: forward.id } });
  expect(q.getAgentRequest(waiting.requestId!)?.status).toBe('queued');
});
