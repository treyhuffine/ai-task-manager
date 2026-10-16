import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, expectCode, owner, setup, teardown } from './helpers.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup(); });
afterEach(() => { teardown(ctx); ctx = null; });
const me = owner();

async function twoMayas() {
  const a = (await call('save_person', { name: 'Maya Chen', identifiers: [{ kind: 'email', value: 'maya@northstar.example' }] }, me)).record;
  const b = (await call('save_person', { name: 'Maya Chen', identifiers: [{ kind: 'email', value: 'maya.chen@personal.example' }] }, me)).record;
  const list = (await call('save_list', { name: 'Collaborators', recordKind: 'person' }, me)).record;
  await call('update_list_members', { listId: list.id, expectedRevision: list.revision, add: [a.id, b.id] }, me);
  await call('save_note', { subjectKind: 'person', subjectId: b.id, body: 'Prefers morning calls.' }, me);
  const org = (await call('save_organization', { name: 'Northstar' }, me)).record;
  await call('save_affiliation', { personId: b.id, organizationId: org.id, role: 'Design lead' }, me);
  await call('save_commitment', { direction: 'i_owe', personId: b.id, action: 'Send the portfolio checklist' }, me);
  const fresh = async (id: string) => (await call('get_person', { id }, me)).person.revision;
  return { a, b, list, org, revisions: { a: await fresh(a.id), b: await fresh(b.id) } };
}

describe('merge and undo', () => {
  it('merging people moves exact references, keeps a durable mapping and retains the merged record', async () => {
    const w = await twoMayas();
    const merged = await call('merge_people', { survivorId: w.a.id, mergedId: w.b.id, survivorRevision: w.revisions.a, mergedRevision: w.revisions.b }, me);
    expect(merged.status).toBe('saved');
    const survivor = await call('get_person', { id: w.a.id }, me);
    expect(survivor.identities.map((item: { value: string }) => item.value).sort()).toEqual(['maya.chen@personal.example', 'maya@northstar.example']);
    expect(survivor.notes.map((note: { body: string }) => note.body)).toEqual(['Prefers morning calls.']);
    expect(survivor.commitments.length).toBe(1);
    expect(survivor.affiliations[0].organizationName).toBe('Northstar');
    // The old ID still opens the surviving record.
    expect((await call('get_person', { id: w.b.id }, me)).person.id).toBe(w.a.id);
    expect((await call('list_people', { limit: 10 }, me)).total).toBe(1);
    // The duplicate list membership collapsed into one.
    expect((await call('list_lists', { limit: 10 }, me)).items[0].memberCount).toBe(1);
    expect(ctx!.db.get<{ merged_into: string }>('SELECT merged_into FROM persons WHERE id = ?', w.b.id)!.merged_into).toBe(w.a.id);
  });

  it('a stale merge fails atomically and changes nothing', async () => {
    const w = await twoMayas();
    const result = await call('merge_people', { survivorId: w.a.id, mergedId: w.b.id, survivorRevision: w.revisions.a, mergedRevision: w.revisions.b - 1 }, me);
    expect(result.status).toBe('conflict');
    expect((await call('list_people', { limit: 10 }, me)).total).toBe(2);
    expect(ctx!.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM merges')!.count).toBe(0);
  });

  it('undo restores original references and lists references added after the merge for explicit attribution', async () => {
    const w = await twoMayas();
    const { mergeId } = await call('merge_people', { survivorId: w.a.id, mergedId: w.b.id, survivorRevision: w.revisions.a, mergedRevision: w.revisions.b }, me);
    const later = (await call('save_note', { subjectKind: 'person', subjectId: w.a.id, body: 'Added after the merge.' }, me)).record;
    const preview = await call('undo_merge', { mergeId, preview: true }, me);
    expect(preview.laterReferences.map((item: { ref: string }) => item.ref)).toEqual([`notes:${later.id}`]);
    await expectCode(call('undo_merge', { mergeId, expectedRevision: preview.revision, digest: preview.digest, attributions: [] }, me), 'invalid_input');
    // A reference added after the preview makes the undo stale. Nothing changes.
    await call('save_note', { subjectKind: 'person', subjectId: w.a.id, body: 'Added after the preview.' }, me);
    await expectCode(call('undo_merge', { mergeId, expectedRevision: preview.revision, digest: preview.digest, attributions: [{ ref: `notes:${later.id}`, to: 'restored' }] }, me), 'conflict');
    const again = await call('undo_merge', { mergeId, preview: true }, me);
    const attributions = again.laterReferences.map((item: { ref: string }) => ({ ref: item.ref, to: item.ref === `notes:${later.id}` ? 'restored' : 'survivor' }));
    const undone = await call('undo_merge', { mergeId, expectedRevision: again.revision, digest: again.digest, attributions }, me);
    expect(undone.restored).toBe(w.b.id);
    const a = await call('get_person', { id: w.a.id }, me);
    const b = await call('get_person', { id: w.b.id }, me);
    expect(a.person.id).toBe(w.a.id);
    expect(b.person.id).toBe(w.b.id);
    expect(a.identities.map((item: { value: string }) => item.value)).toEqual(['maya@northstar.example']);
    expect(b.identities.map((item: { value: string }) => item.value)).toEqual(['maya.chen@personal.example']);
    expect(b.notes.map((note: { body: string }) => note.body).sort()).toEqual(['Added after the merge.', 'Prefers morning calls.']);
    expect(a.notes.map((note: { body: string }) => note.body)).toEqual(['Added after the preview.']);
    expect(b.commitments.length).toBe(1);
    expect(b.affiliations.length).toBe(1);
    expect((await call('list_lists', { limit: 10 }, me)).items[0].memberCount).toBe(2);
    await expectCode(call('undo_merge', { mergeId, preview: true }, me), 'conflict');
  });

  it('keeping two records separate is remembered and the pair is never proposed again', async () => {
    await call('save_person', { name: 'Sam Lee', identifiers: [{ kind: 'email', value: 'sam@atlas.example' }] }, me);
    const second = (await call('save_person', { name: 'Sam Lee', identifiers: [{ kind: 'email', value: 'sam@other.example' }] }, me)).record;
    const { proposeSameName } = await import('../src/domain/reviews.js');
    ctx!.db.tx(() => proposeSameName(ctx!, second.id, 'manual'));
    const reviews = await call('list_reviews', { kind: 'person', limit: 10 }, me);
    await call('resolve_identity', { reviewId: reviews.items[0].id, expectedRevision: reviews.items[0].revision, decision: 'keep_separate' }, me);
    ctx!.db.tx(() => proposeSameName(ctx!, second.id, 'manual'));
    expect((await call('list_reviews', { kind: 'person', limit: 10 }, me)).items).toEqual([]);
  });

  it('merging companies moves affiliations and opportunities, and undo restores them', async () => {
    const one = (await call('save_organization', { name: 'Fieldwork', website: 'fieldwork.example' }, me)).record;
    const two = (await call('save_organization', { name: 'Fieldwork Studio', website: 'fieldwork.example' }, me)).record;
    const person = (await call('save_person', { name: 'Jordan Bell' }, me)).record;
    await call('save_affiliation', { personId: person.id, organizationId: two.id, role: 'Founder' }, me);
    const pipeline = (await call('save_pipeline', { name: 'Client work', template: 'client_work' }, me)).record;
    await call('save_opportunity', { title: 'Onboarding project', pipelineId: pipeline.id, organizationId: two.id }, me);
    const r1 = (await call('get_organization', { id: one.id }, me)).organization.revision;
    const r2 = (await call('get_organization', { id: two.id }, me)).organization.revision;
    const { mergeId } = await call('merge_organizations', { survivorId: one.id, mergedId: two.id, survivorRevision: r1, mergedRevision: r2 }, me);
    const survivor = await call('get_organization', { id: one.id }, me);
    expect(survivor.people.current.map((item: { personName: string }) => item.personName)).toEqual(['Jordan Bell']);
    expect(survivor.opportunities.length).toBe(1);
    const preview = await call('undo_merge', { mergeId, preview: true }, me);
    await call('undo_merge', { mergeId, expectedRevision: preview.revision, digest: preview.digest, attributions: [] }, me);
    expect((await call('get_organization', { id: two.id }, me)).opportunities.length).toBe(1);
    expect((await call('get_organization', { id: one.id }, me)).people.current).toEqual([]);
  });
});
