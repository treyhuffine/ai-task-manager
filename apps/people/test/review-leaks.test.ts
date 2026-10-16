/**
 * Regression tests for the leaks found in review of b8e90a75. Each one
 * reproduced on that code. All records are fictional.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../src/domain/context.js';
import { openContext, useContext } from '../src/runtime.js';
import { setSearchRow } from '../src/domain/search.js';
import { call, chat, expectCode, INSTANCE, job, owner, setup, state, teardown } from './helpers.js';
import { fakeHost, mail, OWNER } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const recent = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
const me = owner();

describe('a cached write is not replayed after the caller\'s scope narrows', () => {
  it('refuses a replay after the scope is revoked and replaced by a narrower writable one, and writes nothing twice', async () => {
    const circle = (await call('save_collection', { label: 'Private circle' }, me)).key;
    const broad = await call('create_scope', { actorId: 'chat:a', sources: ['manual', circle], operations: ['read', 'write'] }, me);
    const invocationId = randomUUID();
    const input = { name: 'Robin Vale', collection: circle, identifiers: [{ kind: 'email', value: 'robin@private.example' }] };
    const first = await call('save_person', input, chat('a', broad.scopeRef), invocationId);
    expect(first.record.primaryEmail).toBe('robin@private.example');
    expect(first.record.sourceLabels).toContain('Private circle');
    await call('revoke_scope', { scopeRef: broad.scopeRef }, me);
    const narrow = await call('create_scope', { actorId: 'chat:a', sources: ['manual'], operations: ['read', 'write'] }, me);
    await expectCode(call('save_person', input, chat('a', narrow.scopeRef), invocationId), 'conflict');
    expect((await call('list_people', { limit: 50 }, me)).items.filter((item: { name: string }) => item.name === 'Robin Vale')).toHaveLength(1);
  });

  it('refuses a replay after a source is removed from the same scope, so deleted data is not returned from the receipt', async () => {
    const preview = await call('preview_import', { fileName: 'contacts.csv', mimeType: 'text/csv', base64: b64('Name,Email\nKai Moreno,kai@imported.example\n') }, me);
    await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, me);
    const imported = (await call('list_sources', {}, me)).imports[0].source as string;
    const kai = (await call('list_people', { limit: 50 }, me)).items.find((item: { name: string }) => item.name === 'Kai Moreno');
    const grant = await call('create_scope', { actorId: 'chat:b', sources: ['manual', imported], operations: ['read', 'write'] }, me);
    const invocationId = randomUUID();
    const input = { id: kai.id, expectedRevision: kai.revision, headline: 'Researcher' };
    const first = await call('save_person', input, chat('b', grant.scopeRef), invocationId);
    expect(first.record.primaryEmail).toBe('kai@imported.example');
    // Deleting the import removes it from every scope in place: same scope reference, fewer sources.
    await call('delete_source_data', { source: imported, confirm: true }, me);
    const revision = (await call('get_person', { id: kai.id }, me)).person.revision;
    const replay = call('save_person', input, chat('b', grant.scopeRef), invocationId);
    await expectCode(replay, 'conflict');
    expect((await call('get_person', { id: kai.id }, me)).person.revision).toBe(revision);
  });
});

describe('background briefings stay inside the schedule\'s scope', () => {
  const PRIVATE = 'Private note: considering a move to another team';
  const ai = (prompts: string[]) => (prompt: string) => {
    prompts.push(prompt);
    return prompt.includes('meeting preparation')
      ? JSON.stringify({ items: [{ text: 'You discussed the portfolio review.', kind: 'discussion', sources: ['R1'] }], unknowns: [] })
      : '{"commitments":[],"resolutions":[],"facts":[],"stages":[]}';
  };
  const world = (events = false) => ({
    public: {
      email: OWNER,
      mail: [
        mail('m1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio review', body: 'Let us discuss the portfolio review.', sent: true, date: recent(3), messageId: '<m1@personal.example>' }),
        mail('m2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Portfolio review', body: 'Sounds good, see you then.', date: recent(2), inReplyTo: '<m1@personal.example>' }),
      ],
      events: events ? [{ id: 'e1', summary: 'Portfolio review', start: new Date(Date.now() + 864e5).toISOString(), end: new Date(Date.now() + 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true, organizer: true }, { email: 'maya@northstar.example', displayName: 'Maya Chen' }] }] : [],
    },
  });
  const drain = async (caller: Parameters<typeof call>[2]) => { for (let index = 0; index < 30; index++) if (!(await call('run_background_step', {}, caller)).ran) break; };
  const briefingItems = () => ctx!.db.all<{ state: string; payload: string }>("SELECT state, payload FROM work_items WHERE kind = 'briefing'");

  it('a schedule granted only one account never sends an owner-queued briefing, with its private note, to ai_text', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(), { ai: ai(prompts) });
    const schedule = job([{ account: 'public' }], host.capability);
    await drain(schedule);
    const maya = (await call('list_people', { limit: 50 }, me)).items.find((item: { name: string }) => item.name === 'Maya Chen');
    await call('save_note', { subjectKind: 'person', subjectId: maya.id, body: PRIVATE }, me);
    await call('set_extraction', { enabled: true }, me);
    const queued = await call('request_briefing', { subjectKind: 'person', subjectId: maya.id }, owner([], host.capability));
    expect(queued.availability).toBe('queued');
    await drain(schedule);
    expect(prompts.some((prompt) => prompt.includes('Private note'))).toBe(false);
    expect(prompts.some((prompt) => prompt.includes('meeting preparation'))).toBe(false);
    expect(briefingItems().map((item) => item.state)).toEqual(['pending']);
  });

  it('a schedule generates an upcoming-meeting briefing under its own account scope, and the owner can read it', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(true), { ai: ai(prompts) });
    await call('set_extraction', { enabled: true }, me);
    const schedule = job([{ account: 'public' }, { account: 'public', binding: 'calendar' }], host.capability);
    await drain(schedule);
    const maya = (await call('list_people', { limit: 50 }, me)).items.find((item: { name: string }) => item.name === 'Maya Chen');
    await call('save_note', { subjectKind: 'person', subjectId: maya.id, body: PRIVATE }, me);
    // The job queued it under its own sources, never a fabricated owner scope.
    const items = briefingItems();
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(JSON.parse(item.payload).scope).toMatchObject({ kind: 'sources', sources: ['account:public'] });
    expect(items.every((item) => item.state === 'done')).toBe(true);
    const briefingPrompts = prompts.filter((prompt) => prompt.includes('meeting preparation'));
    expect(briefingPrompts.length).toBeGreaterThan(0);
    expect(briefingPrompts.some((prompt) => prompt.includes('Private note'))).toBe(false);
    const forOwner = await call('get_briefing', { subjectKind: 'person', subjectId: maya.id }, me);
    expect(forOwner.origin).toBe('generated');
    expect(forOwner.statusLabel).toMatch(/from owner@personal\.example only$/);
  });

  it('the owner\'s own Prepare runs under the owner scope, through the owner\'s step', async () => {
    const prompts: string[] = [];
    const host = fakeHost(world(), { ai: ai(prompts) });
    await drain(job([{ account: 'public' }], host.capability));
    const maya = (await call('list_people', { limit: 50 }, me)).items.find((item: { name: string }) => item.name === 'Maya Chen');
    await call('save_note', { subjectKind: 'person', subjectId: maya.id, body: PRIVATE }, me);
    await call('set_extraction', { enabled: true }, me);
    const ownerCaller = owner([], host.capability);
    expect((await call('request_briefing', { subjectKind: 'person', subjectId: maya.id }, ownerCaller)).availability).toBe('queued');
    const step = await call('continue_import', { source: 'briefings' }, ownerCaller);
    expect(step.ran).toEqual({ kind: 'briefing', source: 'briefings' });
    expect(prompts.some((prompt) => prompt.includes('meeting preparation') && prompt.includes('Private note'))).toBe(true);
    expect((await call('get_briefing', { subjectKind: 'person', subjectId: maya.id }, ownerCaller)).origin).toBe('generated');
  });
});

describe('a private pipeline stays private through shared opportunities', () => {
  async function world() {
    const deals = (await call('save_collection', { label: 'Deals' }, me)).key;
    const jordan = (await call('save_person', { name: 'Jordan Bell' }, me)).record;
    const fieldwork = (await call('save_organization', { name: 'Fieldwork' }, me)).record;
    const pipeline = (await call('save_pipeline', { name: 'Secret acquisitions', template: 'client_work', collection: deals }, me)).record;
    const opportunity = (await call('save_opportunity', { title: 'Shared onboarding', pipelineId: pipeline.id, organizationId: fieldwork.id, personIds: [jordan.id], nextAction: 'Send the proposal', nextActionDate: '2026-10-20', collection: 'manual' }, me)).record;
    const grant = await call('create_scope', { actorId: 'chat:m', sources: ['manual'], operations: ['read'] }, me);
    return { deals, jordan, fieldwork, pipeline, opportunity, m: chat('m', grant.scopeRef) };
  }

  it('hides the opportunity from detail, lists, boards, counts, record pages and context when its pipeline is private', async () => {
    const w = await world();
    expect((await call('list_pipelines', {}, w.m)).items).toEqual([]);
    await expectCode(call('get_opportunity', { id: w.opportunity.id }, w.m), 'not_found');
    const listed = await call('list_opportunities', { limit: 50 }, w.m);
    expect(listed.total).toBe(0);
    expect(listed.items).toEqual([]);
    const board = await call('list_opportunities', { limit: 50, filters: { pipelineId: w.pipeline.id } }, w.m);
    expect(board.total).toBe(0);
    expect((await call('list_opportunities', { limit: 50, filters: { text: 'onboarding' } }, w.m)).total).toBe(0);
    const person = await call('get_person', { id: w.jordan.id }, w.m);
    expect(person.opportunities).toEqual([]);
    const company = await call('get_organization', { id: w.fieldwork.id }, w.m);
    expect(JSON.stringify(company)).not.toContain('Shared onboarding');
    expect(JSON.stringify(company)).not.toContain('Secret acquisitions');
    for (const subject of [{ subjectKind: 'person', subjectId: w.jordan.id }, { subjectKind: 'organization', subjectId: w.fieldwork.id }]) {
      const context = JSON.stringify(await call('get_relationship_context', subject, w.m));
      expect(context).not.toContain('Shared onboarding');
      expect(context).not.toMatch(/Exploring|Discussing|Proposal/);
    }
    await expectCode(call('get_relationship_context', { subjectKind: 'opportunity', subjectId: w.opportunity.id }, w.m), 'not_found');
    const view = await call('describe_view_context', { path: `/opportunities/${w.opportunity.id}`, query: {}, state: { section: 'opportunity', selected: [{ kind: 'opportunity', id: w.opportunity.id }] } }, w.m);
    expect(view.modelContent).not.toContain('Shared onboarding');
    // A derived next action does not surface it either.
    expect(JSON.stringify((await call('list_people', { limit: 50 }, w.m)).items)).not.toContain('Send the proposal');
    expect((await call('list_people', { limit: 50, filters: { hasFollowUp: true } }, w.m)).total).toBe(0);
  });

  it('leaves the owner\'s view unchanged', async () => {
    const w = await world();
    const detail = await call('get_opportunity', { id: w.opportunity.id }, me);
    expect(detail.opportunity.pipelineName).toBe('Secret acquisitions');
    expect((await call('list_opportunities', { limit: 50, filters: { pipelineId: w.pipeline.id } }, me)).total).toBe(1);
    expect((await call('get_person', { id: w.jordan.id }, me)).opportunities).toHaveLength(1);
    expect(JSON.stringify(await call('get_relationship_context', { subjectKind: 'organization', subjectId: w.fieldwork.id }, me))).toContain('Shared onboarding');
  });
});

describe('scheduled extraction never sends private opportunities to ai_text', () => {
  async function world() {
    const prompts: string[] = [];
    const host = fakeHost({ public: { email: OWNER, mail: [
      mail('j1', { from: OWNER, to: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Scope', body: 'I will send the revised proposal by Friday.', sent: true, date: recent(3), messageId: '<j1@personal.example>' }),
    ] } }, { ai: (prompt) => { prompts.push(prompt); return '{"commitments":[],"resolutions":[],"facts":[],"stages":[]}'; } });
    await call('set_extraction', { enabled: true }, me);
    const deals = (await call('save_collection', { label: 'Deals' }, me)).key;
    const jordan = (await call('save_person', { name: 'Jordan Bell', identifiers: [{ kind: 'email', value: 'jordan@fieldwork.example' }] }, me)).record;
    const pipeline = (await call('save_pipeline', { name: 'Secret acquisitions', template: 'client_work', collection: deals }, me)).record;
    await call('save_opportunity', { title: 'Secret expansion', pipelineId: pipeline.id, personIds: [jordan.id], collection: deals }, me);
    return { prompts, host };
  }

  it('a schedule extracts without the private opportunity, and the owner\'s own step includes it', async () => {
    const scheduled = await world();
    const schedule = job([{ account: 'public' }], scheduled.host.capability);
    for (let index = 0; index < 20; index++) if (!(await call('run_background_step', {}, schedule)).ran) break;
    expect(scheduled.prompts.length).toBeGreaterThan(0);
    expect(scheduled.prompts.some((prompt) => prompt.includes('Secret expansion') || prompt.includes('Secret acquisitions'))).toBe(false);
  });

  it('the owner running the same step sees the opportunity in the prompt', async () => {
    const owned = await world();
    for (let index = 0; index < 20; index++) if (!(await call('sync_step', {}, job([{ account: 'public' }], owned.host.capability))).ran) break;
    expect(owned.prompts).toEqual([]);
    const kinds: string[] = [];
    for (let index = 0; index < 5 && !kinds.includes('enrich'); index++) kinds.push((await call('continue_import', { source: 'account:public' }, owner(['public'], owned.host.capability))).ran?.kind ?? 'none');
    expect(kinds).toContain('enrich');
    expect(owned.prompts.some((prompt) => prompt.includes('Secret expansion'))).toBe(true);
  });
});

describe('search never indexes a private company name under a shared source', () => {
  async function world() {
    const circle = (await call('save_collection', { label: 'Private circle' }, me)).key;
    const jordan = (await call('save_person', { name: 'Jordan Bell' }, me)).record;
    const hidden = (await call('save_organization', { name: 'Hidden Ventures', collection: circle }, me)).record;
    await call('save_affiliation', { personId: jordan.id, organizationId: hidden.id, role: 'Founder', collection: 'manual' }, me);
    const grant = await call('create_scope', { actorId: 'chat:s', sources: ['manual'], operations: ['read'] }, me);
    return { circle, jordan, hidden, s: chat('s', grant.scopeRef) };
  }

  it('finds nothing for the private name from a shared-only scope, while the role, detail and owner search still work', async () => {
    const w = await world();
    const before = (await call('list_people', { limit: 50 }, w.s)).total;
    const hiddenSearch = await call('search_people', { text: 'Hidden Ventures', limit: 20 }, w.s);
    expect(hiddenSearch.total).toBe(0);
    expect(hiddenSearch.items).toEqual([]);
    expect((await call('list_people', { limit: 50, filters: { text: 'Hidden' } }, w.s)).total).toBe(0);
    expect((await call('list_people', { limit: 50 }, w.s)).total).toBe(before);
    expect((await call('search_people', { text: 'Founder', limit: 20 }, w.s)).items.map((item: { name: string }) => item.name)).toEqual(['Jordan Bell']);
    expect(JSON.stringify(await call('get_person', { id: w.jordan.id }, w.s))).not.toContain('Hidden Ventures');
    expect((await call('search_people', { text: 'Hidden Ventures', limit: 20 }, me)).items.map((item: { name: string }) => item.name)).toEqual(['Jordan Bell']);
    expect((await call('get_person', { id: w.jordan.id }, me)).header.company?.name).toBe('Hidden Ventures');
  });

  it('a one-time reindex at startup corrects a row written the old way', async () => {
    const w = await world();
    // A search row as the earlier version wrote it: the private name under the shared source.
    ctx!.db.tx(() => setSearchRow(ctx!, `person:${w.jordan.id}:manual`, 'person', w.jordan.id, 'manual', 'Jordan Bell Founder Hidden Ventures'));
    ctx!.settings.set('search_index_version', 0);
    expect((await call('search_people', { text: 'Hidden Ventures', limit: 20 }, w.s)).total).toBe(1);
    ctx!.close();
    ctx = await openContext({ dataDir: state.dataDir, instanceId: INSTANCE });
    useContext(ctx);
    expect((await call('search_people', { text: 'Hidden Ventures', limit: 20 }, w.s)).total).toBe(0);
    expect((await call('search_people', { text: 'Hidden Ventures', limit: 20 }, me)).total).toBe(1);
  });
});
