import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import * as chat from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { runAction } from '@/lib/orchestrator/dispatch';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, fake: FakeHarness;
const missingAuth = vi.hoisted(() => new Set<string>());
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  missingAuth.clear();
  fixture = await createTeamExecutionFixture(); chat.setTeamAiRunnerForTests(null); _resetExecutorState();
  fake = installFakeHarness('claude'); q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
});
afterEach(async () => {
  vi.restoreAllMocks(); await chat.stopTeamAiWork({}, 'Fixture ended.'); await chat.settledTeamAi(); await closeAllSessions();
  fake.restore(); _resetExecutorState(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: (id: Parameters<typeof fakeHarnessAuth>[0]) => fakeHarnessAuth(id, !missingAuth.has(id)) };
});

it('an unsigned-in harness or invalid model refuses without leaving an empty child', async () => {
  const parent = sender('ask'), count = q.listChatSessions().length;
  const input = { workspaceId: fixture.workspace.id, requestId: 'preflight', prompt: 'Work' };
  missingAuth.add('codex');
  expect(await runAction('start_execution', { ...input, provider: 'codex' }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  expect(q.listChatSessions()).toHaveLength(count);
  expect(await runAction('start_execution', { ...input, provider: 'claude', model: 'missing-model' }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  expect(q.listChatSessions()).toHaveLength(count);
  const done = q.createTask({ title: 'Finished task' }); q.completeTask(done.id, { meta: { source: 'human' } });
  for (const [taskId, code] of [['missing-task', 'not_found'], [done.id, 'invalid_params']]) {
    expect(await runAction('start_execution', { ...input, provider: 'claude', taskId }, context(parent.id))).toMatchObject({ ok: false, error: { code } });
  }
  expect(q.listChatSessions()).toHaveLength(count);
});

it('concurrent identical launches and archived retries return one accepted execution without replay', async () => {
  const parent = sender('ask'); let turns = 0;
  fake.onTurn(async turn => { turns++; await turn.say('Done'); });
  const input = { workspaceId: fixture.workspace.id, provider: 'claude', requestId: 'parallel', prompt: 'Do the work', effort: 'max' };
  const replies = await Promise.all(Array.from({ length: 4 }, () => runAction('start_execution', input, context(parent.id))));
  for (const reply of replies) expect(reply, JSON.stringify(reply)).toMatchObject({ ok: true });
  const ids = replies.map(reply => (reply.result as { sessionId: string }).sessionId);
  expect(new Set(ids).size).toBe(1);
  await chat.settledTeamAi(); expect(turns).toBe(1);
  expect(q.listChatEvents(ids[0]).filter(event => event.source === 'user')).toHaveLength(1);
  const member = await teamTrpc(fixture.member.token.plaintext);
  await member.sessions.archivePost.mutate({ params: { id: ids[0] }, body: {} });
  expect(await runAction('start_execution', input, context(parent.id))).toMatchObject({ ok: true, result: { sessionId: ids[0], started: false } });
  expect(turns).toBe(1); expect(q.getChatSession(ids[0])?.status).toBe('archived');
  for (const patch of [{ prompt: 'Different work' }, { permissionMode: 'auto_edits' }, { effort: 'low' }]) {
    expect(await runAction('start_execution', { ...input, ...patch }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'conflict' } });
  }
});
const context = (sessionId: string) => ({ remote: true, actor: { source: 'ai' as const, sessionId, memberId: fixture.member.member.id }, caller: { location: 'elsewhere' as const, apiKeyId: fixture.member.key.id } });
function sender(permissionMode: 'ask' | 'auto_all') {
  return q.createChatSession({ workspaceId: fixture.workspace.id, harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode, createdByMemberId: fixture.member.member.id });
}

it('refuses invalid prompts before creating a child and returns a stable policy code', async () => {
  const parent = sender('ask'), before = q.listChatSessions().length;
  for (const prompt of [' '.repeat(3), 'x'.repeat(20_001)]) {
    expect(await runAction('start_execution', { workspaceId: fixture.workspace.id, provider: 'claude', requestId: 'invalid', prompt }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'invalid_params' } });
  }
  expect(q.listChatSessions()).toHaveLength(before);
  expect(await runAction('start_execution', { workspaceId: fixture.workspace.id, provider: 'claude', requestId: 'widen', prompt: 'Work', permissionMode: 'auto_all' }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  expect(q.listChatSessions()).toHaveLength(before);
});

it('a retry cannot reuse a broader child from another sender or an earlier permission setting', async () => {
  const broad = sender('auto_all'), narrow = sender('ask');
  // Simulate loss of service after durable child creation but before a send
  // was accepted. No completed or accepted request is replayed.
  const admission = vi.spyOn(chat, 'sendToTeamAi').mockRejectedValueOnce(new q.TeamChatError('unavailable', 'Transport interrupted'));
  const input = { workspaceId: fixture.workspace.id, provider: 'claude', requestId: 'saved-launch', prompt: 'Do work' };
  expect(await runAction('start_execution', input, context(broad.id))).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  admission.mockRestore();
  const child = q.listChatSessions({ workspaceId: fixture.workspace.id }).find(row => row.id !== broad.id && row.id !== narrow.id)!;
  expect(child.permissionMode).toBe('auto_all');
  for (const parent of [narrow, broad]) {
    q.updateChatSession(parent.id, { permissionMode: 'ask' });
    expect(await runAction('start_execution', input, context(parent.id))).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  }
  q.updateChatSession(child.id, { permissionMode: 'plan', prePlanMode: 'auto_all' });
  expect(await runAction('start_execution', input, context(narrow.id))).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  expect(q.listChatEvents(child.id)).toEqual([expect.objectContaining({ source: 'system', content: null, raw: expect.objectContaining({ subtype: 'native_launch_intent' }) })]);
  expect(fake.sessions).toEqual([]);
});

it('a failed first send retains its original task, label and prompt intent', async () => {
  const parent = sender('ask');
  const task = q.createTask({ title: 'Original task' }), other = q.createTask({ title: 'Another task' });
  const input = { workspaceId: fixture.workspace.id, provider: 'claude', requestId: 'intent-after-refusal', prompt: 'Original brief', label: 'Original label', taskId: task.id };
  const send = vi.spyOn(chat, 'sendToTeamAi').mockRejectedValueOnce(new q.TeamChatError('unavailable', 'First send refused'));
  expect(await runAction('start_execution', input, context(parent.id))).toMatchObject({ ok: false });
  send.mockRestore();
  const count = q.listChatSessions().length;
  for (const patch of [{ prompt: 'Changed brief' }, { label: 'Changed label' }, { taskId: other.id }]) {
    expect(await runAction('start_execution', { ...input, ...patch }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'conflict' } });
  }
  expect(q.listChatSessions()).toHaveLength(count);
  expect(q.getTask(other.id)?.status).toBe('todo');
  fake.onTurn(async turn => { await turn.say('Done'); });
  expect(await runAction('start_execution', input, context(parent.id))).toMatchObject({ ok: true, result: { started: false } });
  await chat.settledTeamAi();
});

it('disabled harnesses and UI model failures return stable errors before creating a child', async () => {
  const parent = sender('ask'), count = q.listChatSessions().length;
  vi.stubEnv('NEXT_PUBLIC_RI_CURSOR_ENABLED', 'false');
  expect(await runAction('start_execution', { workspaceId: fixture.workspace.id, provider: 'cursor', requestId: 'disabled', prompt: 'Work' }, context(parent.id))).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  const member = await teamTrpc(fixture.member.token.plaintext);
  await expect(member.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'missing-model' } })).rejects.toMatchObject({ data: expect.objectContaining({ httpStatus: 400 }) });
  expect(q.listChatSessions()).toHaveLength(count);
});
