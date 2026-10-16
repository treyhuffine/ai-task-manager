/**
 * The spec's "Release requires" list, one named test per bullet, using the
 * spec's wording. All data is fictional and every capability is a fake.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseGmailMessage } from '@ri/app-kit/sources';
import { setup, call, owner, chat, job, fixture, mailAccount, contract } from './helpers.js';
import { calendarEvent, fakeProvider, ics, rawMessage, type FakeMessage } from './fakes.js';
import { ingestCalendarEvent, ingestMessage } from '../src/server/ingest.js';
import { app } from '../src/server/state.js';

const NOW = '2026-10-15T15:00:00Z';
const deliver = (message: FakeMessage, account = 'acct-mail') => ingestMessage(parseGmailMessage(rawMessage(message)), { account, ownAddress: 'you@example.test' });
const save = async (fields: Record<string, unknown>) => (await call('save_opportunity', fields, owner())).record as { id: string; revision: number };
const detail = (id: string) => call('get_opportunity', { id }, owner());

describe('Release requires', () => {
  it('Two roles at one company and two recruiter threads remain correctly separated.', async () => {
    await setup({ now: NOW });
    const designer = await save({ company: 'Northstar', role: 'Product designer' });
    const senior = await save({ company: 'Northstar', role: 'Senior product designer' });
    const fieldwork = await save({ company: 'Fieldwork', role: 'Product lead' });
    const lumen = await save({ company: 'Lumen', role: 'Staff designer' });

    // Two roles at one company: the longer title is not mistaken for the shorter, and a domain alone attaches to neither.
    deliver({ id: 'ns-ack', threadId: 'ns-t1', from: 'Northstar Careers <careers@northstar.example>', subject: 'Application received: Senior Product Designer', text: 'Thank you for applying for the Senior Product Designer position.', date: '2026-10-08T10:00:00Z' });
    expect((await detail(senior.id)).opportunity.stage).toBe('applied');
    expect((await detail(designer.id)).opportunity.stage).toBe('saved');
    expect((await detail(designer.id)).correspondence).toEqual([]);
    deliver({ id: 'ns-vague', threadId: 'ns-t2', from: 'Northstar Talent <talent@northstar.example>', subject: 'Next steps', text: 'Could you share your availability for a call next week?', date: '2026-10-09T10:00:00Z' });
    expect((await detail(designer.id)).interviews).toEqual([]);
    expect((await detail(senior.id)).interviews).toEqual([]);
    const vague = (await call('list_review', { limit: 10 }, owner())).items[0];
    expect(vague.candidates.map((candidate: { opportunityId: string }) => candidate.opportunityId).sort()).toEqual([designer.id, senior.id].sort());

    // Two recruiter threads from one recruiter stay with their own roles.
    const recruiter = 'Jordan Bell <jordan.bell@talentbridge.example>';
    deliver({ id: 'r1', threadId: 'thread-fieldwork', from: recruiter, subject: 'Product lead at Fieldwork', text: 'I am reaching out about the Product lead role at Fieldwork.', date: '2026-10-10T10:00:00Z' });
    deliver({ id: 'r2', threadId: 'thread-lumen', from: recruiter, subject: 'Staff designer at Lumen', text: 'I am reaching out about the Staff designer role at Lumen.', date: '2026-10-10T11:00:00Z' });
    deliver({ id: 'r3', threadId: 'thread-fieldwork', from: recruiter, subject: 'Re: Product lead at Fieldwork', text: 'Are you free on Tuesday afternoon?', date: '2026-10-11T10:00:00Z', inReplyTo: '<r1@mail.example.test>' });
    deliver({ id: 'r4', threadId: 'thread-lumen', from: recruiter, subject: 'Re: Staff designer at Lumen', text: 'They would like to talk soon. Are you free?', date: '2026-10-11T11:00:00Z', inReplyTo: '<r2@mail.example.test>' });
    const fieldworkMail = (await detail(fieldwork.id)).correspondence.map((item: { threadId: string }) => item.threadId);
    const lumenMail = (await detail(lumen.id)).correspondence.map((item: { threadId: string }) => item.threadId);
    expect(fieldworkMail).toEqual(['thread-fieldwork', 'thread-fieldwork']);
    expect(lumenMail).toEqual(['thread-lumen', 'thread-lumen']);
    deliver({ id: 'r5', threadId: 'thread-new', from: recruiter, subject: 'Quick check-in', text: 'Do you have a few minutes this week?', date: '2026-10-12T10:00:00Z' });
    const fresh = app().db.prepare("SELECT opportunity_id, match_status FROM correspondence WHERE message_id = 'r5'").get();
    expect(fresh).toMatchObject({ opportunity_id: null, match_status: 'review' });
  });

  it('A posting that changes or disappears preserves the version used for preparation.', async () => {
    await setup({ now: NOW });
    const first = 'Product designer at Northstar\n\nRequirements\n- Turn complex workflows into clear product experiences.\n- Partner with research.';
    const record = await save({ company: 'Northstar', role: 'Product designer', description: first });
    const prep = await call('get_preparation', { opportunityId: record.id }, owner());
    expect(prep.requirements.map((item: { text: string }) => item.text)).toEqual(['Turn complex workflows into clear product experiences.', 'Partner with research.']);
    const saved = await call('save_preparation', { opportunityId: record.id, expectedRevision: 0, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [], questions: [], notes: 'Based on the October 8 posting' }, owner());
    const usedSnapshot = saved.record.postingSnapshotId;

    // The listing changes: a newer description becomes a new snapshot, and preparation keeps citing the old one.
    const changed = 'Product designer at Northstar\n\nRequirements\n- Own the design system.';
    const current = (await detail(record.id)).opportunity;
    await call('save_opportunity', { id: record.id, expectedRevision: current.revision, description: changed }, owner());
    const after = await call('get_preparation', { opportunityId: record.id }, owner());
    expect(after.postingSnapshotId).toBe(usedSnapshot);
    expect(after.newerSnapshotId).toBeTruthy();
    expect(after.newerSnapshotId).not.toBe(usedSnapshot);
    expect(after.requirements.map((item: { text: string }) => item.text)).toEqual(['Turn complex workflows into clear product experiences.', 'Partner with research.']);
    const original = await call('get_posting', { id: usedSnapshot }, owner());
    expect(original.text).toBe(first);
    expect(original.latest).toBe(false);
    expect(original.usedByPreparations).toBe(1);

    // The listing disappears: it is marked closed and the snapshot used for preparation still opens.
    const latest = (await detail(record.id)).opportunity;
    await call('save_opportunity', { id: record.id, expectedRevision: latest.revision, listingClosed: true }, owner());
    expect((await call('get_posting', { id: usedSnapshot }, owner())).text).toBe(first);
    const opened = await detail(record.id);
    expect(opened.postings).toHaveLength(2);
    expect(opened.opportunity.listingClosedAt).toBeTruthy();
  });

  it('Editing résumé v3 produces v4 while an existing submission still points to v3.', async () => {
    await setup({ now: NOW });
    let family = (await call('save_material_version', { kind: 'resume', title: 'Product design résumé', text: 'Sam Rivera\nv1 text' }, owner())).record;
    for (const text of ['Sam Rivera\nv2 text', 'Sam Rivera\nv3 text']) {
      family = (await call('save_material_version', { familyId: family.material.id, parentVersionId: family.version.id, expectedRevision: family.material.revision, text }, owner())).record;
    }
    const v3 = family.version;
    expect(v3.number).toBe(3);
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    await call('record_submission', { opportunityId: record.id, expectedRevision: record.revision, appliedOn: '2026-10-09', channel: 'company_site', materialVersionIds: [v3.id], confirmed: true }, owner());

    const edited = await call('save_material_version', { familyId: family.material.id, parentVersionId: v3.id, expectedRevision: family.material.revision, text: 'Sam Rivera\nv4 text, shorter summary', note: 'Shorter summary' }, owner());
    expect(edited.record.version).toMatchObject({ number: 4, parentId: v3.id, origin: 'edited', submitted: false });
    expect(edited.record.version.contentDigest).not.toBe(v3.contentDigest);
    const submission = (await detail(record.id)).submissions[0];
    expect(submission.materials).toEqual([expect.objectContaining({ versionId: v3.id, number: 3, title: 'Product design résumé', shared: true })]);
    const read = await call('get_material', { id: family.material.id, versionId: v3.id }, owner());
    expect(read.text).toBe('Sam Rivera\nv3 text');
    expect(read.version).toMatchObject({ submitted: true, usedBy: [expect.objectContaining({ opportunityId: record.id, company: 'Northstar', appliedOn: '2026-10-09' })] });
    const compare = await call('compare_material_versions', { fromVersionId: v3.id, toVersionId: edited.record.version.id }, owner());
    expect(compare).toMatchObject({ added: 1, removed: 1 });
    // Versions cannot be edited in place, and saving from a stale revision is a conflict, not an overwrite.
    expect(() => app().db.prepare("UPDATE material_versions SET title = 'changed' WHERE id = ?").run(v3.id)).toThrow(/immutable/);
    const stale = await call('save_material_version', { familyId: family.material.id, parentVersionId: v3.id, expectedRevision: family.material.revision, text: 'Sam Rivera\nanother edit' }, owner());
    expect(stale.status).toBe('conflict');
    expect(stale.current.material.latestNumber).toBe(4);
  });

  it('An invitation, confirmed interview, reschedule and cancellation produce accurate states and time zones without an invented rejection.', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    const from = 'Maya Chen <maya.chen@northstar.example>';
    deliver({ id: 'm1', threadId: 'thread', from, subject: 'Portfolio discussion for the Product designer role', text: 'Could you share your availability for a portfolio discussion?', date: '2026-10-09T15:00:00Z' });
    let interviews = (await detail(record.id)).interviews;
    expect(interviews).toEqual([expect.objectContaining({ status: 'scheduling_needed', startAt: null, zone: null })]);
    const id = interviews[0].id;

    deliver({ id: 'm2', threadId: 'thread', from, subject: 'Re: Portfolio discussion', text: 'Thank you. We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT.', date: '2026-10-12T15:04:00Z', inReplyTo: '<m1@mail.example.test>' });
    interviews = (await detail(record.id)).interviews;
    expect(interviews).toEqual([expect.objectContaining({ id, status: 'scheduled', startAt: '2026-10-16T16:00:00.000Z', zone: 'America/Denver' })]);
    expect((await detail(record.id)).opportunity.stage).toBe('interviewing');

    deliver({ id: 'm3', threadId: 'thread', from, subject: 'Updated invitation: Portfolio discussion', text: 'We need to move our interview.', date: '2026-10-13T15:00:00Z', ics: ics({ uid: 'portfolio@northstar.example', sequence: 1, start: '20261019T140000', end: '20261019T144500', zone: 'America/Denver', summary: 'Portfolio discussion', organizer: 'maya.chen@northstar.example', attendees: ['you@example.test'] }) });
    interviews = (await detail(record.id)).interviews;
    expect(interviews).toEqual([expect.objectContaining({ id, status: 'scheduled', startAt: '2026-10-19T20:00:00.000Z', endAt: '2026-10-19T20:45:00.000Z', zone: 'America/Denver' })]);
    expect(interviews[0].history.at(-1)).toMatchObject({ kind: 'rescheduled', summary: 'Moved from Fri, Oct 16, 10:00 MDT to Mon, Oct 19, 14:00 MDT' });

    deliver({ id: 'm4', threadId: 'thread', from, subject: 'Canceled: Portfolio discussion', text: 'Unfortunately we have to cancel the interview.', date: '2026-10-14T15:00:00Z', ics: ics({ uid: 'portfolio@northstar.example', method: 'CANCEL', sequence: 2, status: 'CANCELLED', start: '20261019T140000', end: '20261019T144500', zone: 'America/Denver', summary: 'Portfolio discussion', organizer: 'maya.chen@northstar.example', attendees: ['you@example.test'] }) });
    const opened = await detail(record.id);
    expect(opened.interviews).toEqual([expect.objectContaining({ id, status: 'canceled', startAt: '2026-10-19T20:00:00.000Z', zone: 'America/Denver' })]);
    expect(opened.interviews[0].history.map((event: { kind: string }) => event.kind)).toEqual(['scheduling_needed', 'scheduled', 'rescheduled', 'canceled']);
    expect(opened.opportunity).toMatchObject({ stage: 'interviewing', outcome: null });
    expect(opened.stageHistory.some((event: { toStage: string }) => event.toStage === 'closed')).toBe(false);
  });

  it('An acknowledgment imported twice creates one application event. A manual stage override survives the next sync.', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const ack: FakeMessage = { id: 'ack-1', threadId: 't-ack', from: 'Lumen Recruiting <jobs@lumen.example>', subject: 'Thank you for applying', text: 'Thank you for applying for the Staff designer role at Lumen.', date: '2026-10-12T10:00:00Z', messageId: '<ack-lumen@lumen.example>' };
    const provider = fakeProvider({
      mailbox: {
        'acct-1': { emailAddress: 'you@example.test', pages: [['ack-1']], messages: { 'ack-1': ack }, history: [[{ messagesAdded: [{ message: { id: 'ack-1', threadId: 't-ack' } }] }]] },
        'acct-2': { emailAddress: 'you@work.example.test', pages: [['ack-copy']], messages: { 'ack-copy': { ...ack, id: 'ack-copy', threadId: 't-copy' } } },
      },
    });
    const accounts = [mailAccount('acct-1'), mailAccount('acct-2')];
    for (let index = 0; index < 8; index++) await call('run_background_step', {}, job(accounts, { capability: provider.capability }));
    deliver(ack, 'acct-1');
    const applied = (await detail(record.id)).stageHistory.filter((event: { toStage: string; decision: string }) => event.toStage === 'applied' && event.decision === 'applied');
    expect(applied).toHaveLength(1);
    expect(provider.calls.filter((item) => item.name === 'gmail.read_message' && item.account === 'acct-1')).toHaveLength(1);

    // The person corrects the stage. The next sync brings evidence that disagrees, and the correction stays.
    const current = (await detail(record.id)).opportunity;
    await call('change_stage', { id: record.id, expectedRevision: current.revision, stage: 'closed', outcome: 'withdrawn', note: 'I withdrew' }, owner());
    provider.mailbox['acct-1'].history = [[{ messagesAdded: [{ message: { id: 'invite-1', threadId: 't-ack' } }] }]];
    provider.mailbox['acct-1'].messages['invite-1'] = { id: 'invite-1', threadId: 't-ack', from: 'Lumen Recruiting <jobs@lumen.example>', subject: 'Re: Thank you for applying', text: 'We look forward to speaking with you on Monday, October 19 at 9:00 AM PT.', date: '2026-10-14T10:00:00Z' };
    for (let index = 0; index < 4; index++) await call('run_background_step', {}, job(accounts, { capability: provider.capability }));
    const opened = await detail(record.id);
    expect(opened.opportunity).toMatchObject({ stage: 'closed', outcome: 'withdrawn', stageLocked: true });
    expect(opened.interviews[0]).toMatchObject({ status: 'scheduled', zone: 'America/Los_Angeles' });
  });

  it('A generated preparation answer identifies its source and does not invent user experience. Unsupported extraction shows a usable manual path.', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer', description: 'Product designer at Northstar\n\nRequirements\n- Comfort running usability studies with customers.' });
    const material = await call('save_material_version', { kind: 'resume', title: 'Product design résumé', text: 'Ran monthly usability studies with customer operations staff.' }, owner());
    await call('record_submission', { opportunityId: record.id, expectedRevision: (await detail(record.id)).opportunity.revision, appliedOn: '2026-10-09', channel: 'company_site', materialVersionIds: [material.record.version.id], confirmed: true }, owner());
    const prep = await call('get_preparation', { opportunityId: record.id }, owner());
    const saved = await call('save_preparation', { opportunityId: record.id, expectedRevision: 0, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [], questions: [], notes: '' }, owner());

    let prompt = '';
    const ai = (text: string) => {
      prompt = text;
      return JSON.stringify({ suggestions: [
        { kind: 'talking_point', text: 'Connect your monthly usability studies to their customer research.', evidence: [{ source: 'S2', quote: 'Ran monthly usability studies with customer operations staff.' }, { source: 'S1', quote: 'Comfort running usability studies with customers.' }] },
        { kind: 'talking_point', text: 'Mention the 12 studies you ran at Acme Robotics.', evidence: [{ source: 'S2', quote: 'Ran monthly usability studies' }] },
      ] });
    };
    const provider = fakeProvider({ ai });
    const result = await call('suggest_preparation', { preparationId: saved.record.id }, owner({ capability: provider.capability }));
    expect(prompt).toContain('untrusted data');
    expect(prompt.length).toBeLessThanOrEqual(16000);
    expect(result.outcome).toBe('ready');
    expect(result.preparation.suggestions).toHaveLength(1);
    expect(result.preparation.suggestions[0].evidence.map((entry: { label: string; source: string }) => [entry.source, entry.label])).toEqual([['material', 'Product design résumé v1, as submitted'], ['posting', expect.stringMatching(/^Saved posting/)]]);
    expect(result.preparation.suggestionsState).toMatchObject({ status: 'ready', rejected: 1 });
    expect(result.preparation.examples).toEqual([]);
    expect(result.message).toMatch(/1 suggestion from your saved evidence\. 1 more were left out/);

    // Without AI the workspace stays fully usable by hand.
    const unavailable = await call('suggest_preparation', { preparationId: saved.record.id }, owner());
    expect(unavailable).toMatchObject({ outcome: 'unavailable' });
    expect(unavailable.message).toMatch(/^Extraction unavailable/);
    const manual = await call('save_preparation', { preparationId: saved.record.id, opportunityId: record.id, expectedRevision: saved.record.revision, postingSnapshotId: prep.postingSnapshotId, requirements: prep.requirements, examples: [{ id: 'e1', text: 'My monthly usability studies.', requirementIds: [] }], questions: [{ id: 'q1', text: 'How do customers join research?', requirementIds: [] }], notes: 'Written by hand.' }, owner());
    expect(manual.status).toBe('saved');
    expect(manual.record.suggestions).toHaveLength(1);
  });

  it('An Ask Ri action preserves the native draft, stages the intended source context and performs no application or email send.', async () => {
    await setup({ now: NOW });
    expect(contract.actions.filter((action) => action.effect === 'external_write')).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '../plugin.json'), 'utf8'));
    const requested: string[] = manifest.extensions['com.ri'].requests.integrations.flatMap((item: { actions: string[] }) => item.actions);
    expect(requested.filter((name) => /send|draft|insert|create|update|delete|modify|patch/.test(name))).toEqual([]);

    await call('open_view', { path: '/', query: {} }, fixture());
    const interview = (await call('list_interviews', { limit: 10, upcoming: true }, owner())).items[0];
    const state = { section: 'preparation', selected: [{ type: 'interview', id: interview.id }] };
    const described = await call('describe_view_context', { path: `/interviews/${interview.id}`, query: {}, state }, owner());
    expect(described.modelContent).toContain('Fri, Oct 16, 10:00 MDT (America/Denver)');
    expect(described.modelContent).toContain('Posting snapshot captured');
    expect(described.modelContent).toContain('Product design résumé v3');
    expect(described.modelContent).toContain('Email');
    expect(described.modelContent).toContain('User\'s own example');
    expect(described.recordRefs.map((ref: { entityType: string }) => ref.entityType)).toEqual(expect.arrayContaining(['opportunity', 'interview']));
    // A chat given the saved jobs and the calendar, but not email or materials, gets the interview without them.
    const scope = await call('create_scope', { actorId: 'chat:c-prep', sources: ['manual', 'account:fixture-calendar'], operations: ['read'] }, owner());
    const narrow = await call('describe_view_context', { path: `/interviews/${interview.id}`, query: {}, state }, chat('c-prep', scope.scopeRef));
    expect(narrow.modelContent).not.toContain('Email ');
    expect(narrow.modelContent).not.toContain('Product design résumé v3');
    expect(narrow.modelContent).toContain('a material not shared with this chat');
    expect(app().db.prepare('SELECT COUNT(*) AS count FROM app_invocations').get()).toBeTruthy();
  });
});
