import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../src/domain/context.js';
import { call, chat, owner, setup, teardown } from './helpers.js';
import { fakeHost } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });

describe('Ri follow-ups', () => {
  it('a retried invocation and a second click with the same operation create one Ri task', async () => {
    const host = fakeHost({});
    const me = owner([], host.capability);
    const person = (await call('save_person', { name: 'Jordan Bell' }, me)).record;
    const operationId = randomUUID(), invocation = randomUUID();
    const input = { subject: { kind: 'person', id: person.id }, title: 'Send the revised proposal', dueAt: '2026-10-16', operationId };
    const first = await call('create_follow_up', input, me, invocation);
    const retried = await call('create_follow_up', input, me, invocation);
    const clicked = await call('create_follow_up', input, me);
    expect(first.link.taskId).toBe('task-1');
    expect(retried.link.taskId).toBe('task-1');
    expect(clicked.link.taskId).toBe('task-1');
    expect(host.count('create_task')).toBe(1);
    expect(host.calls.find((item) => item.name === 'create_task')!.input).toMatchObject({ title: 'Send the revised proposal', dueAt: '2026-10-16', operationId });
  });

  it('a failed task creation is recorded, and the retry uses the same operation ID and creates one task', async () => {
    const host = fakeHost({}, { failCreateTaskOnce: true });
    const me = owner([], host.capability);
    const person = (await call('save_person', { name: 'Jordan Bell' }, me)).record;
    const input = { subject: { kind: 'person', id: person.id }, title: 'Call Jordan', operationId: randomUUID() };
    const failed = await call('create_follow_up', input, me);
    expect(failed.link.status).toBe('failed');
    expect(failed.link.lastError).toBe('Ri was busy. Try again');
    const retried = await call('create_follow_up', input, me);
    expect(retried.link.status).toBe('linked');
    expect(host.tasks.size).toBe(1);
  });

  it('a commitment gets at most one live task, and a deleted Ri task is shown as unavailable and never recreated', async () => {
    const host = fakeHost({});
    const me = owner([], host.capability);
    const person = (await call('save_person', { name: 'Maya Chen' }, me)).record;
    const commitment = (await call('save_commitment', { direction: 'i_owe', personId: person.id, action: 'Introduce Maya to a research lead' }, me)).record;
    const one = await call('create_follow_up', { subject: { kind: 'commitment', id: commitment.id }, title: 'Introduce Maya', operationId: randomUUID() }, me);
    const two = await call('create_follow_up', { subject: { kind: 'commitment', id: commitment.id }, title: 'Introduce Maya again', operationId: randomUUID() }, me);
    expect(two.link.id).toBe(one.link.id);
    host.tasks.get(one.link.operationId)!.deleted = true;
    const checked = await call('check_follow_ups', { ids: [one.link.id] }, me);
    expect(checked.items[0].status).toBe('unavailable');
    const after = await call('create_follow_up', { subject: { kind: 'commitment', id: commitment.id }, title: 'Introduce Maya', operationId: one.link.operationId }, me);
    expect(after.link.status).toBe('unavailable');
    expect(host.count('create_task')).toBe(1);
  });

  it('shows a clear message when Ri has not allowed tasks, and links an existing task without creating one', async () => {
    const me = owner([], async (name) => { if (name === 'get_task') return { id: 'existing-7', status: 'open' }; throw Object.assign(new Error('Not allowed'), { name: 'AppError', code: 'forbidden' }); });
    const person = (await call('save_person', { name: 'Sam Okafor' }, me)).record;
    const denied = await call('create_follow_up', { subject: { kind: 'person', id: person.id }, title: 'Arrange discovery call', operationId: randomUUID() }, me);
    expect(denied.link.status).toBe('failed');
    expect(denied.link.lastError).toMatch(/Allow People to create Ri tasks in Sources/);
    const linked = await call('create_follow_up', { subject: { kind: 'person', id: person.id }, title: 'Existing task', existingTaskId: 'existing-7' }, me);
    expect(linked.link).toMatchObject({ status: 'linked', taskId: 'existing-7' });
  });

  it('a chat may create a follow-up only with a write scope and only for records it can see', async () => {
    const host = fakeHost({});
    const me = owner([], host.capability);
    const person = (await call('save_person', { name: 'Elena Park' }, me)).record;
    const scope = await call('create_scope', { actorId: 'chat:w', sources: ['manual'], operations: ['read', 'write'] }, me);
    const writer = chat('w', scope.scopeRef, host.capability);
    const result = await call('create_follow_up', { subject: { kind: 'person', id: person.id }, title: 'Ask Elena about the study', operationId: randomUUID() }, writer);
    expect(result.link.status).toBe('linked');
  });
});
