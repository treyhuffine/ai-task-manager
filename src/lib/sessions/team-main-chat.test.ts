/**
 * Regression: Team New chat is additive: the shared
 * AgentChatPanel "New" button and the composer's provider switch call
 * workspaces.chatNewPost -> startNewMainChat, which retires the agent's
 * current main chat. In a team Home the current main chat is shared.
 */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { getProvider } from '@agentex/agent';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, FAKE_MODEL_ID, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
});
afterEach(async () => {
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

it("New chat preserves another member's running and queued work", async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const member = await teamTrpc(fixture.member.token.plaintext);
  // The agent's main chat as the shared AgentView opens it (ensure semantics).
  const current = await owner.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  const chatId = current.session.id;
  const started = Promise.withResolvers<void>();
  fake.onTurn(async turn => { if (turn.message.includes('Long A')) { started.resolve(); await new Promise(() => {}); } await turn.say('ok'); });
  await owner.sessions.messagesPost.mutate({ params: { id: chatId }, body: { content: 'Long A', id: crypto.randomUUID() } });
  await started.promise;
  await owner.sessions.messagesPost.mutate({ params: { id: chatId }, body: { content: 'Queued A', id: crypto.randomUUID() } });
  expect(q.listTeamChatTurns(chatId).map(t => t.status)).toEqual(['running', 'queued']);

  // Member B presses "New" (or switches model in the composer) in the same shared agent view.
  const created = await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: {} });
  const observed = {
    oldStatus: q.getChatSession(chatId)?.status,
    turns: q.listTeamChatTurns(chatId).map(t => [t.status, t.error]),
    newChat: created.session.id !== chatId,
  };
  // Correct (H1): a new chat is added; A's chat and work continue.
  expect(observed.oldStatus).toBe('active');
  expect(observed.turns[0][0]).toBe('running');
  expect(observed.turns[1][0]).toBe('queued');
  expect(observed.newChat).toBe(true);
  expect((await owner.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session!.id).toBe(chatId);
  expect((await member.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session!.id).toBe(created.session.id);
  const codex = installFakeHarness('codex'); codex.modelId = 'gpt-6.1-sol';
  try {
    const switched = await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: { providerId: 'codex', model: codex.modelId } });
    expect(switched.session).toMatchObject({ harness: 'codex', model: codex.modelId });
    expect(q.listTeamChatTurns(chatId).map(turn => turn.status)).toEqual(['running', 'queued']);
    expect((await member.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session!.id).toBe(switched.session.id);
    const appRequest = await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: { forApp: true } });
    expect(appRequest.session.id).toBe(switched.session.id);
  } finally { codex.restore(); }
  const resumed = await member.workspaces.chatResumePost.mutate({ params: { id: fixture.workspace.id }, body: { sessionId: chatId } });
  expect(resumed.session!.id).toBe(chatId);
  expect((await member.workspaces.chatGet.query({ params: { id: fixture.workspace.id } })).session!.id).toBe(chatId);
}, 30_000);

it('carries main speed controls through Team main-chat and execution launch policies to the ordinary runner', async () => {
  fake = installFakeHarness('claude'); fake.modelId = 'opus';
  getProvider('claude').listModels = async () => [{ id: 'opus', name: 'Opus', serviceTiers: [
    { id: 'default', name: 'Normal', availability: 'available' }, { id: 'fast', name: 'Fast', availability: 'available' },
  ] }];
  q.saveTeamAiSettings({ harness: 'claude', model: 'opus' }, fixture.owner.member.id);
  const member = await teamTrpc(fixture.member.token.plaintext);
  const main = await member.workspaces.chatNewPost.mutate({ params: { id: fixture.workspace.id }, body: { providerId: 'claude', model: 'opus', serviceTier: 'fast' } });
  expect(main.session.serviceTier).toBe('fast');
  await member.sessions.messagesPost.mutate({ params: { id: main.session.id }, body: { id: crypto.randomUUID(), content: 'Run at selected speed' } }); await settledTeamAi();
  expect(fake.latest().ctx.config?.serviceTier).toBe('fast');
  const execution = await member.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'opus', serviceTier: 'fast' } });
  expect(execution.serviceTier).toBe('fast');
  const sibling = await member.sessions.newChatPost.mutate({ params: { id: execution.id }, body: {} });
  expect(sibling.session.serviceTier).toBe('fast');
  await member.sessions.messagesPost.mutate({ params: { id: sibling.session.id }, body: { id: crypto.randomUUID(), content: 'Continue at selected speed' } }); await settledTeamAi();
  expect(fake.latest().ctx.config?.serviceTier).toBe('fast');
});
