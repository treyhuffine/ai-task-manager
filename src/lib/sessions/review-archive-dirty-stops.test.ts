/** Probe: the ordinary two-step archive (first POST without force) on a dirty Team execution. */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createTeamExecutionFixture } from '@/test/fixtures/team-execution';
import { installFakeHarness, FAKE_MODEL_ID, type FakeHarness } from '@/test/fixtures/fake-harness';
import { preloadTeamRoutes, serveTeam, teamTrpc } from '@/test/fixtures/team-home';
import * as q from '@/lib/db/queries';
import { settledTeamAi, stopTeamAiWork, setTeamAiRunnerForTests } from '@/lib/team/ai/chat';
import { closeAllSessions, _resetExecutorState } from '@/lib/runner/local-runner';

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

it('a refused (dirty) archive leaves running and queued member turns alone', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const source = fixture.workspace.cwd;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'ignore' });
  git('init', '-b', 'main'); fs.writeFileSync(path.join(source, 'file.txt'), 'original'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const worktree = path.join(fixture.home.root, 'worktree'); git('worktree', 'add', '-b', 'dirty-test', worktree);
  fs.writeFileSync(path.join(worktree, 'file.txt'), 'uncommitted');
  q.updateWorkspace(fixture.workspace.id, { isGit: true });
  const { session: chat, execution } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Dirty work', worktreePath: worktree, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  q.createPlacement({ executionId: execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: worktree });
  const started = Promise.withResolvers<void>();
  fake.onTurn(async () => { started.resolve(); await new Promise(() => {}); });
  const a = await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'dirty-archive-a', text: 'Long running work' });
  await started.promise;
  const b = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'dirty-archive-b', text: 'Queued follow-up' });
  let refusal = '';
  try { await member.sessions.archivePost.mutate({ params: { id: chat.id }, body: {} }); refusal = 'archived'; }
  catch (error) { refusal = error instanceof Error ? error.message : String(error); }
  expect(refusal).toMatch(/uncommitted|dirty|modified/i);
  const observed = { refusal, execution: q.getExecution(execution.id)?.status, a: q.getTeamChatTurn(a.turnId)?.status, aError: q.getTeamChatTurn(a.turnId)?.error, b: q.getTeamChatTurn(b.turnId)?.status, bError: q.getTeamChatTurn(b.turnId)?.error };
  expect(observed.execution).toBe('active');
  expect({ a: observed.a, b: observed.b }).toEqual({ a: 'running', b: 'queued' });
});
vi.mock('@/lib/harness/runtime', async original => {
 const { fakeHarnessRuntime, fakeHarnessAuth } = await import('@/test/fixtures/harness-runtime');
 return { ...await original<typeof import('@/lib/harness/runtime')>(), getHarnessRuntime: fakeHarnessRuntime, resolveHarnessAuth: fakeHarnessAuth };
});
