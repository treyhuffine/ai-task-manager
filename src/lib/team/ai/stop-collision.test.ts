/**
 * Regression from the second review: a stop of member A's running turn while member B's
 * turn is queued. The team stop path closes the native session (runner.stop),
 * fire-and-forget, while the drain loop immediately claims the next turn.
 * Real agentex Claude close() flips state to 'closed' synchronously and then
 * awaits a grace window (process exit, transcript scan, cleanup). The probe
 * models that by delaying the fake close after it marks itself closed.
 */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, FAKE_MODEL_ID, FakeSession, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests, markTeamChatStop } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState, isHarnessSessionAlive } from '@/lib/runner/local-runner';
import { isRunning } from '@/lib/executor/adapter';
import { listForSession as listPending } from '@/lib/runner/pending';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness;
const originalClose = FakeSession.prototype.close;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
});
afterEach(async () => {
  FakeSession.prototype.close = originalClose;
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it('stopping A while B is queued leaves B on a tracked, live session with its prompt intact', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Stop race' });
  q.updateChatSession(chat.id, { permissionMode: 'ask' });

  // Real Claude: state = closed synchronously, then a grace window before close() resolves.
  const closeFinished = Promise.withResolvers<void>();
  FakeSession.prototype.close = async function (this: FakeSession) {
    this.state = 'closed';
    await new Promise(resolve => setTimeout(resolve, 400));
    await originalClose.call(this);
    closeFinished.resolve();
  };

  const firstStarted = Promise.withResolvers<void>();
  let secondAnswer: unknown = 'not answered';
  fake.onTurn(async turn => {
    if (turn.message.includes('Hold A')) { firstStarted.resolve(); await new Promise(() => {}); }
    if (turn.message.includes('B asks')) { secondAnswer = await turn.ask({ toolName: 'Bash', toolUseId: 'b-approval', input: { command: 'pwd' } }); }
    await turn.say('ok');
  });

  const a = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'probe-a-hold-1', text: 'Hold A' });
  await firstStarted.promise;
  const b = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'probe-b-asks-1', text: 'B asks' });
  expect(q.listTeamChatTurns(chat.id).map(t => t.status)).toEqual(['running', 'queued']);

  await member.team.ai.stop.mutate({ turnId: a.turnId });
  // B's turn is now claimed and should be raising its permission prompt on a fresh session.
  await vi.waitFor(() => expect(q.runningTeamChatTurn(chat.id)?.id).toBe(b.turnId), { timeout: 5000 });
  await vi.waitFor(() => expect(listPending(chat.id).length).toBe(1), { timeout: 5000 });
  const sessionsBeforeClose = fake.sessions.length;
  // Let A's close finish its grace window.
  await closeFinished.promise;
  await new Promise(resolve => setTimeout(resolve, 50));

  const observed = {
    aStatus: q.getTeamChatTurn(a.turnId)?.status,
    bStatus: q.getTeamChatTurn(b.turnId)?.status,
    sessions: fake.sessions.length,
    sessionsBeforeClose,
    latestClosed: fake.latest().isClosed(),
    trackedAlive: isHarnessSessionAlive(chat.id),
    runningFlag: isRunning(chat.id),
    pendingPrompts: listPending(chat.id).length,
    secondAnswer,
  };
  expect(observed.aStatus).toBe('cancelled');
  // Expected correct behavior: B's live session S2 is still tracked and its prompt still pending.
  expect(observed.latestClosed).toBe(false);
  expect(observed.trackedAlive).toBe(true);
  expect(observed.pendingPrompts).toBe(1);
}, 30_000);

it('a failed close refuses later work, reports the failure, and lets an explicit retry close safely', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Close failure' });
  const started = Promise.withResolvers<void>();
  fake.onTurn(async () => { started.resolve(); await new Promise(() => {}); });
  const a = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'failed-close-a', text: 'Hold A' });
  await started.promise;
  const b = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'failed-close-b', text: 'B waits' });
  FakeSession.prototype.close = async () => { throw new Error('Cannot close fixture process'); };
  await expect(owner.team.ai.stop.mutate({ turnId: a.turnId })).rejects.toThrow(/could not stop/);
  await settledTeamAi();
  expect(q.getTeamChatTurn(a.turnId)).toMatchObject({ status: 'failed', error: expect.stringContaining('could not stop') });
  expect(q.getTeamChatTurn(b.turnId)?.status).toBe('failed');
  expect(fake.sessions).toHaveLength(1);
  await expect(owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'failed-close-c', text: 'Retry safely' })).rejects.toThrow(/could not stop/);
  expect(q.findTeamChatSend(chat.id, fixture.owner.member.id, 'failed-close-c')).toBeNull();
  FakeSession.prototype.close = originalClose;
  fake.onTurn(turn => turn.say('Recovered'));
  const c = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'failed-close-c', text: 'Retry safely' });
  await settledTeamAi();
  expect(q.getTeamChatTurn(c.turnId)?.status).toBe('done');
  expect(fake.sessions).toHaveLength(2);
});

it('a refused lifecycle close cannot relabel a later provider failure as cancellation', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Refused close' });
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  setTeamAiRunnerForTests(async () => { started.resolve(); await finish.promise; return { status: 'failed', code: 'runtime', error: 'An independent runtime failure' }; });
  const turn = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'refused-close', text: 'Work' });
  await started.promise;
  const settleClose = markTeamChatStop(chat.id, 'Archive requested');
  settleClose(false);
  finish.resolve(); await settledTeamAi();
  expect(q.getTeamChatTurn(turn.turnId)).toMatchObject({ status: 'failed', error: 'An independent runtime failure' });
  setTeamAiRunnerForTests(null);
});
