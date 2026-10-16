/**
 * Ri follow-ups, the fictional preview set, imported file deletion, the
 * opener and stale-edit conflicts. All data is fictional.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, call, owner, fixture, chat } from './helpers.js';
import { fakeProvider } from './fakes.js';
import { app } from '../src/server/state.js';

const NOW = '2026-10-15T15:00:00Z';

describe('Ri follow-ups', () => {
  it('a retry or a second click with the same operation returns the same Ri task, and task availability is checked live', async () => {
    await setup({ now: NOW });
    const record = (await call('save_opportunity', { company: 'Lumen', role: 'Staff designer' }, owner())).record;
    const provider = fakeProvider();
    const operationId = randomUUID();
    const input = { subject: { type: 'opportunity', id: record.id }, title: 'Follow up with Lumen', dueAt: '2026-10-19', operationId };
    const invocationId = randomUUID();
    const first = await call('create_follow_up', input, owner({ capability: provider.capability, id: invocationId }));
    const retry = await call('create_follow_up', input, owner({ capability: provider.capability, id: invocationId }));
    const secondClick = await call('create_follow_up', input, owner({ capability: provider.capability }));
    expect(first.followUp).toMatchObject({ state: 'created', title: 'Follow up with Lumen', dueAt: '2026-10-19', opportunityId: record.id });
    expect(retry.followUp.taskId).toBe(first.followUp.taskId);
    expect(secondClick.followUp.id).toBe(first.followUp.id);
    expect(provider.tasks.size).toBe(1);
    const created = provider.calls.filter((item) => item.name === 'create_task');
    expect(created.every((item) => item.input.operationId === operationId && item.input.dueAt === '2026-10-19')).toBe(true);
    let listed = await call('list_follow_ups', { opportunityId: record.id }, owner({ capability: provider.capability }));
    expect(listed.items[0].task).toMatchObject({ available: true, status: 'todo' });
    provider.tasks.clear();
    listed = await call('list_follow_ups', { opportunityId: record.id }, owner({ capability: provider.capability }));
    expect(listed.items[0].task).toMatchObject({ available: false, reason: 'This Ri task was deleted' });
  });

  it('when Ri tasks are not allowed, the link is kept as failed with a way forward, and the same operation succeeds later', async () => {
    await setup({ now: NOW });
    const record = (await call('save_opportunity', { company: 'Cedar', role: 'Design lead' }, owner())).record;
    const operationId = randomUUID();
    const input = { subject: { type: 'opportunity', id: record.id }, title: 'Review the offer', operationId };
    await expect(call('create_follow_up', input, owner())).rejects.toThrow(/Allow them in Sources/);
    const pending = await call('list_follow_ups', { opportunityId: record.id }, owner());
    expect(pending.items[0].followUp).toMatchObject({ state: 'failed', taskId: null });
    const provider = fakeProvider();
    const retried = await call('create_follow_up', input, owner({ capability: provider.capability }));
    expect(retried.followUp).toMatchObject({ id: pending.items[0].followUp.id, state: 'created' });
  });
});

describe('fictional preview', () => {
  it('seeds the same fictional records as the design concept once, for a preview only, marked as fictional', async () => {
    await setup({ now: NOW });
    const view = await call('open_view', { path: '/', query: {} }, fixture());
    expect(view.data).toMatchObject({ mode: 'app', fictional: true, landing: 'today', section: 'today', setup: { opportunities: 5, materials: 3, review: 2 } });
    const list = await call('list_opportunities', { limit: 50, view: 'active' }, fixture());
    expect(list.items.map((item: { company: string; stage: string }) => `${item.company}:${item.stage}`)).toEqual(['Atlas Studio:saved', 'Fieldwork:saved', 'Lumen:applied', 'Northstar:interviewing', 'Cedar:offer']);
    const northstar = list.items.find((item: { company: string }) => item.company === 'Northstar');
    expect(northstar.next).toMatchObject({ kind: 'interview', startAt: '2026-10-16T16:00:00.000Z', zone: 'America/Denver' });
    const cedar = list.items.find((item: { company: string }) => item.company === 'Cedar');
    expect(cedar.next).toMatchObject({ kind: 'deadline', date: '2026-10-21', label: 'Reply to the offer by' });
    const atlas = list.items.find((item: { company: string }) => item.company === 'Atlas Studio');
    expect(atlas.note).toBe('Add the description to prepare with this role');
    await call('open_view', { path: '/', query: {} }, fixture());
    expect((await call('list_opportunities', { limit: 50, view: 'all' }, fixture())).total).toBe(5);
    const materials = await call('list_materials', { limit: 50, archived: false }, fixture());
    const resume = materials.items.find((item: { title: string }) => item.title === 'Product design résumé');
    expect(resume.versions.map((version: { number: number; submitted: boolean }) => [version.number, version.submitted])).toEqual([[4, false], [3, true], [2, false], [1, false]]);
  });

  it('an installed instance opened by its owner starts empty and lands on Opportunities', async () => {
    await setup({ now: NOW });
    const view = await call('open_view', { path: '/', query: {} }, owner());
    expect(view.data).toMatchObject({ fictional: false, landing: 'opportunities', section: 'opportunities', setup: { opportunities: 0, materials: 0 } });
    expect(view.scope.actions).toContain('save_opportunity');
    expect((await call('list_opportunities', { limit: 50, view: 'all' }, owner())).total).toBe(0);
  });

  it('opening the view reads saved records only: it never starts a sync or any AI', async () => {
    await setup({ now: NOW });
    const provider = fakeProvider({ ai: () => '{}' });
    await call('open_view', { path: '/today', query: {} }, fixture({ capability: provider.capability }));
    await call('describe_view_context', { path: '/today', query: {}, state: { section: 'today' } }, fixture({ capability: provider.capability }));
    await call('get_today', { zone: 'America/Denver' }, fixture({ capability: provider.capability }));
    expect(provider.calls).toEqual([]);
  });

  it('deep paths and query state open where the person left off', async () => {
    await setup({ now: NOW });
    await call('open_view', { path: '/', query: {} }, fixture());
    const lumen = (await call('list_opportunities', { limit: 50, view: 'active', search: 'Lumen' }, fixture())).items[0];
    const view = await call('open_view', { path: `/opportunities/${lumen.id}`, query: { tab: 'materials', mode: 'table', unknown: 'x' } }, fixture());
    expect(view.data).toMatchObject({ section: 'opportunity', id: lumen.id, query: { tab: 'materials', mode: 'table' } });
    expect((await call('open_view', { path: '/materials', query: {} }, fixture())).data.section).toBe('materials');
    expect((await call('open_view', { path: '/sources', query: {} }, fixture())).data.section).toBe('sources');
  });
});

describe('stale edits', () => {
  it('a stale update returns the current record to compare instead of overwriting it', async () => {
    await setup({ now: NOW });
    const record = (await call('save_opportunity', { company: 'Northstar', role: 'Product designer' }, owner())).record;
    await call('save_opportunity', { id: record.id, expectedRevision: record.revision, nextAction: 'Prepare portfolio' }, owner());
    const stale = await call('save_opportunity', { id: record.id, expectedRevision: record.revision, nextAction: 'Something else' }, owner());
    expect(stale).toMatchObject({ status: 'conflict', current: { nextAction: 'Prepare portfolio' } });
    const staleStage = await call('change_stage', { id: record.id, expectedRevision: record.revision, stage: 'applied' }, owner());
    expect(staleStage.status).toBe('conflict');
    const invocationId = randomUUID();
    const first = await call('save_opportunity', { id: record.id, expectedRevision: stale.current.revision, notes: 'Retried once' }, owner({ id: invocationId }));
    const again = await call('save_opportunity', { id: record.id, expectedRevision: stale.current.revision, notes: 'Retried once' }, owner({ id: invocationId }));
    expect(again).toEqual(first);
    await expect(call('save_opportunity', { id: record.id, expectedRevision: stale.current.revision, notes: 'Different change' }, owner({ id: invocationId }))).rejects.toThrow(/different change/);
  });

  it('a chat with write access saves through the same revision checks and its change is attributed to it', async () => {
    await setup({ now: NOW });
    const record = (await call('save_opportunity', { company: 'Northstar', role: 'Product designer' }, owner())).record;
    const scope = await call('create_scope', { actorId: 'chat:c-1', sources: ['manual'], operations: ['read', 'write'] }, owner());
    const moved = await call('change_stage', { id: record.id, expectedRevision: record.revision, stage: 'applied' }, chat('c-1', scope.scopeRef));
    expect(moved.record.stageLock.by).toBe('chat:c-1');
    const history = (await call('get_opportunity', { id: record.id }, owner())).stageHistory;
    expect(history.at(-1)).toMatchObject({ author: 'chat:c-1', toStage: 'applied' });
  });
});

describe('imported files', () => {
  it('Delete imported data removes what a file created, unless a preparation or submission depends on it', async () => {
    await setup({ now: NOW });
    const text = 'Platform designer at Pinecrest\n\nRequirements\n- Five years designing internal platforms.';
    const file = { name: 'pinecrest.txt', mimeType: 'text/plain', base64: Buffer.from(text).toString('base64') };
    const preview = await call('preview_import', { kind: 'posting', file }, owner());
    const applied = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, owner());
    const listed = await call('list_imports', {}, owner());
    expect(listed.items).toEqual([expect.objectContaining({ id: preview.previewId, name: 'pinecrest.txt', kind: 'Job description', records: 2 })]);
    const prep = await call('get_preparation', { opportunityId: applied.opportunityIds[0] }, owner());
    await call('save_preparation', { opportunityId: applied.opportunityIds[0], expectedRevision: 0, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [], questions: [], notes: 'x' }, owner());
    await expect(call('delete_import', { id: preview.previewId, confirm: 'delete' }, owner())).rejects.toThrow(/preparation uses this description/);

    const second = await call('preview_import', { kind: 'material', file: { name: 'resume.txt', mimeType: 'text/plain', base64: Buffer.from('Sam Rivera\nFictional résumé').toString('base64') } }, owner());
    await call('apply_import', { previewId: second.previewId, digest: second.digest }, owner());
    const removed = await call('delete_import', { id: second.previewId, confirm: 'delete' }, owner());
    expect(removed).toMatchObject({ removed: 1, kept: 0 });
    expect((await call('list_materials', { limit: 10, archived: false }, owner())).items).toEqual([]);
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM import_previews WHERE id = ?').get(second.previewId)).toMatchObject({ count: 0 });
  });
});

describe('materials and context selections', () => {
  it('archiving a material keeps every version and its submissions, and context describes materials and review items', async () => {
    await setup({ now: NOW });
    await call('open_view', { path: '/', query: {} }, fixture());
    const materials = await call('list_materials', { limit: 50, archived: false }, fixture());
    const resume = materials.items.find((item: { title: string }) => item.title === 'Product design résumé');
    const archived = await call('archive_material', { id: resume.id, expectedRevision: resume.revision, archived: true }, fixture());
    expect(archived.record.archivedAt).toBeTruthy();
    expect((await call('list_materials', { limit: 50, archived: false }, fixture())).items.map((item: { id: string }) => item.id)).not.toContain(resume.id);
    const kept = (await call('list_materials', { limit: 50, archived: true }, fixture())).items[0];
    expect(kept.versions.find((version: { number: number }) => version.number === 3).usedBy).toHaveLength(2);
    const review = (await call('list_review', { limit: 10 }, fixture())).items.find((item: { kind: string }) => item.kind === 'match');
    const described = await call('describe_view_context', { path: '/materials', query: {}, state: { section: 'materials', selected: [{ type: 'material', id: resume.id }, { type: 'review', id: review.id }] } }, fixture());
    expect(described.modelContent).toContain('Résumé: Product design résumé');
    expect(described.modelContent).toMatch(/v3, edited, submitted/);
    expect(described.modelContent).toContain("user's own material");
    expect(described.modelContent).toContain('Review item: Two design roles');
    expect(Buffer.byteLength(described.modelContent)).toBeLessThanOrEqual(16_384);
    const stale = await call('describe_view_context', { path: '/opportunities', query: {}, state: { selected: [{ type: 'opportunity', id: 'not-a-real-id' }] } }, fixture());
    expect(stale.modelContent).toContain('not available to this chat');
  });
});
