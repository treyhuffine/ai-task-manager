/**
 * Focused review of the c8473cd fixes. Temporary homes, real Git, fake harness only.
 *
 * Kept as regressions. The held-message probe was adapted to the fix the
 * review asked for: delivery stops at the message nothing took, keeping the
 * rest behind it in order, where the probe had observed the second message
 * going first. Its requirement is kept (the first stays held, with a retry
 * the health check can't bypass) and the retry is exercised.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { saveCheckpoint, worktreeAtCheckpoint } from '@/lib/transfer/git-checkpoint';

let home: TestHome;
let fake: FakeHarness;
let remote: string;
let repo: string;
let destination: string;
let worktree: string;
let hostId: string;
let otherId: string;
let executionId: string;
let chatId: string;
const branch = 'review/refactor';
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, {
  cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' },
}).toString().trim();
function write(dir: string, name: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
  fs.writeFileSync(path.join(dir, name), content);
}
function clone(name: string) {
  const into = path.join(home.root, name);
  git(home.root, 'clone', '-q', remote, into);
  git(into, 'config', 'user.name', 'Review');
  git(into, 'config', 'user.email', 'review@example.com');
  return into;
}

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-p4-recheck-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostComputerId;
  remote = path.join(home.root, 'remote.git');
  git(home.root, 'init', '-q', '--bare', '-b', 'main', remote);
  repo = clone('source');
  write(repo, 'config', 'old tracked file\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  destination = clone('destination');
  worktree = path.join(home.root, 'worktree');
  git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'main');
  const q = await import('@/lib/db/queries');
  const key = q.createApiKey({ name: 'Review companion', deviceType: 'computer' });
  otherId = q.registerComputerForApiKey({ apiKeyId: key.key.id, name: 'Review companion', platform: 'darwin' }).computer.id;
  const workspace = q.createWorkspace({ name: 'Review', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Review' });
  executionId = created.execution.id;
  chatId = created.session.id;
  q.updateExecution(executionId, { worktreePath: worktree, branchName: branch, baseSha: git(worktree, 'rev-parse', 'HEAD') });
  fake = installFakeHarness('claude');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await (await import('@/lib/runner/local-runner')).closeAllSessions();
  fake.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/transfer/moving'))._resetExecutionOperations();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

it('does not recursively stage unselected files or secrets when a tracked file becomes a directory', async () => {
  git(worktree, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  fs.unlinkSync(path.join(worktree, 'config'));
  write(worktree, 'config/index.ts', 'export {};\n');
  write(worktree, 'config/.env.local', 'TOKEN=private\n');
  write(worktree, 'config/local.json', 'private machine settings\n');
  // Safely refusing this refactor is also acceptable. Publishing its excluded files is not.
  await saveCheckpoint({ worktree, message: 'checkpoint', includeUntracked: [], filesToCopy: ['config/local.json'] }).catch(() => null);
  const published = git(remote, 'ls-tree', '-r', '--name-only', `refs/heads/${branch}`).split('\n');
  expect.soft(published).not.toContain('config/.env.local');
  expect.soft(published).not.toContain('config/local.json');
  expect(published).not.toContain('config/index.ts');
});

it('allows a clean tracked file-to-directory refactor in a reused destination', async () => {
  const first = await saveCheckpoint({ worktree, message: 'first', includeUntracked: [] });
  const target = path.join(home.root, 'destination worktree');
  await worktreeAtCheckpoint({ repo: destination, path: target, checkpoint: first });
  fs.unlinkSync(path.join(worktree, 'config'));
  write(worktree, 'config/index.ts', 'export {};\n');
  git(worktree, 'add', '--all');
  git(worktree, 'commit', '-qm', 'turn config into a folder');
  const next = await saveCheckpoint({ worktree, message: 'next', includeUntracked: [] });
  expect(git(target, 'status', '--porcelain')).toBe('');
  await expect(worktreeAtCheckpoint({ repo: destination, path: target, checkpoint: next })).resolves.toMatchObject({ sha: next.sha });
});

it('keeps a held message recoverable when preparation fails before any send is accepted', async () => {
  const q = await import('@/lib/db/queries');
  const transfer = q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: otherId, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
  const first = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'first instruction', createdAt: new Date().toISOString() })!;
  const second = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'second instruction', createdAt: new Date().toISOString() })!;
  q.holdForTransfer(executionId, first.id);
  q.holdForTransfer(executionId, second.id);
  q.updateTransfer(transfer.id, { state: 'failed', stage: 'saving', failedStage: 'saving', error: 'push rejected' });
  const models = await import('@/lib/harness/model-discovery');
  vi.spyOn(models, 'getHarnessModelCatalog').mockRejectedValueOnce(new Error('temporary model discovery failure'));
  const { resumeOnSource, retryHeldDelivery, viewOf } = await import('@/lib/transfer/continue');
  const resumed = await resumeOnSource(executionId);
  // Nothing took the first: it stays first in line, the second behind it, and the card says why.
  expect(resumed).toMatchObject({ state: 'cancelled', heldEventIds: [first.id, second.id] });
  expect(viewOf(resumed)).toMatchObject({ heldCount: 2, delivering: false, error: '2 held messages didn\'t reach ' + q.getComputer(hostId)!.name + ': temporary model discovery failure' });
  expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
  const { deliveriesForChat } = await import('@/lib/workers/delivery');
  expect(deliveriesForChat(chatId)[first.id]).toMatchObject({ state: 'held' });
  // Opening it again doesn't send either on its own, nor does a new message overtake them.
  const health = await import('@/lib/executor/health');
  await health.healthCheckSession(chatId, { redispatchOrphans: true, force: true });
  const third = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'third instruction', createdAt: new Date().toISOString() })!;
  await (await import('@/lib/executor/adapter')).dispatch(chatId, third.content!, { sourceEventId: third.id });
  expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
  expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([first.id, second.id, third.id]);
  // Send them again: all three, in order, once.
  await expect(retryHeldDelivery(executionId)).resolves.toMatchObject({ heldEventIds: [], error: null });
  expect(fake.sessions.flatMap((s) => s.messages)).toEqual(['first instruction', 'second instruction', 'third instruction']);
});
