/** Team queue admission while the shared idle close is already in flight. */
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork } from './chat';
import { closeAllSessions, closeIdleSessions, IDLE_CLOSE_MS } from '@/lib/runner/local-runner';
import { runnerState } from '@/lib/runner/live-state';
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
let fixture: Awaited<ReturnType<typeof createTeamExecutionFixture>>, fake: FakeHarness;
beforeAll(preloadTeamRoutes, 120_000);
beforeEach(async () => { vi.stubEnv('RI_MIRROR_DISABLED', '1'); vi.stubGlobal('fetch', serveTeam); fixture = await createTeamExecutionFixture(); fake = installFakeHarness('claude'); q.saveTeamAiSettings({ harness: 'claude', model: fake.modelId }, fixture.owner.member.id); });
afterEach(async () => { vi.restoreAllMocks(); await stopTeamAiWork({}, 'Fixture ended.'); await settledTeamAi(); await closeAllSessions(); fake.restore(); await fixture.cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }, 60_000);
it('delivers the next member turn once after idle shutdown completes', async () => {
  const owner = await teamTrpc(fixture.owner.token.plaintext), member = await teamTrpc(fixture.member.token.plaintext);
  const delivered: string[] = []; fake.onTurn(async turn => { delivered.push(turn.message); await turn.say('Done'); });
  const chat = await owner.team.ai.chats.create.mutate({ workspaceId: fixture.workspace.id, label: 'Idle close' });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'idle-owner-first', text: 'First request' }); await settledTeamAi();
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const handle = fake.latest(), close = handle.close.bind(handle);
  vi.spyOn(handle, 'close').mockImplementation(async () => { entered.resolve(); await release.promise; await close(); });
  runnerState.lastActivityAt.set(chat.id, Date.now() - IDLE_CLOSE_MS - 1);
  const sweep = closeIdleSessions(); await entered.promise;
  try { await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'idle-member-second', text: 'Second request during idle close' }); }
  finally { release.resolve(); }
  await sweep; await settledTeamAi();
  expect(q.listTeamChatTurns(chat.id).map(turn => turn.status)).toEqual(['done', 'done']);
  expect(q.listTeamChatTurns(chat.id).map(turn => turn.memberId)).toEqual([fixture.owner.member.id, fixture.member.member.id]);
  expect(delivered.filter(text => text.includes('Second request during idle close'))).toHaveLength(1);
});
