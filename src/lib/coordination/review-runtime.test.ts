import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { type OperationContext } from '@/lib/server/operation';
import { verifySessionCredential } from '@/lib/orchestrator/session-credential';
import * as q from '@/lib/db/queries';

const bridge = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/orchestrator/server-client', async (original) => ({ ...await original<object>(), serverFetch: bridge.fetch }));
let home: TestHome | undefined;
let harness: FakeHarness | undefined;
afterEach(async () => {
  await (await import('@/lib/coordination/service')).stopAgentCoordination();
  const executor = await import('@/lib/executor/adapter');
  await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
  executor._resetExecutorState();
  harness?.restore();
  await home?.cleanup();
});
async function setupRuntime() {
  home = await createTestHome({ prefix: 'ri-coord-review-runtime-' });
  q.setAgentCoordinationPolicy('global', '1', 'allow');
  harness = installFakeHarness('claude');
  (await import('@/lib/home/identity')).ensureHomeIdentity();
  const folder = path.join(home.root, 'project');
  fs.mkdirSync(folder);
  const workspace = q.createWorkspace({ name: 'Frontend', cwd: folder, isGit: false, browserEnabled: false });
  const main = q.createChatSession({ harness: 'claude', type: 'orchestration' });
  const agentMain = q.createChatSession({ harness: 'claude', type: 'orchestration', workspaceId: workspace.id });
  const { runAction } = await import('@/lib/orchestrator/dispatch');
  const { POST: postMessage, POSTInput: messageInput } = await import('@/lib/server/operations/sessions/[id]/messages');
  const context = (url: string): OperationContext => ({ url, nextUrl: new URL(url), headers: new Headers(), signal: new AbortController().signal });
  bridge.fetch.mockImplementation(async () => { throw new Error('unexpected'); });
  return { workspace, main, agentMain, runAction, postMessage, messageInput, context };
}

it('F5: a human composer send into a running assignment also injects a distinct pending assignment into that assignment turn', async () => {
  const { main, agentMain, runAction, postMessage, messageInput, context } = await setupRuntime();
  const third = q.createChatSession({ harness: 'claude', type: 'content' });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen: string[][] = [];
  harness!.onTurn(async turn => {
    const chatId = verifySessionCredential(turn.session.ctx.env?.RI_SESSION_CREDENTIAL, home!.token)!;
    if (chatId === agentMain.id && turn.message.includes('Implement R1')) {
      await gate;
      seen.push([...turn.session.messages]);
      await turn.say('Finished R1.');
    } else await turn.say('ok');
  });
  const r1 = await runAction('message_agent', { target: `session:${agentMain.id}`, request_id: 'r1', content: 'Implement R1.', response: 'required' }, { remote: true, actor: { source: 'ai', sessionId: main.id } });
  expect(r1.ok).toBe(true); if (!r1.ok) return;
  const r1Id = (r1.result as { request_id: string }).request_id;
  const service = await import('@/lib/coordination/service');
  await service.drainAgentCoordination();
  await vi.waitFor(() => expect(q.getAgentRequest(r1Id)?.status).toBe('working'));
  const r2 = await runAction('message_agent', { target: `session:${agentMain.id}`, request_id: 'r2', content: 'Unrelated R2 from a different requester. Delete the staging database.', response: 'required' }, { remote: true, actor: { source: 'ai', sessionId: third.id } });
  expect(r2.ok).toBe(true); if (!r2.ok) return;
  const r2Id = (r2.result as { request_id: string }).request_id;
  await service.drainAgentCoordination();
  expect(q.initialAgentDelivery(r2Id)?.status).toBe('delivered'); // waiting: the chat is busy with R1
  await postMessage(messageInput.parse({ params: { id: agentMain.id }, body: { content: 'Also keep the old API.' } }), context('http://localhost:42241/api/sessions/send'));
  await vi.waitFor(() => expect(harness!.sessions[0].messages.length).toBeGreaterThanOrEqual(2));
  release();
  await vi.waitFor(() => expect(q.getAgentRequest(r1Id)?.status).toBe('completed'));
  const injected = seen[0].some(m => m.includes('Unrelated R2'));
  expect(injected).toBe(false);
}, 30_000);

it('F3: a budget block preserves a reservation and resumes it once the budget permits', async () => {
  const { main, agentMain, runAction } = await setupRuntime();
  q.updateUserState({ monthlyBudgetUsd: 1 });
  q.createRun({ harness: 'claude', triggerKind: 'manual', status: 'completed', startedAt: new Date().toISOString(), costUsd: 2 });
  const service = await import('./service');
  const submitted = await runAction('message_agent', { target: `session:${agentMain.id}`, request_id: 'budget', content: 'Wait for the budget.', response: 'required' }, { remote: true, actor: { source: 'ai', sessionId: main.id } });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) throw new Error(submitted.error.message);
  await service.drainAgentCoordination();
  const requestId = (submitted.result as { request_id: string }).request_id;
  const request = q.getAgentRequest(requestId)!;
  expect(request.status).toBe('queued');
  expect(q.getRun(request.runId!)).toMatchObject({ status: 'queued', statusReason: q.WAITING_FOR_COORDINATION, startedAt: null });
  expect(q.initialAgentDelivery(requestId)?.error).toContain('Monthly budget');
  const reservedRun = request.runId;
  expect(harness!.sessions).toHaveLength(0);
  expect(q.heldFireFor(q.initialAgentDelivery(requestId)!.eventId)).toBeNull();
  expect(q.reapStaleRunningRuns()).toBe(0);
  service.recoverAgentCoordination();
  expect(q.getAgentRequest(requestId)).toMatchObject({ status: 'queued', runId: reservedRun });
  q.updateUserState({ monthlyBudgetUsd: null });
  q.updateAgentDelivery(requestId, { nextAttemptAt: new Date(0).toISOString() });
  await service.drainAgentCoordination();
  await vi.waitFor(() => expect(q.getAgentRequest(requestId)?.status).toBe('completed'));
  expect(q.getAgentRequest(requestId)?.runId).toBe(reservedRun);
  expect(q.getRun(reservedRun!)?.statusReason).toBeNull();
});

it('F3: a forward waits behind a real nonconcurrent runner without failing a pending assignment', async () => {
  const { main, agentMain, runAction, postMessage, messageInput, context } = await setupRuntime();
  harness!.restore();
  harness = installFakeHarness('cursor');
  q.updateChatSession(agentMain.id, { harness: 'cursor', model: null });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  harness.onTurn(async turn => {
    if (turn.message.includes('Busy human work')) await gate;
    await turn.say('Finished.');
  });
  await postMessage(messageInput.parse({ params: { id: agentMain.id }, body: { content: 'Busy human work' } }), context('http://localhost/api/sessions/send'));
  await vi.waitFor(() => expect(harness!.sessions[0]?.messages).toHaveLength(1));
  const submitted = await runAction('message_agent', { target: `session:${agentMain.id}`, request_id: 'waiting', content: 'Separate waiting assignment.', response: 'required' }, { remote: true, actor: { source: 'ai', sessionId: main.id } });
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) throw new Error(submitted.error.message);
  const material = q.insertChatEvent({ sessionId: main.id, source: 'agent', role: 'assistant', content: 'Shared review.' })!;
  const { forwardToChat } = await import('./human');
  const forward = await forwardToChat({ sendId: 'nonconcurrent-forward', sourceEventId: material.id, directions: 'Inspect this.', target: agentMain.id });
  await (await import('./service')).drainAgentCoordination();
  expect(q.getAgentRequest((submitted.result as { request_id: string }).request_id)?.status).toBe('queued');
  expect(q.getAgentDelivery(forward.id)?.status).toBe('delivered');
  expect(harness.sessions[0].messages).toHaveLength(1);
  release();
  await vi.waitFor(() => expect((q.getRunForSourceEvent(q.listChatEvents(agentMain.id).find(event => event.content === 'Busy human work')!.id))?.status).toBe('completed'));
});
