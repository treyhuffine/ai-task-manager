/**
 * A scheduled fire whose message a move holds (P3 re-check): it waits as
 * its run, later fires wait behind it, the boot sweep keeps it, and the
 * move delivers it as that run, finished by its turn. A delivery that fails
 * before anything took it leaves it held and the run waiting.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import type { ExecutionTransferRecord, TriggerRecord } from '@/db/types';

let home: TestHome;
let fake: FakeHarness;
let q: typeof import('@/lib/db/queries');
let executionId: string;
let transfer: ExecutionTransferRecord;
let trigger: TriggerRecord;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-held-fire-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  const hostId = identity.ensureHomeIdentity().home.hostDeviceId;
  q = await import('@/lib/db/queries');
  const repo = path.join(home.root, 'repo');
  const worktree = path.join(home.root, 'execution');
  fs.mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString().trim();
  git('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'Held fire\n');
  git('add', 'README.md');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base');
  git('worktree', 'add', '-q', '-b', 'held', worktree, 'main');
  const workspace = q.createWorkspace({ name: 'Held fire', cwd: repo, isGit: true, baseBranch: 'main', filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  executionId = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Held' }).execution.id;
  q.updateExecution(executionId, { worktreePath: worktree, branchName: 'held', baseSha: git('rev-parse', 'HEAD') });
  trigger = q.createTrigger({ name: 'Hourly', workspaceId: workspace.id, owningExecutionId: executionId, targetKind: 'workspace', harness: 'claude', prompt: 'Sweep', kind: 'cron', cronExpression: '0 * * * *', timeoutSeconds: 60 });
  const destination = q.createDevice({ name: 'Elsewhere', platform: 'darwin', hostname: 'fixture-only' , kind: 'computer' });
  transfer = q.createTransfer({ executionId, fromDeviceId: hostId, toDeviceId: destination.id, fromGeneration: 1, includeUntracked: [], requestedByApiKeyId: null });
  fake = installFakeHarness('claude');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await (await import('@/lib/runner/local-runner')).closeAllSessions();
  fake?.restore();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/transfer/moving'))._resetExecutionOperations();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
});

async function fire() {
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  const { run } = await dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
  await vi.waitFor(() => expect(q.getRun(run.id)!.statusReason).toBe('held_by_move'));
  return q.getRun(run.id)!;
}

it('waits as its run, with its message, and later fires wait behind it', async () => {
  const run = await fire();
  expect(run).toMatchObject({ status: 'queued', startedAt: null });
  expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([run.sourceEventId]);
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  // The default policy folds the next fire into the held one's chat: the
  // move holds that message too, rather than refuse it.
  const next = await dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
  expect(next.run).toMatchObject({ status: 'skipped', statusReason: 'coalesced_into_active' });
  await vi.waitFor(() => expect(q.getTransfer(transfer.id)!.heldEventIds).toHaveLength(2));
  // Skipping instead leaves nothing new.
  q.updateTrigger(trigger.id, { concurrencyPolicy: 'skip_if_running' });
  const skipped = await dispatchRun({ trigger: q.getTrigger(trigger.id)!, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
  expect(skipped.run).toMatchObject({ status: 'skipped', statusReason: 'trigger_busy' });
  expect(q.getTransfer(transfer.id)!.heldEventIds).toHaveLength(2);
  expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
});

it('is kept by the boot sweep: its message is saved with the move', async () => {
  const run = await fire();
  expect(q.reapStaleRunningRuns()).toBe(0);
  expect(q.getRun(run.id)).toMatchObject({ status: 'queued', statusReason: 'held_by_move' });
});

it('is delivered as the same run once the move settles, and finished by its turn', async () => {
  const run = await fire();
  const { deliverHeld } = await import('@/lib/transfer/continue');
  await deliverHeld(q.updateTransfer(transfer.id, { state: 'cancelled' })!);
  await vi.waitFor(() => expect(q.getRun(run.id)!.status).toBe('completed'));
  expect(q.getRun(run.id)!.startedAt).not.toBeNull();
  expect(fake.sessions.flatMap((s) => s.messages)).toHaveLength(1);
  expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([]);
  // No second run was made for it.
  expect(q.listRuns({ triggerId: trigger.id })).toHaveLength(1);
});

it('stays held, and its run waiting, when a delivery fails before anything took it', async () => {
  const run = await fire();
  const models = await import('@/lib/harness/model-discovery');
  vi.spyOn(models, 'getHarnessModelCatalog').mockRejectedValueOnce(new Error('discovery is down'));
  const { deliverHeld } = await import('@/lib/transfer/continue');
  await deliverHeld(q.updateTransfer(transfer.id, { state: 'cancelled' })!);
  expect(q.getRun(run.id)).toMatchObject({ status: 'queued', statusReason: 'held_by_move' });
  expect(q.getTransfer(transfer.id)!.heldEventIds).toEqual([run.sourceEventId]);
  expect(fake.sessions.flatMap((s) => s.messages)).toEqual([]);
});
