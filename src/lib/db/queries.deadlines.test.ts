import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `ri-deadlines-test-${process.pid}.db`);

function cleanup() {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}
beforeEach(() => {
  cleanup();
  process.env.RI_DB_PATH = TEST_DB;
  process.env.RI_MIRROR_DISABLED = '1';
});
afterAll(cleanup);

async function setup() {
  const dbmod = await import('@/lib/db');
  dbmod.resetDb();
  dbmod.getDb();
  const q = await import('@/lib/db/queries');
  return { q };
}

/** A bare `YYYY-MM-DD` calendar date `offsetDays` from local today. */
function dateStr(offsetDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const META = { source: 'human' as const };

describe('getDeadlineTasks — deterministic deadline surface', () => {
  it('surfaces overdue and due-today real deadlines, sorted earliest-first, flagged honestly', async () => {
    const { q } = await setup();
    q.createTask({ title: 'Due today', rawInput: 'x', hardDeadline: dateStr(0) });
    q.createTask({ title: 'Overdue 1d', rawInput: 'x', hardDeadline: dateStr(-1) });
    q.createTask({ title: 'Overdue 3d', rawInput: 'x', hardDeadline: dateStr(-3) });

    const rows = q.getDeadlineTasks();
    expect(rows.map((r) => r.title)).toEqual(['Overdue 3d', 'Overdue 1d', 'Due today']);

    const overdue3 = rows.find((r) => r.title === 'Overdue 3d')!;
    expect(overdue3.overdue).toBe(true);
    expect(overdue3.dueToday).toBe(false);
    expect(overdue3.daysUntil).toBe(-3);

    const today = rows.find((r) => r.title === 'Due today')!;
    expect(today.overdue).toBe(false);
    expect(today.dueToday).toBe(true);
    expect(today.daysUntil).toBe(0);
  });

  it('never invents a deadline: a task with no hardDeadline is absent', async () => {
    const { q } = await setup();
    q.createTask({ title: 'Ordinary work', rawInput: 'x' });
    q.createTask({ title: 'Has a deadline', rawInput: 'x', hardDeadline: dateStr(1) });

    const rows = q.getDeadlineTasks();
    expect(rows.map((r) => r.title)).toEqual(['Has a deadline']);
  });

  it('respects the upcoming window but always keeps overdue', async () => {
    const { q } = await setup();
    q.createTask({ title: 'Overdue 30d', rawInput: 'x', hardDeadline: dateStr(-30) });
    q.createTask({ title: 'In 5 days', rawInput: 'x', hardDeadline: dateStr(5) });
    q.createTask({ title: 'In 10 days', rawInput: 'x', hardDeadline: dateStr(10) });

    const def = q.getDeadlineTasks(); // default 7-day window
    expect(def.map((r) => r.title).sort()).toEqual(['In 5 days', 'Overdue 30d']);

    const wide = q.getDeadlineTasks({ withinDays: 14 });
    expect(wide.map((r) => r.title).sort()).toEqual(['In 10 days', 'In 5 days', 'Overdue 30d']);
  });

  it('includes In progress deadlines (not just Ready Todo)', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'Underway deadline', rawInput: 'x', hardDeadline: dateStr(0) });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: META });

    const rows = q.getDeadlineTasks();
    const row = rows.find((r) => r.id === t.id)!;
    expect(row).toBeTruthy();
    expect(row.status).toBe('in_progress');
  });

  it('includes blocked deadlines and reports the blocked flag; a Done blocker resolves it', async () => {
    const { q } = await setup();
    const blocker = q.createTask({ title: 'Blocker', rawInput: 'x' });
    const dep = q.createTask({ title: 'Blocked deadline', rawInput: 'x', hardDeadline: dateStr(1) });
    q.updateTask(dep.id, { blockedOn: blocker.id }, META);

    let row = q.getDeadlineTasks().find((r) => r.id === dep.id)!;
    expect(row).toBeTruthy();
    expect(row.blocked).toBe(true);
    expect(row.blockedOn).toBe(blocker.id);

    // Completing the blocker resolves the dependency; the deadline still shows
    // but is no longer blocked.
    q.transitionTask({ taskId: blocker.id, command: 'start', idempotencyKey: 'kb1', meta: META });
    q.completeTask(blocker.id, { idempotencyKey: 'kb2', meta: META });

    row = q.getDeadlineTasks().find((r) => r.id === dep.id)!;
    expect(row.blocked).toBe(false);
  });

  it('excludes resolved lifecycle states (Done / Archived)', async () => {
    const { q } = await setup();
    const done = q.createTask({ title: 'Finished', rawInput: 'x', hardDeadline: dateStr(0) });
    q.transitionTask({ taskId: done.id, command: 'start', idempotencyKey: 'k1', meta: META });
    q.completeTask(done.id, { idempotencyKey: 'k2', meta: META });

    const archived = q.createTask({ title: 'Dropped', rawInput: 'x', hardDeadline: dateStr(0) });
    q.transitionTask({ taskId: archived.id, command: 'archive', idempotencyKey: 'k3', meta: META });

    const keep = q.createTask({ title: 'Still live', rawInput: 'x', hardDeadline: dateStr(0) });

    const rows = q.getDeadlineTasks();
    expect(rows.map((r) => r.id)).toEqual([keep.id]);
  });
});
