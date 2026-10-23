/** Probe (personal Home): a send that arrives while archive tears the worktree down, after the harness close moved earlier. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

let home: TestHome; let fake: FakeHarness; let chatId: string; let worktree: string;
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(async () => {
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  home = await createTestHome({ prefix: 'ri-probe-personal-archive-' });
  const identity = await import('@/lib/home/identity'); identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const repo = path.join(home.root, 'repo'); fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.name', 'P'); git(repo, 'config', 'user.email', 'p@example.invalid');
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n'); git(repo, 'add', '.'); git(repo, 'commit', '-q', '-m', 'base');
  worktree = path.join(home.root, 'wt'); git(repo, 'worktree', 'add', '-q', '-b', 'feature', worktree, 'main');
  const q = await import('@/lib/db/queries');
  const workspaceId = q.createWorkspace({ name: 'Personal', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'claude', label: 'Personal work' });
  chatId = created.session.id;
  q.updateExecution(created.execution.id, { worktreePath: worktree, branchName: 'feature', baseSha: git(worktree, 'rev-parse', 'HEAD') });
  fake = installFakeHarness('claude'); fake.withProcess = true;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await (await import('@/lib/runner/local-runner')).closeAllSessions().catch(() => {});
  fake.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup(); vi.unstubAllEnvs();
});

it('no live harness survives an archive when a message lands during worktree teardown', async () => {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const { hasHarnessSession } = await import('@/lib/runner/live-state');
  const workspaces = await import('@/lib/workspaces');
  const original = workspaces.archiveSessionWorktree;
  let entered!: () => void; const reached = new Promise<void>(r => { entered = r; });
  let release!: () => void; const held = new Promise<void>(r => { release = r; });
  // A slow teardown command (stop dev servers, cleanup) while the archive is in flight.
  vi.spyOn(workspaces, 'archiveSessionWorktree').mockImplementationOnce(async (...args) => { entered(); await held; return original(...args); });
  const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
  const pending = archiveExecutionSession({ sessionId: chatId });
  await reached;
  // A trigger, delegated request or a second window sends to the still-active chat.
  const event = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'sent during teardown', createdAt: new Date().toISOString() })!;
  let dispatched = 'ok';
  await executor.dispatch(chatId, event.content!, { sourceEventId: event.id }).catch(e => { dispatched = String(e); });
  release();
  const archived = await pending.then(r => r?.status ?? null).catch(e => String(e));
  const proc = fake.sessions.at(-1)?.proc;
  const observed = { dispatched, archived, status: q.getChatSession(chatId)?.status, worktreeExists: fs.existsSync(worktree),
    sessions: fake.sessions.length, messages: fake.sessions.flatMap(s => s.messages).length, harnessCached: hasHarnessSession(chatId),
    harnessProcessAlive: !!proc && proc.exitCode === null && proc.signalCode === null };
  expect(observed.status).toBe('archived');
  expect({ cached: observed.harnessCached, alive: observed.harnessProcessAlive }).toEqual({ cached: false, alive: false });
}, 60_000);
