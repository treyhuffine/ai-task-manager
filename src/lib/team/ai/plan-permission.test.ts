import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { runAction } from '@/lib/orchestrator/dispatch';

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

it("a human plan approval restores the helper's inherited Ask setting", async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const parent = q.createChatSession({ workspaceId: fixture.workspace.id, harness: 'claude', type: 'orchestration', surfaceKind: q.TEAM_CHAT_SURFACE, permissionMode: 'ask' });
  const answers: unknown[] = [];
  fake.onTurn(async turn => {
    answers.push(await turn.ask({ toolName: 'ExitPlanMode', toolUseId: 'plan-exit', input: { plan: 'Do it' } }));
    await turn.say('Plan accepted');
  });
  const ctx = { remote: true, actor: { source: 'ai' as const, sessionId: parent.id, memberId: fixture.member.member.id }, caller: { location: 'elsewhere' as const, apiKeyId: fixture.member.key.id } };
  const result = await runAction('start_execution', { workspaceId: fixture.workspace.id, prompt: 'Plan it', requestId: 'plan-child', provider: 'claude', permissionMode: 'plan' }, ctx);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  const childId = (result.result as { sessionId: string }).sessionId;
  expect(q.getChatSession(childId)).toMatchObject({ permissionMode: 'plan', prePlanMode: 'ask' });
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  await vi.waitFor(async () => expect(await owner.sessions.pendingInputGet.query({ params: { id: childId } })).toHaveLength(1), { timeout: 15_000 });
  const pending = await owner.sessions.pendingInputGet.query({ params: { id: childId } }) as Array<{ requestId: string }>;
  await owner.sessions.pendingInputRequestIdPost.mutate({ params: { id: childId, requestId: pending[0].requestId }, body: { allow: true } });
  await settledTeamAi();
  const after = q.getChatSession(childId);
  expect.soft(after?.permissionMode, 'child should not exceed the sender ask mode').toBe('ask');
}, 60_000);
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
