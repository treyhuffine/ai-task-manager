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

/** The stable lifecycle error code off a thrown error, if any. */
function codeOf(e: unknown): string | undefined {
  return (e as { code?: string })?.code;
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
    } catch (e) {
      code = codeOf(e);
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
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('active_execution');
  });

  it('accept-and-complete: stopOwningExecutions completes the task, stops the owner, and reports it', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);

    const result = q.completeTask(task.id, { idempotencyKey: 'cc1', stopOwningExecutions: true });
    expect(result?.toStatus).toBe('done');
    // The coordinated stop reports the execution it displaced (the route reaps
    // its runtime after commit) and the row is durably archived in the same tx.
    expect(result?.stoppedExecutionIds).toEqual([exec.id]);
    expect(q.getExecution(exec.id)?.status).toBe('archived');
    // No live owner remains -> nothing more to reap.
    expect(q.getTaskLifecycleSignals(task.id).hasLiveExecution).toBe(false);
  });

  it('archive with stopOwningExecutions reports the stopped owner; without it, refuses', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);

    let code: string | undefined;
    try {
      q.transitionTask({ taskId: task.id, command: 'archive', idempotencyKey: 'a0' });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('active_execution');

    const result = q.transitionTask({ taskId: task.id, command: 'archive', idempotencyKey: 'a1', stopOwningExecutions: true });
    expect(result.toStatus).toBe('archived');
    expect(result.stoppedExecutionIds).toEqual([exec.id]);
    expect(q.getExecution(exec.id)?.status).toBe('archived');
  });

  it('a coordinated stop releases only the changed task; a shared execution keeps running', async () => {
    const { q, wsId } = await setup();
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const b = q.createTask({ title: 'B', rawInput: 'b' });
    const exec = q.createExecution({ workspaceId: wsId });
    // One execution coordinating two tasks (a batch with shared context).
    q.attachExecutionToTask(exec.id, a.id);
    q.attachExecutionToTask(exec.id, b.id);

    // Completing A with a coordinated stop must NOT kill the execution still
    // working B — it releases only A's claim.
    const result = q.completeTask(a.id, { idempotencyKey: 'ca', stopOwningExecutions: true });
    expect(result?.toStatus).toBe('done');
    expect(result?.stoppedExecutionIds).toEqual([]); // nothing stopped -> nothing to reap
    expect(q.getExecution(exec.id)?.status).toBe('active'); // still running
    expect(q.getExecutionTasks(exec.id).map((t) => t.id)).toEqual([b.id]); // only B remains claimed
    expect(q.getTaskLifecycleSignals(a.id).hasLiveExecution).toBe(false); // A released

    // Now B is the sole task: stopping for B archives the execution.
    const rb = q.transitionTask({ taskId: b.id, command: 'archive', idempotencyKey: 'ab', stopOwningExecutions: true });
    expect(rb.stoppedExecutionIds).toEqual([exec.id]);
    expect(q.getExecution(exec.id)?.status).toBe('archived');
  });

  it('a replay reports no newly stopped executions', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);
    const first = q.completeTask(task.id, { idempotencyKey: 'dup', stopOwningExecutions: true });
    expect(first?.stoppedExecutionIds).toEqual([exec.id]);
    const replay = q.completeTask(task.id, { idempotencyKey: 'dup', stopOwningExecutions: true });
    expect(replay?.replayed).toBe(true);
    expect(replay?.stoppedExecutionIds).toEqual([]);
  });

  it('rejects commitment-bearing fields on a Consider task, allows clearing and plain edits', async () => {
    const { q } = await setup();
    const task = q.createTask({ title: 'Idea', rawInput: 'x' });
    q.transitionTask({ taskId: task.id, command: 'move_to_consider', idempotencyKey: 'k1' });

    for (const [field, value] of [
      ['hardDeadline', '2026-12-01T00:00:00.000Z'],
      ['recurrence', 'weekly'],
      ['reminderAt', '2026-12-01T00:00:00.000Z'],
    ] as const) {
      let code: string | undefined;
      try {
        q.updateTask(task.id, { [field]: value } as Parameters<typeof q.updateTask>[1]);
      } catch (e) {
        code = codeOf(e);
      }
      expect(code).toBe('consider_precondition');
    }

    // Clearing to null is fine, and non-commitment edits still apply.
    expect(() => q.updateTask(task.id, { hardDeadline: null })).not.toThrow();
    expect(q.updateTask(task.id, { title: 'Renamed idea' })?.title).toBe('Renamed idea');
  });

  it('rejects creating a Consider task that carries a commitment field', async () => {
    const { q } = await setup();
    let code: string | undefined;
    try {
      q.createTask({ title: 'Idea', rawInput: 'x', status: 'consider', hardDeadline: '2026-12-01T00:00:00.000Z' });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('consider_precondition');
    // Without the commitment field it creates fine.
    expect(q.createTask({ title: 'Idea', rawInput: 'x', status: 'consider' }).status).toBe('consider');
  });

  it('move_to_consider rejects a task that still has a reminder', async () => {
    const { q } = await setup();
    const task = q.createTask({ title: 'Has reminder', rawInput: 'x', reminderAt: '2026-12-01T00:00:00.000Z' });
    let code: string | undefined;
    try {
      q.transitionTask({ taskId: task.id, command: 'move_to_consider', idempotencyKey: 'r1' });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('consider_precondition');
  });

  it('return_to_todo is refused over a live owning execution unless coordinated', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    q.transitionTask({ taskId: task.id, command: 'start', idempotencyKey: 's1' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);

    let code: string | undefined;
    try {
      q.transitionTask({ taskId: task.id, command: 'return_to_todo', idempotencyKey: 'rt0' });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('active_execution');

    const out = q.transitionTask({ taskId: task.id, command: 'return_to_todo', idempotencyKey: 'rt1', stopOwningExecutions: true });
    expect(out.toStatus).toBe('todo');
    expect(out.stoppedExecutionIds).toEqual([exec.id]);
    expect(q.getExecution(exec.id)?.status).toBe('archived');
  });

  it('an archived blocker keeps the dependent blocked; only Done resolves it', async () => {
    const { q } = await setup();
    const blocker = q.createTask({ title: 'Blocker', rawInput: 'b' });
    const dependent = q.createTask({ title: 'Dependent', rawInput: 'd' });
    q.updateTask(dependent.id, { blockedOn: blocker.id });
    expect(q.getTaskLifecycleSignals(dependent.id).blocked).toBe(true);

    // Archiving the blocker does NOT resolve the dependency (it was dropped,
    // not delivered) — the dependent stays blocked.
    q.transitionTask({ taskId: blocker.id, command: 'archive', idempotencyKey: 'ab' });
    expect(q.getTaskLifecycleSignals(dependent.id).blocked).toBe(true);

    // Completing it (restore then complete) does resolve it.
    q.transitionTask({ taskId: blocker.id, command: 'restore', idempotencyKey: 'rb' });
    q.completeTask(blocker.id, { idempotencyKey: 'cb' });
    expect(q.getTaskLifecycleSignals(dependent.id).blocked).toBe(false);
  });

  it('records review dispositions against an exact output event, newest wins', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const exec = q.createExecution({ workspaceId: wsId });
    // A real chat session for the execution, with two genuine output events.
    const session = q.createChatSession({
      type: 'execution',
      agentId: agent.id,
      workspaceId: wsId,
      executionId: exec.id,
      label: null,
      status: 'active',
    });
    q.insertChatEvent({ id: 'evt-1', sessionId: session.id, role: 'assistant', source: 'agent', content: 'first output' });
    q.insertChatEvent({ id: 'evt-2', sessionId: session.id, role: 'assistant', source: 'agent', content: 'second output' });

    const r1 = q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-1', disposition: 'changes_requested', note: 'tweak it' });
    expect(r1.disposition).toBe('changes_requested');
    q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-1', disposition: 'accepted' });
    q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-2', disposition: 'dismissed' });

    expect(q.getLatestOutputReview('evt-1')!.disposition).toBe('accepted');
    expect(q.getLatestOutputReview('evt-2')!.disposition).toBe('dismissed');
    expect(q.getLatestOutputReview('evt-missing')).toBeNull();
    expect(q.getExecutionReviews(exec.id)).toHaveLength(3);

    // A disposition can only target THIS execution's actual output — a foreign
    // or non-output event id is rejected, not silently recorded.
    let rejected: string | undefined;
    try {
      q.reviewExecutionOutput({ executionId: exec.id, outputEventId: 'evt-not-mine', disposition: 'accepted' });
    } catch (e) {
      rejected = codeOf(e);
    }
    expect(rejected).toBe('not_found');
  });

  it('review context names the single owning task; ambiguous when many', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    const other = q.createTask({ title: 'Other', rawInput: 'y' });
    const exec = q.createExecution({ workspaceId: wsId });

    // No ownership, no output yet.
    let ctx = q.getExecutionReviewContext(exec.id);
    expect(ctx.owningTaskId).toBeNull();
    expect(ctx.latestOutputEventId).toBeNull();
    expect(ctx.hasUnreviewedOutput).toBe(false);

    // One owner -> Accept-and-complete is unambiguous.
    q.attachExecutionToTask(exec.id, task.id);
    ctx = q.getExecutionReviewContext(exec.id);
    expect(ctx.owningTaskId).toBe(task.id);
    expect(ctx.owningTaskTitle).toBe('Owned');

    // Two owners -> ambiguous, no single task to accept-and-complete.
    q.attachExecutionToTask(exec.id, other.id);
    expect(q.getExecutionReviewContext(exec.id).owningTaskId).toBeNull();
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
