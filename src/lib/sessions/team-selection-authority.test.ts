// Review-10 probe: Team speed authority and launch propagation through the real Team tRPC
// operations, ordinary runner and fake provider (no real accounts).
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { getProvider } from '@agentex/agent';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { clearHarnessModelCache } from '@/lib/harness/model-discovery';

let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>;
let fake: FakeHarness;
const tiers = [{ id: 'default', name: 'Normal', availability: 'available' }, { id: 'fast', name: 'Fast', availability: 'available' }];
beforeAll(async () => { await preloadTeamRoutes(); }, 120_000);
beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam);
  fixture = await createTeamExecutionFixture(); setTeamAiRunnerForTests(null); _resetExecutorState();
  fake = installFakeHarness('claude'); fake.modelId = 'opus';
  getProvider('claude').listModels = async () => [
    { id: 'opus', name: 'Opus', serviceTiers: tiers },
    { id: 'claude-hidden-expensive', name: 'Hidden', serviceTiers: tiers },
  ] as never;
  clearHarnessModelCache();
  q.saveTeamAiSettings({ harness: 'claude', model: 'opus' }, fixture.owner.member.id);
});
afterEach(async () => {
  await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); _resetExecutorState();
  fake?.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
});

const outcome = async (fn: () => Promise<unknown>) => { try { return { ok: true, value: await fn() }; } catch (error) { return { ok: false, error: String((error as Error)?.message ?? error).slice(0, 200) }; } };

it('speed-only PATCH requires the same Team send authority as effort', async () => {
  const member = await teamTrpc(fixture.member.token.plaintext);
  const created = await member.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'opus', serviceTier: 'default' } });
  expect(created.serviceTier).toBe('default');
  // Team AI turned off by the owner.
  q.saveTeamAiSettings({ enabled: false }, fixture.owner.member.id);
  const effort = await outcome(() => member.sessions.update.mutate({ params: { id: created.id }, body: { effort: 'high' } }));
  const speed = await outcome(() => member.sessions.update.mutate({ params: { id: created.id }, body: { serviceTier: 'fast' } }));
  // Archived chat.
  q.saveTeamAiSettings({ enabled: true }, fixture.owner.member.id);
  q.updateChatSession(created.id, { status: 'archived' } as never);
  const effortArchived = await outcome(() => member.sessions.update.mutate({ params: { id: created.id }, body: { effort: 'low' } }));
  const speedArchived = await outcome(() => member.sessions.update.mutate({ params: { id: created.id }, body: { serviceTier: 'default' } }));
  expect(effort.ok).toBe(false);
  expect(speed.ok).toBe(false);
  expect(effortArchived.ok).toBe(false);
  expect(speedArchived.ok).toBe(false);
}, 60_000);

it('members cannot launch or switch to models the owner has not enabled', async () => {
  q.setEnabledHarnessModels('claude', ['opus'], 'opus');
  const member = await teamTrpc(fixture.member.token.plaintext);
  const visible = await member.harness.modelsGet.query({ query: { provider: 'claude' } } as never).catch((e: Error) => ({ error: e.message }));
  const launch = await outcome(() => member.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'claude-hidden-expensive', serviceTier: 'fast' } }));
  const chat = await member.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'opus' } });
  const patch = await outcome(() => member.sessions.update.mutate({ params: { id: chat.id }, body: { model: 'claude-hidden-expensive', serviceTier: 'fast' } }));
  expect(launch.ok).toBe(false);
  expect(patch.ok).toBe(false);
}, 60_000);

it('native Team launches carry and inherit speed, and retries reject a changed speed', async () => {
  const { runAction } = await import('@/lib/orchestrator/dispatch');
  const { withExecutionRequest } = await import('@/lib/home/execution-request');
  const member = await teamTrpc(fixture.member.token.plaintext);
  const sender = await member.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'opus', serviceTier: 'fast' } });
  q.acceptTeamChatSend({ chatId: sender.id, memberId: fixture.member.member.id, requestingApiKeyId: fixture.member.key.id, clientSendId: 'source-turn', text: 'Coordinate work' });
  q.claimNextTeamChatTurn(sender.id);
  const key = { scope: 'team_ai', location: 'elsewhere', apiKeyId: fixture.member.key.id, memberId: fixture.member.member.id, memberRole: 'member', workerDeviceId: null, sessionChatId: sender.id } as never;
  const ctx = { remote: true, actor: { source: 'ai', sessionId: sender.id, memberId: fixture.member.member.id, executionId: q.getChatSession(sender.id)?.executionId }, caller: { location: 'elsewhere', apiKeyId: fixture.member.key.id } } as never;
  const withSpeed = await withExecutionRequest(key, () => runAction('start_execution', { workspaceId: fixture.workspace.id, prompt: 'Delegated', requestId: 'speed-1', provider: 'claude', model: 'opus', serviceTier: 'fast' }, ctx));
  const withoutSpeed = await withExecutionRequest(key, () => runAction('start_execution', { workspaceId: fixture.workspace.id, prompt: 'Delegated', requestId: 'speed-2', provider: 'claude', model: 'opus' }, ctx));
  await settledTeamAi();
  const started = (withoutSpeed as { result?: { sessionId?: string } }).result?.sessionId;
  expect((withSpeed as { ok: boolean }).ok).toBe(true);
  expect(started && q.getChatSession(started)?.serviceTier).toBe('fast');
  const changed = await withExecutionRequest(key, () => runAction('start_execution', { workspaceId: fixture.workspace.id, prompt: 'Delegated', requestId: 'speed-1', provider: 'claude', model: 'opus', serviceTier: 'default' }, ctx));
  expect(changed.ok).toBe(false);
  const hidden = await withExecutionRequest(key, () => runAction('start_execution', { workspaceId: fixture.workspace.id, prompt: 'Hidden', requestId: 'hidden', provider: 'claude', model: 'claude-hidden-expensive' }, ctx));
  expect(hidden.ok).toBe(false);
}, 60_000);

it('an owner may select a hidden model, but a member cannot run it', async () => {
  q.setEnabledHarnessModels('claude', ['opus'], 'opus');
  const member = await teamTrpc(fixture.member.token.plaintext);
  const owner = await teamTrpc(fixture.owner.token.plaintext);
  const chat = await owner.workspaces.sessionsPost.mutate({ params: { id: fixture.workspace.id }, body: { harness: 'claude', model: 'claude-hidden-expensive', serviceTier: 'fast' } });
  fake.modelId = 'claude-hidden-expensive';
  await member.sessions.messagesPost.mutate({ params: { id: chat.id }, body: { id: crypto.randomUUID(), content: 'Run on hidden model' } }); await settledTeamAi();
  expect(fake.sessions).toHaveLength(0);
  expect(q.listTeamChatTurns(chat.id)).toEqual([expect.objectContaining({ status: 'failed', error: expect.stringContaining('enabled') })]);
}, 60_000);
