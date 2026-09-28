import { afterEach, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';
import type { WorkerHarnessReport } from '@/db/types';

let home: TestHome | undefined;
let fake: FakeHarness | undefined;
afterEach(async () => {
  fake?.restore();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home?.cleanup();
});

it('does not leave a timed-out scheduled send executable on reconnect', async () => {
  home = await createTestHome({ prefix: 'ri-p3-schedule-review-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache(); identity.ensureHomeIdentity();
  const q = await import('@/lib/db/queries');
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'Laptop', createdByApiKeyId: null });
  const laptop = q.redeemEnrollGrant({ secret: grant.secret, name: 'Laptop' }).computer.id;
  q.recordWorkerHeartbeat(laptop, { protocol: WORKER_PROTOCOL, version: 'test', state: 'awake', harnesses: [
    { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } } as WorkerHarnessReport,
  ] });
  const ws = q.createWorkspace({ name: 'Timed sweep', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false });
  const created = q.createExecutionWithChat({ workspaceId: ws.id, harness: 'claude', label: 'Sleeping laptop' });
  q.createPlacement({ executionId: created.execution.id, computerId: laptop, startReason: 'created', worktreePath: home.root });
  const trigger = q.createTrigger({ name: 'Short timed sweep', workspaceId: ws.id, owningExecutionId: created.execution.id,
    targetKind: 'workspace', harness: 'claude', prompt: 'Sweep', kind: 'cron', cronExpression: '0 * * * *', timeoutSeconds: 1,
  });
  fake = installFakeHarness('claude');
  const { dispatchRun } = await import('@/lib/runs/dispatch');
  const { run } = await dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
  // Adapted to the fix chosen (the review offered both): the clock starts when
  // the laptop takes the message, so a fire waiting for a sleeping laptop waits
  // there (P3.4), and never fails on time with its message still queued.
  await new Promise((r) => setTimeout(r, 2_500));
  expect(q.getRun(run.id)!.status).not.toBe('failed');
  expect(q.listWorkerCommands(laptop).filter((c) => c.kind === 'send').map((c) => c.state)).toEqual(['queued']);
  expect(q.listWorkerCommands(laptop).filter((c) => c.kind === 'interrupt')).toHaveLength(0);
  // The laptop wakes and takes it: from then on its second counts.
  q.takeCommandsForStream(laptop, 0);
  for (let i = 0; i < 400 && q.getRun(run.id)?.status !== 'failed'; i++) await new Promise((r) => setTimeout(r, 10));
  expect(q.getRun(run.id)).toMatchObject({ status: 'failed', errorCode: 'timeout' });
  const waiting = q.listWorkerCommands(laptop).filter((c) => c.kind === 'send' && c.state === 'queued');
  expect(waiting, 'the home says the run failed, but this send will still run when the laptop wakes').toHaveLength(0);
}, 20_000);
