/** Probe: archive preflight passes while the agent is still running; its last edit lands as it is closed. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, FAKE_MODEL_ID, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';
import { hasHarnessSession } from '@/lib/runner/live-state';
vi.mock('@/lib/harness/runtime', async original => {
  const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
  return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});

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
});

it('a dirty refusal discovered after the close keeps queued member work', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const source = fixture.workspace.cwd;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'ignore' });
  git('init', '-b', 'main'); fs.writeFileSync(path.join(source, 'file.txt'), 'original'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const worktree = path.join(fixture.home.root, 'worktree'); git('worktree', 'add', '-b', 'late-dirty', worktree);
  q.updateWorkspace(fixture.workspace.id, { isGit: true });
  const { session: chat, execution } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Late dirty', worktreePath: worktree, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  q.createPlacement({ executionId: execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: worktree });
  const started = Promise.withResolvers<void>();
  // A running agent mid-edit: the tool call's write completes as the harness is stopped.
  let turns = 0;
  fake.onTurn(async turn => {
    if (++turns > 1) { await turn.say('Resumed queued work'); return; }
    turn.signal.addEventListener('abort', () => fs.writeFileSync(path.join(worktree, 'file.txt'), 'edit landed while closing'), { once: true });
    started.resolve(); await new Promise(() => {});
  });
  const a = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'late-dirty-a', text: 'Edit file.txt' });
  await started.promise;
  const b = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'late-dirty-b', text: 'Queued follow-up from Maya' });
  let refusal = '';
  try { await member.sessions.archivePost.mutate({ params: { id: chat.id }, body: {} }); refusal = 'archived'; }
  catch (error) { refusal = error instanceof Error ? error.message : String(error); }
  await settledTeamAi();
  const observed = { refusal: refusal.slice(0, 80), execution: q.getExecution(execution.id)?.status, worktreeExists: fs.existsSync(worktree),
    a: q.getTeamChatTurn(a.turnId)?.status, aError: q.getTeamChatTurn(a.turnId)?.error, b: q.getTeamChatTurn(b.turnId)?.status, bError: q.getTeamChatTurn(b.turnId)?.error,
    harnessCached: hasHarnessSession(chat.id) };
  expect(observed.execution).toBe('active');
  // The person is now shown the dirty files and may cancel. Maya's queued request should still be waiting.
  expect(observed.b).toBe('done');
  expect(observed.bError).toBeNull();
  expect(observed.aError ?? '').not.toMatch(/was archived/);
}, 60_000);
