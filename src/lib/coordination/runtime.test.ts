import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { operationResponse, type OperationContext } from '@/lib/server/operation';
import { verifySessionCredential } from '@/lib/orchestrator/session-credential';
import * as q from '@/lib/db/queries';

const bridge = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/orchestrator/server-client', async (original) => ({ ...await original<object>(), serverFetch: bridge.fetch }));

let home: TestHome | undefined;
let harness: FakeHarness | undefined;

afterEach(async () => {
  await (await import('./service')).stopAgentCoordination();
  const executor = await import('@/lib/executor/adapter');
  await vi.waitFor(() => expect(executor.listRunningSessions()).toHaveLength(0));
  executor._resetExecutorState();
  harness?.restore();
  await home?.cleanup();
});

/** Real Ri operations, dispatcher, runner, event ingestion, run completion,
 * SQLite migration and reply queue. Only the harness model is a stand-in. */
async function setupRuntime() {
  home = await createTestHome({ prefix: 'ri-coordination-runtime-' });
  harness = installFakeHarness('claude');
  (await import('@/lib/home/identity')).ensureHomeIdentity();
  const folder = path.join(home.root, 'project');
  fs.mkdirSync(folder);
  const workspace = q.createWorkspace({ name: 'Frontend', cwd: folder, isGit: false, browserEnabled: false });
  const main = q.createChatSession({ harness: 'claude', type: 'orchestration' });
  const agentMain = q.createChatSession({ harness: 'claude', type: 'orchestration', workspaceId: workspace.id });
  const { runAction } = await import('@/lib/orchestrator/dispatch');
  const { POST: postMessage, POSTInput: messageInput } = await import('@/lib/server/operations/sessions/[id]/messages');
  const { POST: createExecution, POSTInput: executionInput } = await import('@/lib/server/operations/workspaces/[id]/sessions');
  const context = (url: string, init?: RequestInit): OperationContext => ({ url, nextUrl: new URL(url), headers: new Headers(init?.headers), signal: new AbortController().signal });
  bridge.fetch.mockImplementation(async (route: string, init?: RequestInit) => {
    const url = `http://localhost:42241/api${route}`;
    const body = JSON.parse(String(init?.body ?? '{}'));
    const send = route.match(/^\/sessions\/([^/]+)\/messages$/);
    const create = route.match(/^\/workspaces\/([^/]+)\/sessions$/);
    const result = send
      ? await postMessage(messageInput.parse({ params: { id: send[1] }, body }), context(url, init))
      : create ? await createExecution(executionInput.parse({ params: { id: create[1] }, body }), context(url, init)) : null;
    if (!result) throw new Error(`Unexpected internal request ${route}`);
    const response = operationResponse(result);
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    return data;
  });
  return { workspace, main, agentMain, runAction, postMessage, messageInput, context };
}

it('runs an orchestrator delegation through executor consultation and returns the finished work automatically', async () => {
  const { workspace, main, agentMain, runAction, postMessage, messageInput, context } = await setupRuntime();
  harness!.onTurn(async turn => {
    const chatId = verifySessionCredential(turn.session.ctx.env?.RI_SESSION_CREDENTIAL, home!.token);
    expect(chatId).toBeTruthy();
    const chat = q.getChatSession(chatId!)!;
    const ctx = { remote: true, actor: { source: 'ai' as const, sessionId: chat.id } };
    if (chat.id === main.id && !turn.message.includes('[Ri agent request')) {
      expect(await runAction('delegate_work', { workspace_id: workspace.id, request_id: 'runtime-work', prompt: 'Fix the login redirect.', provider: 'claude' }, ctx)).toMatchObject({ ok: true });
      await turn.say('The work is delegated. I will return with the result.');
    } else if (chat.id === agentMain.id) {
      await turn.say('Preserve the destination through login.');
    } else if (chat.type === 'execution' && !turn.message.includes('[Ri agent request')) {
      expect(await runAction('ask_agent', { target: 'agent', request_id: 'runtime-context', content: 'What should happen after login?' }, ctx)).toMatchObject({ ok: true });
      await turn.say('Waiting for the project context.');
    } else if (chat.type === 'execution') {
      expect(turn.message).toContain('Preserve the destination');
      await turn.say('The login redirect is implemented and verified.');
    } else {
      expect(turn.message).toContain('implemented and verified');
      await turn.say('Your login fix is ready for review.');
    }
  });
  const { startAgentCoordination } = await import('./service');
  startAgentCoordination();
  const initial = await postMessage(messageInput.parse({ params: { id: main.id }, body: { content: 'Fix the login behavior in Frontend.' } }), context('http://localhost:42241/api/sessions/send'));
  expect(initial.ok).toBe(true);
  await vi.waitFor(() => expect(q.getLastChatEventBySource(main.id, 'agent')?.content).toBe('Your login fix is ready for review.'), { timeout: 15_000, interval: 25 });
  const [delegation] = q.listAgentRequests(main.id);
  expect(delegation).toMatchObject({ status: 'completed', kind: 'delegation', response: 'The login redirect is implemented and verified.' });
  expect(q.listAgentRequests(delegation.targetSessionId!)).toMatchObject([{ status: 'completed', kind: 'question', response: 'Preserve the destination through login.' }]);
  expect(q.listAgentDeliveries(delegation.id)).toMatchObject([{ status: 'sent', deliveredToSessionId: main.id }]);
  expect(harness!.sessions).toHaveLength(3);
}, 20_000);

it('returns a failed provider result as failure instead of reporting a successful delegation', async () => {
  const { workspace, main, runAction, postMessage, messageInput, context } = await setupRuntime();
  harness!.onTurn(async turn => {
    const chatId = verifySessionCredential(turn.session.ctx.env?.RI_SESSION_CREDENTIAL, home!.token)!;
    if (chatId !== main.id) throw new Error('failure from provider');
    if (!turn.message.includes('[Ri agent request')) {
      expect(await runAction('delegate_work', { workspace_id: workspace.id, request_id: 'failed-runtime', prompt: 'Investigate.', provider: 'claude' },
        { remote: true, actor: { source: 'ai', sessionId: main.id } })).toMatchObject({ ok: true });
      await turn.say('The investigation has started.');
    } else {
      expect(turn.message).toContain('failure from provider');
      await turn.say('The investigation failed and needs attention.');
    }
  });
  (await import('./service')).startAgentCoordination();
  await postMessage(messageInput.parse({ params: { id: main.id }, body: { content: 'Investigate the problem.' } }), context('http://localhost:42241/api/sessions/send'));
  await vi.waitFor(() => expect(q.getLastChatEventBySource(main.id, 'agent')?.content).toBe('The investigation failed and needs attention.'), { timeout: 15_000, interval: 25 });
  const [request] = q.listAgentRequests(main.id);
  expect(request.status).toBe('failed');
  expect(q.getRun(request.runId!)?.status).toBe('failed');
  expect(q.listAgentDeliveries(request.id)).toMatchObject([{ kind: 'failed', status: 'sent' }]);
}, 20_000);
