/**
 * P3 re-check at d0c788f, finding 1: a scheduled run's clock started before
 * its message was prepared, and running out didn't stop the preparation, so
 * the run failed and then queued its message for a sleeping worker anyway.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';
import type { WorkerHarnessReport } from '@/db/types';

let home: TestHome | undefined;
let fake: FakeHarness | undefined;
afterEach(async () => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks();
  fake?.restore();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
});

it('does not fail before queue admission and then enqueue a scheduled send anyway', async () => {
  home = await createTestHome({ prefix: 'ri-p3-clock-recheck-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const grant = q.createDeviceGrant({ kind: 'enroll', deviceId: null, deviceName: 'Review worker', createdByApiKeyId: null });
  const worker = q.redeemEnrollGrant({ secret: grant.secret, name: 'Review worker' }).device.id;
  q.recordWorkerHeartbeat(worker, { protocol: WORKER_PROTOCOL, version: 'test', state: 'awake', harnesses: [
    { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } } as WorkerHarnessReport,
  ] });
  const workspace = q.createWorkspace({ name: 'Scheduled review', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: workspace.id, harness: 'claude', label: 'Review' });
  q.createPlacement({ executionId: created.execution.id, deviceId: worker, startReason: 'created', worktreePath: home.root });
  const trigger = q.createTrigger({ name: 'Timed review', workspaceId: workspace.id, owningExecutionId: created.execution.id, targetKind: 'workspace', harness: 'claude', prompt: 'Sweep', kind: 'cron', cronExpression: '0 * * * *', timeoutSeconds: 1 });
  fake = installFakeHarness('claude');
  const models = await import('@/lib/harness/model-discovery');
  const original = models.getHarnessModelCatalog;
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { entered = resolve; });
  vi.spyOn(models, 'getHarnessModelCatalog').mockImplementationOnce(async (...args) => {
    entered(); await gate; return original(...args);
  });
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  vi.useFakeTimers();
  const { run } = await dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
  await reached;
  await vi.advanceTimersByTimeAsync(1500);
  const intervals = vi.spyOn(globalThis, 'setInterval');
  release();
  await vi.advanceTimersByTimeAsync(100);
  const persisted = q.getRun(run.id)!;
  const queued = q.listWorkerCommands(worker).filter((command) => command.kind === 'send' && command.state === 'queued');
  // Either keep waiting for the sleeping worker or abort preparation completely.
  // A failed run must never leave a fresh send that will execute when it wakes.
  expect({ failed: persisted.status === 'failed', queued: queued.length }).not.toEqual({ failed: true, queued: 1 });
  // Kept at the fix, stricter: preparation outran the limit, so the run
  // failed on time, the send boundary refused the message, and no clock
  // was left watching a queue.
  expect(persisted).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  expect(q.listWorkerCommands(worker).filter((command) => command.kind === 'send')).toEqual([]);
  expect(intervals).not.toHaveBeenCalled();
}, 20_000);
