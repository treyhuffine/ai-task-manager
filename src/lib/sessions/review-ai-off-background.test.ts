/** Probe: turning Team AI off while the shared harness still has background work / a self-initiated turn. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { hasHarnessSession, runnerState, isRunning } from '@/lib/runner/live-state';
import { once } from 'node:events';
import { forgetHarnessProcess } from '@/lib/runner/harness-processes';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness;
let owner: Awaited<ReturnType<typeof teamTrpc>>;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
  owner = await teamTrpc(fixture.owner.token.plaintext);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopTeamAiWork({}, 'Fixture ended.').catch(() => {}); await settledTeamAi(); await closeAllSessions().catch(() => {}); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it.each([false, true])('AI off closes background work and ignores late self-started output (process %s)', async withProcess => {
  fake = installFakeHarness('claude'); fake.withProcess = withProcess;
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'AI off' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'ai-off-bg-1', text: 'Start a background build' });
  await settledTeamAi();
  // The provider reports a background task still running after the member's turn ended.
  runnerState.backgroundTasks.set(chat.id, new Set(['bg-build']));
  const off = await owner.team.ai.setEnabled.mutate({ enabled: false });
  const afterOff = { enabled: off.enabled, reason: off.reason, harnessCached: hasHarnessSession(chat.id), background: runnerState.backgroundTasks.has(chat.id) };
  // The background task finishes and Claude opens its own follow-up turn, as it does in production.
  runnerState.backgroundTasks.delete(chat.id);
  const session = fake.latest();
  await session.emit({ type: 'turn_start', turnId: 'self-1', trigger: 'task', raw: {} });
  const runningDuringSelfTurn = isRunning(chat.id);
  await session.emit({ type: 'assistant', text: 'Self-initiated follow-up while Team AI is off' });
  await session.emit({ type: 'turn_end', turnId: 'self-1', trigger: 'task', reason: 'result' });
  await new Promise(r => setTimeout(r, 100));
  const persisted = q.listChatEvents(chat.id).some(e => e.content?.includes('while Team AI is off'));
  const observed = { ...afterOff, runningDuringSelfTurn, persisted };
  expect(observed).toMatchObject({ enabled: false, reason: null, harnessCached: false, background: false, runningDuringSelfTurn: false, persisted: false });
});
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});


it.each([false, true])('a member stops background work through the shared UI procedure and unblocks the next member (process %s)', async withProcess => {
  fake = installFakeHarness('claude'); fake.withProcess = withProcess;
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const member = await teamTrpc(fixture.member.token.plaintext);
  fake.onTurn(async turn => {
    await turn.say('Done');
    if (turn.message.endsWith('Background build')) await turn.emit({ type: 'background_task', phase: 'started', taskId: 'build', taskType: 'shell', status: 'running' });
  });
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Background queue' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'bg-queue-first', text: 'Background build' });
  await settledTeamAi();
  expect(runnerState.backgroundTasks.has(chat.id)).toBe(true);
  const next = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'bg-queue-next', text: 'Next member request' });
  expect(q.getTeamChatTurn(next.turnId)?.status).toBe('queued');
  vi.spyOn(fake.latest(), 'stopTask').mockImplementation(async () => {
    await fake.latest().emit({ type: 'background_task', phase: 'completed', taskId: 'build', taskType: 'shell', status: 'stopped' });
    return { stopped: true };
  });
  expect(await member.sessions.tasksStopTaskIdPost.mutate({ params: { id: chat.id, taskId: 'build' }, body: {} })).toEqual({ stopped: true });
  await settledTeamAi();
  expect(q.getTeamChatTurn(next.turnId)?.status).toBe('done');
  expect(q.listTeamActivity(fixture.workspace.id)).toMatchObject([{ operation: 'background_task_stop', memberId: fixture.member.member.id }]);
  await member.sessions.restartPost.mutate({ params: { id: chat.id }, body: {} });
  expect(hasHarnessSession(chat.id)).toBe(false);
  expect(q.listTeamActivity(fixture.workspace.id).some(row => row.operation === 'restart_harness' && row.memberId === fixture.member.member.id)).toBe(true);
}, 30_000);


it.each(['removal', 'revocation'] as const)('%s closes completed member background work', async control => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const member = await teamTrpc(fixture.member.token.plaintext);
  fake.onTurn(async turn => {
    await turn.emit({ type: 'background_task', phase: 'started', taskId: 'leftover', taskType: 'shell', status: 'running' });
    await turn.say('Started');
  });
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Member background' });
  await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'member-background', text: 'Work' });
  await settledTeamAi();
  expect(runnerState.backgroundTasks.has(chat.id)).toBe(true);
  if (control === 'removal') await owner.team.removeMember.mutate({ id: fixture.member.member.id });
  else await member.team.signIns.revoke.mutate({ keyId: fixture.member.key.id });
  await settledTeamAi();
  expect(hasHarnessSession(chat.id)).toBe(false);
  expect(runnerState.backgroundTasks.has(chat.id)).toBe(false);
});

it.each(['archive', 'restart', 'AI off'] as const)('%s recovers a real root that exited without a process record', async control => {
  fake = installFakeHarness('claude'); fake.withProcess = true;
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Exited root' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'root-exit', text: 'Hello' });
  await settledTeamAi();
  const proc = fake.latest().proc!;
  const exited = once(proc, 'exit'); proc.kill('SIGTERM'); await exited;
  await forgetHarnessProcess(chat.id, proc.pid!);
  runnerState.backgroundTasks.set(chat.id, new Set(['reported-before-exit']));
  if (control === 'archive') await owner.team.ai.chats.archive.mutate({ id: chat.id });
  else if (control === 'restart') await owner.sessions.restartPost.mutate({ params: { id: chat.id }, body: {} });
  else expect(await owner.team.ai.setEnabled.mutate({ enabled: false })).toMatchObject({ enabled: false, reason: null });
  expect(hasHarnessSession(chat.id)).toBe(false);
  expect(runnerState.unconfirmedCloses.has(chat.id)).toBe(false);
  expect(runnerState.backgroundTasks.has(chat.id)).toBe(false);
});
