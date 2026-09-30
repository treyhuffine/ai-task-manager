/**
 * Adversarial P4 review at cbbd90c. No production homes or real harnesses.
 *
 * Kept as regressions. Two probes were adapted to go through the paths the
 * app uses, with their invariant kept: the archive race takes the lock with
 * `startTransfer` (which refuses under an archive in flight) rather than
 * inserting the record directly, and the cold restart runs the startup's
 * transfer recovery as well as the transcript sweep.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { saveCheckpoint, worktreeAtCheckpoint, reviewCheckout } from '@/lib/transfer/git-checkpoint';

let home: TestHome;
let fake: FakeHarness;
let remote: string;
let repo: string;
let destination: string;
let worktree: string;
let hostId: string;
let otherId: string;
let workspaceId: string;
let executionId: string;
let chatId: string;
const branch = 'review/feature-with-slashes';

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
  home = await createTestHome({ prefix: 'ri-p4-review-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostDeviceId;
  remote = path.join(home.root, 'remote.git');
  git(home.root, 'init', '-q', '--bare', '-b', 'main', remote);
  repo = clone('source repo');
  write(repo, 'README.md', 'base\n');
  write(repo, '.gitignore', 'ignored/\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'push', '-q', 'origin', 'main');
  destination = clone('destination repo');
  worktree = path.join(home.root, 'source worktree');
  git(repo, 'worktree', 'add', '-q', '-b', branch, worktree, 'main');
  const q = await import('@/lib/db/queries');
  const key = q.pairDevice({ name: 'Review companion', kind: 'computer' });
  otherId = q.registerDeviceForApiKey({ apiKeyId: key.key.id, name: 'Review companion', platform: 'darwin' }).device.id;
  workspaceId = q.createWorkspace({ name: 'Review', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'claude', label: 'Review' });
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
  (await import('@/lib/executor/remote-live'))._resetRemoteLive();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function moving() {
  const q = await import('@/lib/db/queries');
  return q.createTransfer({ executionId, fromDeviceId: hostId, toDeviceId: otherId, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
}
async function savedMessage(content: string) {
  return (await import('@/lib/db/queries')).insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
}

describe('checkpoint contents and recovery', () => {
  it('never publishes staged local-only files even when includeUntracked is empty', async () => {
    git(worktree, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    write(worktree, '.env.local', 'SECRET=private\n');
    write(worktree, 'local-config.json', 'private setup\n');
    git(worktree, 'add', '.env.local', 'local-config.json');
    await saveCheckpoint({ worktree, message: 'checkpoint', includeUntracked: [], filesToCopy: ['local-config.json'] }).catch(() => null);
    const names = git(remote, 'ls-tree', '-r', '--name-only', `refs/heads/${branch}`).split('\n');
    expect.soft(names).not.toContain('.env.local');
    expect(names).not.toContain('local-config.json');
  });

  it('never publishes changes to an already-tracked filesToCopy file', async () => {
    write(worktree, 'local-config.json', 'template\n');
    git(worktree, 'add', 'local-config.json');
    git(worktree, 'commit', '-q', '-m', 'template');
    git(worktree, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
    write(worktree, 'local-config.json', 'SECRET=personal\n');
    await saveCheckpoint({ worktree, message: 'checkpoint', includeUntracked: [], filesToCopy: ['local-config.json'] }).catch(() => null);
    expect(git(remote, 'show', `refs/heads/${branch}:local-config.json`)).toBe('template');
  });

  it('keeps an unresolved merge unresolved instead of committing its conflict markers', async () => {
    git(repo, 'switch', '-q', '-c', 'other');
    write(repo, 'README.md', 'other side\n');
    git(repo, 'commit', '-qam', 'other');
    write(worktree, 'README.md', 'our side\n');
    git(worktree, 'commit', '-qam', 'ours');
    try { git(worktree, 'merge', 'other'); } catch { /* Expected unresolved merge. */ }
    const before = git(worktree, 'rev-parse', 'HEAD');
    const unmerged = git(worktree, 'ls-files', '-u');
    expect(unmerged).not.toBe('');
    await saveCheckpoint({ worktree, message: 'checkpoint', includeUntracked: [] }).catch(() => null);
    expect.soft(git(worktree, 'rev-parse', 'HEAD')).toBe(before);
    expect(git(worktree, 'ls-files', '-u')).toBe(unmerged);
  });

  it('can retry the same checkpoint request after its chosen new file was committed', async () => {
    write(worktree, 'new feature.ts', 'export {};\n');
    const args = { worktree, message: 'checkpoint', includeUntracked: ['new feature.ts'] };
    const first = await saveCheckpoint(args);
    await expect(saveCheckpoint(args)).resolves.toMatchObject({ sha: first.sha, committed: false });
  });

  it('does not overwrite an ignored local file when reusing a destination worktree', async () => {
    const first = await saveCheckpoint({ worktree, message: 'first', includeUntracked: [] });
    const target = path.join(home.root, 'destination worktree');
    await worktreeAtCheckpoint({ repo: destination, path: target, checkpoint: first });
    write(target, 'ignored/settings.json', 'local data that must survive\n');
    write(worktree, 'ignored/settings.json', 'published content\n');
    git(worktree, 'add', '-f', 'ignored/settings.json');
    git(worktree, 'commit', '-qm', 'new tracked path');
    const next = await saveCheckpoint({ worktree, message: 'next', includeUntracked: [] });
    await worktreeAtCheckpoint({ repo: destination, path: target, checkpoint: next }).catch(() => null);
    expect(fs.readFileSync(path.join(target, 'ignored/settings.json'), 'utf8')).toBe('local data that must survive\n');
  });

  it('does not overwrite an ignored local file when refreshing a review checkout', async () => {
    const first = await saveCheckpoint({ worktree, message: 'first', includeUntracked: [] });
    const target = path.join(home.root, 'review worktree');
    await reviewCheckout({ repo: destination, path: target, checkpoint: first });
    write(target, 'ignored/settings.json', 'local review data\n');
    write(worktree, 'ignored/settings.json', 'published content\n');
    git(worktree, 'add', '-f', 'ignored/settings.json');
    git(worktree, 'commit', '-qm', 'new tracked path');
    const next = await saveCheckpoint({ worktree, message: 'next', includeUntracked: [] });
    await reviewCheckout({ repo: destination, path: target, checkpoint: next }).catch(() => null);
    expect(fs.readFileSync(path.join(target, 'ignored/settings.json'), 'utf8')).toBe('local review data\n');
  });

  it('supports a non-origin remote, slash branches, spaced paths, and a large explicitly chosen file', async () => {
    git(repo, 'remote', 'rename', 'origin', 'upstream');
    git(destination, 'remote', 'rename', 'origin', 'upstream');
    fs.writeFileSync(path.join(worktree, 'large new file.bin'), Buffer.alloc(17 * 1024 * 1024, 97));
    const checkpoint = await saveCheckpoint({ worktree, message: 'large file', includeUntracked: ['large new file.bin'] });
    const target = path.join(home.root, 'large destination');
    await worktreeAtCheckpoint({ repo: destination, path: target, checkpoint });
    expect(checkpoint.remote).toBe('upstream');
    expect(git(target, 'branch', '--show-current')).toBe(branch);
    expect(fs.statSync(path.join(target, 'large new file.bin')).size).toBe(17 * 1024 * 1024);
  });

  it('refuses detached HEAD without staging or changing files', async () => {
    git(worktree, 'checkout', '-q', '--detach');
    write(worktree, 'README.md', 'keep this edit\n');
    const before = git(worktree, 'status', '--porcelain');
    await expect(saveCheckpoint({ worktree, message: 'checkpoint', includeUntracked: [] })).rejects.toMatchObject({ code: 'not_on_branch' });
    expect(git(worktree, 'status', '--porcelain')).toBe(before);
  });
});

describe('transfer lifecycle boundaries', () => {
  it('keeps new messages held after a transfer fails until Resume or Try again', async () => {
    const q = await import('@/lib/db/queries');
    const transfer = await moving();
    q.updateTransfer(transfer.id, { state: 'failed', stage: 'saving', failedStage: 'saving', error: 'push rejected' });
    const event = await savedMessage('typed after the move stopped');
    await (await import('@/lib/executor/adapter')).dispatch(chatId, event.content!, { sourceEventId: event.id });
    expect.soft(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
    expect(q.latestTransfer(executionId)!.heldEventIds).toContain(event.id);
  });

  it('does not deliver held messages twice when Resume is clicked concurrently', async () => {
    const q = await import('@/lib/db/queries');
    const transfer = await moving();
    const event = await savedMessage('deliver once');
    q.holdForTransfer(executionId, event.id);
    q.updateTransfer(transfer.id, { state: 'failed', stage: 'saving', failedStage: 'saving', error: 'push rejected' });
    const { resumeOnSource } = await import('@/lib/transfer/continue');
    await Promise.allSettled([resumeOnSource(executionId), resumeOnSource(executionId)]);
    expect(fake.sessions.flatMap((s) => s.messages).filter((s) => s === 'deliver once')).toHaveLength(1);
  });

  it('rechecks a send that was awaiting model discovery when the transfer stopped the source', async () => {
    const models = await import('@/lib/harness/model-discovery');
    const original = models.getHarnessModelCatalog;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(models, 'getHarnessModelCatalog').mockImplementationOnce(async (...args) => {
      entered();
      await held;
      return original(...args);
    });
    const executor = await import('@/lib/executor/adapter');
    const event = await savedMessage('in flight before moving');
    const pending = executor.dispatch(chatId, event.content!, { sourceEventId: event.id });
    await reached;
    const transfer = await moving();
    const stopped = await executor.close(chatId);
    expect(stopped.closed).toBe(true);
    (await import('@/lib/db/queries')).updateTransfer(transfer.id, { stage: 'saving' });
    release();
    await pending;
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
  });

  it('does not let a move take its lock under an archive already started', async () => {
    const workspaces = await import('@/lib/workspaces');
    const original = workspaces.archiveSessionWorktree;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const reached = new Promise<void>((resolve) => { entered = resolve; });
    vi.spyOn(workspaces, 'archiveSessionWorktree').mockImplementationOnce(async (...args) => {
      entered();
      await held;
      return original(...args);
    });
    const { archiveExecutionSession } = await import('@/lib/sessions/dispatch');
    const pending = archiveExecutionSession({ sessionId: chatId });
    await reached;
    const { startTransfer } = await import('@/lib/transfer/continue');
    expect(() => startTransfer({ chatSessionId: chatId, toDeviceId: otherId, includeUntracked: [], requestedByApiKeyId: null })).toThrow(
      "It's being archived right now. Continue once that's done.",
    );
    release();
    await pending.catch(() => null);
    // The archive the person asked for went ahead, and no move was ever under way to lose its source.
    const q = await import('@/lib/db/queries');
    expect(q.latestTransfer(executionId)).toBeNull();
    expect(fs.existsSync(worktree)).toBe(false);
  });

  it('refuses a new execution terminal after the source has stopped for transfer', async () => {
    const transfer = await moving();
    (await import('@/lib/db/queries')).updateTransfer(transfer.id, { stage: 'saving' });
    const pty = await import('@/lib/terminal/pty-manager');
    const spawn = vi.spyOn(pty, 'createTerminal').mockImplementation((input) => ({
      id: 'probe-terminal', ownerId: input.ownerId, cwd: input.cwd, shell: '/bin/sh',
      cols: 80, rows: 24, exited: false, exitCode: null, createdAt: new Date().toISOString(),
    }));
    const { POST } = await import('@/app/api/sessions/[id]/terminals/route');
    const response = await POST(new Request('http://127.0.0.1/api/terminals', { method: 'POST', body: '{}' }) as never, {
      params: Promise.resolve({ id: chatId }),
    });
    expect.soft(response.status).toBe(409);
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(['saving', 'continuing'] as const)('exposes recovery after a cold restart with an active persisted transfer at %s', async (stage) => {
    const q = await import('@/lib/db/queries');
    const transfer = await moving();
    const event = await savedMessage('held across a home restart');
    q.holdForTransfer(executionId, event.id);
    if (stage === 'continuing') {
      q.continueOwnership({ transferId: transfer.id, worktreePath: destination, checkpointSha: git(worktree, 'rev-parse', 'HEAD'), branch });
    } else q.updateTransfer(transfer.id, { stage });
    // Persisted state left by a process that stopped mid-transfer. No promise
    // from that process exists after the DB is reopened and cold-start sweep runs.
    (await import('@/lib/db')).resetDb();
    (await import('@/lib/executor/adapter'))._resetExecutorState();
    (await import('@/lib/home/identity')).resetHomeIdentityCache();
    (await import('@/lib/home/identity')).ensureHomeIdentity();
    (await import('@/lib/transfer/continue')).recoverInterruptedTransfers();
    await (await import('@/lib/executor/reconcile')).reconcileAllSessions();
    expect(q.getTransfer(transfer.id)).toMatchObject({ state: 'failed', heldEventIds: [event.id] });
    // The held message wasn't sent by the sweep, and the recovery the card offers works.
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
    const { finishOnDestination, resumeOnSource } = await import('@/lib/transfer/continue');
    if (stage === 'saving') await expect(resumeOnSource(executionId)).resolves.toMatchObject({ state: 'cancelled', heldEventIds: [] });
    // This companion never reported a harness, so nothing there can take it:
    // it stays in line, the reason recorded, for Send them again (P4 re-check).
    else await expect(finishOnDestination(executionId)).resolves.toMatchObject({ state: 'succeeded', heldEventIds: [event.id], error: expect.stringContaining("hasn't reported claude") });
  });
});
