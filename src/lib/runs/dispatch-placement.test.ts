/**
 * One scheduler, on the home (spec §7, P3.4). A scheduled fire starts new
 * work on the home even when the agent's default computer is elsewhere, and
 * never sends it somewhere else instead: an agent with no folder here fails
 * the fire, saying why. A fire into an execution that already runs on
 * another computer goes there, and waits while that computer is away.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { installFakeHarness, type FakeHarness } from '@/test/fixtures/fake-harness';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';
import type { WorkerHarnessReport } from '@/db/types';

const HARNESSES: WorkerHarnessReport[] = [
  { harness: 'claude', binary: { status: 'supported', version: '9.9.9' }, capabilities: { sessions: { supported: true } } } as WorkerHarnessReport,
];

let home: TestHome;
let fake: FakeHarness;
let hostId: string;
let laptopId: string;
let agentId: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-schedule-placement-' });
  const identity = await import('@/lib/home/identity');
  identity.resetHomeIdentityCache();
  hostId = identity.ensureHomeIdentity().home.hostComputerId!;
  const q = await import('@/lib/db/queries');
  q.updateComputer(hostId, { name: 'Mac Mini' });
  const grant = q.createComputerGrant({ kind: 'enroll', computerId: null, computerName: 'MacBook', createdByApiKeyId: null });
  laptopId = q.redeemEnrollGrant({ secret: grant.secret, name: 'MacBook' }).computer.id;
  q.recordWorkerHeartbeat(laptopId, { protocol: WORKER_PROTOCOL, version: 'test', harnesses: HARNESSES, state: 'awake' });
  agentId = q.createWorkspace({ name: 'Ri', cwd: home.root, isGit: false, filesToCopy: [], collapsed: false, skipLiveConfirm: false, browserEnabled: false }).id;
  fake = installFakeHarness('claude');
});

afterEach(async () => {
  fake.restore();
  (await import('@/lib/workers/hub'))._resetWorkerHub();
  (await import('@/lib/executor/adapter'))._resetExecutorState();
  (await import('./rate-lease'))._resetApiLeaseState();
  (await import('@/lib/home/identity')).resetHomeIdentityCache();
  await home.cleanup();
});

async function setUpOn(computerId: string) {
  const q = await import('@/lib/db/queries');
  q.recordAgentSetupReports(computerId, [{
    agentId, sourcePath: computerId === hostId ? home.root : '/Users/trey/code/ri', configRevision: null,
    status: 'ready', problem: null, references: [],
  }], { complete: true });
}

let scheduled = 0;
async function schedule(kind: 'cron' | 'at' = 'cron') {
  const q = await import('@/lib/db/queries');
  return q.createTrigger({
    name: `Sweep ${++scheduled}`,
    workspaceId: agentId,
    targetKind: 'workspace',
    harness: 'claude',
    prompt: 'Sweep the inbox',
    ...(kind === 'cron' ? { kind: 'cron', cronExpression: '0 9 * * *' } : { kind: 'at', runAt: new Date().toISOString() }),
  });
}

/** The agent's executions, archived ones included. */
function executionsOf(q: typeof import('@/lib/db/queries')): string[] {
  return [...new Set(q.listWorkspaceExecutions(agentId, { includeArchived: true }).map((s) => s.executionId!))];
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

describe('a scheduled fire', () => {
  it("starts on the home even when the agent's default computer is the laptop", async () => {
    await setUpOn(hostId);
    await setUpOn(laptopId);
    const { setDefaultComputer } = await import('@/lib/setups/run-on');
    setDefaultComputer(agentId, laptopId);
    const q = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');
    for (const kind of ['cron', 'at'] as const) {
      const { run, chatSession } = await dispatchRun({ trigger: await schedule(kind), triggerKind: kind, scheduledFor: new Date().toISOString() });
      expect(q.getRun(run.id)?.status).toMatch(/running|completed/);
      expect(q.chatPlacement(chatSession!.id)).toMatchObject({ computerId: hostId, isHome: true });
      await until(() => q.getRun(run.id)?.status === 'completed', `the ${kind} run to finish`);
    }
    expect(q.listWorkerCommands(laptopId)).toEqual([]);
  });

  it("fails, saying why, for an agent that isn't set up on the home, and starts nothing anywhere", async () => {
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');
    const trigger = await schedule();
    const { run, chatSession } = await dispatchRun({ trigger, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
    expect(chatSession).toBeNull();
    expect(run).toMatchObject({
      status: 'failed',
      errorCode: 'not_set_up_here',
      errorMessage: "Ri isn't set up on Mac Mini, where scheduled work runs. Attach its folder there to run this.",
    });
    expect(q.getTrigger(trigger.id)).toMatchObject({ lastRunStatus: 'failed', consecutiveFailures: 1, owningExecutionId: null });
    expect(executionsOf(q)).toEqual([]);
    expect(q.listWorkerCommands(laptopId)).toEqual([]);
  });

  it('still runs at home for an agent from before setups', async () => {
    const q = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');
    const { run } = await dispatchRun({ trigger: await schedule(), triggerKind: 'cron', scheduledFor: new Date().toISOString() });
    await until(() => q.getRun(run.id)?.status === 'completed', 'the run to finish');
  });

  it('goes to the computer its execution runs on, and waits there while that computer is away', async () => {
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { deliveriesForChat } = await import('@/lib/workers/delivery');
    const { dispatchRun } = await import('./dispatch');
    const trigger = await schedule();
    const created = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'Sweeps' });
    q.createPlacement({ executionId: created.execution.id, computerId: laptopId, startReason: 'created', worktreePath: '/Users/trey/code/ri' });
    q.updateTrigger(trigger.id, { owningExecutionId: created.execution.id });

    const { run, chatSession } = await dispatchRun({ trigger: q.getTrigger(trigger.id)!, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
    expect(chatSession!.executionId).toBe(created.execution.id);
    await until(() => q.listWorkerCommands(laptopId).some((c) => c.kind === 'send'), 'the send to be queued for the laptop');
    const send = q.listWorkerCommands(laptopId).find((c) => c.kind === 'send')!;
    expect(send.state).toBe('queued');
    const [delivery] = Object.values(deliveriesForChat(chatSession!.id));
    expect(delivery).toMatchObject({ state: 'waiting', computerName: 'MacBook' });
    // Waiting, not failed, and not started a second time at home.
    expect(q.getRun(run.id)?.status).toBe('running');
    expect(executionsOf(q)).toEqual([created.execution.id]);
    expect(fake.sessions).toEqual([]);
  });

  it("doesn't hold one of the home's API leases while it waits for the laptop", async () => {
    await setUpOn(laptopId);
    const q = await import('@/lib/db/queries');
    const { acquireApiLease, releaseApiLease } = await import('./rate-lease');
    const { dispatchRun } = await import('./dispatch');
    const created = q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: 'Sweeps' });
    q.createPlacement({ executionId: created.execution.id, computerId: laptopId, startReason: 'created', worktreePath: '/Users/trey/code/ri' });
    // Five sweeps into five executions on the sleeping laptop, more than the four leases.
    for (let i = 0; i < 5; i++) {
      const trigger = await schedule();
      const execution = i === 0 ? created.execution : q.createExecutionWithChat({ workspaceId: agentId, harness: 'claude', label: `Sweeps ${i}` }).execution;
      if (i > 0) q.createPlacement({ executionId: execution.id, computerId: laptopId, startReason: 'created', worktreePath: '/Users/trey/code/ri' });
      q.updateTrigger(trigger.id, { owningExecutionId: execution.id });
      await dispatchRun({ trigger: q.getTrigger(trigger.id)!, triggerKind: 'cron', scheduledFor: new Date().toISOString() });
    }
    await until(() => q.listWorkerCommands(laptopId).filter((c) => c.kind === 'send').length === 5, 'all five sends to wait for the laptop');
    // Every lease is still free for work at home.
    const granted = await Promise.race([
      Promise.all([0, 1, 2, 3].map(() => acquireApiLease())).then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), 200)),
    ]);
    expect(granted).toBe(true);
    for (let i = 0; i < 4; i++) releaseApiLease();
  });
});
