import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Ctx } from '../src/domain/context.js';
import { call, chat, expectCode, job, owner, setup, teardown } from './helpers.js';
import { fakeHost, mail, OWNER, OWNER_WORK } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const recent = (days: number) => new Date(Date.now() - days * 864e5).toISOString();

/** Two accounts plus manual records in two collections, then two chats with different scopes. */
async function world() {
  const host = fakeHost({
    personal: { email: OWNER, mail: [
      mail('p1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio review', body: 'Let us discuss the portfolio review.', sent: true, date: recent(3) }),
      mail('p2', { from: OWNER, to: ['Alex Rivera <alex@fastmail.com>'], subject: 'Catch-up', body: 'Coffee next week?', sent: true, date: recent(9) }),
    ] },
    work: { email: OWNER_WORK, mail: [
      mail('w1', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>', 'Priya Shah <priya@fieldwork.example>'], subject: 'Confidential pricing for Fieldwork', body: 'The fee is confidential.', sent: true, date: recent(2) }),
    ] },
  }, { ai: (prompt) => prompt.includes('meeting preparation') ? JSON.stringify({ items: [{ text: 'Owner-only prose about the confidential fee.', kind: 'discussion', sources: ['R1'] }], unknowns: [] }) : '{"commitments":[],"resolutions":[],"facts":[],"stages":[]}' });
  const scheduled = job([{ account: 'personal' }, { account: 'work' }], host.capability);
  for (let index = 0; index < 20; index++) if (!(await call('run_background_step', {}, scheduled)).ran) break;
  const me = owner(['personal', 'work'], host.capability);
  const work = (await call('save_collection', { label: 'Work deals' }, me)).key;
  const people = (await call('list_people', { limit: 50 }, me)).items as { id: string; name: string; revision: number }[];
  const id = (name: string) => people.find((person) => person.name === name)!.id;
  const fieldwork = (await call('save_organization', { name: 'Fieldwork', website: 'fieldwork.example', collection: work }, me)).record;
  await call('save_affiliation', { personId: id('Jordan Bell'), organizationId: fieldwork.id, role: 'Founder', collection: work }, me);
  const pipeline = (await call('save_pipeline', { name: 'Deals', template: 'client_work', collection: work }, me)).record;
  await call('save_opportunity', { title: 'Secret expansion', pipelineId: pipeline.id, organizationId: fieldwork.id, personIds: [id('Jordan Bell')], value: { minor: 5000000, currency: 'USD' } }, me);
  await call('save_note', { subjectKind: 'person', subjectId: id('Maya Chen'), body: 'Owner note in my main collection.' }, me);
  const mayaRevision = (await call('get_person', { id: id('Maya Chen') }, me)).person.revision;
  await call('save_person', { id: id('Maya Chen'), expectedRevision: mayaRevision, name: 'Aaron Override' }, me);
  const grantA = await call('create_scope', { actorId: 'chat:a', sources: ['account:personal'], operations: ['read'] }, me);
  const grantB = await call('create_scope', { actorId: 'chat:b', sources: ['account:work', 'manual'], operations: ['read', 'write'] }, me);
  // Owner generates a briefing about Jordan. A narrower chat must never receive its prose.
  await call('set_extraction', { enabled: true }, me);
  const queued = await call('request_briefing', { subjectKind: 'person', subjectId: id('Jordan Bell') }, me);
  expect(queued.availability).toBe('queued');
  // The owner's Prepare runs the owner's own step. The schedule never runs an owner-scope briefing.
  for (let index = 0; index < 10; index++) if (!(await call('run_background_step', {}, scheduled)).ran) break;
  expect((await call('get_briefing', { subjectKind: 'person', subjectId: id('Jordan Bell') }, me)).origin).toBe('saved_records');
  await call('continue_import', { source: 'briefings' }, me);
  const ownerBriefing = await call('get_briefing', { subjectKind: 'person', subjectId: id('Jordan Bell') }, me);
  expect(ownerBriefing.origin).toBe('generated');
  return { host, me, a: chat('a', grantA.scopeRef), b: chat('b', grantB.scopeRef), id, fieldwork, work, pipeline, grantA, grantB };
}

describe('app data scopes', () => {
  it('two chats with different scopes see only their own sources through lists, search, counts and detail', async () => {
    const w = await world();
    const listA = (await call('list_people', { limit: 50 }, w.a)).items.map((item: { name: string }) => item.name).sort();
    const listB = (await call('list_people', { limit: 50 }, w.b)).items.map((item: { name: string }) => item.name).sort();
    expect(listA).toEqual(['Alex Rivera', 'Maya Chen']);
    expect(listB).toEqual(['Aaron Override', 'Jordan Bell', 'Priya Shah']);
    expect((await call('list_people', { limit: 50 }, w.a)).total).toBe(2);
    // A narrower chat never sees the owner's override name, and sorts by what it can see.
    expect(listA).not.toContain('Aaron Override');
    expect((await call('search_people', { text: 'fieldwork', limit: 10 }, w.a)).total).toBe(0);
    expect((await call('search_people', { text: 'pricing', limit: 10 }, w.a)).total).toBe(0);
    expect((await call('search_people', { text: 'Aaron', limit: 10 }, w.a)).total).toBe(0);
    await expectCode(call('get_person', { id: w.id('Jordan Bell') }, w.a), 'not_found');
    expect((await call('list_organizations', { limit: 50 }, w.a)).items).toEqual([]);
    // B sees Jordan from the work account, but not the company, affiliation, pipeline or amount kept in the Work deals collection.
    const jordan = await call('get_person', { id: w.id('Jordan Bell') }, w.b);
    expect(jordan.header.company).toBeNull();
    expect(jordan.opportunities).toEqual([]);
    expect((await call('list_opportunities', { limit: 50 }, w.b)).total).toBe(0);
    expect((await call('list_pipelines', {}, w.b)).items).toEqual([]);
    await expectCode(call('get_organization', { id: w.fieldwork.id }, w.b), 'not_found');
    // B sees the person only through the manual layer: no hidden email or interaction from the personal account.
    const maya = await call('get_person', { id: w.id('Maya Chen') }, w.b);
    expect(maya.person.name).toBe('Aaron Override');
    expect(maya.identities).toEqual([]);
    expect((await call('list_interactions', { subjectKind: 'person', subjectId: w.id('Maya Chen'), limit: 20, include: ['email', 'meeting'] }, w.b)).items).toEqual([]);
    expect(maya.notes.map((note: { body: string }) => note.body)).toEqual(['Owner note in my main collection.']);
    expect((await call('get_person', { id: w.id('Maya Chen') }, w.a)).notes).toEqual([]);
  });

  it('a cached owner briefing is never served to a narrower chat', async () => {
    const w = await world();
    const briefing = await call('get_briefing', { subjectKind: 'person', subjectId: w.id('Jordan Bell') }, w.b);
    expect(briefing.origin).toBe('saved_records');
    expect(JSON.stringify(briefing)).not.toContain('Owner-only prose');
    const context = await call('get_relationship_context', { subjectKind: 'person', subjectId: w.id('Jordan Bell') }, w.b);
    expect(JSON.stringify(context)).not.toContain('Owner-only prose');
    expect(JSON.stringify(context)).not.toContain('5000000');
  });

  it('view context is re-resolved for the receiving chat and never names hidden records', async () => {
    const w = await world();
    const state = { section: 'people', selected: [{ kind: 'person', id: w.id('Jordan Bell') }, { kind: 'person', id: w.id('Alex Rivera') }], filters: { text: '' } };
    const forA = await call('describe_view_context', { path: '/people', query: {}, state }, w.a);
    expect(forA.modelContent).toContain('Alex Rivera');
    expect(forA.modelContent).not.toContain('Jordan');
    expect(forA.modelContent).toContain('1 selected record is not available to this chat');
    expect(forA.recordRefs.map((ref: { recordId: string }) => ref.recordId)).toEqual([w.id('Alex Rivera')]);
    const forged = await call('describe_view_context', { path: `/people/${w.id('Priya Shah')}`, query: {}, state: { section: 'person', selected: [] } }, w.a);
    expect(forged.modelContent).not.toContain('Priya');
  });

  it('a revoked scope, a chat without a scope and a read-only scope are refused, and a job sees only its accounts', async () => {
    const w = await world();
    await expectCode(call('list_people', { limit: 5 }, chat('c', null)), 'forbidden');
    await expectCode(call('save_note', { subjectKind: 'person', subjectId: w.id('Maya Chen'), body: 'Not allowed' }, w.a), 'forbidden');
    await expectCode(call('list_people', { limit: 5 }, chat('impostor', w.grantA.scopeRef)), 'forbidden');
    await call('revoke_scope', { scopeRef: w.grantA.scopeRef }, w.me);
    await expectCode(call('list_people', { limit: 5 }, w.a), 'revoked');
    await expectCode(call('export_records', { table: 'people' }, w.b), 'forbidden');
    await expectCode(call('merge_people', { survivorId: w.id('Jordan Bell'), mergedId: w.id('Priya Shah'), survivorRevision: 1, mergedRevision: 1 }, w.b), 'forbidden');
    const scheduled = job([{ account: 'personal' }]);
    expect((await call('run_background_step', {}, scheduled)).ran?.source ?? 'account:personal').toBe('account:personal');
  });

  it('a chat write lands in a collection it was given and stays invisible to other chats', async () => {
    const w = await world();
    const note = await call('save_note', { subjectKind: 'person', subjectId: w.id('Jordan Bell'), body: 'Written by chat B' }, w.b);
    expect(note.record.collection).toBe('manual');
    const asOwner = await call('get_person', { id: w.id('Jordan Bell') }, w.me);
    expect(asOwner.notes.some((item: { body: string }) => item.body === 'Written by chat B')).toBe(true);
    const revisionA = (await call('open_view', { path: '/today', query: {} }, w.a)).data.revision;
    await call('save_note', { subjectKind: 'person', subjectId: w.id('Jordan Bell'), body: 'Another work note' }, w.b);
    expect((await call('open_view', { path: '/today', query: {} }, w.a)).data.revision).toBe(revisionA);
  });
});
