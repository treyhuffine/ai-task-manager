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
      expect(await runAction('message_agent', { response: 'required', target: 'agent', request_id: 'runtime-context', content: 'What should happen after login?' }, ctx)).toMatchObject({ ok: true });
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
  expect(delegation).toMatchObject({ status: 'completed', kind: 'delegation' });
  expect(q.terminalAgentDelivery(delegation.id)?.payload.content).toBe('The login redirect is implemented and verified.');
  expect(q.listAgentRequests(delegation.targetSessionId!)).toMatchObject([{ status: 'completed', kind: 'question' }]);
  expect(q.terminalAgentDelivery(q.listAgentRequests(delegation.targetSessionId!)[0].id)?.payload.content).toBe('Preserve the destination through login.');
  expect(q.terminalAgentDelivery(delegation.id)).toMatchObject({ status: 'accepted', targetSessionId: main.id });
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
  expect(q.terminalAgentDelivery(request.id)).toMatchObject({ kind: 'failed', status: 'accepted' });
}, 20_000);

it('supplies held messages to a human turn without assigning their owed work, then starts one assignment on release', async () => {
  const {main,agentMain,runAction,postMessage,messageInput,context}=await setupRuntime();
  q.setAgentCoordinationHold(agentMain.id,true);
  const actor={remote:true,actor:{source:'ai' as const,sessionId:main.id}};
  let requestId='';
  for(let n=0;n<5;n++) {
    const result=await runAction('message_agent',{target:`session:${agentMain.id}`,request_id:`held-${n}`,content:`Held material ${n}`,response:n===0?'required':'none'},actor);
    expect(result.ok).toBe(true);
    if(n===0 && result.ok) requestId=(result.result as {request_id:string}).request_id;
  }
  await (await import('./service')).drainAgentCoordination();
  expect(harness!.sessions).toHaveLength(0);
  harness!.onTurn(async turn=>{
    const chatId=verifySessionCredential(turn.session.ctx.env?.RI_SESSION_CREDENTIAL,home!.token)!;
    if(chatId===main.id) { await turn.say('The assignment outcome was received.'); return; }
    if(turn.message.includes('Human inspection')) {
      for(let n=0;n<5;n++) expect(turn.message).toContain(`Held material ${n}`);
      await turn.say('Human turn output is context, not the owed answer.');
    } else {
      expect(turn.message).toContain('Inspect the current state');
      await turn.say('This is the assigned outcome.');
    }
  });
  await postMessage(messageInput.parse({params:{id:agentMain.id},body:{content:'Human inspection'}}),context('http://localhost:42241/api/sessions/send'));
  await vi.waitFor(()=>expect(q.getLastChatEventBySource(agentMain.id,'agent')?.content).toBe('Human turn output is context, not the owed answer.'));
  expect(q.getAgentRequest(requestId)).toMatchObject({status:'queued',runId:null});
  expect(q.getChatSession(agentMain.id)?.coordinationHeldAt).toBeTruthy();
  const readBy=q.initialAgentDelivery(requestId)!.acceptedByRunId;
  q.setAgentCoordinationHold(agentMain.id,false);
  await (await import('./service')).drainAgentCoordination();
  await vi.waitFor(()=>expect(q.getAgentRequest(requestId)?.status).toBe('completed'));
  expect(q.terminalAgentDelivery(requestId)?.payload.content).toBe('This is the assigned outcome.');
  expect(q.getAgentRequest(requestId)?.runId).not.toBe(readBy);
  expect(q.initialAgentDelivery(requestId)?.acceptedByRunId).toBe(readBy);
},20_000);

it('keeps the producing assignment when human input folds into its active native turn', async () => {
  const {main,agentMain,runAction,postMessage,messageInput,context}=await setupRuntime();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  harness!.onTurn(async turn=>{
    const chatId=verifySessionCredential(turn.session.ctx.env?.RI_SESSION_CREDENTIAL,home!.token)!;
    if(chatId===agentMain.id) {
      await gate;
      expect(turn.session.messages.some(message=>message.includes('Preserve the existing API'))).toBe(true);
      await turn.say('Reconciled the human direction and finished the assignment.');
    } else await turn.say('Result received.');
  });
  const result=await runAction('message_agent',{target:`session:${agentMain.id}`,request_id:'human-overlap',content:'Implement the change.',response:'required'},{remote:true,actor:{source:'ai',sessionId:main.id}});
  expect(result.ok).toBe(true); if(!result.ok) return;
  const id=(result.result as {request_id:string}).request_id;
  await (await import('./service')).drainAgentCoordination();
  await vi.waitFor(()=>expect(q.getAgentRequest(id)?.status).toBe('working'));
  const assigned=q.getAgentRequest(id)!.runId;
  await postMessage(messageInput.parse({params:{id:agentMain.id},body:{content:'Preserve the existing API'}}),context('http://localhost:42241/api/sessions/send'));
  await vi.waitFor(()=>expect(harness!.sessions[0].messages).toHaveLength(2));
  expect(q.getAgentRequest(id)?.runId).toBe(assigned);
  release();
  await vi.waitFor(()=>expect(q.getAgentRequest(id)?.status).toBe('completed'));
  expect(q.terminalAgentDelivery(id)?.payload).toMatchObject({humanDirected:true,content:'Reconciled the human direction and finished the assignment.'});
  expect(q.getAgentRequest(id)?.runId).toBe(assigned);
},20_000);

it('forwards once into a new chat with the selected model and effort and no automatic return', async () => {
  const { main, workspace } = await setupRuntime();
  harness!.onTurn(async turn => { await turn.say('The shared review is complete.'); });
  const selected = q.insertChatEvent({ sessionId: main.id, role: 'assistant', source: 'agent', content: 'Full original review and findings.' })!;
  const input = { sendId: 'new-human-share', sourceEventId: selected.id, directions: 'Check these findings.', launch: { workspaceId: workspace.id, provider: 'claude' as const, model: 'sonnet', effort: 'high' as const } };
  const { forwardToChat } = await import('./human');
  const first = await forwardToChat(input);
  await (await import('./service')).drainAgentCoordination();
  await vi.waitFor(() => expect(q.getAgentDelivery(first.id)?.status).toBe('accepted'));
  const second = await forwardToChat(input);
  await (await import('./service')).drainAgentCoordination();
  expect(second.id).toBe(first.id);
  const delivery = q.getAgentDelivery(first.id)!;
  expect(q.getChatSession(delivery.targetSessionId!)!).toMatchObject({ model: 'sonnet', effort: 'high' });
  expect(q.listChatSessions({ workspaceId: workspace.id }).filter(chat => chat.type === 'execution')).toHaveLength(1);
  expect(q.listAgentRequests(main.id)).toHaveLength(0);
  await vi.waitFor(() => expect(q.getLastChatEventBySource(delivery.targetSessionId!, 'agent')?.content).toBe('The shared review is complete.'));
  expect(q.getLastChatEventBySource(main.id, 'agent')?.id).toBe(selected.id);
  expect(q.getChatEventById(delivery.eventId)?.raw).toMatchObject({ agentCoordination: { senderKind: 'human', sourceEventId: selected.id, directions: 'Check these findings.' } });
}, 20_000);
