/** Probe: an unconfirmed (timed-out) close must stay retryable; an ordinary session-open health check in between. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { hasHarnessSession } from '@/lib/runner/live-state';

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
  await stopTeamAiWork({}, 'Fixture ended.').catch(() => {}); await settledTeamAi(); await closeAllSessions().catch(() => {}); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
}, 60_000);

it('keeps a timed-out close blocked across an ordinary session-open reconcile', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Unconfirmed close' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'unconfirmed-close-1', text: 'Hello' });
  await settledTeamAi();
  const session = fake.latest();
  const closeCalls = vi.fn();
  // As agentex's Claude session: close() marks the session closed synchronously, then waits for exit.
  vi.spyOn(session, 'close').mockImplementation(() => { closeCalls(); session.state = 'closed'; return new Promise<void>(() => {}); });
  await expect(member.team.ai.chats.archive.mutate({ id: chat.id })).rejects.toThrow(/did not confirm/);
  expect(q.getChatSession(chat.id)?.status).toBe('active');
  expect(hasHarnessSession(chat.id)).toBe(true);
  // A member opens the chat: the ordinary per-view reconcile runs the shared health check.
  await member.sessions.reconcilePost.mutate({ params: { id: chat.id }, body: {} });
  const retainedAfterOpen = hasHarnessSession(chat.id);
  let retry: string;
  try { await member.team.ai.chats.archive.mutate({ id: chat.id }); retry = 'resolved'; } catch (error) { retry = error instanceof Error ? error.message : String(error); }
  const log = { retainedAfterOpen, retry, status: q.getChatSession(chat.id)?.status, closeCalls: closeCalls.mock.calls.length };
  // Correct behaviour: the unconfirmed handle stays tracked and the retry joins the original SDK close and still refuses without confirmed exit.
  expect(log).toMatchObject({ retainedAfterOpen: true, status: 'active', closeCalls: 1 });
  expect(retry).toMatch(/did not confirm/);
}, 60_000);
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
