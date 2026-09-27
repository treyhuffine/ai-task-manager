/**
 * The boundary between moving work and everything else, and what survives a
 * restart (P4 review fixes). A home with one execution in a real Git
 * worktree, a second computer that isn't connected, and the fake harness.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';

let home: TestHome;
let fake: FakeHarness;
let hostId: string;
let otherId: string;
let executionId: string;
let chatId: string;
let worktree: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-coordination-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostComputerId;
  const repo = path.join(home.root, 'repo');
  git(home.root, 'init', '-q', '-b', 'main', repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base');
  worktree = path.join(home.root, 'worktree');
  git(repo, 'worktree', 'add', '-q', '-b', 'work', worktree, 'main');
  const q = await import('@/lib/db/queries');
  const key = q.createApiKey({ name: 'Laptop', deviceType: 'computer' });
  otherId = q.registerComputerForApiKey({ apiKeyId: key.key.id, name: 'Laptop', platform: 'darwin' }).computer.id;
  const workspaceId = q.createWorkspace({ name: 'Demo', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  const created = q.createExecutionWithChat({ workspaceId, harness: 'claude', label: 'Work' });
  executionId = created.execution.id;
  chatId = created.session.id;
  q.updateExecution(executionId, { worktreePath: worktree, branchName: 'work', baseSha: git(worktree, 'rev-parse', 'HEAD') });
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

async function saved(content: string) {
  return (await import('@/lib/db/queries')).insertChatEvent({ sessionId: chatId, role: 'user', source: 'user', content, createdAt: new Date().toISOString() })!;
}

async function moveRecord() {
  const q = await import('@/lib/db/queries');
  return q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: otherId, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
}

async function until(check: () => boolean, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('the boundary around the source', () => {
  it("won't start a change while the work moves, nor a move under a change", async () => {
    const moving = await import('./moving');
    const release = moving.admitChange(executionId, 'pushing');
    expect(moving.busyWith(executionId)).toBe('pushing');
    const { startTransfer } = await import('./continue');
    expect(() => startTransfer({ chatSessionId: chatId, toComputerId: otherId, includeUntracked: [], requestedByApiKeyId: null })).toThrow(
      "It's pushing right now. Continue once that's done.",
    );
    release();
    expect(moving.busyWith(executionId)).toBeNull();

    await moveRecord();
    expect(() => moving.admitChange(executionId, 'pushing')).toThrow("It's moving to Laptop. Try again once it has arrived there.");
    expect(moving.admitSend(executionId)).toBeNull();
  });

  it('stops the source only once the sends already let through have reached it', async () => {
    const moving = await import('./moving');
    const release = moving.admitSend(executionId)!;
    // A send doesn't stop a move from starting: the move waits for it instead.
    expect(moving.busyWith(executionId)).toBeNull();
    expect(await moving.drainSends(executionId, 100)).toBe(false);
    setTimeout(release, 50);
    expect(await moving.drainSends(executionId, 2_000)).toBe(true);
  });

  it('sends a message prepared while the work changed hands to its new owner, never the old one', async () => {
    const q = await import('@/lib/db/queries');
    const models = await import('@/lib/harness/model-discovery');
    const original = models.getHarnessModelCatalog;
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const reached = new Promise<void>((resolve) => (entered = resolve));
    vi.spyOn(models, 'getHarnessModelCatalog').mockImplementationOnce(async (...args) => {
      entered();
      await held;
      return original(...args);
    });
    const executor = await import('@/lib/executor/adapter');
    const event = await saved('for whoever has it');
    let queued!: () => void;
    const onItsWay = new Promise<void>((resolve) => (queued = resolve));
    // Its turn would come from the laptop's worker, which isn't running: wait for it to be queued there.
    void executor.dispatch(chatId, event.content!, { sourceEventId: event.id, onQueued: () => queued() }).catch(() => {});
    await reached;
    // Meanwhile the move finished: the laptop, which runs claude, has the work now.
    const { WORKER_PROTOCOL } = await import('@/lib/workers/protocol');
    q.recordWorkerHeartbeat(otherId, {
      protocol: WORKER_PROTOCOL,
      version: 'test',
      state: 'awake',
      harnesses: [{ harness: 'claude', binary: { status: 'supported', command: 'claude', version: '1', protocolProfile: null }, capabilities: { sessions: { supported: true }, concurrentSend: { supported: true } } }],
    } as never);
    const transfer = await moveRecord();
    const laptopFolder = path.join(home.root, 'laptop-worktree');
    q.continueOwnership({ transferId: transfer.id, worktreePath: laptopFolder, checkpointSha: git(worktree, 'rev-parse', 'HEAD'), branch: 'work' });
    q.updateTransfer(transfer.id, { state: 'succeeded', stage: 'done' });
    release();
    await onItsWay;
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
    const sends = q.listWorkerCommands(otherId).filter((c) => c.kind === 'send' && c.sourceEventId === event.id);
    expect(sends).toHaveLength(1);
    // Built for the laptop, in its folder there, not for the home's worktree.
    expect((sends[0].payload as { spec: { cwd: string } }).spec.cwd).toBe(laptopFolder);
  });
});

describe('settling a move that stopped', () => {
  it('holds new messages until it is settled, and a second Resume finds nothing to do', async () => {
    const q = await import('@/lib/db/queries');
    const transfer = await moveRecord();
    q.updateTransfer(transfer.id, { state: 'failed', failedStage: 'saving', error: 'push rejected' });
    const executor = await import('@/lib/executor/adapter');
    const first = await saved('first');
    await executor.dispatch(chatId, first.content!, { sourceEventId: first.id });
    // A helper with no saved message is refused rather than sent.
    await expect(executor.dispatch(chatId, 'from a commit helper')).rejects.toThrow('Its move to another computer stopped.');
    expect(fake.sessions).toHaveLength(0);
    expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([first.id]);

    const { resumeOnSource } = await import('./continue');
    await expect(resumeOnSource(executionId)).resolves.toMatchObject({ state: 'cancelled', heldEventIds: [] });
    await expect(resumeOnSource(executionId)).rejects.toThrow('There is no stopped move to resume from.');
    // Settled: what's sent now goes to the source.
    const next = await saved('after resuming');
    await executor.dispatch(chatId, next.content!, { sourceEventId: next.id });
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual(['first', 'after resuming']);
  });

  it('answers Resume once its messages are with the harness, in order, not after their turns', async () => {
    const q = await import('@/lib/db/queries');
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    fake.onTurn(async (turn) => {
      await gate;
      await turn.say(`done: ${turn.message}`);
    });
    const transfer = await moveRecord();
    const a = await saved('one');
    const b = await saved('two');
    q.holdForTransfer(executionId, a.id);
    q.holdForTransfer(executionId, b.id);
    q.updateTransfer(transfer.id, { state: 'failed', failedStage: 'saving', error: 'push rejected' });
    const { resumeOnSource } = await import('./continue');
    await resumeOnSource(executionId);
    // Both with the harness, in order, while neither turn has finished.
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual(['one', 'two']);
    open();
  });

  it('carries what a stopped move held into Try again, in the same step that supersedes it', async () => {
    const q = await import('@/lib/db/queries');
    const stopped = await moveRecord();
    const a = await saved('held');
    q.holdForTransfer(executionId, a.id);
    q.updateTransfer(stopped.id, { state: 'failed', failedStage: 'saving', error: 'push rejected' });
    const again = q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: otherId, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
    expect(again.heldEventIds).toEqual([a.id]);
    expect(q.getTransfer(stopped.id)).toMatchObject({ state: 'cancelled', heldEventIds: [] });
    const { resumeOnSource } = await import('./continue');
    await expect(resumeOnSource(executionId)).rejects.toThrow('There is no stopped move to resume from.');
  });
});

describe('when the home restarts', () => {
  it('stops an interrupted move and withdraws the commands no computer took yet', async () => {
    const q = await import('@/lib/db/queries');
    const transfer = await moveRecord();
    q.updateTransfer(transfer.id, { stage: 'setting_up' });
    const prepare = q.queueWorkerCommand({
      computerId: otherId,
      kind: 'prepare',
      payload: { transfer: { id: transfer.id } },
      actor: { source: 'human' },
      executionId,
      chatSessionId: chatId,
      generation: 2,
    });
    const unrelated = q.queueWorkerCommand({ computerId: otherId, kind: 'interrupt', payload: {}, actor: { source: 'human' }, executionId, chatSessionId: chatId, generation: 1 });
    const { recoverInterruptedTransfers } = await import('./continue');
    expect(recoverInterruptedTransfers()).toEqual({ stopped: 1, delivering: 0 });
    expect(q.getTransfer(transfer.id)).toMatchObject({
      state: 'failed',
      failedStage: 'setting_up',
      error: 'Ri restarted while it was moving. Nothing was lost: Try again, or resume on Mac Mini.'.replace('Mac Mini', q.getComputer(hostId)!.name),
    });
    expect(q.getWorkerCommand(prepare.id)!.state).toBe('cancelled');
    expect(q.getWorkerCommand(unrelated.id)!.state).toBe('queued');
  });

  it('goes on delivering what a settled move had not sent yet', async () => {
    const q = await import('@/lib/db/queries');
    const transfer = await moveRecord();
    const a = await saved('left over');
    q.holdForTransfer(executionId, a.id);
    // Settled by Resume, then the home stopped before the message went.
    q.updateTransfer(transfer.id, { state: 'cancelled', failedStage: 'saving' });
    const executor = await import('@/lib/executor/adapter');
    // Nothing else sends it meanwhile: it's still listed as held.
    await executor.dispatch(chatId, a.content!, { sourceEventId: a.id });
    expect(fake.sessions).toHaveLength(0);
    const { recoverInterruptedTransfers } = await import('./continue');
    expect(recoverInterruptedTransfers()).toEqual({ stopped: 0, delivering: 1 });
    await until(() => fake.sessions.flatMap((s) => s.messages).includes('left over'), 'the held message');
    expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([]);
    expect(fake.sessions.flatMap((s) => s.messages)).toEqual(['left over']);
  });
});
