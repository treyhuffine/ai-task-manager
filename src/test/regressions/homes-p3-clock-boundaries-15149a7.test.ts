/** Independent re-check: real dispatch/runner/bookkeeping, temporary home and fake harness only. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { getProvider } from '@agentex/agent';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { TriggerRecord } from '@/db/types';

let home: TestHome;
let fake: FakeHarness;
let q: typeof import('@/lib/db/queries');
let executionId: string;
let hostId: string;
let trigger: TriggerRecord;
beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-clock-boundaries-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache(); hostId = identity.ensureHomeIdentity().home.hostComputerId;
  q = await import('@/lib/db/queries');
  const repo = path.join(home.root, 'repo');
  const worktree = path.join(home.root, 'execution');
  fs.mkdirSync(repo);
  const git = (...args:string[]) => execFileSync('git', args, {cwd:repo,stdio:'pipe',env:{...process.env,GIT_CONFIG_NOSYSTEM:'1'}}).toString().trim();
  git('init','-q','-b','main');
  fs.writeFileSync(path.join(repo,'README.md'),'Temporary review repository\n');
  git('add','README.md');
  git('-c','user.name=Review','-c','user.email=review@example.invalid','commit','-qm','base');
  git('worktree','add','-q','-b','review',worktree,'main');
  const workspace = q.createWorkspace({ name: 'Review clock', cwd: repo, isGit: true, baseBranch:'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Review' });
  executionId = created.execution.id;
  q.updateExecution(executionId,{worktreePath:worktree,branchName:'review',baseSha:git('rev-parse','HEAD')});
  trigger = q.createTrigger({ name: 'Timed review', workspaceId: workspace.id, owningExecutionId: executionId, targetKind: 'workspace', harness: 'claude', prompt: 'Review sweep', kind: 'cron', cronExpression: '0 * * * *', timeoutSeconds: 1 });
  fake = installFakeHarness('claude');
});
afterEach(async () => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  await (await import('@/lib/runner/local-runner')).closeAllSessions();
  fake?.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/transfer/moving'))._resetExecutionOperations();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
});

async function fire() {
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  return dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
}

it('does not send locally after the clock expired while a harness session was starting', async () => {
  const provider = getProvider(fake.providerType);
  const create = provider.createSession!;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(provider, 'createSession').mockImplementationOnce(async (context) => {
    entered(); await gate; return create(context);
  });
  vi.useFakeTimers();
  const { run } = await fire();
  await reached;
  await vi.advanceTimersByTimeAsync(1500);
  expect(q.getRun(run.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  release();
  await vi.advanceTimersByTimeAsync(100);
  expect(fake.sessions.flatMap((session) => session.messages),
    'the failed scheduled run still reached the harness after session creation finished').toEqual([]);
}, 20_000);

it('keeps a scheduled fire pending while its message is held by a move', async () => {
  const destination = q.createComputer({ name: 'Review destination', platform: 'darwin', hostname: 'fixture-only' });
  const transfer = q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: destination.id, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
  vi.useFakeTimers();
  const { run } = await fire();
  await vi.advanceTimersByTimeAsync(100);
  expect(q.getTransfer(transfer.id)!.heldEventIds).toHaveLength(1);
  expect(fake.sessions.flatMap((session) => session.messages)).toEqual([]);
  expect(['queued', 'running'], 'the scheduled fire has not run yet').toContain(q.getRun(run.id)!.status);
}, 20_000);

it('keeps the scheduled timeout when a move releases its held message', async () => {
  const destination = q.createComputer({ name: 'Review destination', platform: 'darwin', hostname: 'fixture-only' });
  const transfer = q.createTransfer({ executionId, fromComputerId: hostId, toComputerId: destination.id, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
  let began!: () => void;
  const reached = new Promise<void>((resolve) => { began = resolve; });
  let interrupted = false;
  fake.onTurn(async ({ signal }) => {
    began();
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => { interrupted = true; resolve(); }, { once: true }));
  });
  vi.useFakeTimers();
  const { run } = await fire();
  await vi.advanceTimersByTimeAsync(100);
  const settled = q.updateTransfer(transfer.id, {state:'cancelled'})!;
  const { deliverHeld } = await import('@/lib/transfer/continue');
  await deliverHeld(settled);
  await reached;
  await vi.advanceTimersByTimeAsync(1500);
  expect.soft(interrupted, 'a held scheduled message lost its one-second execution limit').toBe(true);
  expect(q.getRun(run.id)).toMatchObject({status:'failed', errorCode:'timeout'});
}, 20_000);

it('interrupts a local turn that has actually started and preserves timeout as the outcome', async () => {
  let began!: () => void;
  const reached = new Promise<void>((resolve) => { began = resolve; });
  let interrupted = false;
  fake.onTurn(async ({ signal }) => {
    began();
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => { interrupted = true; resolve(); }, { once: true }));
  });
  vi.useFakeTimers();
  const { run } = await fire();
  await reached;
  await vi.advanceTimersByTimeAsync(1500);
  expect(interrupted).toBe(true);
  expect(q.getRun(run.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
}, 20_000);
