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
    } catch (e: any) {
      code = e?.code;
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

  it('rejects an illegal transition (start on done) and reopen clears completedAt', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.completeTask(t.id, { idempotencyKey: 'k1' });
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k2' });
    } catch (e: any) {
      code = e?.code;
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
    } catch (e: any) {
      code = e?.code;
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
    q.updateTask(t.id, { status: 'done' } as any);
    expect(q.getTask(t.id)!.status).toBe('in_progress');
  });
});
