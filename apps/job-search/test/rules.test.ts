/**
 * The spec's "Stage and communication rules" table, one named test per row,
 * plus the "States and recovery" behaviors. All records are fictional.
 */
import { describe, it, expect } from 'vitest';
import { parseGmailMessage } from '@ri/app-kit/sources';
import { sha256 } from '@ri/app-kit/data';
import { setup, call, owner, fixture } from './helpers.js';
import { calendarEvent, ics, rawMessage, type FakeMessage } from './fakes.js';
import { ingestCalendarEvent, ingestMessage } from '../src/server/ingest.js';
import { app } from '../src/server/state.js';

const NOW = '2026-10-15T15:00:00Z';
const deliver = (message: FakeMessage, account = 'acct-mail') => ingestMessage(parseGmailMessage(rawMessage(message)), { account, ownAddress: 'you@example.test' });
const onCalendar = (event: ReturnType<typeof calendarEvent>, account = 'acct-cal') => ingestCalendarEvent(event as never, { account, calendarId: 'primary', calendarZone: 'America/Denver' });

async function save(fields: Record<string, unknown>) {
  const result = await call('save_opportunity', fields, owner());
  return result.record as { id: string; revision: number; stage: string };
}
const detail = (id: string) => call('get_opportunity', { id }, owner());
const reviews = async () => (await call('list_review', { limit: 50 }, owner())).items as { id: string; kind: string; revision: number; candidates: { opportunityId: string; evidence: { kind: string }[] }[]; evidence: { id: string }[]; proposal: { stage: string | null; outcome: string | null } }[];

describe('Stage and communication rules', () => {
  it('Saved posting: create a Saved opportunity and an immutable posting snapshot', async () => {
    await setup({ now: NOW });
    const description = 'Product designer at Northstar\n\nRequirements\n- Turn complex workflows into clear product experiences.';
    const record = await save({ company: 'Northstar', role: 'Product designer', description });
    expect(record.stage).toBe('saved');
    const opened = await detail(record.id);
    expect(opened.postings).toHaveLength(1);
    expect(opened.postings[0].contentDigest).toBe(sha256(description));
    expect(opened.stageHistory[0]).toMatchObject({ toStage: 'saved', author: 'owner-ui:owner', confidence: 'user', decision: 'applied' });
    expect(() => app().db.prepare("UPDATE posting_snapshots SET extracted = '{}' WHERE id = ?").run(opened.postings[0].id)).toThrow(/immutable/);
  });

  it('User marks applied: record Applied with the user-entered date and the selected submission material versions', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    const material = await call('save_material_version', { kind: 'resume', title: 'Résumé', text: 'Sam Rivera\nProduct designer' }, owner());
    const versionId = material.record.version.id;
    await expect(call('record_submission', { opportunityId: record.id, expectedRevision: record.revision, appliedOn: '2026-10-12', channel: 'company_site', materialVersionIds: [versionId], confirmed: false }, owner())).rejects.toThrow(/Confirm that you submitted/);
    const result = await call('record_submission', { opportunityId: record.id, expectedRevision: record.revision, appliedOn: '2026-10-12', channel: 'company_site', materialVersionIds: [versionId], confirmed: true }, owner());
    expect(result.status).toBe('saved');
    expect(result.record.submission.materials.map((item: { versionId: string }) => item.versionId)).toEqual([versionId]);
    expect(result.record.opportunity.stage).toBe('applied');
    const history = (await detail(record.id)).stageHistory;
    expect(history.at(-1)).toMatchObject({ toStage: 'applied', occurredAt: '2026-10-12T12:00:00.000Z', author: 'owner-ui:owner', evidence: { kind: 'submission' } });
  });

  it('Exact application acknowledgment: link the source and suggest Applied, or update automatically when identity is unambiguous and no user override conflicts', async () => {
    await setup({ now: NOW });
    const exact = await save({ company: 'Northstar', role: 'Product designer', requisitionId: 'R-4821' });
    const single = await save({ company: 'Atlas Studio', role: 'Senior product designer' });
    deliver({ id: 'ack-1', threadId: 't-1', from: 'Northstar Careers <no-reply@northstar.example>', subject: 'Thank you for applying', text: 'Thank you for applying for the Product designer role (Req ID: R-4821).', date: '2026-10-09T17:10:00Z' });
    const exactDetail = await detail(exact.id);
    expect(exactDetail.opportunity.stage).toBe('applied');
    expect(exactDetail.stageHistory.at(-1)).toMatchObject({ toStage: 'applied', author: 'automatic', confidence: 'exact', decision: 'applied', occurredAt: '2026-10-09T17:10:00.000Z', evidence: { kind: 'correspondence' } });
    expect(exactDetail.correspondence[0].matchBasis.map((item: { kind: string }) => item.kind)).toContain('requisition');

    deliver({ id: 'ack-2', threadId: 't-2', from: 'Atlas Studio <careers@atlasstudio.example>', subject: 'Thanks for applying to Atlas Studio', text: 'Thanks for applying to Atlas Studio.', date: '2026-10-14T17:45:00Z' });
    const singleDetail = await detail(single.id);
    expect(singleDetail.opportunity.stage).toBe('saved');
    expect(singleDetail.correspondence).toHaveLength(1);
    const suggestion = (await reviews()).find((item) => item.kind === 'stage');
    expect(suggestion?.proposal).toMatchObject({ stage: 'applied' });
    const accepted = await call('resolve_match', { reviewId: suggestion!.id, expectedRevision: suggestion!.revision, decision: 'accept_stage' }, owner());
    expect(accepted.status).toBe('saved');
    expect((await detail(single.id)).opportunity).toMatchObject({ stage: 'applied', stageLocked: true });
  });

  it('Invitation to choose interview times: show Scheduling needed, which is not a scheduled interview', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    deliver({ id: 'inv-1', threadId: 't-portfolio', from: 'Maya Chen <maya.chen@northstar.example>', subject: 'Portfolio discussion for the Product designer role', text: 'Could you share your availability for a 45 minute portfolio discussion next week?', date: '2026-10-10T14:20:00Z' });
    const opened = await detail(record.id);
    expect(opened.interviews).toHaveLength(1);
    expect(opened.interviews[0]).toMatchObject({ status: 'scheduling_needed', startAt: null });
    expect(opened.opportunity.schedulingNeeded).toBe(true);
    expect(opened.opportunity.next).toMatchObject({ kind: 'scheduling' });
    expect((await call('list_interviews', { limit: 10, upcoming: true }, owner())).items).toEqual([]);
    const today = await call('get_today', { zone: 'America/Denver' }, owner());
    expect(today.interviews).toEqual([]);
    expect(today.scheduling.map((item: { opportunityId: string }) => item.opportunityId)).toEqual([record.id]);
    expect(opened.opportunity.stage).toBe('saved');
  });

  it('Matching calendar event or confirmed appointment: create or update the interview, with participant and time-zone evidence', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    deliver({ id: 'inv-1', threadId: 't-portfolio', from: 'Maya Chen <maya.chen@northstar.example>', subject: 'Portfolio discussion for the Product designer role', text: 'Could you share your availability?', date: '2026-10-10T14:20:00Z' });
    const waiting = (await detail(record.id)).interviews[0];
    onCalendar(calendarEvent({ id: 'ev-1', summary: 'Portfolio discussion: Product designer', start: '2026-10-16T10:00:00-06:00', end: '2026-10-16T10:45:00-06:00', zone: 'America/Denver', organizer: 'maya.chen@northstar.example', attendees: [{ email: 'maya.chen@northstar.example', name: 'Maya Chen' }, { email: 'you@example.test', self: true }], joinUrl: 'https://meet.example.test/portfolio' }));
    const opened = await detail(record.id);
    expect(opened.interviews).toHaveLength(1);
    const interview = opened.interviews[0];
    expect(interview.id).toBe(waiting.id);
    expect(interview).toMatchObject({ status: 'scheduled', startAt: '2026-10-16T16:00:00.000Z', endAt: '2026-10-16T16:45:00.000Z', zone: 'America/Denver', origin: 'calendar', format: 'video', meetingLink: 'https://meet.example.test/portfolio' });
    expect(interview.participants).toEqual(expect.arrayContaining([expect.objectContaining({ email: 'maya.chen@northstar.example', name: 'Maya Chen', role: 'organizer' }), expect.objectContaining({ role: 'self' })]));
    expect(interview.history.map((event: { kind: string }) => event.kind)).toEqual(['scheduling_needed', 'scheduled']);
    expect(opened.opportunity.stage).toBe('interviewing');

    // A confirmation email with an invitation file creates the interview in the event's own zone.
    const other = await save({ company: 'Cedar', role: 'Design lead' });
    deliver({ id: 'conf-1', threadId: 't-cedar', from: 'Priya Natarajan <priya@cedar.example>', subject: 'Invitation: Final conversation for the Design lead role', text: 'Your interview is confirmed.', date: '2026-10-11T10:00:00Z', ics: ics({ uid: 'cedar-final@cedar.example', start: '20261020T090000', end: '20261020T100000', zone: 'America/New_York', summary: 'Final conversation', organizer: 'priya@cedar.example', attendees: ['you@example.test'] }) });
    const cedar = (await detail(other.id)).interviews[0];
    expect(cedar).toMatchObject({ status: 'scheduled', startAt: '2026-10-20T13:00:00.000Z', zone: 'America/New_York', origin: 'mail' });
  });

  it('Rescheduled or canceled interview: update that interview identity and retain history, never marking the application rejected from a canceled meeting', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    const base = { id: 'ev-1', summary: 'Portfolio discussion: Product designer', zone: 'America/Denver', organizer: 'maya.chen@northstar.example', attendees: [{ email: 'maya.chen@northstar.example', name: 'Maya Chen' }] };
    onCalendar(calendarEvent({ ...base, start: '2026-10-16T10:00:00-06:00', end: '2026-10-16T10:45:00-06:00' }));
    const first = (await detail(record.id)).interviews[0];
    onCalendar(calendarEvent({ ...base, start: '2026-10-19T14:00:00-06:00', end: '2026-10-19T14:45:00-06:00', updated: '2026-10-13T09:00:00.000Z' }));
    const moved = (await detail(record.id)).interviews;
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: first.id, startAt: '2026-10-19T20:00:00.000Z', zone: 'America/Denver', status: 'scheduled' });
    expect(moved[0].history.at(-1).summary).toMatch(/Moved from Fri, Oct 16, 10:00 MDT to Mon, Oct 19, 14:00 MDT/);
    onCalendar(calendarEvent({ ...base, start: '2026-10-19T14:00:00-06:00', end: '2026-10-19T14:45:00-06:00', cancelled: true, updated: '2026-10-14T09:00:00.000Z' }));
    const opened = await detail(record.id);
    expect(opened.interviews[0]).toMatchObject({ id: first.id, status: 'canceled', sourceState: 'removed' });
    expect(opened.interviews[0].history.map((event: { kind: string }) => event.kind)).toEqual(['scheduled', 'rescheduled', 'source_removed']);
    expect(opened.opportunity.stage).toBe('interviewing');
    expect(opened.opportunity.outcome).toBeNull();
    // A cancellation email for the meeting changes the interview, not the application.
    deliver({ id: 'cancel-1', threadId: 't-c', from: 'Maya Chen <maya.chen@northstar.example>', subject: 'Interview canceled', text: 'Unfortunately we have to cancel the interview for the Product designer role. We will be in touch.', date: '2026-10-14T10:00:00Z' });
    expect((await detail(record.id)).opportunity).toMatchObject({ stage: 'interviewing', outcome: null });
  });

  it('Offer or rejection correspondence: require strong opportunity matching, and send ambiguous or multi-role correspondence to Review', async () => {
    await setup({ now: NOW });
    const designer = await save({ company: 'Northstar', role: 'Product designer' });
    const senior = await save({ company: 'Northstar', role: 'Senior product designer' });
    const cedar = await save({ company: 'Cedar', role: 'Design lead' });
    deliver({ id: 'offer-1', threadId: 't-offer', from: 'Priya <priya@cedar.example>', subject: 'Your offer', text: 'We are delighted to extend an offer for the Design lead role at Cedar.', date: '2026-10-14T15:30:00Z' });
    expect((await detail(cedar.id)).opportunity.stage).toBe('offer');
    expect((await detail(cedar.id)).stageHistory.at(-1)).toMatchObject({ toStage: 'offer', confidence: 'strong', author: 'automatic' });

    deliver({ id: 'rej-1', threadId: 't-rej', from: 'Northstar Talent <talent@northstar.example>', subject: 'Your application', text: 'We have decided to move forward with other candidates.', date: '2026-10-14T16:00:00Z' });
    for (const id of [designer.id, senior.id]) expect((await detail(id)).opportunity.stage).toBe('saved');
    const pending = await reviews();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ kind: 'match', proposal: { stage: 'closed', outcome: 'rejected' } });
    expect(pending[0].candidates.map((candidate) => candidate.opportunityId).sort()).toEqual([designer.id, senior.id].sort());
    for (const candidate of pending[0].candidates) expect(candidate.evidence.length).toBeGreaterThan(0);

    const resolved = await call('resolve_match', { reviewId: pending[0].id, expectedRevision: pending[0].revision, decision: 'attach', opportunityId: senior.id, applyStage: true }, owner());
    expect(resolved.record.opportunityId).toBe(senior.id);
    expect((await detail(senior.id)).opportunity).toMatchObject({ stage: 'closed', outcome: 'rejected' });
    expect((await detail(designer.id)).opportunity.stage).toBe('saved');

    deliver({ id: 'multi-1', threadId: 't-multi', from: 'Northstar Talent <talent@northstar.example>', subject: 'Offer', text: 'We are pleased to extend an offer. It covers the Product designer role and the Senior product designer role.', date: '2026-10-15T09:00:00Z' });
    const message = app().db.prepare("SELECT id, match_status, review_id FROM correspondence WHERE message_id = 'multi-1'").get() as { id: string; match_status: string; review_id: string };
    expect(message.match_status).toBe('review');
    const multi = (await reviews()).find((item) => item.id === message.review_id)!;
    expect(multi).toMatchObject({ kind: 'match', proposal: { stage: 'offer' } });
    expect(multi.candidates.map((candidate) => candidate.opportunityId).sort()).toEqual([designer.id, senior.id].sort());
    expect((await detail(designer.id)).opportunity.stage).toBe('saved');
  });

  it('Manual stage correction: persist the correction and suppress contradictory automatic changes until the user resolves them', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer', requisitionId: 'R-4821' });
    const moved = await call('change_stage', { id: record.id, expectedRevision: record.revision, stage: 'applied', note: 'Applied through a referral' }, owner());
    expect(moved.record).toMatchObject({ stage: 'applied', stageLocked: true });
    onCalendar(calendarEvent({ id: 'ev-1', summary: 'Interview: Product designer', start: '2026-10-16T10:00:00-06:00', end: '2026-10-16T10:45:00-06:00', organizer: 'maya.chen@northstar.example', attendees: [{ email: 'maya.chen@northstar.example' }] }));
    let opened = await detail(record.id);
    expect(opened.opportunity.stage).toBe('applied');
    expect(opened.interviews[0].status).toBe('scheduled');
    expect(opened.stageHistory.at(-1)).toMatchObject({ toStage: 'interviewing', decision: 'suppressed', author: 'automatic' });
    const held = (await reviews()).find((item) => item.kind === 'stage')!;
    expect(held.proposal.stage).toBe('interviewing');
    // A second contradictory signal joins the same review instead of a new prompt.
    deliver({ id: 'conf', threadId: 't-x', from: 'Maya Chen <maya.chen@northstar.example>', subject: 'Re: Product designer', text: 'We look forward to discussing your portfolio on Friday, October 16 at 10:00 MDT.', date: '2026-10-12T09:00:00Z' });
    expect((await reviews()).filter((item) => item.kind === 'stage')).toHaveLength(1);
    const kept = await call('resolve_match', { reviewId: held.id, expectedRevision: (await reviews()).find((item) => item.kind === 'stage')!.revision, decision: 'keep_stage' }, owner());
    expect(kept.status).toBe('saved');
    opened = await detail(record.id);
    expect(opened.opportunity).toMatchObject({ stage: 'applied', stageLocked: true });
    expect(opened.stageHistory.at(-1)).toMatchObject({ decision: 'dismissed', author: 'owner-ui:owner' });
    // Turning automatic updates back on lets the next evidence apply.
    await call('set_stage_tracking', { id: record.id, expectedRevision: opened.opportunity.revision, automatic: true }, owner());
    deliver({ id: 'offer', threadId: 't-o', from: 'Maya Chen <maya.chen@northstar.example>', subject: 'Offer', text: 'We are pleased to extend an offer for the Product designer role.', date: '2026-10-20T09:00:00Z' });
    expect((await detail(record.id)).opportunity.stage).toBe('offer');
  });

  it('every stage change records author or source, confidence category, decision and revision', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Cedar', role: 'Design lead' });
    deliver({ id: 'ack', threadId: 't', from: 'Cedar <jobs@cedar.example>', subject: 'Application received: Design lead', text: 'We have received your application for the Design lead role at Cedar.', date: '2026-10-01T10:00:00Z' });
    const history = (await detail(record.id)).stageHistory;
    expect(history).toHaveLength(2);
    for (const event of history) {
      expect(event.author).toBeTruthy();
      expect(event.source).toBeTruthy();
      expect(['user', 'exact', 'strong', 'probable', 'ai']).toContain(event.confidence);
      expect(['applied', 'suggested', 'suppressed', 'dismissed', 'accepted']).toContain(event.decision);
      expect(event.revision).toBeGreaterThan(0);
    }
    expect(history[1]).toMatchObject({ fromStage: 'saved', toStage: 'applied', source: 'account:acct-mail' });
  });

  it('silence is not a rejection and does not generate a fake deadline: a quiet application gets only a labeled suggestion', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Lumen', role: 'Staff designer' });
    await call('record_submission', { opportunityId: record.id, expectedRevision: record.revision, appliedOn: '2026-09-20', channel: 'company_site', materialVersionIds: [], confirmed: true }, owner());
    const today = await call('get_today', { zone: 'America/Denver' }, owner());
    expect(today.suggestions).toEqual([{ opportunityId: record.id, company: 'Lumen', role: 'Staff designer', appliedOn: '2026-09-20', quietDays: 25 }]);
    expect(today.deadlines).toEqual([]);
    const opened = await detail(record.id);
    expect(opened.opportunity).toMatchObject({ stage: 'applied', outcome: null, deadline: null, nextActionDue: null });
  });

  it('review queues group related evidence so one thread does not create many repetitive prompts, and Ignore keeps the thread quiet', async () => {
    await setup({ now: NOW });
    await save({ company: 'Northstar', role: 'Product designer' });
    await save({ company: 'Northstar', role: 'Senior product designer' });
    for (const [index, text] of ['Thanks for your interest.', 'Following up on my last note.', 'One more question for you.'].entries())
      deliver({ id: `m-${index}`, threadId: 't-same', from: 'Northstar Talent <talent@northstar.example>', subject: 'Re: your candidacy', text, date: `2026-10-1${index}T10:00:00Z` });
    let open = await reviews();
    expect(open).toHaveLength(1);
    expect(open[0].evidence).toHaveLength(3);
    await call('resolve_match', { reviewId: open[0].id, expectedRevision: open[0].revision, decision: 'ignore' }, owner());
    deliver({ id: 'm-4', threadId: 't-same', from: 'Northstar Talent <talent@northstar.example>', subject: 'Re: your candidacy', text: 'Checking in again.', date: '2026-10-14T10:00:00Z' });
    open = await reviews();
    expect(open).toEqual([]);
    expect(app().db.prepare("SELECT match_status FROM correspondence WHERE message_id = 'm-4'").get()).toMatchObject({ match_status: 'ignored' });
  });
});

describe('States and recovery', () => {
  it('a saved URL with no description says "Add the description to prepare with this role", and the link is stored without fetching', async () => {
    await setup({ now: NOW });
    const preview = await call('preview_import', { kind: 'posting', url: 'https://jobs.fieldwork.example/product-lead' }, owner());
    expect(preview.posting.hasText).toBe(false);
    expect(preview.warnings).toContain('Only the link is saved. Add the description to prepare with this role.');
    const applied = await call('apply_import', { previewId: preview.previewId, digest: preview.digest, decisions: { company: 'Fieldwork', role: 'Product lead' } }, owner());
    const opened = await detail(applied.opportunityIds[0]);
    expect(opened.opportunity.sourceUrl).toBe('https://jobs.fieldwork.example/product-lead');
    expect(opened.postings).toEqual([]);
    expect(opened.opportunity.note).toBe('Add the description to prepare with this role');
  });

  it('a closed listing still opens its retained snapshot', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Atlas Studio', role: 'Senior product designer', description: 'Senior product designer at Atlas Studio\n\nRequirements\n- Lead design reviews.' });
    const closed = await call('save_opportunity', { id: record.id, expectedRevision: (await detail(record.id)).opportunity.revision, listingClosed: true }, owner());
    expect(closed.record.listingClosedAt).toBeTruthy();
    const opened = await detail(record.id);
    const posting = await call('get_posting', { id: opened.postings[0].id }, owner());
    expect(posting).toMatchObject({ textAvailable: true });
    expect(posting.text).toContain('Lead design reviews.');
  });

  it('a calendar deletion updates the interview and never erases preparation notes or submission history', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    await call('record_submission', { opportunityId: record.id, expectedRevision: record.revision, appliedOn: '2026-10-09', channel: 'company_site', materialVersionIds: [], confirmed: true }, owner());
    const event = { id: 'ev-1', summary: 'Interview: Product designer', start: '2026-10-16T10:00:00-06:00', end: '2026-10-16T10:45:00-06:00', organizer: 'maya.chen@northstar.example', attendees: [{ email: 'maya.chen@northstar.example' }] };
    onCalendar(calendarEvent(event));
    const interview = (await detail(record.id)).interviews[0];
    const prep = await call('get_preparation', { opportunityId: record.id, interviewId: interview.id }, owner());
    await call('save_preparation', { opportunityId: record.id, interviewId: interview.id, expectedRevision: prep.revision, requirements: [], examples: [{ id: 'e1', text: 'My onboarding project.', requirementIds: [] }], questions: [], notes: 'Bring the decision log.' }, owner());
    onCalendar(calendarEvent({ ...event, cancelled: true }));
    const opened = await detail(record.id);
    expect(opened.interviews[0]).toMatchObject({ status: 'canceled', sourceState: 'removed' });
    expect(opened.submissions).toHaveLength(1);
    const kept = await call('get_preparation', { interviewId: interview.id }, owner());
    expect(kept.notes).toBe('Bring the decision log.');
    expect(kept.examples[0].text).toBe('My onboarding project.');
  });

  it('refresh preserves preparation notes: saves keep revisions and a stale save returns the current version to compare', async () => {
    await setup({ now: NOW });
    const record = await save({ company: 'Northstar', role: 'Product designer' });
    const base = { opportunityId: record.id, requirements: [], examples: [], questions: [] };
    const first = await call('save_preparation', { ...base, expectedRevision: 0, notes: 'First draft' }, owner());
    const second = await call('save_preparation', { ...base, preparationId: first.record.id, expectedRevision: 1, notes: 'Second draft' }, owner());
    expect(second.record.revision).toBe(2);
    const stale = await call('save_preparation', { ...base, preparationId: first.record.id, expectedRevision: 1, notes: 'From another tab' }, owner());
    expect(stale).toMatchObject({ status: 'conflict', current: { notes: 'Second draft', revision: 2 } });
    expect(second.record.revisions.map((item: { revision: number }) => item.revision)).toEqual([2, 1]);
  });

  it('interrupted parsing resumes from a saved import without duplicating opportunities', async () => {
    await setup({ now: NOW });
    const csv = 'Company,Title,Status,Date Applied\nLumen,Staff designer,Applied,2026-10-12\nCedar,Design lead,Interviewing,2026-10-01\n';
    const file = { name: 'applications.csv', mimeType: 'text/csv', base64: Buffer.from(csv).toString('base64') };
    const preview = await call('preview_import', { kind: 'opportunities', file }, owner());
    expect(preview.rows.map((row: { company: string; stage: string }) => [row.company, row.stage])).toEqual([['Lumen', 'applied'], ['Cedar', 'interviewing']]);
    const invocationId = crypto.randomUUID();
    const first = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, owner({ id: invocationId }));
    const retry = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, owner({ id: invocationId }));
    expect(retry).toEqual(first);
    const again = await call('apply_import', { previewId: preview.previewId, digest: preview.digest }, owner());
    expect(again.opportunityIds).toEqual(first.opportunityIds);
    const second = await call('preview_import', { kind: 'opportunities', file }, owner());
    expect(second.rows.every((row: { duplicate: boolean }) => row.duplicate)).toBe(true);
    const repeat = await call('apply_import', { previewId: second.previewId, digest: second.digest }, owner());
    expect(repeat.created).toBe(0);
    expect((await call('list_opportunities', { limit: 50, view: 'all' }, owner())).total).toBe(2);
    await expect(call('apply_import', { previewId: preview.previewId, digest: 'b'.repeat(64) }, owner())).rejects.toThrow(/changed/);
  });

  it('a PDF or Word file goes through Ri extract_text, and an unavailable reader leaves a clear manual path', async () => {
    await setup({ now: NOW });
    const pdf = { name: 'posting.pdf', mimeType: 'application/pdf', base64: Buffer.from('%PDF-fictional').toString('base64') };
    const extracted = await call('preview_import', { kind: 'posting', file: pdf }, owner({ capability: async (name, input) => { expect(name).toBe('extract_text'); expect((input as { mimeType: string }).mimeType).toBe('application/pdf'); return { text: 'Product lead at Fieldwork\n\nRequirements\n- Lead a product team.', truncated: false, characters: 60 }; } }));
    expect(extracted.posting).toMatchObject({ company: 'Fieldwork', role: 'Product lead', requirementCount: 1, fileName: 'posting.pdf' });
    await expect(call('preview_import', { kind: 'posting', file: pdf }, fixture())).rejects.toThrow(/Paste the text instead/);
  });
});
