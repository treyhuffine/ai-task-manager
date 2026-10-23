import { getProvider } from '@agentex/agent';
/** Probe: the ordinary session archive route (the UI's Archive) on a Team chat whose harness won't close. */
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
  await stopTeamAiWork({}, 'Fixture ended.').catch(() => {}); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it('ordinary sessions.archivePost on an idle Team chat whose close fails', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Archive order' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'archive-order-1', text: 'Hello' });
  await settledTeamAi();
  expect(hasHarnessSession(chat.id)).toBe(true);
  vi.spyOn(fake.latest(), 'close').mockRejectedValue(new Error('Close refused'));
  let outcome: unknown;
  try { outcome = await member.sessions.archivePost.mutate({ params: { id: chat.id }, body: {} }); }
  catch (error) { outcome = { threw: error instanceof Error ? error.message : String(error) }; }
  expect(outcome).toMatchObject({ threw: expect.stringMatching(/Close refused/) });
  const status = q.getChatSession(chat.id)?.status;
  // Ledger: "Failed close never archives first". Expectation for a correct build:
  expect({ status, cached: hasHarnessSession(chat.id) }).toEqual({ status: 'active', cached: true });
});
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});


it('waits for asynchronous startup before confirming archive and leaves no late cached harness', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id);
  const provider = getProvider('claude'); const create = provider.createSession!;
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  vi.spyOn(provider, 'createSession').mockImplementation(async context => { entered.resolve(); await release.promise; return create(context); });
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Starting' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'archive-during-startup', text: 'Start' });
  await entered.promise;
  let archived = false;
  const archive = member.sessions.archivePost.mutate({ params: { id: chat.id }, body: {} }).then(result => { archived = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(archived).toBe(false);
  release.resolve(); await archive; await settledTeamAi();
  expect(q.getChatSession(chat.id)?.status).toBe('archived');
  expect(hasHarnessSession(chat.id)).toBe(false);
  expect(fake.latest().state).toBe('closed');
  expect(fake.latest().messages).toEqual([]);
}, 30_000);
