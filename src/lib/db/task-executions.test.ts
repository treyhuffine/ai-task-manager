import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DB = path.join(os.tmpdir(), `flow-task-exec-test-${process.pid}.db`);

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
  const ws = q.createWorkspace({ name: 'Test WS', cwd: '/tmp/flow-test-ws' });
  return { q, wsId: ws.id };
}

describe('task-owned executions', () => {
  it('owns tasks many-to-many: an execution can own several tasks, a task several executions', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Do the thing', rawInput: 'x' });
    const other = q.createTask({ title: 'Other', rawInput: 'y' });
    const exec = q.createExecution({ workspaceId: wsId });
    const exec2 = q.createExecution({ workspaceId: wsId });

    q.attachExecutionToTask(exec.id, task.id);
    expect(q.getTaskExecutions(task.id).map((e) => e.id)).toEqual([exec.id]);

    // Idempotent re-attach of the same pair.
    const a = q.attachExecutionToTask(exec.id, task.id);
    const b = q.attachExecutionToTask(exec.id, task.id);
    expect(a.id).toBe(b.id);
    expect(q.getTaskExecutions(task.id)).toHaveLength(1);

    // Same execution can also own a SECOND task (a batch with shared context).
    q.attachExecutionToTask(exec.id, other.id);
    expect(q.getExecutionTasks(exec.id).map((t) => t.id).sort()).toEqual([task.id, other.id].sort());

    // A task can be worked by a SECOND execution.
    q.attachExecutionToTask(exec2.id, task.id);
    expect(q.getTaskExecutions(task.id).map((e) => e.id).sort()).toEqual([exec.id, exec2.id].sort());

    // Detach removes just that pair.
    expect(q.detachExecutionFromTask(exec.id, other.id)).toBe(true);
    expect(q.getExecutionTasks(exec.id).map((t) => t.id)).toEqual([task.id]);
    expect(q.detachExecutionFromTask(exec.id, other.id)).toBe(false);
  });

  it('blocks archiving a task with a live owning execution, unless coordinated', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned task', rawInput: 'x' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);

    // Archive is refused while an agent owns and is live.
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: task.id, command: 'archive', idempotencyKey: 'a1' });
    } catch (e: any) {
      code = e?.code;
    }
    expect(code).toBe('active_execution');
    expect(q.getTask(task.id)!.status).not.toBe('archived');

    // Coordinated stop archives the execution AND the task together.
    const out = q.transitionTask({ taskId: task.id, command: 'archive', idempotencyKey: 'a2', stopOwningExecutions: true });
    expect(out.toStatus).toBe('archived');
    expect(q.getExecution(exec.id)!.status).toBe('archived');
    expect(q.getTaskLifecycleSignals(task.id).hasLiveExecution).toBe(false);
  });

  it('blocks completing a task with a live owning execution', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);
    let code: string | undefined;
    try {
      q.completeTask(task.id, { idempotencyKey: 'c1' });
    } catch (e: any) {
      code = e?.code;
    }
    expect(code).toBe('active_execution');
  });

  it('records review dispositions against an exact output event, newest wins', async () => {
    const { q, wsId } = await setup();
    const exec = q.createExecution({ workspaceId: wsId });
    const r1 = q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-1', disposition: 'changes_requested', note: 'tweak it' });
    expect(r1.disposition).toBe('changes_requested');
    q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-1', disposition: 'accepted' });
    q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-2', disposition: 'dismissed' });

    expect(q.getLatestOutputReview('evt-1')!.disposition).toBe('accepted');
    expect(q.getLatestOutputReview('evt-2')!.disposition).toBe('dismissed');
    expect(q.getLatestOutputReview('evt-missing')).toBeNull();
    expect(q.getExecutionReviews(exec.id)).toHaveLength(3);
  });

  it('surfaces the blocked signal from an unresolved blocker task', async () => {
    const { q } = await setup();
    const blocker = q.createTask({ title: 'Blocker', rawInput: 'b' });
    const dependent = q.createTask({ title: 'Dependent', rawInput: 'd' });
    q.updateTask(dependent.id, { blockedOn: blocker.id });
    expect(q.getTaskLifecycleSignals(dependent.id).blocked).toBe(true);

    // Completing the blocker resolves the dependency.
    q.completeTask(blocker.id, { idempotencyKey: 'bc' });
    expect(q.getTaskLifecycleSignals(dependent.id).blocked).toBe(false);
  });
});
