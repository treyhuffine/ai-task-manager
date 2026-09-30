/** Independent re-check probes at 3fb2d87. Temporary fixtures only. */
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

it('takes only the chosen child of a tracked file replaced by a folder', async () => {
  fs.unlinkSync(path.join(worktree, 'config'));
  write(worktree, 'config/chosen.ts', 'export {};\n');
  write(worktree, 'config/not-chosen.ts', 'leave me\n');
  write(worktree, 'config/.env.local', 'SECRET=local\n');
  const checkpoint = await saveCheckpoint({ worktree, message: 'checkpoint', includeUntracked: ['config/chosen.ts'] });
  expect(git(remote, 'ls-tree', '-r', '--name-only', checkpoint.sha).split('\n')).toEqual(['config/chosen.ts']);
  expect(fs.readFileSync(path.join(worktree, 'config/.env.local'), 'utf8')).toBe('SECRET=local\n');
});

it('preserves an ignored descendant when an incoming commit replaces its folder with a file', async () => {
  fs.unlinkSync(path.join(worktree, 'config'));
  write(worktree, 'config/tracked.ts', 'tracked\n');
  write(worktree, '.gitignore', '*.local\n');
  git(worktree, 'add', '--all');
  git(worktree, 'commit', '-qm', 'folder');
  const first = await saveCheckpoint({ worktree, message: 'first', includeUntracked: [] });
  const target = path.join(home.root, 'target');
  await worktreeAtCheckpoint({ repo: destination, path: target, checkpoint: first });
  write(target, 'config/nested/secret.local', 'keep this\n');
  fs.rmSync(path.join(worktree, 'config'), { recursive: true });
  write(worktree, 'config', 'replacement file\n');
  git(worktree, 'add', '--all');
  git(worktree, 'commit', '-qm', 'replace folder');
  const next = await saveCheckpoint({ worktree, message: 'next', includeUntracked: [] });
  await expect(worktreeAtCheckpoint({ repo: destination, path: target, checkpoint: next })).rejects.toMatchObject({
    code: 'local_files_in_the_way',
    message: expect.stringContaining('config/nested/secret.local'),
  });
  expect(fs.readFileSync(path.join(target, 'config/nested/secret.local'), 'utf8')).toBe('keep this\n');
});

it('the retry HTTP route refuses a concurrent retry and sends a held message once', async () => {
  const q = await import('@/lib/db/queries');
  const transfer = q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: otherId, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
  const event = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'retry once', createdAt: new Date().toISOString() })!;
  q.holdForTransfer(executionId, event.id);
  q.updateTransfer(transfer.id, { state: 'cancelled', error: 'earlier preparation failure' });
  const { POST } = await import('@/app/api/sessions/[id]/transfer/deliver/route');
  const make = () => POST(new Request('http://isolated.test/api/sessions/' + chatId + '/transfer/deliver', { method: 'POST' }) as never, { params: Promise.resolve({ id: chatId }) });
  const responses = await Promise.all([make(), make()]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(q.getTransfer(transfer.id)).toMatchObject({ heldEventIds: [], error: null });
  expect(fake.sessions.flatMap((s) => s.messages)).toEqual(['retry once']);
});

it('does not acknowledge a held event merely because an earlier dispatch is still preparing it', async () => {
  const q = await import('@/lib/db/queries');
  const executor = await import('@/lib/executor/adapter');
  const models = await import('@/lib/harness/model-discovery');
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(models, 'getHarnessModelCatalog').mockImplementationOnce(async () => {
    entered();
    await gate;
    throw new Error('preparation failed before acceptance');
  });
  const event = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'still preparing', createdAt: new Date().toISOString() })!;
  const original = executor.dispatch(chatId, event.content!, { sourceEventId: event.id }).catch(() => undefined);
  await reached;
  const transfer = q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: otherId, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
  q.updateTransfer(transfer.id, { state: 'failed', stage: 'saving', failedStage: 'saving', error: 'push failed' });
  // Opening the chat during the failed move re-fires the orphan and correctly holds it.
  const health = await import('@/lib/executor/health');
  await health.healthCheckSession(chatId, { redispatchOrphans: true, force: true });
  expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([event.id]);
  const { resumeOnSource } = await import('@/lib/transfer/continue');
  let deliveryEntered!: () => void;
  const reachedDelivery = new Promise<void>((resolve) => { deliveryEntered = resolve; });
  const dispatch = executor.dispatch;
  vi.spyOn(executor, 'dispatch').mockImplementation((...args) => {
    if (args[2]?.heldFor === transfer.id) deliveryEntered();
    return dispatch(...args);
  });
  const resuming = resumeOnSource(executionId);
  // Let recovery reach the duplicate-send path while original preparation is still paused.
  await reachedDelivery;
  release();
  await Promise.all([original, resuming]);
  const sent = fake.sessions.flatMap((s) => s.messages).includes('still preparing');
  const retained = q.getTransfer(transfer.id)!.heldEventIds.includes(event.id);
  if (!sent && !retained) {
    // A later message now bypasses the lost queue and its reply hides the missing one from health recovery.
    const later = q.insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content: 'later instruction', createdAt: new Date().toISOString() })!;
    await executor.dispatch(chatId, later.content!, { sourceEventId: later.id });
    await (await import('@/lib/runner/local-runner')).closeAllSessions();
    const report = await health.healthCheckSession(chatId, { redispatchOrphans: true, force: true });
    expect(report.redispatched).toBe(false);
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual(['later instruction']);
  }
  // Either recovery actually sends it, or it keeps durable pending state. An in-flight reservation isn't acceptance.
  expect({ sent, retained }).not.toEqual({ sent: false, retained: false });
});
