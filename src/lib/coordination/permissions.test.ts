import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import * as q from '@/lib/db/queries';
import { agentLaunchPermission } from './permissions';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { await home.cleanup(); });
it.each(['ask','plan'] as const)('caps omitted and broader requested authority to the source %s mode', mode => {
  const source=q.createChatSession({type:'orchestration',harness:'claude',permissionMode:mode});
  const actor={source:'ai' as const,sessionId:source.id};
  expect(agentLaunchPermission(actor,undefined,'claude')).toBe(mode);
  expect(agentLaunchPermission(actor,'auto_all','codex')).toBe(mode);
  expect(agentLaunchPermission({source:'human'},'auto_all','claude')).toBe('auto_all');
});
it('fails unsupported capped modes rather than upgrading them', async () => {
  const source=q.createChatSession({type:'orchestration',harness:'claude',permissionMode:'ask'});
  const actor={source:'ai' as const,sessionId:source.id};
  expect(()=>agentLaunchPermission(actor,undefined,'cursor')).toThrow(/does not support|not supported|supports/i);
  const workspace=q.createWorkspace({name:'Project',cwd:home.root,isGit:false});
  const {dispatchExecutionSession}=await import('@/lib/sessions/dispatch');
  await expect(dispatchExecutionSession({workspaceId:workspace.id,harness:'cursor',actor})).rejects.toMatchObject({code:'invalid_params'});
  expect(q.listChatSessions({workspaceId:workspace.id})).toHaveLength(0);
});
it('rechecks an existing launch on retry without overwriting a human permission change', async () => {
  const source=q.createChatSession({type:'orchestration',harness:'claude',permissionMode:'ask'});
  const workspace=q.createWorkspace({name:'Project',cwd:home.root,isGit:false});
  const {session}=q.createExecutionWithChat({workspaceId:workspace.id,harness:'claude',permissionMode:'auto_all',label:null});
  const {dispatchExecutionSession}=await import('@/lib/sessions/dispatch');
  await expect(dispatchExecutionSession({workspaceId:workspace.id,sessionId:session.id,harness:'claude',actor:{source:'ai',sessionId:source.id}})).rejects.toMatchObject({code:'conflict'});
  expect(q.getChatSession(session.id)?.permissionMode).toBe('auto_all');
});

it('finishes child policy initialization after a crash between chat creation and initialization', async () => {
  const source = q.createChatSession({ type: 'orchestration', harness: 'claude', permissionMode: 'ask' });
  q.setAgentCoordinationPolicy('chat', source.id, 'allow');
  const workspace = q.createWorkspace({ name: 'Project', cwd: home.root, isGit: false });
  q.setAgentCoordinationPolicy('agent', workspace.id, 'ask');
  const { requestScopedId } = await import('./start-id');
  const delivery = q.createInitiatingAgentDelivery({ id: 'approved-launch', source, sourceRunId: null, address: `agent:${workspace.id}`, targetSessionId: null, requestKey: 'launch-key', parentRequestId: null, kind: 'delegation', content: 'Implement this.', options: { workspaceId: workspace.id }, eventId: 'launch-input', prompt: 'Implement this.', status: 'queued' });
  const sessionId = requestScopedId('session', workspace.id, delivery.id);
  q.createExecutionWithChat({ workspaceId: workspace.id, chatSessionId: sessionId, harness: 'claude', permissionMode: 'ask', label: null });
  const { dispatchExecutionSession } = await import('@/lib/sessions/dispatch');
  const input = { workspaceId: workspace.id, sessionId, coordinationDeliveryId: delivery.id, actor: { source: 'ai' as const, sessionId: source.id } };
  await dispatchExecutionSession(input);
  expect(q.agentCoordinationPolicy(sessionId)).toMatchObject({ policy: 'ask', source: 'chat' });
  q.setAgentCoordinationPolicy('chat', sessionId, 'allow');
  await dispatchExecutionSession(input);
  expect(q.agentCoordinationPolicy(sessionId).policy).toBe('allow');
  expect(q.listChatEvents(sessionId).filter(event => event.content === 'coordination_initialized')).toHaveLength(1);
});

it('prevents signed agents from bypassing delegation approval through sibling or main-chat launch endpoints', async () => {
  const source = q.createChatSession({ type: 'orchestration', harness: 'claude' });
  const { SESSION_CREDENTIAL_HEADER, sessionCredential } = await import('@/lib/orchestrator/session-credential');
  const request = new Request('http://localhost/api/new-chat', { headers: { [SESSION_CREDENTIAL_HEADER]: sessionCredential(source.id)! } });
  const context = { headers: request.headers, url: request.url, nextUrl: new URL(request.url), signal: request.signal };
  const sibling = await import('@/lib/server/operations/sessions/[id]/new-chat');
  const agentMain = await import('@/lib/server/operations/workspaces/[id]/chat/new');
  const orchestrator = await import('@/lib/server/operations/orchestrator-chat');
  expect(await sibling.POST(sibling.POSTInput.parse({ params: { id: source.id }, body: {} }), context)).toMatchObject({ ok: false, status: 403 });
  expect(await agentMain.POST(agentMain.POSTInput.parse({ params: { id: 'other-agent' }, body: {} }), context)).toMatchObject({ ok: false, status: 403 });
  expect(await orchestrator.POST(orchestrator.POSTInput.parse({ body: {} }), context)).toMatchObject({ ok: false, status: 403 });
  expect(q.listChatSessions({})).toHaveLength(1);
});
