import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { coordinateLifecycleChange } from '@/lib/sessions/workstream';

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

interface CoordDetails {
  requiresChoice?: boolean;
  stopFailed?: boolean;
  running?: { executionId: string; otherTasks: { id: string; title: string; status: string }[] }[];
}
function detailsOf(e: unknown): CoordDetails | undefined {
  return (e as { details?: CoordDetails })?.details;
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

  it('task lifecycle is independent of execution lifecycle', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);

    // Completing / archiving / returning the task never blocks on, stops, or
    // detaches the associated execution — the association is durable context.
    const done = q.completeTask(task.id, { idempotencyKey: 'c1' });
    expect(done?.toStatus).toBe('done');
    expect(q.getExecution(exec.id)?.status).toBe('active');
    expect(q.getExecutionTasks(exec.id).map((t) => t.id)).toEqual([task.id]);

    q.transitionTask({ taskId: task.id, command: 'reopen', idempotencyKey: 'r1' });
    q.transitionTask({ taskId: task.id, command: 'archive', idempotencyKey: 'a1' });
    expect(q.getExecution(exec.id)?.status).toBe('active'); // still running
    expect(q.getExecutionTasks(exec.id).map((t) => t.id)).toEqual([task.id]); // still associated
  });

  it('createExecutionWithChat atomically associates + starts, rolling back a terminal race', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const task = q.createTask({ title: 'T', rawInput: 'x' });
    const { execution } = q.createExecutionWithChat({ workspaceId: wsId, agentId: agent.id, label: null, startTask: { taskId: task.id, idempotencyKey: 'start-1' } });
    expect(q.getTask(task.id)!.status).toBe('in_progress');
    expect(q.getExecutionTasks(execution.id).map((t) => t.id)).toEqual([task.id]);

    // Starting a terminal task rolls back the association AND the execution.
    const done = q.createTask({ title: 'D', rawInput: 'y' });
    q.completeTask(done.id, { idempotencyKey: 'c1' });
    let code: string | undefined;
    try {
      q.createExecutionWithChat({ workspaceId: wsId, agentId: agent.id, label: null, startTask: { taskId: done.id, idempotencyKey: 'start-2' } });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('conflict');
    expect(q.getTaskExecutions(done.id)).toHaveLength(0); // rolled back
    expect(q.getTask(done.id)!.status).toBe('done'); // unchanged
  });

  it('getTaskContinueTargets returns active associated executions with a session, excluding archived', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const task = q.createTask({ title: 'T', rawInput: 'x' });

    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    q.attachExecutionToTask(exec.id, task.id);
    expect(q.getTaskContinueTargets(task.id).map((t) => t.sessionId)).toEqual([session.id]);

    // An archived execution is history, never a Continue target.
    const arch = q.createExecution({ workspaceId: wsId });
    q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: arch.id, label: null, status: 'active' });
    q.attachExecutionToTask(arch.id, task.id);
    q.archiveExecution(arch.id);
    expect(q.getTaskContinueTargets(task.id).map((t) => t.executionId)).toEqual([exec.id]);
  });

  it('coordination requires an explicit choice for a genuinely running workstream', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const b = q.createTask({ title: 'B', rawInput: 'b' });
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    q.attachExecutionToTask(exec.id, a.id);
    q.attachExecutionToTask(exec.id, b.id);

    const notified: string[] = [];
    let stopFail = false;
    const runtime = {
      async runningSessionIds() { return [session.id]; },
      async stopExecution() { return stopFail ? { ok: false, failures: ['boom'] } : { ok: true, failures: [] }; },
      async notify(executionId: string) { notified.push(executionId); },
    };

    // No choice -> requiresChoice conflict, disclosing the running workstream and
    // its collateral task B.
    let details: CoordDetails | undefined;
    try {
      await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', runtime });
    } catch (e) {
      details = detailsOf(e);
      expect(codeOf(e)).toBe('active_execution');
    }
    expect(details?.requiresChoice).toBe(true);
    expect(details?.running?.[0]?.executionId).toBe(exec.id);
    expect(details?.running?.[0]?.otherTasks?.map((t) => t.id)).toEqual([b.id]);

    // keep_running -> notifies, proceeds.
    await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', choice: 'keep_running', change: { taskId: a.id, taskTitle: 'A', action: 'completed' }, runtime });
    expect(notified).toEqual([exec.id]);

    // stop_running_agent success -> proceeds; failure -> throws and blocks.
    await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', choice: 'stop_running_agent', runtime });
    stopFail = true;
    let stopFailed = false;
    try {
      await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', choice: 'stop_running_agent', runtime });
    } catch (e) {
      stopFailed = detailsOf(e)?.stopFailed === true;
    }
    expect(stopFailed).toBe(true);

    // Move to Consider is a hard reject while running (no keep/stop choice).
    let uncommitCode: string | undefined;
    try {
      await coordinateLifecycleChange({ taskId: a.id, kind: 'uncommit', runtime });
    } catch (e) {
      uncommitCode = codeOf(e);
    }
    expect(uncommitCode).toBe('active_execution');
  });

  it('coordination re-verifies the exact disclosed execution set', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    q.attachExecutionToTask(exec.id, a.id);
    const runtime = {
      async runningSessionIds() { return [session.id]; },
      async stopExecution() { return { ok: true, failures: [] }; },
      async notify() {},
    };
    // The disclosed set matches the live set -> proceeds.
    await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', choice: 'stop_running_agent', acknowledgedExecutionIds: [exec.id], runtime });
    // A stale disclosed set -> re-disclose (conflict), never stop an undisclosed agent.
    let code: string | undefined;
    try {
      await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', choice: 'stop_running_agent', acknowledgedExecutionIds: ['someone-else'], runtime });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('active_execution');
  });

  it('coordination fails honest (conflict) when liveness is unknown and a task has an active association', async () => {
    const { q, wsId } = await setup();
    const a = q.createTask({ title: 'A', rawInput: 'a' });
    const exec = q.createExecution({ workspaceId: wsId }); // active
    q.attachExecutionToTask(exec.id, a.id);
    const unknown = {
      async runningSessionIds() { return null; }, // server unreachable
      async stopExecution() { return { ok: true, failures: [] }; },
      async notify() {},
    };
    let code: string | undefined;
    try {
      await coordinateLifecycleChange({ taskId: a.id, kind: 'displace', runtime: unknown });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('conflict');

    // A task with no active association proceeds even when liveness is unknown.
    const b = q.createTask({ title: 'B', rawInput: 'b' });
    await coordinateLifecycleChange({ taskId: b.id, kind: 'displace', runtime: unknown });
  });

  it('coordination is a no-op when nothing is genuinely running', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'A', rawInput: 'a' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);
    const runtime = {
      async runningSessionIds() { return []; }, // associated but not running
      async stopExecution() { return { ok: true, failures: [] }; },
      async notify() {},
    };
    // No throw, no choice needed — an association is not live work.
    await coordinateLifecycleChange({ taskId: task.id, kind: 'displace', runtime });
    await coordinateLifecycleChange({ taskId: task.id, kind: 'uncommit', runtime });
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

  it('return_to_todo at the DB layer is pure — it never touches the execution', async () => {
    const { q, wsId } = await setup();
    const task = q.createTask({ title: 'Owned', rawInput: 'x' });
    q.transitionTask({ taskId: task.id, command: 'start', idempotencyKey: 's1' });
    const exec = q.createExecution({ workspaceId: wsId });
    q.attachExecutionToTask(exec.id, task.id);

    // The runtime keep/stop choice is coordinated at the route; the durable
    // transition itself just returns the task to Todo and leaves the execution
    // and its association intact.
    const out = q.transitionTask({ taskId: task.id, command: 'return_to_todo', idempotencyKey: 'rt1' });
    expect(out.toStatus).toBe('todo');
    expect(q.getExecution(exec.id)?.status).toBe('active');
    expect(q.getExecutionTasks(exec.id).map((t) => t.id)).toEqual([task.id]);
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

  it('review badge respects association time — output older than the association does not flag', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });

    // Output produced far in the past.
    q.insertChatEvent({ id: 'old-out', sessionId: session.id, role: 'assistant', source: 'agent', content: 'old', createdAt: '2000-01-01T00:00:00.000Z' });

    // A task associated NOW (after that output) does not inherit its review.
    const late = q.createTask({ title: 'Late', rawInput: 'x' });
    q.attachExecutionToTask(exec.id, late.id);
    expect(q.getTaskAttentionSignals(late.id).review).toBe(false);

    // Fresh output after the association DOES flag it.
    q.insertChatEvent({ id: 'new-out', sessionId: session.id, role: 'assistant', source: 'agent', content: 'new', createdAt: '2999-01-01T00:00:00.000Z' });
    expect(q.getTaskAttentionSignals(late.id).review).toBe(true);
  });

  it('nested subagent narration is never the review target', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    // A subagent-launch tool call + a subagent output nested under it.
    q.insertChatEvent({ id: 'launch', sessionId: session.id, role: 'assistant', source: 'tool_call', toolName: 'Task', externalToolCallId: 'call-1', createdAt: '2999-01-01T00:00:00.000Z' });
    q.insertChatEvent({ id: 'sub-out', sessionId: session.id, role: 'assistant', source: 'agent', content: 'subagent line', externalParentToolCallId: 'call-1', createdAt: '2999-01-02T00:00:00.000Z' });

    // The only outcome-source event is nested subagent narration -> nothing to review.
    expect(q.getExecutionReviewContext(exec.id).latestOutputEventId).toBeNull();

    // A top-level output IS reviewable.
    q.insertChatEvent({ id: 'top-out', sessionId: session.id, role: 'assistant', source: 'agent', content: 'final', createdAt: '2999-01-03T00:00:00.000Z' });
    expect(q.getExecutionReviewContext(exec.id).latestOutputEventId).toBe('top-out');
  });

  it('accept-and-complete is atomic and refuses to complete over newer output', async () => {
    const { q, wsId } = await setup();
    const agent = q.getOrCreateDefaultExecutor('claude_code');
    const exec = q.createExecution({ workspaceId: wsId });
    const session = q.createChatSession({ type: 'execution', agentId: agent.id, workspaceId: wsId, executionId: exec.id, label: null, status: 'active' });
    const task = q.createTask({ title: 'T', rawInput: 'x' });
    q.attachExecutionToTask(exec.id, task.id);
    q.insertChatEvent({ id: 'out-1', sessionId: session.id, role: 'assistant', source: 'agent', content: 'done', createdAt: '2999-01-01 00:00:00' });

    // Latest output + eligible task -> review recorded AND task completed, in one
    // step, execution untouched.
    const res = q.acceptOutputAndCompleteTask({ executionId: exec.id, outputEventId: 'out-1', taskId: task.id, idempotencyKey: 'ac1' });
    expect(res.review.disposition).toBe('accepted');
    expect(res.task!.status).toBe('done');
    expect(q.getExecution(exec.id)?.status).toBe('active');

    // Newer output arrives; reopen the task. Accepting the OLD event is a
    // conflict and records neither the review nor the completion.
    q.insertChatEvent({ id: 'out-2', sessionId: session.id, role: 'assistant', source: 'agent', content: 'more', createdAt: '2999-01-02 00:00:00' });
    q.transitionTask({ taskId: task.id, command: 'reopen', idempotencyKey: 'ro' });
    const reviewsBefore = q.getExecutionReviews(exec.id).length;
    let code: string | undefined;
    try {
      q.acceptOutputAndCompleteTask({ executionId: exec.id, outputEventId: 'out-1', taskId: task.id, idempotencyKey: 'ac2' });
    } catch (e) {
      code = codeOf(e);
    }
    expect(code).toBe('conflict');
    expect(q.getExecutionReviews(exec.id).length).toBe(reviewsBefore); // review not recorded
    expect(q.getTask(task.id)!.status).toBe('todo'); // task not completed
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
