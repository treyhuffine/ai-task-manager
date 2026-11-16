import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { eq } from 'drizzle-orm';
import { todayLocalDate } from '@/lib/deck/date';

const TEST_DB = path.join(os.tmpdir(), `ri-task-transitions-test-${process.pid}.db`);

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

/** A calendar date `n` days after another, by day math. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

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

    const s = q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(s.fromStatus).toBe('todo');
    expect(s.toStatus).toBe('in_progress');
    expect(s.statusChangedCount).toBe(1);
    expect(s.replayed).toBe(false);
  });

  it('replays an idempotent retry instead of re-applying', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    const again = q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(again.replayed).toBe(true);
    expect(again.statusChangedCount).toBe(1);
  });

  it('rejects a stale expected count with a conflict', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } }); // now count 1
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'return_to_todo', idempotencyKey: 'k2', expectedStatusChangedCount: 0, meta: { source: 'human' } });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('conflict');
  });

  it('completes non-recurring to done, and a retry never duplicates completion history', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    const c = q.completeTask(t.id, { idempotencyKey: 'k2', meta: { source: 'human' } });
    expect(c!.toStatus).toBe('done');
    expect(c!.statusChangedCount).toBe(2);
    const cAgain = q.completeTask(t.id, { idempotencyKey: 'k2', meta: { source: 'human' } });
    expect(cAgain!.replayed).toBe(true);
    const completions = db.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, t.id)).all();
    expect(completions).toHaveLength(1);
  });

  it('recurring completion records one occurrence, advances, and returns to Todo', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'Water', rawInput: 'x', recurrence: 'weekly' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    const c = q.completeTask(t.id, { idempotencyKey: 'k2', meta: { source: 'human' } });
    expect(c!.recurring).toBe(true);
    expect(c!.toStatus).toBe('todo');
    expect(q.getTask(t.id)!.status).toBe('todo');
    // No schedule yet: the first completion sets it, one week from local today.
    expect(q.getTask(t.id)!.nextRecurrenceAt).toBe(addDays(todayLocalDate(), 7));
    const completions = db.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, t.id)).all();
    expect(completions).toHaveLength(1);
  });

  it('recurring Todo->Todo completion advances the lifecycle revision', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'Water', rawInput: 'x', recurrence: 'weekly' });
    expect(t.statusChangedCount).toBe(0); // created Todo
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
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
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    // A calendar date after local today, never an overdue one.
    expect(c!.nextRecurrenceAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c!.nextRecurrenceAt! > todayLocalDate()).toBe(true);
    const next = new Date(`${c!.nextRecurrenceAt}T00:00:00Z`);
    expect(next.getUTCDay()).toBe(3); // same weekday as the anchor (phase kept)
    // And it is a whole number of weeks from the anchor, not reset to now+7.
    const days = Math.round((next.getTime() - Date.UTC(2024, 0, 3)) / 86_400_000);
    expect(days % 7).toBe(0);
    expect(c!.nextRecurrenceAt! <= addDays(todayLocalDate(), 7)).toBe(true);
  });

  it('monthly recurrence clamps to the last day of the month (Jan 31 -> Feb 28)', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'Monthly', rawInput: 'x', recurrence: 'monthly' });
    // A future scheduled occurrence so it advances exactly once.
    db.update(schema.tasks).set({ nextRecurrenceAt: '2027-01-31T12:00:00.000Z' }).where(eq(schema.tasks.id, t.id)).run();
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(c!.nextRecurrenceAt).toBe('2027-02-28');
  });

  it('completing/archiving a parent with open children needs an exact acknowledgement', async () => {
    const { q } = await setup();
    const parent = q.createTask({ title: 'Parent', rawInput: 'p' });
    const child = q.createTask({ title: 'Child', rawInput: 'c', parentId: parent.id });

    // Without acknowledgement -> conflict disclosing the open child.
    let details: { requiresChildAck?: boolean; openChildren?: { id: string }[] } | undefined;
    try {
      q.completeTask(parent.id, { idempotencyKey: 'p1', meta: { source: 'human' } });
    } catch (e) {
      details = (e as { details?: typeof details }).details;
      expect((e as { code?: string }).code).toBe('conflict');
    }
    expect(details?.requiresChildAck).toBe(true);
    expect(details?.openChildren?.map((c) => c.id)).toEqual([child.id]);

    // A stale/wrong acknowledgement is still rejected.
    let staleCode: string | undefined;
    try {
      q.completeTask(parent.id, { idempotencyKey: 'p2', acknowledgedChildIds: ['nonexistent'], meta: { source: 'human' } });
    } catch (e) {
      staleCode = (e as { code?: string }).code;
    }
    expect(staleCode).toBe('conflict');

    // The exact open-child set proceeds, leaving the child unchanged.
    const done = q.completeTask(parent.id, { idempotencyKey: 'p3', acknowledgedChildIds: [child.id], meta: { source: 'human' } });
    expect(done!.toStatus).toBe('done');
    expect(q.getTask(child.id)!.status).toBe('todo'); // child untouched

    // A completed child no longer gates the parent.
    q.completeTask(child.id, { idempotencyKey: 'cc', meta: { source: 'human' } });
    q.transitionTask({ taskId: parent.id, command: 'reopen', idempotencyKey: 're', meta: { source: 'human' } });
    const arch = q.transitionTask({ taskId: parent.id, command: 'archive', idempotencyKey: 'ar', meta: { source: 'human' } });
    expect(arch.toStatus).toBe('archived');
  });

  it('rejects a parent assignment that would create a cycle', async () => {
    const { q } = await setup();
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const b = q.createTask({ title: 'B', rawInput: 'b', parentId: a.id });

    // Self-parenting is rejected.
    let selfCode: string | undefined;
    try {
      q.updateTask(a.id, { parentId: a.id }, { source: 'human' });
    } catch (e) {
      selfCode = (e as { code?: string }).code;
    }
    expect(selfCode).toBe('invalid_params');

    // Making A a child of its own descendant B would cycle -> rejected.
    let cycleCode: string | undefined;
    try {
      q.updateTask(a.id, { parentId: b.id }, { source: 'human' });
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
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(c!.nextRecurrenceAt).toBe('2027-03-31');
  });

  it('review gating compares timestamps as instants, not strings, across formats', async () => {
    const { q, db, schema } = await setup();
    const wsId = q.createWorkspace({ name: 'W', cwd: '/tmp/w-ts', isGit: false }).id;
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', harness: 'claude', workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
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
    const wsId = q.createWorkspace({ name: 'W', cwd: '/tmp/w-st', isGit: false }).id;
    const exec = q.createExecution({ workspaceId: wsId });
    // A setup failure leaves the execution active but not running.
    db.update(schema.executions).set({ setupError: 'boom' }).where(eq(schema.executions.id, exec.id)).run();
    const task = q.createTask({ title: 'T', rawInput: 'x' });
    q.attachExecutionToTask(exec.id, task.id);
    expect(q.getTaskAttentionSignals(task.id).stalled).toBe(true);
  });

  it('points "open the agent" at the running chat, else an active one, and shows a running turn as Working', async () => {
    const { q } = await setup();
    const wsId = q.createWorkspace({ name: 'W', cwd: '/tmp/w-open', isGit: false }).id;
    const task = q.createTask({ title: 'T', rawInput: 'x' });
    expect(q.getTaskAttentionSignals(task.id).agentSessionId).toBeNull();

    const exec = q.createExecution({ workspaceId: wsId });
    const primary = q.createChatSession({ type: 'execution', harness: 'claude', workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    const sibling = q.createChatSession({ type: 'execution', harness: 'claude', workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    q.attachExecutionToTask(exec.id, task.id);

    // Idle between turns: the execution's active chat, and not Working.
    const idle = q.getTaskAttentionSignals(task.id, new Set());
    expect(idle.working).toBe(false);
    expect([primary.id, sibling.id]).toContain(idle.agentSessionId);

    // A turn running in the sibling chat: that chat, and Working.
    const running = q.getTaskAttentionSignals(task.id, new Set([sibling.id]));
    expect(running.working).toBe(true);
    expect(running.agentSessionId).toBe(sibling.id);

    // Output to review while a new turn runs: both are true, so both show.
    // Without the running set, an active association alone is not "doing
    // something", and the update wins.
    q.insertChatEvent({ id: 'out-1', sessionId: sibling.id, role: 'assistant', source: 'agent', content: 'progress', createdAt: new Date(Date.now() + 60_000).toISOString() });
    const busy = q.getTaskAttentionSignals(task.id, new Set([sibling.id]));
    expect(busy.review).toBe(true);
    expect(busy.working).toBe(true);
    const durable = q.getTaskAttentionSignals(task.id);
    expect(durable.review).toBe(true);
    expect(durable.working).toBe(false);

    // Archived work is history: nothing to open.
    q.archiveExecution(exec.id);
    expect(q.getTaskAttentionSignals(task.id, new Set()).agentSessionId).toBeNull();
  });

  it('lifecyclePreflight validates without applying and detects replay', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });

    // A valid, unseen command: applicable, not a replay, and NOT yet applied.
    expect(q.lifecyclePreflight({ taskId: t.id, command: 'start', idempotencyKey: 'k1' })).toEqual({ replay: false });
    expect(q.getTask(t.id)!.status).toBe('todo'); // preflight didn't apply anything

    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
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

  it('reorderTaskInLane normalizes null keys and places a card at the requested position', async () => {
    const { q } = await setup();
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const b = q.createTask({ title: 'B', rawInput: 'b' });
    const c = q.createTask({ title: 'C', rawInput: 'c' });
    expect(a.sortKey ?? null).toBeNull(); // fresh tasks have no sort key

    // Move A to the very top (before the current first card). Null keys across
    // the lane are normalized, and A lands before C.
    const { sortKey } = q.reorderTaskInLane(a.id, null, c.id);
    const cKey = q.getTask(c.id)!.sortKey!;
    expect(sortKey < cKey).toBe(true);
    expect([a.id, b.id, c.id].every((id) => q.getTask(id)!.sortKey != null)).toBe(true);

    // Two previously-null cards can now actually be reordered relative to each other.
    q.reorderTaskInLane(b.id, a.id, c.id);
    const bKey = q.getTask(b.id)!.sortKey!;
    expect(q.getTask(a.id)!.sortKey! < bKey).toBe(true);
    expect(bKey < q.getTask(c.id)!.sortKey!).toBe(true);
  });

  it('reusing an idempotency key for a different command is a conflict', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'shared', meta: { source: 'human' } });
    // Same key, different command -> conflict, not a silent replay of "start".
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'archive', idempotencyKey: 'shared', meta: { source: 'human' } });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('conflict');
    // And reusing it for complete is likewise rejected.
    let completeCode: string | undefined;
    try {
      q.completeTask(t.id, { idempotencyKey: 'shared', meta: { source: 'human' } });
    } catch (e) {
      completeCode = (e as { code?: string })?.code;
    }
    expect(completeCode).toBe('conflict');
  });

  it('rejects an illegal transition (start on done) and reopen clears completedAt', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k2', meta: { source: 'human' } });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('invalid_transition');
    q.transitionTask({ taskId: t.id, command: 'reopen', idempotencyKey: 'k3', meta: { source: 'human' } });
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
      q.transitionTask({ taskId: t.id, command: 'move_to_consider', idempotencyKey: 'k1', meta: { source: 'human' } });
    } catch (e) {
      code = (e as { code?: string })?.code;
    }
    expect(code).toBe('consider_precondition');
  });

  it('records exactly one ledger row per applied command (none for replays or errors)', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } }); // replay
    q.completeTask(t.id, { idempotencyKey: 'k2', meta: { source: 'human' } });
    try {
      q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k3', meta: { source: 'human' } }); // invalid on done
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
    q.transitionTask({ taskId: t.id, command: 'start', idempotencyKey: 'k1', meta: { source: 'human' } });
    // Attempt a status change through the generic path.
    q.updateTask(t.id, { status: 'done' } as Parameters<typeof q.updateTask>[1], { source: 'human' });
    expect(q.getTask(t.id)!.status).toBe('in_progress');
  });

  it('deletes completion history with a task, but rolls it back when a remaining reference refuses deletion', async () => {
    const { q, db, schema } = await setup();
    const task = q.createTask({ title: 'Completed', rawInput: 'Completed' });
    q.completeTask(task.id, { idempotencyKey: 'complete', meta: { source: 'human' } });
    const note = q.createNote({ body: 'Keep reference', taskId: task.id });
    const history = () => db.select().from(schema.taskCompletions).where(eq(schema.taskCompletions.taskId, task.id)).all();
    expect(history()).toHaveLength(1);
    expect(() => q.deleteTask(task.id)).toThrow(/FOREIGN KEY/);
    expect(history()).toHaveLength(1);
    expect(q.getTask(task.id)).toBeDefined();
    q.deleteNote(note.id);
    expect(q.deleteTask(task.id)).toBe(true);
    expect(history()).toHaveLength(0);
    expect(q.getTask(task.id)).toBeUndefined();
  });
});

describe('repeating tasks', () => {
  it('a daily task done tonight is Ready from the start of tomorrow, on the local calendar', async () => {
    const { q } = await setup();
    const { isReady } = await import('@/lib/tasks/lifecycle');
    const t = q.createTask({ title: 'Stretch', rawInput: 'x', recurrence: 'daily' });
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    const tomorrow = addDays(todayLocalDate(), 1);
    expect(c!.nextRecurrenceAt).toBe(tomorrow);
    const after = q.getTask(t.id)!;
    const readyAt = (now: Date) => isReady({ status: after.status, hasUnresolvedBlocker: false, resurfaceAfter: null, recurrence: after.recurrence, nextRecurrenceAt: after.nextRecurrenceAt, now: now.toISOString() });
    const [y, m, d] = tomorrow.split('-').map(Number);
    expect(readyAt(new Date(y, m - 1, d - 1, 23, 59))).toBe(false);
    expect(readyAt(new Date(y, m - 1, d, 0, 1))).toBe(true);
  });

  it('moves the deadline to the next occurrence and ends a snooze', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'Pay property tax', rawInput: 'x', recurrence: 'Yearly' });
    // The Notion import wrote some deadlines as instants.
    db.update(schema.tasks).set({ hardDeadline: '2027-01-21T00:00:00.000Z', resurfaceAfter: addDays(todayLocalDate(), 3) }).where(eq(schema.tasks.id, t.id)).run();
    q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    const after = q.getTask(t.id)!;
    expect(after.hardDeadline).toBe('2028-01-21');
    expect(after.resurfaceAfter).toBeNull();
  });

  it('a long-stale deadline lands on its first future date, not still overdue', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'Quarterly filing', rawInput: 'x', recurrence: 'Quarterly', hardDeadline: '2024-01-12' });
    q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    const deadline = q.getTask(t.id)!.hardDeadline!;
    expect(deadline > todayLocalDate()).toBe(true);
    expect(deadline <= addDays(todayLocalDate(), 92)).toBe(true);
    expect(deadline.slice(8)).toBe('12');
  });

  it('done late with its next deadline still ahead, it stays Ready and keeps its lead', async () => {
    const { q } = await setup();
    const { isReady } = await import('@/lib/tasks/lifecycle');
    const today = todayLocalDate();
    // Scheduled 9 days ago, due 5 days ago: last week's occurrence is late, and
    // this week's opened 2 days ago with its deadline 2 days ahead.
    const t = q.createTask({ title: 'Weekly report', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: addDays(today, -9), hardDeadline: addDays(today, -5) });
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(c!.nextRecurrenceAt).toBe(addDays(today, -2));
    const after = q.getTask(t.id)!;
    expect(after.hardDeadline).toBe(addDays(today, 2));
    expect(isReady({ status: after.status, hasUnresolvedBlocker: false, resurfaceAfter: null, recurrence: after.recurrence, nextRecurrenceAt: after.nextRecurrenceAt, now: new Date().toISOString() })).toBe(true);
  });

  it('follows the cadence in agent-written wording, not a weekly guess', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'Renew library card', rawInput: 'x', recurrence: 'Every 2 years, verify', nextRecurrenceAt: '2027-03-01' });
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(c!.nextRecurrenceAt).toBe('2029-03-01');
  });

  it('done early, the next occurrence is still a full interval after the scheduled one', async () => {
    const { q } = await setup();
    const scheduled = addDays(todayLocalDate(), 5);
    const t = q.createTask({ title: 'Water', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: scheduled });
    const c = q.completeTask(t.id, { idempotencyKey: 'k1', meta: { source: 'human' } });
    expect(c!.nextRecurrenceAt).toBe(addDays(scheduled, 7));
  });
});

describe('repeat writes', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      return { code: (e as { code?: string }).code, message: (e as Error).message };
    }
    return null;
  };

  it('refuses a cadence Ri cannot follow, with what to write instead', async () => {
    const { q } = await setup();
    expect(code(() => q.createTask({ title: 'X', rawInput: 'x', recurrence: 'every Monday and Thursday' })))
      .toMatchObject({ code: 'invalid_params', message: expect.stringMatching(/use weekly/) });
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    expect(code(() => q.updateTask(t.id, { recurrence: 'FREQ=WEEKLY;BYDAY=MO' }, { source: 'ai' }))).toMatchObject({ code: 'invalid_params' });
    expect(q.getTask(t.id)!.recurrence).toBeNull();
  });

  it('keeps an unreadable recurrence already stored, so a restore or an echoed field still saves', async () => {
    const { q, db, schema } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x' });
    db.update(schema.tasks).set({ recurrence: 'every Tuesday' }).where(eq(schema.tasks.id, t.id)).run();
    expect(q.updateTask(t.id, { title: 'Y', recurrence: 'every Tuesday' }, { source: 'ai' })!.title).toBe('Y');
  });

  it('stores the text as written, trimmed, and blank as none', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x', recurrence: '  Yearly, only if applicable ' });
    expect(t.recurrence).toBe('Yearly, only if applicable');
    expect(q.updateTask(t.id, { recurrence: '   ' }, { source: 'human' })!.recurrence).toBeNull();
  });

  it('keeps the next occurrence as a calendar date and refuses one that is not a date', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: '2026-12-05T09:00:00.000Z' });
    expect(t.nextRecurrenceAt).toBe('2026-12-05');
    expect(code(() => q.updateTask(t.id, { nextRecurrenceAt: 'next friday' }, { source: 'ai' }))).toMatchObject({ code: 'invalid_params' });
    expect(code(() => q.updateTask(t.id, { nextRecurrenceAt: '2026-02-30' }, { source: 'ai' }))).toMatchObject({ code: 'invalid_params' });
    expect(q.updateTask(t.id, { nextRecurrenceAt: '' }, { source: 'human' })!.nextRecurrenceAt).toBeNull();
  });

  it('ending a repeat drops its next occurrence, and changing the cadence keeps it', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'X', rawInput: 'x', recurrence: 'weekly', nextRecurrenceAt: '2026-12-05' });
    expect(q.updateTask(t.id, { recurrence: '2w' }, { source: 'human' })!.nextRecurrenceAt).toBe('2026-12-05');
    const ended = q.updateTask(t.id, { recurrence: null }, { source: 'human' })!;
    expect(ended.recurrence).toBeNull();
    expect(ended.nextRecurrenceAt).toBeNull();
  });

  it('a Consider task still cannot repeat', async () => {
    const { q } = await setup();
    const t = q.createTask({ title: 'Maybe', rawInput: 'x', status: 'consider' });
    expect(code(() => q.updateTask(t.id, { recurrence: 'weekly' }, { source: 'human' }))).toMatchObject({ code: 'consider_precondition' });
    expect(q.updateTask(t.id, { recurrence: '' }, { source: 'human' })!.recurrence).toBeNull();
  });
});
