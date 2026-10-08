import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb, getRawDb, resetDb } from '@/lib/db';
import { chatSessions, workResultDecisions, workResultTasks, taskCompletions, taskStatusChanges } from '@/lib/db/schema';
import { attachExecutionToTask, createChatSession, createExecution, createTask, createWorkspace,
  getTask, transitionTask } from '@/lib/db/queries';
import type { WorkResultActor, WorkResultCodeRevision } from '@/db/types';
import { createWorkResult, createWorkResultDecision, getWorkResult } from './queries';
import { setWorkResultCapabilities } from './capabilities';
import { acceptWorkResultAndCompleteTask, getWorkResultCompletionOptions } from './completion-queries';
import { acceptAndCompleteWorkResult } from './completion';
import { POST } from '@/app/api/results/[id]/complete/route';

const runtime = vi.hoisted(() => ({ runningSessionIds: vi.fn(), stopExecution: vi.fn(), notify: vi.fn() }));
const observation = vi.hoisted(() => vi.fn());
const executionObservation = vi.hoisted(() => vi.fn());
vi.mock('@/lib/sessions/workstream-runtime', () => ({ inProcessWorkstreamRuntime: runtime }));
vi.mock('./observe', () => ({ observeWorkResultCodeRevision: observation, observeWorkResultExecutionCodeRevision: executionObservation }));
vi.mock('@/lib/embeddings/embed', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/embeddings/embed')>(),
  upsertEmbedding: vi.fn(async () => {}), deleteEmbedding: vi.fn(),
}));

const human: WorkResultActor = { userId: 'local', source: 'human' };
let root: string;
beforeEach(() => {
  resetDb();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-result-completion-'));
  vi.stubEnv('RI_ROOT', root);
  vi.stubEnv('RI_DB_PATH', path.join(root, 'data.db'));
  vi.stubEnv('RI_CONFIG_DIR', path.join(root, 'config'));
  vi.stubEnv('RI_MIRROR_DISABLED', '1');
  getDb();
  setWorkResultCapabilities({ handoffsEnabled: true, aiReviewEnabled: false });
  runtime.runningSessionIds.mockResolvedValue([]);
  runtime.stopExecution.mockResolvedValue({ ok: true, failures: [] });
  runtime.notify.mockResolvedValue(undefined);
  observation.mockResolvedValue(null);
  executionObservation.mockResolvedValue(null);
});
afterEach(() => {
  resetDb();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function linked(taskIds?: string[]) {
  const task = createTask({ title: 'Deliver the useful outcome' });
  const result = createWorkResult(human, { requestId: 'deliverable', body: 'The saved work.', taskIds: taskIds ?? [task.id] }).result;
  return { task, result, input: { requestId: 'accept-complete', resultId: result.id, expectedStatusChangedCount: task.statusChangedCount } };
}

function codeRevision(commitSha: string, workingTreeState: WorkResultCodeRevision['workingTreeState'] = 'clean'): WorkResultCodeRevision {
  return { commitSha, workingTreeState, capturedAt: '2026-10-07T00:00:00Z' };
}

function author() {
  const workspace = createWorkspace({ name: 'Author', cwd: root, isGit: false });
  const execution = createExecution({ workspaceId: workspace.id });
  const session = createChatSession({ harness: 'claude', type: 'execution', workspaceId: workspace.id, executionId: execution.id });
  return { execution, session };
}

function post(id: string, input: unknown) {
  return POST(new Request(`http://localhost/api/results/${id}/complete`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  }), { params: Promise.resolve({ id }) });
}

describe('atomic exact-result acceptance and task completion', () => {
  it('keeps Accept separate and completes one eligible linked task through the existing lifecycle', () => {
    const { task, result, input } = linked();
    createWorkResultDecision(human, { requestId: 'accept-only', resultId: result.id, disposition: 'accepted' });
    expect(getTask(task.id)?.status).toBe('todo');
    expect(getDb().select().from(taskCompletions).all()).toHaveLength(0);
    const completed = acceptWorkResultAndCompleteTask(human, { ...input, note: 'The outcome is accepted.' });
    expect(completed.completion?.task.status).toBe('done');
    expect(completed.review).toMatchObject({ disposition: 'accepted', actorSource: 'human', actorUserId: 'local' });
    expect(getWorkResult(result.id)?.reviews).toHaveLength(2);
    expect(getDb().select().from(taskStatusChanges).all()[0]).toMatchObject({ command: 'complete', actorSource: 'human', reason: `Accepted saved result ${result.id}` });
  });

  it('requires an explicit choice among eligible linked tasks and rejects unrelated or terminal choices', () => {
    const first = createTask({ title: 'First outcome' });
    const second = createTask({ title: 'Second outcome' });
    const unrelated = createTask({ title: 'Unrelated outcome' });
    const { result, input } = linked([first.id, second.id]);
    expect(() => acceptWorkResultAndCompleteTask(human, input)).toThrow(/Choose the linked task/);
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, taskId: unrelated.id })).toThrow(/eligible linked task/);
    expect(getWorkResult(result.id)?.reviews).toHaveLength(0);
    acceptWorkResultAndCompleteTask(human, { ...input, taskId: second.id });
    expect(getTask(first.id)?.status).toBe('todo');
    expect(getTask(second.id)?.status).toBe('done');
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, requestId: 'terminal', taskId: second.id })).toThrow(/eligible linked task/);
  });

  it('rejects a successor and taskless or Consider results without partial acceptance', () => {
    const { result, input } = linked();
    createWorkResult(human, { requestId: 'replacement', body: 'A meaningful revised handoff.', supersedesId: result.id });
    expect(() => acceptWorkResultAndCompleteTask(human, input)).toThrow(/newer handoff/);
    const taskless = createWorkResult(human, { requestId: 'taskless', body: 'Useful independent findings.', taskIds: [] }).result;
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, resultId: taskless.id })).toThrow(/eligible linked task/);
    const idea = createTask({ title: 'Uncommitted idea', status: 'consider' });
    const ideaResult = createWorkResult(human, { requestId: 'idea', body: 'An option to consider.', taskIds: [idea.id] }).result;
    expect(getWorkResultCompletionOptions(ideaResult.id).choices).toEqual([]);
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, resultId: ideaResult.id })).toThrow(/eligible linked task/);
    expect(getDb().select().from(workResultDecisions).all()).toEqual([]);
    expect(getDb().select().from(taskCompletions).all()).toEqual([]);
  });

  it('does not treat ordinary conversation or an independent handoff as supersession', async () => {
    const { task, result, input } = linked();
    createWorkResult(human, { requestId: 'independent', body: 'An unrelated independent result.', taskIds: [task.id] });
    const completed = await acceptAndCompleteWorkResult(human, input);
    expect(completed.review.resultId).toBe(result.id);
    expect(completed.completion?.task.status).toBe('done');
  });

  it('rejects a known commit or working-copy state mismatch, while dirty-unbound identity stays unknown', () => {
    const task = createTask({ title: 'Code outcome' });
    const saved = createWorkResult(human, { requestId: 'code', body: 'The code handoff.', taskIds: [task.id] }, { codeRevision: codeRevision('saved-sha') }).result;
    const input = { requestId: 'complete-code', resultId: saved.id, expectedStatusChangedCount: 0 };
    expect(() => acceptWorkResultAndCompleteTask(human, input, codeRevision('changed-sha'))).toThrow(/code revision changed/);
    expect(() => acceptWorkResultAndCompleteTask(human, input, codeRevision('saved-sha', 'dirty'))).toThrow(/code revision changed/);
    expect(getWorkResult(saved.id)?.reviews).toEqual([]);
    expect(getTask(task.id)?.status).toBe('todo');
    expect(getWorkResultCompletionOptions(saved.id, 'local').codeFreshness).toBe('unknown');
    acceptWorkResultAndCompleteTask(human, input, codeRevision('saved-sha'));
    const dirtyTask = createTask({ title: 'Working-copy outcome' });
    const dirty = createWorkResult(human, { requestId: 'dirty', body: 'Working-copy handoff.', taskIds: [dirtyTask.id] }, { codeRevision: codeRevision('same-sha', 'dirty') }).result;
    expect(getWorkResultCompletionOptions(dirty.id, 'local', codeRevision('same-sha', 'dirty')).codeFreshness).toBe('unknown');
    expect(acceptWorkResultAndCompleteTask(human, { ...input, requestId: 'complete-dirty', resultId: dirty.id }, codeRevision('same-sha', 'dirty')).completion?.task.status).toBe('done');
  });

  it('rejects a stale task revision and rolls back acceptance if lifecycle completion fails after insertion', () => {
    const { task, result, input } = linked();
    transitionTask({ taskId: task.id, command: 'start', idempotencyKey: 'started', meta: { source: 'human' } });
    expect(() => acceptWorkResultAndCompleteTask(human, input)).toThrow(/Task changed/);
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
    getRawDb().exec("CREATE TRIGGER completion_failure BEFORE INSERT ON task_completions BEGIN SELECT RAISE(ABORT, 'completion unavailable'); END");
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, expectedStatusChangedCount: 1 })).toThrow(/completion unavailable/);
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
    expect(getTask(task.id)?.status).toBe('in_progress');
    expect(getDb().select().from(taskCompletions).all()).toEqual([]);
  });

  it('records a recurring occurrence once and preserves the existing cadence under concurrent retries', async () => {
    const task = createTask({ title: 'Daily outcome', recurrence: 'daily', nextRecurrenceAt: '2026-10-07T00:00:00Z' });
    const result = createWorkResult(human, { requestId: 'daily', body: 'This occurrence is finished.', taskIds: [task.id] }).result;
    const input = { requestId: 'complete-daily', resultId: result.id, expectedStatusChangedCount: 0 };
    const responses = await Promise.all(Array.from({ length: 8 }, () => Promise.resolve().then(() => acceptWorkResultAndCompleteTask(human, input))));
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(getDb().select().from(taskCompletions).all()).toHaveLength(1);
    expect(getWorkResult(result.id)?.reviews).toHaveLength(1);
    expect(getTask(task.id)).toMatchObject({ status: 'todo', statusChangedCount: 1 });
    expect(responses[0].completion?.recurring).toBe(true);
    expect(responses.every((response) => response.completion?.nextRecurrenceAt === responses[0].completion?.nextRecurrenceAt)).toBe(true);
    expect(getWorkResultCompletionOptions(result.id)).toMatchObject({ choices: [], completedTaskIds: [task.id] });
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, requestId: 'another-count', expectedStatusChangedCount: 1 })).toThrow(/eligible linked task/);
    expect(getDb().select().from(taskCompletions).all()).toHaveLength(1);
  });

  it('replays committed intent after source/link pruning and disable, while changed intent conflicts', async () => {
    const { execution, session } = author();
    const task = createTask({ title: 'Outcome with a source' });
    const result = createWorkResult(human, { requestId: 'sourced', body: 'The completed outcome.', taskIds: [task.id] }, { sourceChatSessionId: session.id }).result;
    const input = { requestId: 'complete-source', resultId: result.id, expectedStatusChangedCount: 0 };
    const first = await acceptAndCompleteWorkResult(human, input);
    expect(first.completion?.task.status).toBe('done');
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    getDb().delete(workResultTasks).where(eq(workResultTasks.resultId, result.id)).run();
    setWorkResultCapabilities({ handoffsEnabled: false });
    observation.mockClear();
    runtime.runningSessionIds.mockClear();
    expect((await acceptAndCompleteWorkResult(human, input)).review.id).toBe(first.review.id);
    expect(observation).not.toHaveBeenCalled();
    expect(runtime.runningSessionIds).not.toHaveBeenCalled();
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, note: 'Changed decision' })).toThrow(/different work/);
    expect(() => acceptWorkResultAndCompleteTask(human, { ...input, requestId: 'fresh-after-off' })).toThrow(/disabled/);
    expect(getDb().select().from(taskCompletions).all()).toHaveLength(1);
    expect(first.completion?.task.id).toBe(task.id);
    expect(getDb().select().from(taskStatusChanges).all()[0]?.executionId).toBe(execution.id);
  });

  it('prevents signed agent acceptance from claiming the human completion operation', () => {
    const { session } = author();
    const { result, input } = linked();
    expect(() => acceptWorkResultAndCompleteTask({ userId: 'local', source: 'ai', sessionId: session.id }, input)).toThrow(/human owner/);
    expect(() => acceptWorkResultAndCompleteTask({ userId: 'elsewhere', source: 'human' }, input)).toThrow(/authority/);
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
  });
});

describe('existing lifecycle questions through the result completion HTTP path', () => {
  it('composes open-child acknowledgment and a disclosed running-workstream choice', async () => {
    const { execution, session } = author();
    const parent = createTask({ title: 'Parent outcome' });
    const child = createTask({ title: 'Open child', parentId: parent.id });
    const collateral = createTask({ title: 'Other shared task' });
    attachExecutionToTask(execution.id, parent.id);
    attachExecutionToTask(execution.id, collateral.id);
    const result = createWorkResult(human, { requestId: 'parent-result', body: 'Parent handoff.', taskIds: [parent.id] }).result;
    const input = { requestId: 'parent-completion', expectedStatusChangedCount: 0 };
    const children = await post(result.id, input);
    expect(children.status).toBe(409);
    expect(await children.json()).toMatchObject({ code: 'conflict', details: { requiresChildAck: true, openChildren: [{ id: child.id }] } });
    expect(runtime.runningSessionIds).not.toHaveBeenCalled();
    runtime.runningSessionIds.mockResolvedValue([session.id]);
    const running = await post(result.id, { ...input, acknowledgedChildIds: [child.id] });
    expect(running.status).toBe(409);
    expect(await running.json()).toMatchObject({ code: 'active_execution', details: { requiresChoice: true, running: [{ executionId: execution.id, otherTasks: [{ id: collateral.id }] }] } });
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
    const done = await post(result.id, { ...input, acknowledgedChildIds: [child.id], runtimeChoice: 'keep_running', acknowledgedExecutionIds: [execution.id] });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ replayed: false, taskId: parent.id, completion: { task: { status: 'done' } } });
    expect(runtime.notify).toHaveBeenCalledWith(execution.id, { taskId: parent.id, taskTitle: parent.title, action: 'completed' });
    expect(runtime.stopExecution).not.toHaveBeenCalled();
    expect(getTask(child.id)?.status).toBe('todo');
    expect(getTask(collateral.id)?.status).toBe('todo');
  });

  it('leaves acceptance and task unchanged when an explicitly chosen runtime stop fails', async () => {
    const { execution, session } = author();
    const { task, result } = linked();
    attachExecutionToTask(execution.id, task.id);
    runtime.runningSessionIds.mockResolvedValue([session.id]);
    runtime.stopExecution.mockResolvedValue({ ok: false, failures: ['The device is unavailable.'] });
    const response = await post(result.id, { requestId: 'failed-stop', expectedStatusChangedCount: 0, runtimeChoice: 'stop_running_agent', acknowledgedExecutionIds: [execution.id] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'active_execution', details: { stopFailed: true } });
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
    expect(getTask(task.id)?.status).toBe('todo');
    expect(getDb().select().from(taskCompletions).all()).toEqual([]);
  });

  it('checks known code mismatch before any runtime coordination or acceptance', async () => {
    const { session } = author();
    const task = createTask({ title: 'Code outcome' });
    const result = createWorkResult(human, { requestId: 'known-code', body: 'The named revision.', taskIds: [task.id] }, { sourceChatSessionId: session.id, codeRevision: codeRevision('saved') }).result;
    observation.mockResolvedValue(codeRevision('changed'));
    const response = await post(result.id, { requestId: 'reject-changed', expectedStatusChangedCount: 0, runtimeChoice: 'stop_running_agent' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'conflict', details: { staleReason: 'revision_mismatch' } });
    expect(runtime.runningSessionIds).not.toHaveBeenCalled();
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
  });

  it('checks retained execution scope even after the source conversation is pruned', async () => {
    const { execution, session } = author();
    const task = createTask({ title: 'Durable code outcome' });
    const result = createWorkResult(human, { requestId: 'durable-code', body: 'The retained revision.', taskIds: [task.id] }, { sourceChatSessionId: session.id, codeRevision: codeRevision('saved') }).result;
    getDb().delete(chatSessions).where(eq(chatSessions.id, session.id)).run();
    executionObservation.mockResolvedValue(codeRevision('changed'));
    const response = await post(result.id, { requestId: 'pruned-changed', expectedStatusChangedCount: 0 });
    expect(response.status).toBe(409);
    expect(executionObservation).toHaveBeenCalledWith(execution.id, 'local');
    expect(runtime.runningSessionIds).not.toHaveBeenCalled();
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
  });

  it('requires the current task revision and preserves clear capability errors', async () => {
    const { task, result } = linked();
    expect((await post(result.id, { requestId: 'no-revision' })).status).toBe(422);
    setWorkResultCapabilities({ handoffsEnabled: false });
    const response = await post(result.id, { requestId: 'disabled', expectedStatusChangedCount: 0 });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'unsupported' });
    expect(getTask(task.id)?.status).toBe('todo');
    expect(getWorkResult(result.id)?.reviews).toEqual([]);
  });
});
