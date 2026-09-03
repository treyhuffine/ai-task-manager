import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';

const TEST_DB = path.join(os.tmpdir(), `flow-task-transitions-test-${process.pid}.db`);

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
beforeEach(() => {
  cleanup();
  process.env.FLOW_DB_PATH = TEST_DB;
  process.env.FLOW_MIRROR_DISABLED = '1';
});
afterAll(cleanup);

async function setup() {
  const dbmod = await import('@/lib/db');
  dbmod.resetDb();
  dbmod.getDb();
  const q = await import('@/lib/db/queries');
  const schema = await import('@/lib/db/schema');
  return { q, db: dbmod.getDb(), schema };
}

describe('lifecycle command chokepoint (transitionTask / completeTask)', () => {
  it('creates todo at count 0, and each transition bumps the count + stamps age', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    expect(t.status).toBe('todo');
    expect(t.statusChangedCount).toBe(0);
    expect(t.statusChangedAt).toBeTruthy();

    const s = q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    expect(s.fromStatus).toBe('todo');
    expect(s.toStatus).toBe('in_progress');
    expect(s.statusChangedCount).toBe(1);
    expect(s.replayed).toBe(false);
  });

  it('replays an idempotent retry instead of re-applying', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    const again = q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    expect(again.replayed).toBe(true);
    expect(again.statusChangedCount).toBe(1);
  });

  it('rejects a stale expected count with a conflict', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' }); // now count 1
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'return_to_todo', idempotencyKey: 'k2', expectedStatusChangedCount: 0 });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('conflict');
  });

  it('completes non-recurring to done, and a retry never duplicates completion history', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    const c = q.completeTask(t.id, { idempotencyKey: 'k2' });
    expect(c!.toStatus).toBe('done');
    expect(c!.statusChangedCount).toBe(2);
    const cAgain = q.completeTask(t.id, { idempotencyKey: 'k2' });
    expect(cAgain!.replayed).toBe(true);
    const completions = db.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, t.id)).all();
    expect(completions).toHaveLength(1);
  });

  it('recurring completion records one occurrence, advances, and returns to Todo', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'Water', rawInput: 'x', recurrence: 'weekly' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    const c = q.completeTask(t.id, { idempotencyKey: 'k2' });
    expect(c!.recurring).toBe(true);
    expect(c!.toStatus).toBe('todo');
    expect(q.getTask(t.id)!.status).toBe('todo');
    expect(q.getTask(t.id)!.nextRecurrenceAt).toBeTruthy();
    const completions = db.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, t.id)).all();
    expect(completions).toHaveLength(1);
  });

  it('recurring Todo->Todo completion advances the lifecycle revision', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'Water', rawInput: 'x', recurrence: 'weekly' });
    expect(t.statusChangedCount).toBe(0); // created Todo
    const c = q.completeTask(t.id, { idempotencyKey: 'k1' });
    // Stored status stays Todo, but the revision still advances so a concurrent
    // or duplicate completion is detectable.
    expect(c!.toStatus).toBe('todo');
    expect(c!.statusChangedCount).toBe(1);
    expect(q.getTask(t.id)!.statusChangedCount).toBe(1);
  });

  it('recurring completion preserves cadence phase when completed very late', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'Weekly', rawInput: 'x', recurrence: 'weekly' });
    // A scheduled occurrence far in the past, on a known weekday (Wed).
    const anchor = '2024-01-03T09:00:00.000Z';
    db.update(schema.tasks).set({ nextRecurrenceAt: anchor }).where(eq(schema.tasks.id, t.id)).run();
    const c = q.completeTask(t.id, { idempotencyKey: 'k1' });
    const next = new Date(c!.nextRecurrenceAt!);
    expect(next.getTime()).toBeGreaterThan(Date.now()); // landed in the future
    expect(next.getUTCDay()).toBe(new Date(anchor).getUTCDay()); // same weekday (phase kept)
    // And it is a whole number of weeks from the anchor, not reset to now+7.
    const days = Math.round((next.getTime() - new Date(anchor).getTime()) / 86_400_000);
    expect(days % 7).toBe(0);
  });

  it('monthly recurrence clamps to the last day of the month (Jan 31 -> Feb 28)', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'Monthly', rawInput: 'x', recurrence: 'monthly' });
    // A future scheduled occurrence so it advances exactly once.
    db.update(schema.tasks).set({ nextRecurrenceAt: '2027-01-31T12:00:00.000Z' }).where(eq(schema.tasks.id, t.id)).run();
    const c = q.completeTask(t.id, { idempotencyKey: 'k1' });
    expect(c!.nextRecurrenceAt!.startsWith('2027-02-28')).toBe(true);
  });

  it('completing/archiving a parent with open children needs an exact acknowledgement', async () => {
    const { q } = await setup();
    const parent = q.createTask({ title: 'Parent', rawInput: 'p' });
    const child = q.createTask({ title: 'Child', rawInput: 'c', parentId: parent.id });

    // Without acknowledgement -> conflict disclosing the open child.
    let details: { requiresChildAck?: boolean; openChildren?: { id: string }[] } | undefined;
    try {
      q.completeTask(parent.id, { idempotencyKey: 'p1' });
    } catch (e) {
      details = (e as { details?: typeof details }).details;
      expect((e as { code?: string }).code).toBe('conflict');
    }
    expect(details?.requiresChildAck).toBe(true);
    expect(details?.openChildren?.map((c) => c.id)).toEqual([child.id]);

    // A stale/wrong acknowledgement is still rejected.
    let staleCode: string | undefined;
    try {
      q.completeTask(parent.id, { idempotencyKey: 'p2', acknowledgedChildIds: ['nonexistent'] });
    } catch (e) {
      staleCode = (e as { code?: string }).code;
    }
    expect(staleCode).toBe('conflict');

    // The exact open-child set proceeds, leaving the child unchanged.
    const done = q.completeTask(parent.id, { idempotencyKey: 'p3', acknowledgedChildIds: [child.id] });
    expect(done!.toStatus).toBe('done');
    expect(q.getTask(child.id)!.status).toBe('todo'); // child untouched

    // A completed child no longer gates the parent.
    q.completeTask(child.id, { idempotencyKey: 'cc' });
    q.transitionTask({ taskId: parent.id, command: 'reopen', idempotencyKey: 're' });
    const arch = q.transitionTask({ taskId: parent.id, command: 'archive', idempotencyKey: 'ar' });
    expect(arch.toStatus).toBe('archived');
  });

  it('rejects a parent assignment that would create a cycle', async () => {
    const { q } = await setup();
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const b = q.createTask({ title: 'B', rawInput: 'b', parentId: a.id });

    // Self-parenting is rejected.
    let selfCode: string | undefined;
    try {
      q.updateTask(a.id, { parentId: a.id });
    } catch (e) {
      selfCode = (e as { code?: string }).code;
    }
    expect(selfCode).toBe('invalid_params');

    // Making A a child of its own descendant B would cycle -> rejected.
    let cycleCode: string | undefined;
    try {
      q.updateTask(a.id, { parentId: b.id });
    } catch (e) {
      cycleCode = (e as { code?: string }).code;
    }
    expect(cycleCode).toBe('invalid_params');
  });

  it('monthly recurrence stays end-of-month across short months (Feb 28 -> Mar 31)', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'M', rawInput: 'x', recurrence: 'monthly' });
    // End of February (a short month) — the next occurrence should return to the
    // last day of the next month, not stick at the 28th.
    db.update(schema.tasks).set({ nextRecurrenceAt: '2027-02-28T12:00:00.000Z' }).where(eq(schema.tasks.id, t.id)).run();
    const c = q.completeTask(t.id, { idempotencyKey: 'k1' });
    expect(c!.nextRecurrenceAt!.startsWith('2027-03-31')).toBe(true);
  });

  it('review gating compares timestamps as instants, not strings, across formats', async () => {
    const { q, db, schema } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const wsId = q.createWorkspace({ name: 'W', cwd: '/tmp/w-ts' }).id;
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    const task = q.createTask({ title: 'T', rawInput: 'x' });
    q.attachExecutionToTask(exec.id, task.id);
    // Pin the association + task epoch to a known ISO instant.
    const anchor = '2026-09-03T11:00:00.000Z';
    db.update(schema.executionTasks).set({ createdAt: anchor }).where(eq(schema.executionTasks.taskId, task.id)).run();
    db.update(schema.tasks).set({ statusChangedAt: anchor }).where(eq(schema.tasks.id, task.id)).run();
    // Output ONE HOUR LATER, in SQLite space-format (no zone). A lexicographic
    // compare would call it "before" the ISO anchor (space < T); as an instant
    // it is after -> review.
    q.insertChatEvent({ id: 'o1', sessionId: session.id, role: 'assistant', source: 'agent', content: 'done', createdAt: '2026-09-03 12:00:00' });
    expect(q.getTaskAttentionSignals(task.id).review).toBe(true);
  });

  it('a setup failure flags Stalled even with no running session', async () => {
    const { q, db, schema } = await setup();
    const wsId = q.createWorkspace({ name: 'W', cwd: '/tmp/w-st' }).id;
    const exec = q.createExecution({ workspaceId: wsId });
    // A setup failure leaves the execution active but not running.
    db.update(schema.executions).set({ setupError: 'boom' }).where(eq(schema.executions.id, exec.id)).run();
    const task = q.createTask({ title: 'T', rawInput: 'x' });
    q.attachExecutionToTask(exec.id, task.id);
    expect(q.getTaskAttentionSignals(task.id).stalled).toBe(true);
  });

  it('lifecyclePreflight validates without applying and detects replay', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });

    // A valid, unseen command: applicable, not a replay, and NOT yet applied.
    expect(q.lifecyclePreflight({ taskId: t.id, command: 'start', idempotencyKey: 'k1' })).toEqual({ replay: false });
    expect(q.getTask(t.id)!.status).toBe('todo'); // preflight didn't apply anything

    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    // Same key -> replay (so the route skips runtime coordination).
    expect(q.lifecyclePreflight({ taskId: t.id, command: 'start', idempotencyKey: 'k1' })).toEqual({ replay: true });

    // Stale revision -> conflict, before any runtime effect.
    let code: string | undefined;
    try {
      q.lifecyclePreflight({ taskId: t.id, command: 'return_to_todo', idempotencyKey: 'k2', expectedStatusChangedCount: 0 });
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe('conflict');

    // Open children surface the child-ack conflict at preflight too.
    const parent = q.createTask({ title: 'P', rawInput: 'p' });
    q.createTask({ title: 'C', rawInput: 'c', parentId: parent.id });
    let childCode: string | undefined;
    try {
      q.lifecyclePreflight({ taskId: parent.id, command: 'complete' });
    } catch (e) {
      childCode = (e as { code?: string }).code;
    }
    expect(childCode).toBe('conflict');
  });

  it('reusing an idempotency key for a different command is a conflict', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'shared' });
    // Same key, different command -> conflict, not a silent replay of "start".
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'archive', idempotencyKey: 'shared' });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('conflict');
    // And reusing it for complete is likewise rejected.
    let completeCode: string | undefined;
    try {
      q.completeTask(t.id, { idempotencyKey: 'shared' });
    } catch (e) {
      completeCode = (e as { code?: string })?.code;
    }
    expect(completeCode).toBe('conflict');
  });

  it('rejects an illegal transition (start on done) and reopen clears completedAt', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.completeTask(t.id, { idempotencyKey: 'k1' });
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k2' });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('invalid_transition');
    q.transitionTask({ taskId: t.id, command: 'reopen', idempotencyKey: 'k3' });
    const reopened = q.getTask(t.id)!;
    expect(reopened.status).toBe('todo');
    expect(reopened.completedAt).toBeNull();
  });

  it('rejects Todo -> Consider while a commitment-bearing field is present', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    db.update(schema.tasks).set({ hardDeadline: '2026-12-31' }).where(eq(schema.tasks.id, t.id)).run();
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'move_to_consider', idempotencyKey: 'k1' });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('consider_precondition');
  });

  it('records exactly one ledger row per applied command (none for replays or errors)', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' }); // replay
    q.completeTask(t.id, { idempotencyKey: 'k2' });
    try {
      q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k3' }); // invalid on done
    } catch {
      /* expected */
    }
    const rows = db.select().from(schema.taskStatusChanges).where(eq(schema.taskStatusChanges.taskId, t.id)).all();
    expect(rows.map((r) => `${r.command}:${r.fromStatus}->${r.toStatus}`)).toEqual([
      'start:todo->in_progress',
      'complete:in_progress->done',
    ]);
  });

  it('generic updateTask never changes status', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1' });
    // Attempt a status change through the generic path.
    q.updateTask(t.id, { status: 'done' } as Parameters<typeof q.updateTask>[1]);
    expect(q.getTask(t.id)!.status).toBe('in_progress');
  });
});
