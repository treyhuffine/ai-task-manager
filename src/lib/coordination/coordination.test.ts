import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import type { AgentDeliveryRecord, ChatSessionRecord } from '@/db/types';
import { runAction } from '@/lib/orchestrator/dispatch';
import { drainAgentCoordination, recoverAgentCoordination } from './service';
import { finishRun } from '@/lib/runs/finish';
import { applyChatEvent } from '@/lib/executor/apply';
import { stableCoordinationId } from './ids';
import { requestScopedId } from './start-id';
import { decodeChatMessageReceipt } from '@/lib/sessions/chat-message';
import { forwardToChat } from './human';

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
  home = await createTestHome({ prefix: 'ri-coordination-' });
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
async function send(chat = main, input: Record<string, unknown> = {}): Promise<AgentDeliveryRecord> {
  const result = await act(chat, 'message_agent', { response: 'required', target: `session:${agentMain.id}`, request_id: uuidv7(), content: 'Review the change.', ...input });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  await drainAgentCoordination();
  return q.getAgentDelivery((result.result as { id: string }).id)!;
}
async function complete(sessionId: string, content: string, stopped = false) {
  const send = accepted.filter(row => row.sessionId === sessionId).at(-1)!;
  const id = uuidv7();
  applyChatEvent({ id, sessionId, role: 'assistant', source: 'agent', content }, { cumulative: false, runId: send.runId });
  fake.busy.delete(sessionId); fake.producers.delete(sessionId);
  finishRun(send.runId, { ok: true, ...(stopped ? { stopped: true } : {}) });
  await drainAgentCoordination();
  return id;
}

describe('durable symmetric delivery', () => {
  it('wakes a one-way recipient without creating work or returning its final output', async () => {
    const delivery = await send(main, { response: 'none' });
    expect(delivery).toMatchObject({ requestId: null, status: 'accepted', acceptedByRunId: accepted[0].runId });
    expect(q.listAgentRequests(main.id)).toEqual([]);
    await complete(agentMain.id, 'The useful action is finished.');
    expect(accepted).toHaveLength(1);
    expect(q.listChatEvents(main.id).map(decodeChatMessageReceipt).filter(Boolean)).toMatchObject([{ targetSessionId: agentMain.id, targetEventId: delivery.eventId }]);
    expect(q.listChatEvents(main.id).some(event => event.content === 'coordination_proposed')).toBe(false);
  });
  it('returns one terminal answer and never automatically answers a reply', async () => {
    const delivery = await send();
    const output = await complete(agentMain.id, 'Reviewed and fixed.');
    expect(q.getAgentRequest(delivery.requestId!)).toMatchObject({ status: 'completed', responseEventId: output });
    expect(q.terminalAgentDelivery(delivery.requestId!)).toMatchObject({ kind: 'answer', status: 'accepted', targetSessionId: main.id });
    await complete(main.id, 'Ready for the user.');
    expect(accepted).toHaveLength(2);
    q.finishAgentRequest(delivery.requestId!, 'failed', 'Late failure');
    expect(q.listAgentDeliveries(delivery.requestId!).filter(row => ['answer','failed','cancelled'].includes(row.kind))).toHaveLength(1);
  });
  it('survives unchanged retries without changing the accepted payload, event, run or destination', async () => {
    const input = { request_id: 'stable-key', response: 'none', content: 'Exact bytes' };
    const delivery = await send(main, input);
    expect((await send(main, input)).id).toBe(delivery.id);
    expect(accepted).toHaveLength(1);
    expect(await act(main, 'message_agent', { ...input, content: 'Changed', target: `session:${agentMain.id}` })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(q.getAgentDelivery(delivery.id)?.payload).toEqual(delivery.payload);
  });
  it('keeps different required assignments in separate producing turns', async () => {
    const first = await send(); const second = await send();
    expect(second.status).toBe('delivered');
    expect(q.getAgentRequest(second.requestId!)?.runId).toBeNull();
    await complete(agentMain.id, 'First outcome.');
    expect(q.getAgentRequest(first.requestId!)?.status).toBe('completed');
    expect(q.getAgentRequest(second.requestId!)?.status).toBe('working');
    await complete(agentMain.id, 'Second outcome.');
    expect(q.terminalAgentDelivery(first.requestId!)?.payload.content).toBe('First outcome.');
    expect(q.terminalAgentDelivery(second.requestId!)?.payload.content).toBe('Second outcome.');
  });
  it('preserves provider speed and every launch option through delegation and immutable retries', async () => {
    const input = { workspace_id: agent.id, request_id: 'all-options', prompt: 'Review the implementation.', provider: 'claude', model: 'sonnet', effort: 'high', service_tier: 'fast', permission_mode: 'plan', task_id: 'task-1', device_id: 'device-1', label: 'Review' };
    const result = await act(main, 'delegate_work', input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    await drainAgentCoordination();
    const id = (result.result as { request_id: string }).request_id;
    expect(q.getAgentRequest(id)?.options).toMatchObject({ model: 'sonnet', effort: 'high', serviceTier: 'fast', permissionMode: 'plan', taskId: 'task-1', deviceId: 'device-1', label: 'Review' });
    expect(fake.launch).toHaveBeenCalledWith(expect.objectContaining({ harness: 'claude', model: 'sonnet', effort: 'high', serviceTier: 'fast', permissionMode: 'plan', taskId: 'task-1', deviceId: 'device-1', label: 'Review' }));
    expect(await act(main, 'delegate_work', input)).toMatchObject({ ok: true, result: { request_id: id } });
    expect(await act(main, 'delegate_work', { ...input, service_tier: 'default' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await act(main, 'delegate_work', { ...input, permission_mode: 'auto_all' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(new Set(fake.launch.mock.calls.map(([call]) => call.sessionId)).size).toBe(1);
  });
  it('only injects steering related to the current producing assignment', async () => {
    const initial = await send();
    const unrelated = await send(main, { response: 'none' });
    expect(unrelated.status).toBe('delivered');
    const related = await send(main, { response: 'none', related_request_id: initial.requestId, content: 'Also preserve the API.' });
    expect(related.status).toBe('accepted');
    expect(q.getAgentRequest(initial.requestId!)?.runId).toBe(accepted[0].runId);
  });
  it('queues steering when the harness cannot accept concurrent input', async () => {
    const initial = await send(); fake.concurrentSend = false;
    const update = await send(main, { response: 'none', related_request_id: initial.requestId });
    expect(update.status).toBe('delivered'); expect(accepted).toHaveLength(1);
  });
  it('lets a one-way follow-up wake completed work without reopening its obligation', async () => {
    const initial = await send(); await complete(agentMain.id, 'Done.');
    const outcome = q.terminalAgentDelivery(initial.requestId!)!;
    const followup = await send(main, { response: 'none', related_request_id: initial.requestId, content: 'There is a new constraint.' });
    expect(followup.status).toBe('accepted');
    expect(q.getAgentRequest(initial.requestId!)?.status).toBe('completed');
    expect(q.terminalAgentDelivery(initial.requestId!)?.payload).toEqual(outcome.payload);
  });
  it('attributes nested clarification to the actual producing parent and resumes it', async () => {
    const initial = await send();
    const child = await send(agentMain, { target: 'requester', content: 'Keep the old API?' });
    expect(q.getAgentRequest(child.requestId!)?.parentRequestId).toBe(initial.requestId);
    await complete(agentMain.id, 'Waiting for clarification.');
    expect(q.getAgentRequest(initial.requestId!)?.status).toBe('waiting');
    await complete(main.id, 'Yes, preserve it.');
    expect(q.getAgentRequest(initial.requestId!)?.status).toBe('working');
    await complete(agentMain.id, 'Implemented with compatibility.');
    expect(q.terminalAgentDelivery(initial.requestId!)?.payload.content).toBe('Implemented with compatibility.');
  });
  it('makes explicit replies idempotent while refusing another chat or an unbound human turn', async () => {
    const delivery = await send(); const id = delivery.requestId!;
    expect(await act(main, 'reply_agent_request', { id, content: 'Forged' })).toMatchObject({ ok: false });
    const producer = fake.producers.get(agentMain.id)!; fake.producers.delete(agentMain.id);
    expect(await act(agentMain, 'reply_agent_request', { id, content: 'Human context only' })).toMatchObject({ ok: false });
    fake.producers.set(agentMain.id, producer);
    expect(await act(agentMain, 'reply_agent_request', { id, content: 'Explicit answer' })).toMatchObject({ ok: true });
    const answer = q.terminalAgentDelivery(id)!;
    expect(answer.sourceEventId).toBe(q.getAgentRequest(id)?.responseEventId);
    expect(q.getChatEventById(answer.sourceEventId!)).toMatchObject({ sessionId: agentMain.id, role: 'assistant', content: 'Explicit answer' });
    fake.producers.delete(agentMain.id);
    expect(await act(agentMain, 'reply_agent_request', { id, content: 'Explicit answer' })).toMatchObject({ ok: true });
    expect(await act(agentMain, 'reply_agent_request', { id, content: 'Different answer' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
  it('marks stopped partial work as failed and never re-executes interrupted accepted work', async () => {
    const delivery = await send(); await complete(agentMain.id, 'Partial work', true);
    expect(q.getAgentRequest(delivery.requestId!)?.status).toBe('failed');
    expect(q.terminalAgentDelivery(delivery.requestId!)?.payload.content).toContain('stopped');
    expect(q.terminalAgentDelivery(delivery.requestId!)).toMatchObject({ senderKind: 'system', sourceEventId: null });
    const count = accepted.length; recoverAgentCoordination(); await drainAgentCoordination(); expect(accepted).toHaveLength(count);
  });
  it('cancels descendants and fences late outcomes from waking cancelled work', async () => {
    const initial = await send(); const child = await send(agentMain, { target: 'requester' });
    await complete(agentMain.id, 'Waiting.');
    expect(await act(main, 'cancel_agent_request', { id: initial.requestId })).toMatchObject({ ok: true });
    expect(q.getAgentRequest(child.requestId!)?.status).toBe('cancelled');
    const count = accepted.filter(row => row.sessionId === agentMain.id).length;
    await complete(main.id, 'Too late.');
    expect(accepted.filter(row => row.sessionId === agentMain.id)).toHaveLength(count);
  });
  it('keeps blocked updates durable without treating them as completed answers', async () => {
    const initial = await send(); q.queueAgentBlockedUpdates(agentMain.id, 'approval-one', 'Only a person can approve.', accepted[0].runId);
    q.queueAgentBlockedUpdates(agentMain.id, 'approval-one', 'Only a person can approve.', accepted[0].runId);
    await drainAgentCoordination();
    expect(q.listAgentDeliveries(initial.requestId!).filter(row => row.kind === 'blocked')).toHaveLength(1);
    expect(q.getAgentRequest(initial.requestId!)?.status).toBe('working');
  });
});

describe('permission and Hold', () => {
  it('resolves live chat, execution, agent and global preferences, defaulting to ask', () => {
    q.setAgentCoordinationPolicy('global','1',null);
    const { session, execution } = q.createExecutionWithChat({ workspaceId: agent.id, harness: 'claude', label: null });
    const sibling = q.createChatSession({ type: 'execution', harness: 'claude', workspaceId: agent.id, executionId: execution.id });
    expect(q.agentCoordinationPolicy(session.id)).toMatchObject({ policy: 'ask', source: 'default' });
    q.setAgentCoordinationPolicy('global','1','allow'); expect(q.agentCoordinationPolicy(session.id).source).toBe('global');
    q.setAgentCoordinationPolicy('agent',agent.id,'ask'); expect(q.agentCoordinationPolicy(session.id).source).toBe('agent');
    q.setAgentCoordinationPolicy('execution',execution.id,'allow'); expect(q.agentCoordinationPolicy(sibling.id)).toMatchObject({ policy: 'allow', source: 'execution' });
    q.setAgentCoordinationPolicy('chat',session.id,'ask'); expect(q.agentCoordinationPolicy(session.id).source).toBe('chat');
  });
  it('persists pending approval, approves once and does not re-request on policy changes or retries', async () => {
    q.setAgentCoordinationPolicy('global','1','ask');
    const delivery = await send(main, { request_id: 'approval' });
    expect(delivery.status).toBe('awaiting_approval'); expect(accepted).toHaveLength(0);
    recoverAgentCoordination(); expect(q.pendingAgentApprovals(main.id)).toHaveLength(1);
    q.decideAgentDelivery(delivery.id,'allow'); q.setAgentCoordinationHold(agentMain.id,true); await drainAgentCoordination();
    expect(q.getAgentDelivery(delivery.id)?.status).toBe('delivered');
    expect((await send(main,{request_id:'approval'})).status).toBe('delivered');
    q.setAgentCoordinationHold(agentMain.id,false); await drainAgentCoordination(); expect(accepted).toHaveLength(1);
  });
  it('always allow permits arbitrary destinations while denial creates no target work', async () => {
    q.setAgentCoordinationPolicy('global','1','ask');
    const denied = await send(); q.decideAgentDelivery(denied.id,'deny'); await drainAgentCoordination();
    expect(q.getAgentRequest(denied.requestId!)?.status).toBe('cancelled'); expect(accepted.filter(row=>row.sessionId===agentMain.id)).toHaveLength(0);
    const approved = await send(); q.decideAgentDelivery(approved.id,'always'); await drainAgentCoordination();
    expect(q.agentCoordinationPolicy(main.id)).toMatchObject({policy:'allow',source:'chat'});
    const third = q.createChatSession({ type:'content', harness:'claude' });
    expect((await send(main,{target:`session:${third.id}`,response:'none'})).status).toBe('accepted');
  });
  it('covers verified current-requester clarifications while requiring approval for third-chat contact', async () => {
    const initial = await send(); q.setAgentCoordinationPolicy('chat',agentMain.id,'ask');
    expect((await send(agentMain,{target:'requester'})).status).toBe('accepted');
    const third = q.createChatSession({type:'content',harness:'claude'});
    expect((await send(agentMain,{target:`session:${third.id}`})).status).toBe('awaiting_approval');
    expect(q.getAgentRequest(initial.requestId!)?.status).toBe('working');
  });
  it('keeps held messages visible and batches them into one human-authorized forward without releasing Hold', async () => {
    q.setAgentCoordinationHold(agentMain.id,true);
    const messages = [];
    for (let n=0;n<5;n++) messages.push(await send(main,{response:'none',content:`Message ${n}`}));
    expect(accepted).toHaveLength(0); expect(q.pendingAgentDeliveries(agentMain.id)).toHaveLength(5);
    const material = q.insertChatEvent({sessionId:main.id,source:'agent',role:'assistant',content:'Human-selected review'})!;
    await forwardToChat({sendId:'forward',sourceEventId:material.id,directions:'Use these together.',target:agentMain.id}); await drainAgentCoordination();
    expect(accepted).toHaveLength(1); expect(accepted[0].content).toContain('Message 0'); expect(accepted[0].content).toContain('Message 4');
    expect(q.pendingAgentDeliveries(agentMain.id)).toHaveLength(0); expect(q.getChatSession(agentMain.id)?.coordinationHeldAt).toBeTruthy();
  });
  it('does not assign held required work to a human turn and starts it once on release', async () => {
    q.setAgentCoordinationHold(agentMain.id,true); const initial = await send();
    const human = q.createRun({chatSessionId:agentMain.id,harness:'claude',triggerKind:'manual',status:'running'});
    q.acceptAgentDeliveriesForRun(human.id,agentMain.id,[initial.id]);
    expect(q.getAgentRequest(initial.requestId!)?.runId).toBeNull();
    q.recordAgentRequestOutput(human.id,q.insertChatEvent({sessionId:agentMain.id,source:'agent',role:'assistant',content:'Human turn output'})!.id);
    q.settleAgentRequestsForRun(human.id,{ok:true}); expect(q.getAgentRequest(initial.requestId!)?.status).toBe('queued');
    q.setAgentCoordinationHold(agentMain.id,false); await drainAgentCoordination(); await drainAgentCoordination();
    expect(accepted).toHaveLength(1); expect(accepted[0].content).toContain('Inspect the current state');
    expect(q.getAgentDelivery(initial.id)?.acceptedByRunId).toBe(human.id);
  });
  it('reserves one parent continuation after a human reads a held child answer', async () => {
    const initial = await send(); const child = await send(agentMain,{target:'requester'});
    await complete(agentMain.id,'Waiting.'); q.setAgentCoordinationHold(agentMain.id,true); await complete(main.id,'Child answer.');
    const answer = q.terminalAgentDelivery(child.requestId!)!;
    const human = q.createRun({chatSessionId:agentMain.id,harness:'claude',triggerKind:'manual',status:'running'});
    q.acceptAgentDeliveriesForRun(human.id,agentMain.id,[answer.id]);
    expect(q.getAgentRequest(initial.requestId!)?.status).toBe('waiting');
    q.setAgentCoordinationHold(agentMain.id,false); await drainAgentCoordination(); const reserved = q.getAgentRequest(initial.requestId!)?.runId;
    await drainAgentCoordination(); expect(q.getAgentRequest(initial.requestId!)?.runId).toBe(reserved);
    expect(q.getAgentDelivery(answer.id)).toMatchObject({acceptedByRunId:human.id,continuationRunId:reserved});
    expect(accepted.filter(row=>row.sessionId===agentMain.id)).toHaveLength(2);
  });
  it('never overwrites destination ask when initializing child permission', () => {
    const {session} = q.createExecutionWithChat({workspaceId:agent.id,harness:'claude',label:null});
    q.setAgentCoordinationPolicy('agent',agent.id,'ask'); q.initializeAgentChildPolicy(main.id,session.id);
    expect(q.agentCoordinationPolicy(session.id)).toMatchObject({policy:'ask',source:'chat'});
    q.setAgentCoordinationPolicy('global','1','allow'); expect(q.agentCoordinationPolicy(session.id).policy).toBe('ask');
  });
});

describe('launch, provenance and guards', () => {
  it('waits for approval before creating a destination, then reserves stable launch and prompt identities', async () => {
    q.setAgentCoordinationPolicy('global','1','ask');
    const input = {workspace_id:agent.id,request_id:'launch',prompt:'Implement the fix.',provider:'claude',model:'sonnet',effort:'high',permission_mode:'plan'};
    const result = await act(main,'delegate_work',input); expect(result.ok).toBe(true);
    const id = stableCoordinationId('request',main.id,'launch'); await drainAgentCoordination(); expect(fake.launch).not.toHaveBeenCalled();
    q.decideAgentDelivery(id,'allow'); await drainAgentCoordination();
    expect(q.getAgentRequest(id)).toMatchObject({targetSessionId:requestScopedId('session',agent.id,id),status:'working'});
    expect(q.initialAgentDelivery(id)?.eventId).toBe(requestScopedId('prompt',agent.id,id));
    await act(main,'delegate_work',input); await drainAgentCoordination(); expect(fake.launch).toHaveBeenCalledOnce();
  });
  it('forwards full selected material and truthful human authorship once, without automatic return', async () => {
    const text='Review detail. '.repeat(1000); const material=q.insertChatEvent({sessionId:main.id,role:'assistant',source:'agent',content:text})!;
    const input={sendId:'forward-once',sourceEventId:material.id,directions:'Please compare.',target:agentMain.id};
    const delivery=await forwardToChat(input); await drainAgentCoordination();
    expect(await forwardToChat(input)).toMatchObject({id:delivery.id}); await drainAgentCoordination();
    expect(q.getChatEventById(delivery.eventId)).toMatchObject({senderSessionId:null,raw:{agentCoordination:{senderKind:'human',sourceSessionId:main.id,sourceEventId:material.id,content:text}}});
    expect(accepted[0].content).toContain(text); await complete(agentMain.id,'Review done.'); expect(accepted).toHaveLength(1);
  });
  it('never reroutes a pinned target after it is archived', async () => {
    q.setAgentCoordinationHold(agentMain.id,true); const delivery=await send();
    q.archiveChatSession(agentMain.id); q.setAgentCoordinationHold(agentMain.id,false); await drainAgentCoordination();
    expect(q.getAgentRequest(delivery.requestId!)?.status).toBe('failed'); expect(accepted.some(row=>row.sessionId===agentMain.id)).toBe(false);
  });
  it('refuses unsigned, self-directed, foreign-owner and restricted callers', async () => {
    const input={response:'required',target:'orchestrator',request_id:'restricted',content:'Do something.'};
    expect(await runAction('message_agent',input,{remote:true})).toMatchObject({ok:false}); expect(await act(main,'message_agent',input)).toMatchObject({ok:false});
    for(const surfaceKind of ['team_chat','result_review']) expect(await act(q.createChatSession({harness:'claude',type:'orchestration',surfaceKind}),'message_agent',input)).toMatchObject({ok:false});
    const foreign=q.createChatSession({harness:'claude',type:'content',userId:'other'});
    expect(await act(main,'message_agent',{...input,target:`session:${foreign.id}`})).toMatchObject({ok:false});
  });
  it('requires explicit response policy and rejects unsupported or misspelled fields', async () => {
    const input={target:`session:${agentMain.id}`,request_id:'schema',content:'Inspect.'};
    expect(await act(main,'message_agent',input)).toMatchObject({ok:false});
    expect(await act(main,'message_agent',{...input,response:'none',related_request:'typo'})).toMatchObject({ok:false});
    expect(await act(main,'message_agent',{...input,response:'required',related_request_id:'other'})).toMatchObject({ok:false});
  });
});

it('resumes an approved parent after its proposed child is denied, without starting the child target', async () => {
  const initial=await send();
  const third=q.createChatSession({type:'content',harness:'claude'});
  q.setAgentCoordinationPolicy('chat',agentMain.id,'ask');
  const child=await send(agentMain,{target:`session:${third.id}`});
  expect(child.status).toBe('awaiting_approval');
  await complete(agentMain.id,'Waiting for approval.');
  expect(q.getAgentRequest(initial.requestId!)?.status).toBe('waiting');
  q.decideAgentDelivery(child.id,'deny');await drainAgentCoordination();
  expect(q.getAgentRequest(initial.requestId!)?.status).toBe('working');
  expect(accepted.some(row=>row.sessionId===third.id)).toBe(false);
  expect(accepted.at(-1)?.content).toContain('do not manufacture a new retry key');
});

it('batches held child outcomes in one durable reservation and handles a later outcome in a successor continuation', async () => {
  const initial=await send();
  const peers=Array.from({length:3},()=>q.createChatSession({type:'content',harness:'claude'}));
  const children=[];
  for(const peer of peers) children.push(await send(agentMain,{target:`session:${peer.id}`}));
  await complete(agentMain.id,'Waiting for three consultations.');
  q.setAgentCoordinationHold(agentMain.id,true);
  await complete(peers[0].id,'First result.');await complete(peers[1].id,'Second result.');
  q.setAgentCoordinationHold(agentMain.id,false);
  const reservation=q.reserveAgentRequestTurn(initial.requestId!)!;
  expect(reservation.updates).toHaveLength(2);
  q.setAgentCoordinationHold(agentMain.id,true);recoverAgentCoordination();
  expect(q.reserveAgentRequestTurn(initial.requestId!)?.run.id).toBe(reservation.run.id);
  await complete(peers[2].id,'Late result.');
  q.setAgentCoordinationHold(agentMain.id,false);await drainAgentCoordination();
  expect(q.getAgentRequest(initial.requestId!)?.runId).toBe(reservation.run.id);
  await complete(agentMain.id,'Handled the first batch.');
  expect(q.getAgentRequest(initial.requestId!)?.status).toBe('working');
  expect(q.getAgentRequest(initial.requestId!)?.runId).not.toBe(reservation.run.id);
  await complete(agentMain.id,'All results reconciled.');
  expect(q.getAgentRequest(initial.requestId!)?.status).toBe('completed');
  expect(q.terminalAgentDelivery(children[2].requestId!)?.continuationRunId).toBe(q.getAgentRequest(initial.requestId!)?.runId);
});

describe('personal conversation retrieval', () => {
  it('searches main and content conversations while keeping team and reviewer history separate', async () => {
    const content = q.createChatSession({ type: 'content', harness: 'claude', status: 'active' });
    const team = q.createChatSession({ type: 'orchestration', harness: 'claude', surfaceKind: 'team_chat', status: 'active' });
    const reviewer = q.createChatSession({ type: 'execution', harness: 'claude', surfaceKind: 'result_review', status: 'active' });
    for (const chat of [main, agentMain, content, team, reviewer]) q.insertChatEvent({ sessionId: chat.id, role: 'assistant', source: 'agent', content: 'quartz retention decision' });
    const result = await act(main, 'search_sessions', { query: 'quartz' });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.result as Array<{ sessionId: string }>).map(row => row.sessionId).sort()).toEqual([main.id, agentMain.id, content.id].sort());
    expect(await act(main, 'get_session_events', { session_id: team.id })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });

  it('pages equal-timestamp messages without gaps and retrieves long text without provider raw data', async () => {
    const text = 'A'.repeat(45_000);
    const events = Array.from({ length: 6 }, (_, n) => q.insertChatEvent({ id: uuidv7(), sessionId: agentMain.id, role: 'assistant', source: 'agent', content: n === 5 ? text : String(n), createdAt: '2026-10-15T12:00:00.000Z', raw: { privateProviderRecord: true } })!);
    const first = await act(main, 'get_session_events', { session_id: agentMain.id, limit: 3 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const page = first.result as { events: Array<{ id: string; content: string; raw?: unknown }>; next_before: string };
    expect(page.events.map(row => row.id)).toEqual(events.slice(3).map(row => row.id));
    expect(page.events.at(-1)!.content).toHaveLength(20_000);
    expect(page.events.some(row => 'raw' in row)).toBe(false);
    const second = await act(main, 'get_session_events', { session_id: agentMain.id, limit: 3, before: page.next_before });
    expect(second).toMatchObject({ ok: true, result: { hasOlder: false, events: events.slice(0, 3).map(row => ({ id: row.id })) } });
    let reconstructed = '';
    let offset: number | null = 0;
    while (offset !== null) {
      const chunk = await act(main, 'get_chat_event', { id: events[5].id, offset, max_chars: 10_000 });
      expect(chunk.ok).toBe(true);
      if (!chunk.ok) break;
      const part = chunk.result as { content: string; next_offset: number | null };
      reconstructed += part.content;
      offset = part.next_offset;
    }
    expect(reconstructed).toBe(text);
    const alien = q.insertChatEvent({ sessionId: main.id, source: 'user', role: 'user', content: 'cursor' })!;
    expect(await act(main, 'get_session_events', { session_id: agentMain.id, before: alien.id })).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  });

  it('keeps history reads on the session index and rejects another user\'s records', async () => {
    const { getRawDb } = await import('@/lib/db');
    const plans = getRawDb().prepare('EXPLAIN QUERY PLAN SELECT id, content FROM chat_events WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 21').all(main.id) as Array<{ detail: string }>;
    expect(plans.some(row => row.detail.includes('idx_chat_events_session_created'))).toBe(true);
    expect(plans.some(row => /SCAN chat_events\b/.test(row.detail))).toBe(false);
    const other = q.createChatSession({ harness: 'claude', type: 'orchestration', userId: 'other-user' });
    const event = q.insertChatEvent({ sessionId: other.id, role: 'assistant', source: 'agent', content: 'private zircon context' })!;
    expect(await act(main, 'get_chat_event', { id: event.id })).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(await act(main, 'search_sessions', { query: 'zircon' })).toMatchObject({ ok: true, result: [] });
  });
});

it('does not turn a cancelled producing assignment into fresh independent work',async()=>{
  const initial=await send();
  await act(main,'cancel_agent_request',{id:initial.requestId});
  const third=q.createChatSession({type:'content',harness:'claude'});
  expect(await act(agentMain,'message_agent',{target:`session:${third.id}`,request_id:'resurrect',content:'Continue the cancelled work.',response:'required'})).toMatchObject({ok:false,error:{code:'conflict'}});
  expect(q.listAgentRequests(agentMain.id)).toHaveLength(0);
});

it('settles an unaccepted assignment before its empty destination is deleted', async () => {
  const target = q.createChatSession({ type: 'content', harness: 'claude' });
  q.setAgentCoordinationPolicy('chat', main.id, 'ask');
  const delivery = await send(main, { target: `session:${target.id}` });
  expect(delivery.status).toBe('awaiting_approval');
  expect(q.deleteChatSessionIfEmpty(target.id)).toBe(true);
  expect(q.getAgentRequest(delivery.requestId!)).toMatchObject({ status: 'cancelled', targetSessionId: null });
  expect(q.getAgentDelivery(delivery.id)).toMatchObject({ status: 'cancelled', targetSessionId: null });
  await drainAgentCoordination();
  expect(accepted.some(row => row.sessionId === target.id)).toBe(false);
});

it('retains accepted history through soft-event and chat deletion and restricts removal of an assignment run', async () => {
  const initial = await send();
  await complete(agentMain.id, 'Saved outcome remains available.');
  const request = q.getAgentRequest(initial.requestId!)!;
  const { getRawDb } = await import('@/lib/db');
  expect(() => getRawDb().prepare('DELETE FROM runs WHERE id=?').run(request.runId)).toThrow(/FOREIGN KEY/i);
  getRawDb().prepare('DELETE FROM chat_events WHERE id=?').run(request.responseEventId);
  expect(q.terminalAgentDelivery(request.id)?.payload.content).toBe('Saved outcome remains available.');
  q.settleCoordinationForDeletedChat(agentMain.id);
  getRawDb().prepare('DELETE FROM chat_sessions WHERE id=?').run(agentMain.id);
  expect(q.getAgentRequest(request.id)).toMatchObject({ status: 'completed', targetSessionId: null });
  expect(q.getAgentDelivery(initial.id)).toMatchObject({ status: 'accepted', targetSessionId: null });
  const count = accepted.length;
  await drainAgentCoordination();
  expect(accepted).toHaveLength(count);
  expect(q.getChatSession(main.id)).not.toBeNull();
  expect(getRawDb().pragma('foreign_key_check')).toEqual([]);
});

it('rolls back receiving text, outgoing receipt and delivery state without publishing a phantom message',async()=>{
  const {getRawDb}=await import('@/lib/db');
  const {subscribe}=await import('@/lib/realtime/bus');
  const id='atomic-send';
  q.createAgentDelivery({id,kind:'message',senderKind:'agent',sourceSessionId:main.id,targetAddress:`session:${agentMain.id}`,targetSessionId:agentMain.id,eventId:'atomic-event',payload:{version:1,content:'Exact atomic input',prompt:'Exact atomic input',attachments:[]},status:'queued'});
  const heard:unknown[]=[];
  const unsub=[subscribe(`session:${main.id}`,message=>{if(message.kind==='chat_event')heard.push(message);}),subscribe(`session:${agentMain.id}`,message=>{if(message.kind==='chat_event')heard.push(message);})];
  getRawDb().exec("CREATE TRIGGER fail_delivery BEFORE UPDATE OF status ON agent_coordination_deliveries WHEN NEW.id='atomic-send' BEGIN SELECT RAISE(ABORT,'simulated transaction failure'); END;");
  try {
    expect(()=>q.persistAgentDelivery(id)).toThrow('simulated transaction failure');
    expect(q.getChatEventById('atomic-event')).toBeNull();
    expect(q.getAgentDelivery(id)?.status).toBe('queued');
    expect(heard).toEqual([]);
  } finally {getRawDb().exec('DROP TRIGGER fail_delivery');for(const stop of unsub)stop();}
});
