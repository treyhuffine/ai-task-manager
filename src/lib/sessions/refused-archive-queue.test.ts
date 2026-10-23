/** Probe: after a refused archive/close, does a member's queued turn still run once the chat is free? */
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
import { runnerState } from '@/lib/runner/live-state';
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

it('a queued turn behind a background task runs after a dirty archive refusal', async () => {
  fake = installFakeHarness('claude');
  q.saveTeamAiSettings({ harness: 'claude', model: FAKE_MODEL_ID }, fixture.owner.member.id);
  const source = fixture.workspace.cwd;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: source, stdio: 'ignore' });
  git('init', '-b', 'main'); fs.writeFileSync(path.join(source, 'file.txt'), 'original'); git('add', '.');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
  const worktree = path.join(fixture.home.root, 'worktree'); git('worktree', 'add', '-b', 'bg-dirty', worktree);
  fs.writeFileSync(path.join(worktree, 'file.txt'), 'uncommitted');
  q.updateWorkspace(fixture.workspace.id, { isGit: true });
  const { session: chat, execution } = q.createExecutionWithChat({ workspaceId: fixture.workspace.id, harness: 'claude', label: 'Bg dirty', worktreePath: worktree, surfaceKind: q.TEAM_CHAT_SURFACE, createdByMemberId: fixture.owner.member.id });
  q.createPlacement({ executionId: execution.id, deviceId: q.getHome()!.hostDeviceId, startReason: 'created', worktreePath: worktree });
  fake.onTurn(async turn => {
    await turn.say('Done');
    if (turn.message.endsWith('Background build')) await turn.emit({ type: 'background_task', phase: 'started', taskId: 'build', taskType: 'shell', status: 'running' });
  });
  await owner.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'bg-dirty-1', text: 'Background build' });
  for (let i = 0; i < 100 && !runnerState.backgroundTasks.has(chat.id); i++) await new Promise(r => setTimeout(r, 20));
  const next = await member.team.ai.send.mutate({ chatId: chat.id, clientSendId: 'bg-dirty-2', text: 'Queued request from Maya' });
  await new Promise(r => setTimeout(r, 150)); // the drain is waiting on the background task
  let refusal = '';
  try { await member.sessions.archivePost.mutate({ params: { id: chat.id }, body: {} }); refusal = 'archived'; }
  catch (error) { refusal = error instanceof Error ? error.message : String(error); }
  const afterRefusal = q.getTeamChatTurn(next.turnId)?.status;
  // The person cancels the archive (keeps the dirty files). The background build finishes on its own.
  await fake.latest().emit({ type: 'background_task', phase: 'completed', taskId: 'build', taskType: 'shell', status: 'completed' });
  await new Promise(r => setTimeout(r, 1500)); await settledTeamAi();
  const observed = { refusal: refusal.slice(0, 60), execution: q.getExecution(execution.id)?.status, afterRefusal, background: runnerState.backgroundTasks.has(chat.id),
    finally: q.getTeamChatTurn(next.turnId)?.status, providerMessages: fake.sessions.flatMap(s => s.messages).length };
  expect(observed.afterRefusal).toBe('queued');
  expect(observed.finally).toBe('done');
}, 60_000);
