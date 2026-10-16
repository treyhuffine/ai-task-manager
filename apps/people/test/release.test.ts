import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Ctx } from '../src/domain/context.js';
import { openContext, useContext } from '../src/runtime.js';
import { call, chat, job, owner, setup, teardown, tempDir, INSTANCE, expectCode, state } from './helpers.js';
import { fakeHost, mail, OWNER, OWNER_WORK, type FakeAccount } from './fakes.js';

let ctx: Ctx | null = null;
beforeEach(async () => { ctx = await setup({ now: new Date().toISOString(), realTime: true }); });
afterEach(() => { teardown(ctx); ctx = null; });
const recent = (days: number) => new Date(Date.now() - days * 864e5).toISOString();
const day = (offset: number) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
async function steps(caller: Parameters<typeof call>[2], max = 40) { for (let index = 0; index < max; index++) if (!(await call('run_background_step', {}, caller)).ran) break; }
const empty = { commitments: [], resolutions: [], facts: [], stages: [] };

describe('People release requirements', () => {
  it('A person with twenty contacts gets preparation and follow-ups without configuring companies, lists or stages. Enabling and hiding Companies/Pipelines preserves IDs, notes, filters, grants and task links.', async () => {
    const host = fakeHost({ personal: { email: OWNER, mail: Array.from({ length: 20 }, (_, index) => mail(`f${index}`, { from: OWNER, to: [`Friend ${index} <friend${index}@fastmail.com>`], subject: `Catch-up ${index}`, body: `Lovely to see you. I will send the photos from Saturday.`, sent: true, date: recent(index + 1) })) } });
    const me = owner(['personal'], host.capability);
    await steps(job([{ account: 'personal' }], host.capability));
    const opened = await call('open_view', { path: '/', query: {} }, me);
    expect(opened.data.navigation).toMatchObject({ companies: 'hidden', pipelines: 'hidden', landing: 'today' });
    const people = await call('list_people', { limit: 50 }, me);
    expect(people.total).toBe(20);
    const friend = people.items[0];
    const briefing = await call('get_briefing', { subjectKind: 'person', subjectId: friend.id }, me);
    expect(briefing.items.length).toBeGreaterThan(0);
    await call('save_note', { subjectKind: 'person', subjectId: friend.id, body: 'Loves film photography.' }, me);
    const follow = await call('create_follow_up', { subject: { kind: 'person', id: friend.id }, title: 'Send the photos', dueAt: day(2), operationId: randomUUID() }, me);
    expect(follow.link.status).toBe('linked');
    const scope = await call('create_scope', { actorId: 'chat:friends', sources: ['account:personal', 'manual'], operations: ['read'] }, me);
    const view = (await call('save_view', { label: 'Recent friends', recordKind: 'person', filters: { lastExchange: { withinDays: 7 } } }, me)).record;
    const today = await call('get_today', {}, me);
    expect(today.iOwe.length).toBe(1);
    // Turning optional views on and off changes navigation only.
    await call('save_navigation', { companies: 'shown', pipelines: 'shown' }, me);
    await call('save_navigation', { companies: 'hidden', pipelines: 'hidden' }, me);
    const after = await call('get_person', { id: friend.id }, me);
    expect(after.person.id).toBe(friend.id);
    expect(after.notes[0].body).toBe('Loves film photography.');
    expect(after.taskLinks[0].taskId).toBe(follow.link.taskId);
    expect((await call('list_views', { limit: 10 }, me)).items[0]).toMatchObject({ id: view.id, filters: { lastExchange: { withinDays: 7 } } });
    expect((await call('list_people', { limit: 50 }, chat('friends', scope.scopeRef))).total).toBe(20);
  });

  it('A consultant can create two opportunities at one company, associate different contacts, move a stage and create one dated Ri task. A friend can remain entirely outside pipelines.', async () => {
    const host = fakeHost({});
    const me = owner([], host.capability);
    const company = (await call('save_organization', { name: 'Fieldwork' }, me)).record;
    const jordan = (await call('save_person', { name: 'Jordan Bell' }, me)).record;
    const priya = (await call('save_person', { name: 'Priya Shah' }, me)).record;
    const friend = (await call('save_person', { name: 'Alex Rivera' }, me)).record;
    const pipeline = (await call('save_pipeline', { name: 'Client work', template: 'client_work' }, me)).record;
    const one = (await call('save_opportunity', { title: 'Onboarding project', pipelineId: pipeline.id, organizationId: company.id, personIds: [jordan.id] }, me)).record;
    await call('save_opportunity', { title: 'Research workshop', pipelineId: pipeline.id, organizationId: company.id, personIds: [priya.id] }, me);
    const proposal = pipeline.stages.find((stage: { label: string }) => stage.label === 'Proposal').id;
    expect((await call('move_opportunity', { id: one.id, expectedRevision: one.revision, stageId: proposal }, me)).record.stageLabel).toBe('Proposal');
    await call('create_follow_up', { subject: { kind: 'opportunity', id: one.id }, title: 'Send revised proposal', dueAt: day(1), operationId: randomUUID() }, me);
    expect(host.count('create_task')).toBe(1);
    expect(host.calls.find((item) => item.name === 'create_task')!.input.dueAt).toBe(day(1));
    const detail = await call('get_organization', { id: company.id }, me);
    expect(detail.opportunities.map((item: { title: string }) => item.title).sort()).toEqual(['Onboarding project', 'Research workshop']);
    const alex = await call('get_person', { id: friend.id }, me);
    expect(alex.opportunities).toEqual([]);
    expect(alex.header.company).toBeNull();
  });

  it('Same-name people, shared inboxes, plus aliases, shared company domains and two separate accounts remain distinct until justified or explicitly merged. Merge/undo preserves later references without guesses or loss.', async () => {
    const host = fakeHost({
      a: { email: OWNER, mail: [mail('a1', { from: OWNER, to: ['Sam Lee <sam@atlas.example>', 'Sam Lee <sam+work@atlas.example>', 'Help <support@atlas.example>'], body: 'Hi both', sent: true, date: recent(3) })] },
      b: { email: OWNER_WORK, mail: [mail('b1', { from: OWNER_WORK, to: ['Sam Lee <sam.lee@otherco.example>'], body: 'Hello', sent: true, date: recent(2) })] },
    });
    const me = owner(['a', 'b'], host.capability);
    await steps(job([{ account: 'a' }, { account: 'b' }], host.capability));
    const sams = (await call('list_people', { limit: 10, filters: { text: 'Sam' } }, me)).items;
    expect(sams.length).toBe(3);
    expect((await call('search_people', { text: 'support', limit: 5 }, me)).total).toBe(0);
    await call('save_organization', { name: 'Atlas', website: 'atlas.example' }, me);
    await call('save_organization', { name: 'Atlas Labs', website: 'atlas.example' }, me);
    expect((await call('list_organizations', { limit: 10 }, me)).total).toBe(2);
    const [x, y] = sams;
    const { mergeId } = await call('merge_people', { survivorId: x.id, mergedId: y.id, survivorRevision: x.revision, mergedRevision: y.revision }, me);
    const later = (await call('save_note', { subjectKind: 'person', subjectId: x.id, body: 'Written after the merge' }, me)).record;
    const preview = await call('undo_merge', { mergeId, preview: true }, me);
    expect(preview.laterReferences.map((item: { ref: string }) => item.ref)).toContain(`notes:${later.id}`);
    await call('undo_merge', { mergeId, expectedRevision: preview.revision, digest: preview.digest, attributions: preview.laterReferences.map((item: { ref: string }) => ({ ref: item.ref, to: 'survivor' })) }, me);
    expect((await call('list_people', { limit: 10, filters: { text: 'Sam' } }, me)).total).toBe(3);
    expect((await call('get_person', { id: x.id }, me)).notes.map((note: { body: string }) => note.body)).toEqual(['Written after the merge']);
  });

  it('An employee changes companies without moving historical exchanges or private notes into the new company. An old imported role retains its date. Company activity deduplicates a multi-person thread.', async () => {
    const data: Record<string, FakeAccount> = { work: { email: OWNER_WORK, mail: [
      mail('t1', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>', 'Priya Shah <priya@fieldwork.example>'], subject: 'Scope', threadId: 'thread-scope', body: 'Scope draft attached.', sent: true, date: recent(10) }),
      mail('t2', { from: 'Jordan Bell <jordan@fieldwork.example>', to: [OWNER_WORK], cc: ['Priya Shah <priya@fieldwork.example>'], subject: 'Re: Scope', threadId: 'thread-scope', body: 'Looks right.', date: recent(9) }),
    ] } };
    const host = fakeHost(data);
    const me = owner(['work'], host.capability);
    await steps(job([{ account: 'work' }], host.capability));
    const fieldwork = (await call('save_organization', { name: 'Fieldwork' }, me)).record;
    const northstar = (await call('save_organization', { name: 'Northstar' }, me)).record;
    const people = (await call('list_people', { limit: 10 }, me)).items;
    const jordan = people.find((item: { name: string }) => item.name === 'Jordan Bell');
    const priya = people.find((item: { name: string }) => item.name === 'Priya Shah');
    for (const person of [jordan, priya]) {
      const detail = await call('get_person', { id: person.id }, me);
      const preview = await call('preview_company_attribution', { personId: person.id, keyId: detail.identities[0].keyId, organizationId: fieldwork.id, account: 'account:work' }, me);
      await call('apply_company_attribution', { previewId: preview.previewId, digest: preview.digest }, me);
    }
    const activity = await call('list_interactions', { subjectKind: 'organization', subjectId: fieldwork.id, limit: 10 }, me);
    expect(activity.items.length).toBe(1);
    expect(activity.items[0].threadCount).toBe(2);
    await call('save_note', { subjectKind: 'person', subjectId: jordan.id, body: 'Private: thinking about leaving.' }, me);
    const role = (await call('save_affiliation', { personId: jordan.id, organizationId: fieldwork.id, role: 'Founder', validFrom: '2020-01-01' }, me)).record;
    await call('save_affiliation', { id: role.id, expectedRevision: role.revision, validTo: day(-1) }, me);
    await call('save_affiliation', { personId: jordan.id, organizationId: northstar.id, role: 'Design director', validFrom: day(0) }, me);
    expect((await call('list_interactions', { subjectKind: 'organization', subjectId: northstar.id, limit: 10 }, me)).items).toEqual([]);
    expect((await call('get_organization', { id: northstar.id }, me)).notes).toEqual([]);
    const old = await call('get_organization', { id: fieldwork.id }, me);
    expect(old.people.former.map((item: { personName: string }) => item.personName)).toEqual(['Jordan Bell']);
    expect((await call('list_interactions', { subjectKind: 'organization', subjectId: fieldwork.id, limit: 10 }, me)).items.length).toBe(1);
    const header = (await call('get_person', { id: jordan.id }, me)).header;
    expect(header.company.name).toBe('Northstar');
    // An imported role keeps its observation date and is never current employment by itself.
    const csv = Buffer.from('Name,Email,Company,Title,Connected On\nPriya Shah,priya@fieldwork.example,Fieldwork,Operations,2019-05-04\n').toString('base64');
    const imported = await call('preview_import', { fileName: 'old.csv', mimeType: 'text/csv', base64: csv }, me);
    await call('apply_import', { previewId: imported.previewId, digest: imported.digest, companyDecisions: [{ key: 'fieldwork', action: 'existing', organizationId: fieldwork.id }] }, me);
    const priyaRole = (await call('get_person', { id: priya.id }, me)).affiliations.find((item: { origin: string }) => item.origin === 'import');
    expect(priyaRole).toMatchObject({ observedAt: '2019-05-04T12:00:00.000Z', confidence: 'observed', status: 'unknown' });
  });

  it('A confirmed company-attribution rule includes later qualifying exchanges without per-message review. Exclusions, rule removal and date changes retract only its derived links and invalidate affected summaries.', async () => {
    const data: Record<string, FakeAccount> = { work: { email: OWNER_WORK, mail: [
      mail('r1', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Kickoff', body: 'Kickoff notes', sent: true, date: recent(20) }),
      mail('r2', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Budget', body: 'Budget notes', sent: true, date: recent(10) }),
    ] } };
    const host = fakeHost(data);
    const me = owner(['work'], host.capability);
    await steps(job([{ account: 'work' }], host.capability));
    const company = (await call('save_organization', { name: 'Fieldwork' }, me)).record;
    const jordan = (await call('list_people', { limit: 5 }, me)).items[0];
    const keyId = (await call('get_person', { id: jordan.id }, me)).identities[0].keyId;
    const preview = await call('preview_company_attribution', { personId: jordan.id, keyId, organizationId: company.id, account: 'account:work' }, me);
    expect(preview.matches.total).toBe(2);
    const applied = await call('apply_company_attribution', { previewId: preview.previewId, digest: preview.digest }, me);
    const manualTarget = (await call('list_interactions', { subjectKind: 'organization', subjectId: company.id, limit: 10 }, me)).items.find((item: { title: string }) => item.title === 'Kickoff');
    await call('link_interaction', { interactionId: manualTarget.id, expectedRevision: manualTarget.revision, operation: 'link', target: { kind: 'organization', id: company.id } }, me);
    const briefingBefore = await call('get_briefing', { subjectKind: 'organization', subjectId: company.id }, me);
    // Later qualifying mail joins automatically.
    data.work.mail.push(mail('r3', { from: OWNER_WORK, to: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Timeline', body: 'Timeline notes', sent: true, date: recent(1) }));
    data.work.history = [{ added: ['r3'] }];
    for (let index = 0; index < 4; index++) await call('continue_import', { source: 'account:work' }, me);
    const titles = async () => (await call('list_interactions', { subjectKind: 'organization', subjectId: company.id, limit: 10 }, me)).items.map((item: { title: string }) => item.title).sort();
    expect(await titles()).toEqual(['Budget', 'Kickoff', 'Timeline']);
    const briefingAfter = await call('get_briefing', { subjectKind: 'organization', subjectId: company.id }, me);
    expect(JSON.stringify(briefingAfter.items)).not.toBe(JSON.stringify(briefingBefore.items));
    // Excluding one exchange retracts it from the company.
    const budget = (await call('list_interactions', { subjectKind: 'organization', subjectId: company.id, limit: 10 }, me)).items.find((item: { title: string }) => item.title === 'Budget');
    await call('link_interaction', { interactionId: budget.id, expectedRevision: budget.revision, operation: 'exclude', target: { kind: 'organization', id: company.id } }, me);
    expect(await titles()).toEqual(['Kickoff', 'Timeline']);
    // Narrowing the dates retracts only this rule's links outside the range.
    const rule = (await call('get_organization', { id: company.id }, me)).attributionRules[0];
    const narrowed = await call('preview_company_attribution', { personId: jordan.id, keyId, organizationId: company.id, account: 'account:work', from: day(-5), ruleId: rule.id }, me);
    await call('apply_company_attribution', { previewId: narrowed.previewId, digest: narrowed.digest }, me);
    expect(await titles()).toEqual(['Kickoff', 'Timeline']);
    // Removing the rule keeps the manual link.
    const current = (await call('get_organization', { id: company.id }, me)).attributionRules[0];
    await call('apply_company_attribution', { ruleId: current.id, expectedRevision: current.revision, disable: true }, me);
    expect(await titles()).toEqual(['Kickoff']);
    expect(applied.linked).toBe(2);
  });

  it('A 100-attendee webinar and a newsletter do not automatically fill the directory. A direct reply does. An invitation or canceled event never implies attendance.', async () => {
    const data: Record<string, FakeAccount> = { p: { email: OWNER, mail: [
      mail('n1', { from: 'Weekly <news@letters.example>', to: [OWNER], subject: 'Issue 12', body: 'Read on', date: recent(3), headers: { 'List-Id': 'letters.example', 'List-Unsubscribe': '<https://letters.example/u>' } }),
      mail('i1', { from: OWNER, to: ['Kim Ito <kim@lab.example>'], subject: 'Question', body: 'Could we talk?', sent: true, date: recent(4), messageId: '<i1@x>' }),
      mail('i2', { from: 'Lee Park <lee@lab.example>', to: [OWNER], subject: 'Re: Question', body: 'Answering for Kim.', date: recent(3), inReplyTo: '<i1@x>' }),
      mail('inv', { from: 'Organizer <host@summit.example>', to: [OWNER], subject: 'Invitation: Summit', body: 'You are invited', date: recent(2) }),
    ], events: [
      { id: 'web', summary: 'Webinar', start: recent(5), end: recent(4.9), attendees: [{ email: OWNER, self: true }, ...Array.from({ length: 100 }, (_, index) => ({ email: `p${index}@crowd.example` }))] },
      { id: 'gone', summary: 'Coffee', start: new Date(Date.now() + 2 * 864e5).toISOString(), end: new Date(Date.now() + 2 * 864e5 + 36e5).toISOString(), attendees: [{ email: OWNER, self: true }, { email: 'kim@lab.example' }] },
    ], eventChanges: [[{ id: 'gone', summary: 'Coffee', start: new Date(Date.now() + 2 * 864e5).toISOString(), end: new Date(Date.now() + 2 * 864e5 + 36e5).toISOString(), cancelled: true, attendees: [{ email: OWNER, self: true }, { email: 'kim@lab.example' }] }]] } };
    const host = fakeHost(data);
    const me = owner(['p'], host.capability);
    await steps(job([{ account: 'p' }, { account: 'p', binding: 'calendar' }], host.capability));
    for (let index = 0; index < 3; index++) await call('continue_import', { source: 'account:p' }, me);
    const names = (await call('list_people', { limit: 100 }, me)).items.map((item: { name: string }) => item.name).sort();
    expect(names).toEqual(['Kim Ito', 'Lee Park']);
    const kim = (await call('list_people', { limit: 5, filters: { text: 'Kim' } }, me)).items[0];
    const timeline = await call('list_interactions', { subjectKind: 'person', subjectId: kim.id, limit: 10, include: ['meeting'] }, me);
    expect(timeline.items[0].label).toBe('Canceled calendar event');
    expect(timeline.items[0].attendance).toBe('unknown');
    expect(kim.nextMeeting).toBeNull();
  });

  it('A promise shows source evidence and creates no task until chosen. A later unrelated reply does not close it. Completion evidence can resolve a suggestion but never silently complete a user commitment or Ri task.', async () => {
    const data: Record<string, FakeAccount> = { p: { email: OWNER, mail: [
      mail('m1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Intro', threadId: 'th', messageId: '<m1@x>', body: 'I will introduce you to the research lead.', sent: true, date: recent(5) }),
      mail('m2', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Deck', threadId: 'th2', messageId: '<m2@x>', body: 'I will send the deck.', sent: true, date: recent(5) }),
    ] } };
    const host = fakeHost(data, { ai: (prompt) => JSON.stringify(
      prompt.includes('Unrelated weekend plans') ? empty
        : prompt.includes('Here is the deck') ? { ...empty, resolutions: [{ commitment: /(C\d+): [^\n]*deck/i.exec(prompt)?.[1] ?? 'C9', kind: 'completed', source: 'S1', passage: 'Here is the deck you asked for.' }] }
          : prompt.includes('I will introduce you') ? { ...empty, commitments: [{ source: 'S1', direction: 'i_owe', other: 'maya@northstar.example', action: 'Introduce Maya to the research lead', due_date: null, passage: 'I will introduce you to the research lead.' }] }
            : prompt.includes('I will send the deck') ? { ...empty, commitments: [{ source: 'S1', direction: 'i_owe', other: 'maya@northstar.example', action: 'Send Maya the deck', due_date: null, passage: 'I will send the deck.' }] }
              : empty) });
    const me = owner(['p'], host.capability);
    await call('set_extraction', { enabled: true }, me);
    const scheduled = job([{ account: 'p' }], host.capability);
    await steps(scheduled);
    const suggestions = (await call('list_commitments', { filter: 'suggestions', limit: 10 }, me)).items.map((item: { commitment: unknown }) => item.commitment) as { id: string; action: string; evidenceId: string; passage: string; revision: number }[];
    expect(suggestions.length).toBe(2);
    expect(host.count('create_task')).toBe(0);
    const intro = suggestions.find((item) => item.action.startsWith('Introduce'))!;
    expect((await call('get_evidence', { id: intro.evidenceId, passage: intro.passage }, me)).passage).toBe(intro.passage);
    await call('review_commitment', { id: intro.id, expectedRevision: intro.revision, decision: 'accept' }, me);
    data.p.mail.push(mail('m3', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Re: Intro', threadId: 'th', inReplyTo: '<m1@x>', body: 'Unrelated weekend plans: hiking?', date: recent(1) }));
    data.p.mail.push(mail('m4', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Re: Deck', threadId: 'th2', inReplyTo: '<m2@x>', body: 'Here is the deck you asked for.', sent: true, date: recent(1) }));
    data.p.history = [{ added: ['m3', 'm4'] }];
    for (let index = 0; index < 4; index++) await call('continue_import', { source: 'account:p' }, me);
    await steps(scheduled);
    const accepted = (await call('list_commitments', { filter: 'i_owe', limit: 10 }, me)).items.map((item: { commitment: { action: string; state: string; completionEvidenceId: string | null } }) => item.commitment);
    expect(accepted[0]).toMatchObject({ action: 'Introduce Maya to the research lead', state: 'accepted', completionEvidenceId: null });
    const resolved = (await call('list_commitments', { filter: 'completed', limit: 10 }, me)).items.map((item: { commitment: { action: string; state: string; resolution: string } }) => item.commitment);
    expect(resolved[0]).toMatchObject({ action: 'Send Maya the deck', state: 'withdrawn' });
    expect(resolved[0].resolution).toMatch(/Resolved by a later message/);
  });

  it('Dismissal, correction and withdrawal survive resync, a changed extraction version and backup restore. A new substantive claim explains why it is being reviewed again.', async () => {
    const data: Record<string, FakeAccount> = { p: { email: OWNER, mail: [
      mail('d1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Intro', body: 'I will introduce you to the research lead.', sent: true, date: recent(6) }),
      mail('d2', { from: 'Maya Chen <maya@northstar.example>', to: [OWNER], subject: 'Hello', body: 'Best,\nMaya Chen\nDesign lead, Northstar', date: recent(5) }),
    ] } };
    const host = fakeHost(data, { ai: (prompt) => JSON.stringify(prompt.includes('I will introduce you') ? { ...empty, commitments: [{ source: prompt.indexOf('I will introduce you') > prompt.indexOf('S2') && prompt.includes('S2') ? 'S2' : 'S1', direction: 'i_owe', other: 'maya@northstar.example', action: 'Introduce Maya to the research lead', due_date: null, passage: 'I will introduce you to the research lead.' }] } : empty) });
    const me = owner(['p'], host.capability);
    await call('set_extraction', { enabled: true }, me);
    const scheduled = job([{ account: 'p' }], host.capability);
    await steps(scheduled);
    const suggestion = (await call('list_commitments', { filter: 'suggestions', limit: 10 }, me)).items[0].commitment;
    await call('review_commitment', { id: suggestion.id, expectedRevision: suggestion.revision, decision: 'dismiss' }, me);
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    const fact = (await call('get_person', { id: maya.id }, me)).facts[0];
    await call('review_fact', { id: fact.id, expectedRevision: fact.revision, decision: 'reject' }, me);
    // Backup and restore: copy the database and its evidence files, open the copy.
    const backup = tempDir('ri-people-backup-');
    ctx!.db.exec(`VACUUM INTO '${path.join(backup, 'records.db')}'`);
    if (fs.existsSync(path.join(state.dataDir, 'blobs'))) fs.cpSync(path.join(state.dataDir, 'blobs'), path.join(backup, 'blobs'), { recursive: true });
    const restored = await openContext({ dataDir: backup, instanceId: INSTANCE }, { now: () => new Date() });
    useContext(restored);
    ctx!.close();
    ctx = restored;
    await call('delete_source_data', { source: 'account:p', confirm: true }, me);
    await steps(scheduled);
    expect((await call('list_commitments', { filter: 'suggestions', limit: 10 }, me)).items).toEqual([]);
    const again = (await call('list_people', { limit: 5 }, me)).items[0];
    expect((await call('get_person', { id: again.id }, me)).facts).toEqual([]);
    // A new message restating the dismissed promise is reviewable, with the earlier dismissal shown.
    data.p.mail.push(mail('d3', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], subject: 'Following up', body: 'As promised, I will introduce you to the research lead.', sent: true, date: recent(1) }));
    data.p.history = [{ added: ['d3'] }];
    for (let index = 0; index < 4; index++) await call('continue_import', { source: 'account:p' }, me);
    await steps(scheduled);
    const fresh = (await call('list_commitments', { filter: 'suggestions', limit: 10 }, me)).items;
    expect(fresh.length).toBe(1);
    expect(fresh[0].commitment.previousDecision).toMatch(/You dismissed a similar suggestion/);
  });

  it('A stale account, held message failure or pending extraction produces partial coverage rather than an all-clear. One source\'s backfill cannot starve another source or current changes.', async () => {
    const data: Record<string, FakeAccount> = {
      big: { email: OWNER, mail: Array.from({ length: 40 }, (_, index) => mail(`b${index}`, { from: OWNER, to: [`p${index}@big.example`], body: 'x', sent: true, date: recent(index + 1) })) },
      small: { email: OWNER_WORK, mail: [mail('s1', { from: OWNER_WORK, to: ['solo@small.example'], body: 'y', sent: true, date: recent(1) })] },
    };
    const host = fakeHost(data, { pageSize: 10 });
    const me = owner(['big', 'small'], host.capability);
    const scheduled = job([{ account: 'big' }, { account: 'small' }], host.capability);
    const ran: string[] = [];
    for (let index = 0; index < 4; index++) { const result = await call('run_background_step', {}, scheduled); if (result.ran) ran.push(result.ran.source); }
    expect(ran).toContain('account:small');
    const waiting = await call('list_commitments', { filter: 'waiting_on', limit: 10 }, me);
    expect(waiting.items).toEqual([]);
    expect(waiting.coverage.partial).toBe(true);
    await steps(scheduled);
    expect((await call('list_commitments', { filter: 'waiting_on', limit: 10 }, me)).coverage.partial).toBe(false);
    ctx!.db.run("INSERT INTO work_items (id, created_at, updated_at, kind, source_key, dedupe_key, state, attempts, priority, payload, last_error) VALUES ('held', 'x', 'x', 'extract', 'account:big', 'held', 'failed', 3, 'x', '{}', 'The extraction result was not valid')");
    const held = await call('get_today', {}, me);
    expect(held.coverage.partial).toBe(true);
    expect(held.coverage.failed).toBe(1);
  });

  it('With AI disabled, no ai_text capability is invoked, including on sync, search, record open and context read. Manual CRM, deterministic identity linking and saved-source preparation still work.', async () => {
    const host = fakeHost({ p: { email: OWNER, mail: [mail('x1', { from: OWNER, to: ['Maya Chen <maya@northstar.example>'], body: 'I will call you tomorrow.', sent: true, date: recent(2) })] } }, { ai: () => '{}' });
    const me = owner(['p'], host.capability);
    await steps(job([{ account: 'p' }], host.capability));
    const maya = (await call('list_people', { limit: 5 }, me)).items[0];
    await call('search_people', { text: 'Maya', limit: 5 }, me);
    await call('get_person', { id: maya.id }, me);
    await call('get_relationship_context', { subjectKind: 'person', subjectId: maya.id }, me);
    await call('describe_view_context', { path: '/people', query: {}, state: { section: 'people', selected: [{ kind: 'person', id: maya.id }] } }, me);
    await call('save_commitment', { direction: 'i_owe', personId: maya.id, action: 'Call Maya', dueDate: day(1) }, me);
    const briefing = await call('get_briefing', { subjectKind: 'person', subjectId: maya.id }, me);
    expect(briefing.items.some((item: { kind: string }) => item.kind === 'i_owe')).toBe(true);
    expect(host.count('ai_text')).toBe(0);
  });

  it('Removing a source removes its exclusive facts and search results without erasing independent notes. A narrower chat cannot infer hidden companies, stages, amounts, participants or activity through counts, sort order, snippets or cached briefings.', async () => {
    const host = fakeHost({
      p: { email: OWNER, mail: [mail('q1', { from: OWNER, to: ['Zed Quill <zed@quill.example>'], subject: 'Quarterly numbers', body: 'Secret revenue numbers inside.', sent: true, date: recent(2) })] },
      w: { email: OWNER_WORK, mail: [
        mail('q2', { from: OWNER_WORK, to: ['Ann Bloom <ann@bloom.example>', 'Zed Quill <zed@quill.example>'], subject: 'Hello', body: 'Hi', sent: true, date: recent(3) }),
        mail('q3', { from: OWNER_WORK, to: ['Ann Bloom <ann@bloom.example>'], subject: 'Lunch', body: 'Lunch?', sent: true, date: recent(2.5) }),
      ] },
    });
    const me = owner(['p', 'w'], host.capability);
    await steps(job([{ account: 'p' }, { account: 'w' }], host.capability));
    const zed = (await call('list_people', { limit: 5, filters: { text: 'Zed' } }, me)).items[0];
    await call('save_note', { subjectKind: 'person', subjectId: zed.id, body: 'Independent note about Zed.' }, me);
    const scope = await call('create_scope', { actorId: 'chat:w', sources: ['account:w'], operations: ['read'] }, me);
    const narrow = chat('w', scope.scopeRef);
    const timeline = await call('list_interactions', { subjectKind: 'person', subjectId: zed.id, limit: 10 }, narrow);
    expect(JSON.stringify(timeline)).not.toMatch(/Quarterly|Secret revenue/);
    expect((await call('search_people', { text: 'revenue', limit: 5 }, narrow)).total).toBe(0);
    const zedForNarrow = (await call('list_people', { limit: 5, filters: { text: 'Zed' } }, narrow)).items[0];
    expect(zedForNarrow.lastExchangeAt).toBe(timeline.items[0].occurredAt);
    // The owner sees Zed's newer private exchange first. The narrower chat's order uses only what it may see.
    expect((await call('list_people', { limit: 5, sort: { key: 'last_exchange', direction: 'desc' } }, me)).items.map((item: { name: string }) => item.name)).toEqual(['Zed Quill', 'Ann Bloom']);
    expect((await call('list_people', { limit: 5, sort: { key: 'last_exchange', direction: 'desc' } }, narrow)).items.map((item: { name: string }) => item.name)).toEqual(['Ann Bloom', 'Zed Quill']);
    await call('delete_source_data', { source: 'account:p', confirm: true }, me);
    expect((await call('search_people', { text: 'Quarterly', limit: 5 }, me)).total).toBe(0);
    const after = await call('get_person', { id: zed.id }, me);
    expect(after.notes[0].body).toBe('Independent note about Zed.');
    expect((await call('list_interactions', { subjectKind: 'person', subjectId: zed.id, limit: 10, include: ['email'] }, me)).items.map((item: { title: string }) => item.title)).toEqual(['Hello']);
  });

  it('Concurrent stage moves use revision checks. A deleted stage cannot orphan opportunities. A failed/retried follow-up creates one Ri task. Two currencies are never summed together.', async () => {
    const host = fakeHost({}, { failCreateTaskOnce: true });
    const me = owner([], host.capability);
    const pipeline = (await call('save_pipeline', { name: 'Client work', template: 'client_work' }, me)).record;
    const stage = (label: string) => pipeline.stages.find((item: { label: string }) => item.label === label).id;
    const usd = (await call('save_opportunity', { title: 'A', pipelineId: pipeline.id, stageId: stage('Discussing'), value: { minor: 100, currency: 'USD' } }, me)).record;
    await call('save_opportunity', { title: 'B', pipelineId: pipeline.id, value: { minor: 200, currency: 'EUR' } }, me);
    expect((await call('move_opportunity', { id: usd.id, expectedRevision: usd.revision, stageId: stage('Proposal') }, me)).status).toBe('saved');
    expect((await call('move_opportunity', { id: usd.id, expectedRevision: usd.revision, stageId: stage('Won') }, me)).status).toBe('conflict');
    const stages = pipeline.stages.filter((item: { label: string }) => item.label !== 'Proposal').map((item: { id: string; label: string; kind: string }) => ({ id: item.id, label: item.label, kind: item.kind }));
    await expectCode(call('save_pipeline_stages', { pipelineId: pipeline.id, expectedRevision: pipeline.revision, stages }, me), 'invalid_input');
    await call('save_pipeline_stages', { pipelineId: pipeline.id, expectedRevision: pipeline.revision, stages, replacements: [{ stageId: stage('Proposal'), replacementStageId: stage('Discussing') }] }, me);
    expect((await call('get_opportunity', { id: usd.id }, me)).opportunity.stageLabel).toBe('Discussing');
    const operationId = randomUUID();
    expect((await call('create_follow_up', { subject: { kind: 'opportunity', id: usd.id }, title: 'Send proposal', operationId }, me)).link.status).toBe('failed');
    expect((await call('create_follow_up', { subject: { kind: 'opportunity', id: usd.id }, title: 'Send proposal', operationId }, me)).link.status).toBe('linked');
    expect(host.tasks.size).toBe(1);
    expect(JSON.stringify(await call('list_pipelines', {}, me))).not.toContain('300');
  });

  it('Scoped export and full restore preserve stable IDs, memberships, stage history, corrections and decisions. Archive/removal does not delete Ri tasks.', async () => {
    const host = fakeHost({});
    const me = owner([], host.capability);
    const person = (await call('save_person', { name: 'Elena Park', identifiers: [{ kind: 'email', value: 'elena@lab.example' }] }, me)).record;
    const list = (await call('save_list', { name: 'Collaborators', recordKind: 'person' }, me)).record;
    await call('update_list_members', { listId: list.id, expectedRevision: list.revision, add: [person.id] }, me);
    const pipeline = (await call('save_pipeline', { name: 'Intros', template: 'introductions' }, me)).record;
    const opp = (await call('save_opportunity', { title: 'Intro Elena', pipelineId: pipeline.id, personIds: [person.id] }, me)).record;
    await call('move_opportunity', { id: opp.id, expectedRevision: opp.revision, stageId: pipeline.stages[2].id }, me);
    await call('save_note', { subjectKind: 'person', subjectId: person.id, body: 'Ask before introductions.' }, me);
    const follow = await call('create_follow_up', { subject: { kind: 'person', id: person.id }, title: 'Ask Elena', operationId: randomUUID() }, me);
    const tables = ['people', 'lists', 'opportunities', 'stages', 'stage_history', 'notes', 'decisions'] as const;
    const files: Record<string, string> = {};
    for (const table of tables) files[table] = (await call('export_records', { table }, me)).content;
    expect(files.people).toContain(person.id);
    expect(files.lists).toContain(`${list.id},Collaborators,person,manual,${person.id}`);
    expect(files.stage_history.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(files.notes).records[0].body).toBe('Ask before introductions.');
    expect(JSON.parse(files.decisions).formatVersion).toBe(1);
    // Full restore through the snapshot boundary keeps the same IDs.
    const backup = tempDir('ri-people-restore-');
    ctx!.db.exec(`VACUUM INTO '${path.join(backup, 'records.db')}'`);
    const restored = await openContext({ dataDir: backup, instanceId: INSTANCE }, { now: () => new Date() });
    useContext(restored); ctx!.close(); ctx = restored;
    const back = await call('get_person', { id: person.id }, me);
    expect(back.lists[0].id).toBe(list.id);
    expect(back.taskLinks[0].taskId).toBe(follow.link.taskId);
    expect((await call('get_opportunity', { id: opp.id }, me)).history.length).toBe(2);
    await call('delete_record', { kind: 'person', id: person.id, expectedRevision: back.person.revision, mode: 'archive', notes: 'keep', suppress: false }, me);
    expect(host.tasks.size).toBe(1);
    const archived = await call('get_person', { id: person.id }, me);
    await call('delete_record', { kind: 'person', id: person.id, expectedRevision: archived.person.revision, mode: 'remove', notes: 'delete', suppress: true }, me);
    expect(host.tasks.size).toBe(1);
    expect([...host.tasks.values()][0].deleted).toBeUndefined();
  });
});
