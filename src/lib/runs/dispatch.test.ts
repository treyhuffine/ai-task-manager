/**
 * End-to-end dispatch behaviors against a clean in-memory DB. Mocks
 * `@agentex/agent` so the test never spawns a real agent — we exercise
 * the dispatcher's resolveTarget / mutex / skip / runs-row logic, not
 * the executor itself.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';

// Stub agentex before any module imports it transitively.
vi.mock('@agentex/agent', () => ({
  getProvider: () => ({
    capabilities: { concurrentSend: true },
    createSession: vi.fn(),
  }),
  listInstalledSkills: vi.fn(async () => ({})),
  commandInventoryFromEvent: () => null,
}));
vi.mock('@/lib/executor/adapter', () => ({
  dispatch: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 20));
  }),
  abort: vi.fn(async () => {}),
  ExecutorError: class extends Error {},
}));

const TEST_DB = path.join(os.tmpdir(), `flow-dispatch-test-${process.pid}.db`);

// The first test in this file pays the full cold migration cost in its body;
// under full-suite parallel-worker CPU contention that can exceed the 5s
// default and flake. Give DB-backed cases headroom (still a real ceiling).
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

beforeEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  process.env.FLOW_DB_PATH = TEST_DB;
});

afterAll(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
});

async function seed() {
  const { getDb, resetDb } = await import('@/lib/db');
  resetDb();
  const db = getDb();
  const { uuidv7 } = await import('uuidv7');
  const { workspaces, agents } = await import('@/lib/db/schema');
  const wsId = uuidv7();
  db.insert(workspaces).values({
    id: wsId,
    name: 'TestWs',
    slug: 'testws-' + Date.now(),
    cwd: '/tmp/testws',
    isGit: false,
  }).run();
  const agentId = uuidv7();
  db.insert(agents).values({
    id: agentId,
    userId: 'local',
    kind: 'executor',
    name: 'Test',
    harness: 'claude_code',
    config: {},
    status: 'active',
  }).run();
  return { db, wsId, agentId };
}

describe('dispatchRun', () => {
  it('recurring workspace schedule: first fire creates execution, second reuses it with a new chat', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const recur = queries.createSchedule({
      name: 'morning-triage',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'Triage',
      kind: 'cron',
      cronExpression: '0 9 * * 1-5',
    });

    const r1 = await dispatchRun({
      schedule: recur,
      trigger: 'cron',
      scheduledFor: new Date().toISOString(),
    });
    expect(r1.run.executionId).toBeTruthy();

    const owners = queries.findSchedulesByOwningExecution(r1.run.executionId!);
    expect(owners.some((s) => s.id === recur.id)).toBe(true);

    // Wait for mock dispatch to finalize the run row.
    await new Promise((r) => setTimeout(r, 100));
    const finalized = queries.getRun(r1.run.id);
    expect(finalized?.status).toBe('completed');

    const recurAfter = queries.getSchedule(recur.id)!;
    const r2 = await dispatchRun({
      schedule: recurAfter,
      trigger: 'cron',
      scheduledFor: new Date().toISOString(),
    });
    expect(r2.run.executionId).toBe(r1.run.executionId);
    expect(r2.chatSession?.id).not.toBe(r1.chatSession?.id);
  });

  it('one-shot (kind=at) workspace schedule creates a fresh execution + chat', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const recur = queries.createSchedule({
      name: 'recurring',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'Recurring',
      kind: 'cron',
      cronExpression: '* * * * *',
    });
    const first = await dispatchRun({ schedule: recur, trigger: 'cron' });
    await new Promise((r) => setTimeout(r, 100));

    const oneoff = queries.createSchedule({
      name: 'tomorrow-9am',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'X',
      kind: 'at',
      runAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const oneoffFire = await dispatchRun({ schedule: oneoff, trigger: 'at' });
    expect(oneoffFire.run.executionId).toBeTruthy();
    expect(oneoffFire.run.executionId).not.toBe(first.run.executionId);

    const ownsRecur = queries.findSchedulesByOwningExecution(oneoffFire.run.executionId!);
    expect(ownsRecur).toEqual([]);
  });

  it('orchestrator-target schedule fires create chats with executionId NULL', async () => {
    const { agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const orch = queries.createSchedule({
      name: 'morning-summary',
      workspaceId: null,
      targetKind: 'orchestrator',
      agentId,
      prompt: 'Summarize',
      kind: 'cron',
      cronExpression: '0 9 * * 1-5',
    });
    const r = await dispatchRun({ schedule: orch, trigger: 'cron' });
    expect(r.run.executionId).toBeNull();
    expect(r.chatSession?.executionId).toBeNull();
    expect(r.chatSession?.type).toBe('orchestration');
  });

  it('skip_if_running: second fire while first is running is recorded as skipped', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const sched = queries.createSchedule({
      name: 'busy',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'X',
      kind: 'cron',
      cronExpression: '* * * * *',
      concurrencyPolicy: 'skip_if_running',
    });
    const fireA = await dispatchRun({ schedule: sched, trigger: 'cron' });
    // No wait — fire again while A is still running.
    const fireB = await dispatchRun({
      schedule: { ...sched, owningExecutionId: fireA.run.executionId },
      trigger: 'cron',
    });
    expect(fireB.run.status).toBe('skipped');
    expect(fireB.run.statusReason).toBeTruthy();
  });

  it('coalesce_if_active: second fire appends a marker message to the active chat and records skipped+chat', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const sched = queries.createSchedule({
      name: 'morning-triage',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'Triage stream items',
      kind: 'cron',
      cronExpression: '* * * * *',
      concurrencyPolicy: 'coalesce_if_active',
    });
    const fireA = await dispatchRun({ schedule: sched, trigger: 'cron' });
    // Second fire while A is still running.
    const fireB = await dispatchRun({
      schedule: { ...sched, owningExecutionId: fireA.run.executionId },
      trigger: 'cron',
    });

    expect(fireB.run.status).toBe('skipped');
    expect(fireB.run.statusReason).toBe('coalesced_into_active');
    expect(fireB.run.chatSessionId).toBe(fireA.run.chatSessionId);

    const events = queries.listChatEvents(fireA.run.chatSessionId!);
    const marker = events.find((e) => e.role === 'user' && /from schedule morning-triage/.test(e.content ?? ''));
    expect(marker).toBeDefined();
  });

  it('honors schedule.timeoutSeconds: a slow executor is interrupted and the run lands as failed with errorCode=timeout', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const adapter = await import('@/lib/executor/adapter');
    const { dispatchRun } = await import('./dispatch');

    // 2s slow vs 1s timeout — timer wins.
    (adapter.dispatch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => { await new Promise((r) => setTimeout(r, 2000)); },
    );
    (adapter.abort as unknown as ReturnType<typeof vi.fn>).mockClear();

    const sched = queries.createSchedule({
      name: 'tight-timeout',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'X',
      kind: 'cron',
      cronExpression: '* * * * *',
      timeoutSeconds: 1,
    });
    const fire = await dispatchRun({ schedule: sched, trigger: 'cron' });
    await new Promise((r) => setTimeout(r, 1500));

    const after = queries.getRun(fire.run.id)!;
    expect(after.status).toBe('failed');
    expect(after.errorCode).toBe('timeout');
    expect(after.errorMessage).toMatch(/exceeded 1s/);
    expect(adapter.abort).toHaveBeenCalledWith(fire.run.chatSessionId);
  });

  it('treats timeoutSeconds=0 as no timeout (run completes when the executor returns)', async () => {
    const { agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const adapter = await import('@/lib/executor/adapter');
    const { dispatchRun } = await import('./dispatch');

    (adapter.dispatch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async () => { await new Promise((r) => setTimeout(r, 50)); },
    );

    const sched = queries.createSchedule({
      name: 'no-timeout',
      targetKind: 'orchestrator',
      agentId,
      prompt: 'X',
      kind: 'cron',
      cronExpression: '* * * * *',
      timeoutSeconds: 0,
    });
    const fire = await dispatchRun({ schedule: sched, trigger: 'cron' });
    await new Promise((r) => setTimeout(r, 150));
    const after = queries.getRun(fire.run.id)!;
    expect(after.status).toBe('completed');
  });

  it('allow_concurrent on a workspace target is degraded to skip (executions-spec §5)', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const sched = queries.createSchedule({
      name: 'parallel-ws',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'X',
      kind: 'cron',
      cronExpression: '* * * * *',
      concurrencyPolicy: 'allow_concurrent',
    });
    const fireA = await dispatchRun({ schedule: sched, trigger: 'cron' });
    const fireB = await dispatchRun({
      schedule: { ...sched, owningExecutionId: fireA.run.executionId },
      trigger: 'cron',
    });
    // V1 doesn't honor allow_concurrent for workspace targets — second
    // fire is skipped just like skip_if_running.
    expect(fireB.run.status).toBe('skipped');
    expect(fireB.run.statusReason).toBe('schedule_busy');
  });

  it('allow_concurrent on an orchestrator target spawns a second run', async () => {
    const { agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const sched = queries.createSchedule({
      name: 'parallel-orch',
      targetKind: 'orchestrator',
      agentId,
      prompt: 'X',
      kind: 'cron',
      cronExpression: '* * * * *',
      concurrencyPolicy: 'allow_concurrent',
    });
    const fireA = await dispatchRun({ schedule: sched, trigger: 'cron' });
    const fireB = await dispatchRun({ schedule: sched, trigger: 'cron' });
    // Orchestrator targets have no shared worktree — allow_concurrent
    // does what it says. Re-read since `dispatchRun` returns the
    // initial 'queued' snapshot.
    const liveB = queries.getRun(fireB.run.id);
    expect(liveB?.status).not.toBe('skipped');
    expect(fireB.run.chatSessionId).not.toBe(fireA.run.chatSessionId);
  });

  it('cross-schedule sharing one execution: B with skip_if_running is skipped, not coalesced', async () => {
    const { wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const schedA = queries.createSchedule({
      name: 'sched-a',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'A',
      kind: 'cron',
      cronExpression: '* * * * *',
      concurrencyPolicy: 'coalesce_if_active',
    });
    const fireA = await dispatchRun({ schedule: schedA, trigger: 'cron' });

    const schedB = queries.createSchedule({
      name: 'sched-b',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'B',
      kind: 'cron',
      cronExpression: '* * * * *',
      // B shares A's execution. Its policy says skip — should be
      // honored even though the blocker is a different schedule.
      concurrencyPolicy: 'skip_if_running',
      owningExecutionId: fireA.run.executionId,
    });
    const fireB = await dispatchRun({ schedule: schedB, trigger: 'cron' });
    expect(fireB.run.status).toBe('skipped');
    expect(fireB.run.statusReason).toBe('execution_busy');
  });

  it('scheduled run persists the prompt as a user chat_event in the transcript', async () => {
    const { agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');

    const sched = queries.createSchedule({
      name: 'with-transcript',
      targetKind: 'orchestrator',
      agentId,
      prompt: 'Triage the inbox',
      kind: 'cron',
      cronExpression: '* * * * *',
    });
    const fire = await dispatchRun({ schedule: sched, trigger: 'cron' });
    await new Promise((r) => setTimeout(r, 80));

    const events = queries.listChatEvents(fire.run.chatSessionId!);
    const userMsg = events.find((e) => e.role === 'user' && e.source === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toBe('Triage the inbox');
  });

  it('crash recovery: reapStaleRunningRuns marks ghost runs failed', async () => {
    const { db, wsId, agentId } = await seed();
    const queries = await import('@/lib/db/queries');
    const { dispatchRun } = await import('./dispatch');
    const { runs } = await import('@/lib/db/schema');

    const sched = queries.createSchedule({
      name: 'recoverable',
      workspaceId: wsId,
      targetKind: 'workspace',
      agentId,
      prompt: 'X',
      kind: 'cron',
      cronExpression: '* * * * *',
    });
    const r = await dispatchRun({ schedule: sched, trigger: 'cron' });
    await new Promise((wait) => setTimeout(wait, 100));
    // Synthetically resurrect to `running` to simulate a crash leaving it stuck.
    db.update(runs).set({ status: 'running' }).where(eq(runs.id, r.run.id)).run();

    const reaped = queries.reapStaleRunningRuns();
    expect(reaped).toBeGreaterThan(0);
    const after = queries.getRun(r.run.id)!;
    expect(after.status).toBe('failed');
    expect(after.errorCode).toBe('process_restart');
  });
});
