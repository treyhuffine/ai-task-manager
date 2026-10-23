/**
 * Probe: ledger says missing legacy Team plan provenance returns to Ask. The
 * DB row does (apply.ts revertFromPlanMode), but the live runner mirror
 * (local-runner.ts handleUserInputRequest) falls back to DEFAULT_PERMISSION_MODE
 * (auto_all), so later prompts in the same live session are auto-allowed.
 */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests, sendToTeamAi } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it('legacy plan row without prePlanMode returns both DB and live runner to Ask', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const { session } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Legacy plan', surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.member.member.id, permissionMode: 'plan', worktreePath: fixture.workspace.cwd });
  q.updateChatSession(session.id, { prePlanMode: null });
  expect(q.getChatSession(session.id)).toMatchObject({ permissionMode: 'plan', prePlanMode: null });
  const answers: unknown[] = []; let modeAfterExit: string | undefined;
  fake.onTurn(async turn => {
    answers.push(await turn.ask({ toolName: 'ExitPlanMode', toolUseId: 'plan-exit', input: { plan: 'Do it' } }));
    modeAfterExit = q.getChatSession(session.id)?.permissionMode;
    answers.push(await turn.ask({ toolName: 'Write', toolUseId: 'w1', input: { file_path: '/tmp/x', content: 'y' } }));
    await turn.say('done');
  });
  await sendToTeamAi({ chatId: session.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'legacy-1', text: 'Plan then write' });
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  await vi.waitFor(async () => expect(await owner.sessions.pendingInputGet.query({ params: { id: session.id } })).toHaveLength(1), { timeout: 15_000 });
  const pending = await owner.sessions.pendingInputGet.query({ params: { id: session.id } }) as Array<{ requestId: string }>;
  await owner.sessions.pendingInputRequestIdPost.mutate({ params: { id: session.id, requestId: pending[0].requestId }, body: { allow: true } });
  // If the runner mirrors Ask, the Write raises a second pending prompt.
  let second: unknown[] = [];
  try { await vi.waitFor(async () => { second = await owner.sessions.pendingInputGet.query({ params: { id: session.id } }) as unknown[]; expect(second.length).toBe(1); }, { timeout: 3_000 }); } catch { /* recorded below */ }
  expect.soft(second.length, 'Write after plan exit should prompt in ask').toBe(1);
  if (second.length) await owner.sessions.pendingInputRequestIdPost.mutate({ params: { id: session.id, requestId: (second[0] as { requestId: string }).requestId }, body: { allow: false, message: 'no' } });
  await settledTeamAi();
  expect(modeAfterExit).toBe('ask');
  expect(q.getChatSession(session.id)?.permissionMode).toBe('ask');
  expect(answers).toHaveLength(2);
}, 60_000);
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
