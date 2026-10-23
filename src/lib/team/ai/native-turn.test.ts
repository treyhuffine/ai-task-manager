/** Actual ordinary local runner, fake provider only. No native account or binary is used. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, FAKE_MODEL_ID, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests, resumeTeamAiAfterStart } from './chat';
import { HARNESS_IDS } from '@/lib/harness/registry';
import { answerPrompt } from '@/lib/executor/answer-prompt';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { resetDb } from '@/lib/db';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { API_PROTOCOL, API_PROTOCOL_HEADER } from '@/lib/releases/api-contract';
import { runAction } from '@/lib/orchestrator/dispatch';
import { checkTeamChatHealth } from './chat';
import { homeSink } from '@/lib/executor/home-sink';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness;
let member: Awaited<ReturnType<typeof teamTrpc>>, owner: Awaited<ReturnType<typeof teamTrpc>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
  member = await teamTrpc(fixture.member.token.plaintext); owner = await teamTrpc(fixture.owner.token.plaintext);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it('recovers a lost completion receipt once the runner is idle and continues the next member turn', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Lost receipt' });
  const signal = homeSink.signal;
  let dropped = false;
  vi.spyOn(homeSink, 'signal').mockImplementation((id, event) => {
    if (event.type === 'turn_result' && !dropped) { dropped = true; return; }
    signal(id, event);
  });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'lost-completion-first', text: 'First' });
  await vi.waitFor(() => expect(dropped).toBe(true));
  await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'lost-completion-next', text: 'Next' });
  const now = Date.now();
  await checkTeamChatHealth(now); await checkTeamChatHealth(now + 2_000);
  await settledTeamAi();
  expect(q.listTeamChatTurns(chat.id).map(turn => turn.status)).toEqual(['done', 'done']);
  expect(q.listTeamChatTurns(chat.id)[0].error).toBeNull();
  expect(fake.latest().messages).toHaveLength(2);
});

it('keeps a chat open and retryable when archive cannot close its harness', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Retry close' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'archive-close-test', text: 'Hello' });
  await settledTeamAi();
  const failure = vi.spyOn(fake.latest(), 'close').mockRejectedValueOnce(new Error('Close refused'));
  await expect(member.team.ai.chats.archive.mutate({ id: chat.id })).rejects.toThrow(/Close refused/);
  expect(q.getChatSession(chat.id)?.status).toBe('active');
  await member.team.ai.chats.archive.mutate({ id: chat.id });
  expect(failure).toHaveBeenCalledTimes(2);
  expect(q.getChatSession(chat.id)?.status).toBe('archived');
});

it('requires an explicit running-agent choice through the real Team MCP lifecycle path', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const task = q.createTask({ title: 'Running work' });
  const execution = q.createExecutionWithChat({ label: 'Running', workspaceId: fixture.workspace.id, harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  q.createPlacement({ executionId: execution.execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  q.attachExecutionToTask(execution.execution.id, task.id);
  const entered = Promise.withResolvers<void>();
  fake.onTurn(async () => { entered.resolve(); await new Promise(() => {}); });
  await owner.sessions.messagesPost.mutate({ params: { id: execution.session.id }, body: { content: 'Keep working', id: crypto.randomUUID() } });
  await entered.promise;
  const client = await member.team.aiClients.create.mutate({ name: 'Lifecycle client' });
  const call = async (args: Record<string, unknown>) => {
    const response = await serveTeam('http://team.test/api/team/mcp', { method: 'POST', headers: { authorization: `Bearer ${client.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'complete_task', arguments: args } }) });
    const raw = await response.text();
    const message = JSON.parse(raw.includes('data:') ? raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('') : raw);
    return JSON.parse(message.result.content[0].text);
  };
  const refused = await call({ id: task.id, idempotency_key: 'mcp-running-choice' });
  expect(refused).toMatchObject({ ok: false, error: { code: 'conflict' } });
  expect(q.getTask(task.id)?.status).toBe('todo');
  expect(await call({ id: task.id, idempotency_key: 'mcp-running-choice', runtime_choice: 'keep_running' })).toMatchObject({ ok: true });
  expect(q.getTask(task.id)?.status).toBe('done');
  expect(q.listTeamChatTurns(execution.session.id)[0].status).toBe('running');
});

it('inherits an agent sender permission mode and refuses agent widening through launch and HTTP', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const parent = q.createChatSession({ workspaceId: fixture.workspace.id, harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'ask' });
  const ctx = { remote: true, actor: { source: 'ai' as const, sessionId: parent.id, memberId: fixture.member.member.id }, caller: { location: 'elsewhere' as const, apiKeyId: fixture.member.key.id } };
  const input = { workspaceId: fixture.workspace.id, prompt: 'Inspect', requestId: 'inherit-ask', provider: 'claude' as const };
  const result = await runAction('start_execution', input, ctx);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const child = q.getChatSession((result.result as { sessionId: string }).sessionId)!;
  expect(child.permissionMode).toBe('ask');
  await settledTeamAi();
  expect(await runAction('start_execution', { ...input, requestId: 'refuse-auto-all', permissionMode: 'auto_all' }, ctx)).toMatchObject({ ok: false });
  const response = await serveTeam(`http://team.test/api/trpc/sessions.update`, { method: 'POST', headers: { authorization: `Bearer ${fixture.member.token.plaintext}`, [SESSION_CREDENTIAL_HEADER]: sessionCredential(parent.id)!, [API_PROTOCOL_HEADER]: String(API_PROTOCOL), 'content-type': 'application/json' }, body: JSON.stringify({ params: { id: parent.id }, body: { permissionMode: 'auto_all' } }) });
  expect(response.status).toBe(403);
  expect(q.getChatSession(parent.id)?.permissionMode).toBe('ask');
  await member.sessions.update.mutate({ params: { id: parent.id }, body: { permissionMode: 'auto_all' } });
  expect(q.getChatSession(parent.id)?.permissionMode).toBe('auto_all');
});

it.each(HARNESS_IDS)('runs a shared %s chat through the ordinary provider and server placement', async harness => {
  fake = installFakeHarness(harness);
  if (harness === 'codex') fake.modelId = 'gpt-6.1-sol';
  q.saveTeamAiSettings({ harness, model: fake.modelId }, fixture.owner.member.id);
  const created = await member.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Shared work' });
  const sent = await member.team.ai.send.mutate({ chatId: created.id, clientSendId: 'native-member-first', text: 'Inspect shared work' });
  await settledTeamAi();
  expect(q.getTeamChatTurn(sent.turnId)?.status, q.getTeamChatTurn(sent.turnId)?.error ?? undefined).toBe('done');
  expect(fake.sessions).toHaveLength(1);
  expect(fake.latest().ctx.cwd).toBe(fixture.workspace.cwd);
  expect(fake.latest().ctx.config?.mcpServers?.map(server => server.name)).toEqual(['ri_team']);
  const instructions = fake.latest().ctx.config?.instructionsFile;
  const delivered = instructions ? (await import('node:fs')).readFileSync(instructions, 'utf8') : fake.latest().messages[0];
  expect(delivered).toContain('Personal Ri data is never shared automatically.');
  expect(fake.latest().ctx.env?.RI_HOME_TOOLS_URL).toMatch(/^https?:\/\//);
  expect(q.getChatSession(created.id)).toMatchObject({ createdByMemberId: fixture.member.member.id, workspaceId: fixture.workspace.id, deviceId: q.getHome()!.hostDeviceId });
  expect(q.listChatEvents(created.id).some(event => event.source === 'agent')).toBe(true);
  expect(q.listRuns().filter(run => run.chatSessionId === created.id)[0].requestedByMemberId).toBe(fixture.member.member.id);
});

it('lets two members continue one live session, permits human approval, refuses agents, stops and resumes after restart', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const created = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Collaborative work' });
  const first = await owner.team.ai.send.mutate({ chatId: created.id, clientSendId: 'owner-first-turn', text: 'Start the work' });
  await settledTeamAi();
  const nativeId = q.getChatSession(created.id)!.externalSessionId;
  const answers: unknown[] = [];
  fake.onTurn(async turn => {
    if (turn.message.includes('Ask permission')) answers.push(await turn.ask({ toolName: 'Bash', toolUseId: 'shared-approval', input: { command: 'pwd' } }));
    await turn.say('Completed shared work');
  });
  q.updateChatSession(created.id, { permissionMode: 'ask' });
  await closeAllSessions(); // Apply the newly selected ordinary permission mode.
  const second = await member.team.ai.send.mutate({ chatId: created.id, clientSendId: 'member-second-turn', text: 'Ask permission' });
  await vi.waitFor(() => expect(q.runningTeamChatTurn(created.id)?.id).toBe(second.turnId));
  await vi.waitFor(async () => expect(await member.sessions.pendingInputGet.query({ params: { id: created.id } })).toHaveLength(1));
  const agent = { source: 'ai' as const, sessionId: created.id, memberId: fixture.member.member.id, apiKeyId: fixture.member.key.id };
  expect(() => answerPrompt(created.id, 'shared-approval', { allow: true }, agent)).toThrow(/cannot perform/);
  expect(() => answerPrompt(created.id, 'shared-approval', { allow: false }, agent)).toThrow(/cannot perform/);
  const credential = sessionCredential(created.id)!;
  const response = await serveTeam(`http://team.test/api/sessions/${created.id}/pending-input/shared-approval`, { method: 'POST', headers: { authorization: 'Bearer ' + fixture.member.token.plaintext, [SESSION_CREDENTIAL_HEADER]: credential, [API_PROTOCOL_HEADER]: String(API_PROTOCOL), 'content-type': 'application/json' }, body: JSON.stringify({ allow: true }) });
  expect(response.status).toBe(403);
  expect(await owner.sessions.pendingInputRequestIdPost.mutate({ params: { id: created.id, requestId: 'shared-approval' }, body: { allow: true } })).toEqual({ ok: true });
  await settledTeamAi(); expect(answers).toEqual([{ allow: true, updatedInput: { command: 'pwd' } }]);
  expect(fake.latest().messages[0]).toContain('Maya:');
  expect(fake.latest().resumed).toBe(true); expect(fake.latest().sessionId).toBe(nativeId);
  const started = Promise.withResolvers<void>();
  fake.onTurn(async () => { started.resolve(); await new Promise(() => {}); });
  const third = await member.team.ai.send.mutate({ chatId: created.id, clientSendId: 'member-held-turn', text: 'Keep working' });
  await started.promise;
  await owner.team.ai.stop.mutate({ turnId: third.turnId }); await settledTeamAi();
  expect(q.getTeamChatTurn(third.turnId)?.status).toBe('cancelled');
  const history = q.listChatEvents(created.id).map(event => [event.id, event.authorMemberId]);
  await closeAllSessions(); _resetExecutorState(); resetDb(); resumeTeamAiAfterStart();
  expect(q.listChatEvents(created.id).map(event => [event.id, event.authorMemberId])).toEqual(history);
  fake.onTurn(turn => turn.say('After restart'));
  const fourth = await member.team.ai.send.mutate({ chatId: created.id, clientSendId: 'member-after-restart', text: 'Continue after restart' });
  await settledTeamAi();
  expect(q.getTeamChatTurn(fourth.turnId)?.status).toBe('done');
  expect(q.getTeamChatTurn(first.turnId)?.status).toBe('done');
  expect(q.getChatSession(created.id)).toMatchObject({ createdByMemberId: fixture.owner.member.id, externalSessionId: nativeId });
  expect(q.getChatEventById(fourth.messageId)?.authorMemberId).toBe(fixture.member.member.id);
  expect(q.listRuns().filter(run => run.chatSessionId === created.id).map(run => run.requestedByMemberId)).toEqual(expect.arrayContaining([fixture.owner.member.id, fixture.member.member.id]));
});

it('attributes chat file writes and deletes to the member, through the ordinary file operations', async () => {
  fake = installFakeHarness('claude');
  const { execution, session } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Files', worktreePath: fixture.workspace.cwd, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  q.createPlacement({ executionId: execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  await member.sessions.filePut.mutate({ params: { id: session.id }, query: { path: 'member.txt' }, body: { content: 'Member edit' } });
  await member.sessions.fileDelete.mutate({ params: { id: session.id }, query: { path: 'member.txt' }, body: {} });
  expect(q.listTeamActivity(fixture.workspace.id).filter(event => event.resource === 'member.txt')).toEqual(expect.arrayContaining([
    expect.objectContaining({ memberId: fixture.member.member.id, operation: 'write' }),
    expect.objectContaining({ memberId: fixture.member.member.id, operation: 'delete' }),
  ]));
});

it('coordinates completing and archiving shared tasks, preserves other work on Keep, and stops the full workstream on Stop', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const { session: chat, execution } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Coordinated work', worktreePath: fixture.workspace.cwd, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  q.createPlacement({ executionId: execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: fixture.workspace.cwd });
  const task = q.createTask({ title: 'First outcome' });
  const other = q.createTask({ title: 'Other shared outcome' });
  const executionId = q.getChatSession(chat.id)!.executionId!;
  q.attachExecutionToTask(executionId, task.id); q.attachExecutionToTask(executionId, other.id);
  let started = Promise.withResolvers<void>();
  fake.onTurn(async () => { started.resolve(); await new Promise(() => {}); });
  const a = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'lifecycle-a', text: 'Work on both outcomes' });
  await started.promise;
  await expect(member.tasks.complete.mutate({ id: task.id })).rejects.toThrow(/Choose keep_running/);
  expect(q.getTask(task.id)?.status).toBe('todo');
  await member.tasks.complete.mutate({ id: task.id, runtimeChoice: 'keep_running', acknowledgedExecutionIds: [executionId] });
  expect(q.getTask(task.id)?.status).toBe('done');
  expect(q.getTeamChatTurn(a.turnId)?.status).toBe('running');
  expect(q.listChatEvents(chat.id).find(event => (event.raw as { scopeChange?: unknown } | null)?.scopeChange)).toMatchObject({ authorMemberId: fixture.member.member.id, content: expect.stringContaining('First outcome') });
  await owner.team.ai.stop.mutate({ turnId: a.turnId }); await settledTeamAi();
  started = Promise.withResolvers<void>();
  fake.onTurn(async turn => { expect(turn.message).toContain('"title":"First outcome","status":"done"'); started.resolve(); await new Promise(() => {}); });
  const b = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'lifecycle-b', text: 'Continue remaining work' });
  await started.promise;
  await expect(member.tasks.transition.mutate({ id: other.id, command: 'archive' })).rejects.toThrow(/Choose keep_running/);
  await member.tasks.transition.mutate({ id: other.id, command: 'archive', runtimeChoice: 'stop_running_agent', acknowledgedExecutionIds: [executionId] });
  await settledTeamAi();
  expect(q.getTeamChatTurn(b.turnId)?.status).toBe('cancelled');
  expect(q.getTask(other.id)?.status).toBe('archived');
  expect(q.getExecution(executionId)?.status).toBe('active');
  expect(q.getExecutionTasks(executionId).map(value => value.id)).toEqual(expect.arrayContaining([task.id, other.id]));
});

it('labels an agent-started Team prompt with its sending chat while retaining the requesting member', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const sender = q.createChatSession({ workspaceId: fixture.workspace.id, type: 'orchestration', harness: 'claude', surfaceKind: q.TEAM_CHAT_SURFACE });
  q.acceptTeamChatSend({ chatId: sender.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'source-turn', text: 'Coordinate work' });
  q.claimNextTeamChatTurn(sender.id);
  const { startTeamExecutionAction } = await import('@/lib/sessions/team-start-action');
  const result = await startTeamExecutionAction({ remote: true, actor: { source: 'ai', sessionId: sender.id, memberId: fixture.member.member.id }, caller: { apiKeyId: fixture.member.key.id, location: 'home' } }, { workspaceId: fixture.workspace.id, prompt: 'Delegated outcome', requestId: 'agent-start-provenance', label: 'Delegated' });
  await settledTeamAi();
  const message = q.listChatEvents(result.sessionId).find(event => event.source === 'user');
  expect(message).toMatchObject({ content: 'Delegated outcome', authorMemberId: fixture.member.member.id, senderSessionId: sender.id });
  expect(fake.latest().messages.join('\n')).toContain('[Message from the "Shared agent" agent\'s main chat');
});

it('cancels a queued member message through the ordinary interrupt operation', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const entered = Promise.withResolvers<void>();
  fake.onTurn(async () => { entered.resolve(); await new Promise(() => {}); });
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Shared queue' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'ordinary-cancel-first', text: 'Working' });
  await entered.promise;
  const queued = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'ordinary-cancel-second', text: 'Queued' });
  await owner.sessions.interruptPost.mutate({ params: { id: chat.id }, body: { turnId: queued.turnId } });
  expect(q.getTeamChatTurn(queued.turnId)?.status).toBe('cancelled');
  expect(q.runningTeamChatTurn(chat.id)?.memberId).toBe(fixture.owner.member.id);
});
