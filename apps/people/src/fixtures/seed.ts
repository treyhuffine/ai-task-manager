import { newMailCheckpoint, newCalendarCheckpoint, parseGmailMessage, type CalendarEvent } from '@ri/app-kit/sources';
import type { AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx } from '../domain/context.js';
import { saveAffiliation } from '../domain/affiliations.js';
import { ingestEvent, ingestMail, linkInteraction } from '../domain/interactions.js';
import { suggestCommitment, saveCommitment } from '../domain/commitments.js';
import { prepareFollowUp } from '../domain/followups.js';
import { saveList, updateListMembers } from '../domain/lists.js';
import { saveNote } from '../domain/notes.js';
import { createOrganization } from '../domain/organizations.js';
import { refreshPerson, savePerson, createManualPerson, getPersonRow } from '../domain/people.js';
import { personForEmail } from '../domain/identity.js';
import { savePipeline, saveOpportunity, stagesOf } from '../domain/pipelines.js';
import { noteAutoExclusion } from '../domain/exclusions.js';
import { rememberOwnerAddress } from '../domain/extraction.js';
import { saveNavigation } from '../domain/views.js';
import { MANUAL, touch } from '../domain/scope.js';
import { calendarEvent, gmailRaw } from './mail.js';

export const FIXTURE_ACCOUNTS = { personal: 'fixture-personal', work: 'fixture-work' } as const;
const PERSONAL = `account:${FIXTURE_ACCOUNTS.personal}`, WORK = `account:${FIXTURE_ACCOUNTS.work}`;
const OWNER_PERSONAL = 'you@personal.example', OWNER_WORK = 'you@studio.example';

/**
 * The fictional preview world from the People concept: Maya, Jordan, Priya,
 * Alex, Sam and Elena, three companies, a small client pipeline and one
 * chosen Ri follow-up. Dates are relative to now so Today stays useful.
 * Every record is marked as fictional through the preview setting.
 */
export function seedFixtures(ctx: Ctx) {
  const owner: AccessScope = { kind: 'owner', actorId: 'fixture:preview' };
  const actor = 'fixture:preview';
  const now = ctx.now();
  const at = (days: number, hourUtc = 16, minute = 0) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days, hourUtc, minute));
    return date.toISOString();
  };
  const day = (days: number) => at(days).slice(0, 10);
  ctx.db.tx(() => {
    ctx.settings.set('fixture', { seeded: true, at: iso(ctx), note: 'Fictional preview records' });
    rememberOwnerAddress(ctx, OWNER_PERSONAL);
    rememberOwnerAddress(ctx, OWNER_WORK);
    for (const [account, label] of [[FIXTURE_ACCOUNTS.personal, 'Personal Gmail'], [FIXTURE_ACCOUNTS.work, 'Work Gmail']] as const) {
      ctx.accounts.setup({ account, kind: 'mail', historyDays: 90, label });
      const checkpoint = newMailCheckpoint(90, now);
      ctx.accounts.commit(account, 'mail', { ...checkpoint, emailAddress: account === FIXTURE_ACCOUNTS.personal ? OWNER_PERSONAL : OWNER_WORK, backfill: { ...checkpoint.backfill, complete: true, completedAt: at(-1, 15, 12), pages: 4 }, history: { historyId: '900', pageToken: null, checkedAt: at(0, 15, 12) }, lane: 'history', lastSuccessAt: at(0, 15, 12) }, 'ready', label);
    }
    ctx.accounts.setup({ account: FIXTURE_ACCOUNTS.personal, kind: 'calendar', historyDays: 90, calendars: ['primary'] });
    const calendarCheckpoint = newCalendarCheckpoint('primary', 90, 120, now);
    ctx.accounts.commit(FIXTURE_ACCOUNTS.personal, 'calendar', { primary: { ...calendarCheckpoint, phase: 'incremental', syncToken: 'fixture', completedAt: at(-1), lastSuccessAt: at(0, 15, 12) } }, 'ready');
    ctx.settings.set('extraction', { enabled: false, status: 'paused', reason: null, updatedAt: at(-2) });

    const ownerSet = new Set([OWNER_PERSONAL, OWNER_WORK]);
    const mail = (source: string, input: Parameters<typeof gmailRaw>[0]) => ingestMail(ctx, source, parseGmailMessage(gmailRaw(input)), ownerSet).interactionId!;
    // Maya: personal correspondence, an offered introduction and a meeting tomorrow.
    const mayaSent = mail(PERSONAL, { id: 'fx-maya-1', threadId: 'fx-maya', from: `You <${OWNER_PERSONAL}>`, to: ['Maya Chen <maya@northstar.example>'], subject: 'Portfolio discussion and introduction', date: at(-3, 17), sent: true, messageId: '<fx-maya-1@personal.example>',
      body: 'Hi Maya,\n\nI would be happy to introduce you to the research lead I mentioned. Let us also discuss the portfolio review and the team’s hiring plans.\n\nSpeak soon' });
    mail(PERSONAL, { id: 'fx-maya-2', threadId: 'fx-maya', from: 'Maya Chen <maya@northstar.example>', to: [`You <${OWNER_PERSONAL}>`], subject: 'Re: Portfolio discussion and introduction', date: at(-3, 19), inReplyTo: '<fx-maya-1@personal.example>',
      body: 'That would be wonderful, thank you. Could you bring an example of a complex product decision to our call?\n\nBest,\nMaya Chen\nDesign lead, Northstar\nmaya.chen@northstar.example' });
    // Fieldwork: a two-person thread with Jordan and Priya on the work account.
    mail(WORK, { id: 'fx-fw-1', threadId: 'fx-fieldwork', from: 'Jordan Bell <jordan@fieldwork.example>', to: [`You <${OWNER_WORK}>`], cc: ['Priya Shah <priya@fieldwork.example>'], subject: 'First phase and project scope', date: at(-4, 15), messageId: '<fx-fw-1@fieldwork.example>',
      body: 'Thanks for the walkthrough. Could we keep the first phase smaller and see an updated timeline before the next discussion?' });
    const fieldworkSent = mail(WORK, { id: 'fx-fw-2', threadId: 'fx-fieldwork', from: `You <${OWNER_WORK}>`, to: ['Jordan Bell <jordan@fieldwork.example>'], cc: ['Priya Shah <priya@fieldwork.example>'], subject: 'Re: First phase and project scope', date: at(-4, 17), sent: true, inReplyTo: '<fx-fw-1@fieldwork.example>', messageId: '<fx-fw-2@studio.example>',
      body: 'Let’s keep the first phase focused on onboarding. I will send the revised proposal with a smaller first phase and an updated timeline.' });
    const priyaMail = mail(WORK, { id: 'fx-fw-3', threadId: 'fx-fieldwork', from: 'Priya Shah <priya@fieldwork.example>', to: [`You <${OWNER_WORK}>`], cc: ['Jordan Bell <jordan@fieldwork.example>'], subject: 'Re: First phase and project scope', date: at(-4, 20), inReplyTo: '<fx-fw-2@studio.example>',
      body: 'I can confirm which systems the project team can access. I will send the details once I have checked with the team.' });
    // Sam at Atlas Studio, with a reply so the relationship is confirmed.
    mail(WORK, { id: 'fx-atlas-1', threadId: 'fx-atlas', from: 'Sam Okafor <sam@atlas.example>', to: [`You <${OWNER_WORK}>`], subject: 'Product setup conversation', date: at(-6, 16), messageId: '<fx-atlas-1@atlas.example>',
      body: 'We are seeing friction during setup. A discovery call would help us understand what a focused review could cover.' });
    mail(WORK, { id: 'fx-atlas-2', threadId: 'fx-atlas', from: `You <${OWNER_WORK}>`, to: ['Sam Okafor <sam@atlas.example>'], subject: 'Re: Product setup conversation', date: at(-6, 18), sent: true, inReplyTo: '<fx-atlas-1@atlas.example>',
      body: 'Happy to. I will suggest a few times for a discovery call next week.' });
    // Alex and Elena: personal contacts on a shared mail provider, which never implies a company.
    mail(PERSONAL, { id: 'fx-alex-1', threadId: 'fx-alex', from: `You <${OWNER_PERSONAL}>`, to: ['Alex Rivera <alex.rivera@fastmail.com>'], subject: 'Research catch-up', date: at(-9, 18), sent: true,
      body: 'Good to compare notes on the client project. Let us revisit the research plan when we catch up.' });
    mail(PERSONAL, { id: 'fx-elena-1', threadId: 'fx-elena', from: `You <${OWNER_PERSONAL}>`, to: ['Elena Park <elena.park@proton.me>'], subject: 'Thank you', date: at(-17, 18), sent: true,
      body: 'Thank you for sharing your research approach. I will ask before introducing you to anyone.' });
    // A newsletter and a large webinar are left out automatically and only counted.
    noteAutoExclusion(ctx, 'news@designweekly.example', 'mailing list, unsubscribe link', PERSONAL);
    const event = (input: Parameters<typeof calendarEvent>[0]) => ingestEvent(ctx, PERSONAL, 'primary', calendarEvent(input) as unknown as CalendarEvent, 'America/Denver');
    const mayaMeeting = event({ id: 'fx-cal-maya', summary: 'Portfolio discussion', start: at(1, 16), end: at(1, 17), organizerSelf: true, attendees: [{ email: OWNER_PERSONAL, self: true, organizer: true }, { email: 'maya@northstar.example', displayName: 'Maya Chen' }] }).interactionId!;
    event({ id: 'fx-cal-alex', summary: 'Project catch-up', start: at(5, 20), end: at(5, 21), attendees: [{ email: OWNER_PERSONAL, self: true }, { email: 'alex.rivera@fastmail.com', displayName: 'Alex Rivera', organizer: true }] });
    event({ id: 'fx-cal-webinar', summary: 'Design systems webinar', start: at(-2, 17), end: at(-2, 18), attendees: [{ email: OWNER_PERSONAL, self: true }, ...Array.from({ length: 40 }, (_, index) => ({ email: `attendee${index + 1}@webinar.example` }))] });
    void mayaMeeting;

    const id = (email: string) => personForEmail(ctx, email)!;
    const maya = id('maya@northstar.example'), jordan = id('jordan@fieldwork.example'), priya = id('priya@fieldwork.example');
    const sam = id('sam@atlas.example'), alex = id('alex.rivera@fastmail.com'), elena = id('elena.park@proton.me');
    savePerson(ctx, owner, { id: alex, expectedRevision: getPersonRow(ctx, alex)!.revision, headline: 'Independent consultant', pinned: true });
    savePerson(ctx, owner, { id: elena, expectedRevision: getPersonRow(ctx, elena)!.revision, headline: 'Research lead' });
    savePerson(ctx, owner, { id: maya, expectedRevision: getPersonRow(ctx, maya)!.revision, pinned: true });
    savePerson(ctx, owner, { id: jordan, expectedRevision: getPersonRow(ctx, jordan)!.revision, pinned: true });

    const fieldwork = createOrganization(ctx, owner, { name: 'Fieldwork', website: 'fieldwork.example', kind: 'company' });
    const northstar = createOrganization(ctx, owner, { name: 'Northstar', website: 'northstar.example', kind: 'company' });
    const atlas = createOrganization(ctx, owner, { name: 'Atlas Studio', website: 'atlas.example', kind: 'company' });
    saveAffiliation(ctx, owner, actor, { personId: jordan, organizationId: fieldwork, role: 'Founder', status: 'current' });
    saveAffiliation(ctx, owner, actor, { personId: priya, organizationId: fieldwork, role: 'Operations', status: 'current' });
    saveAffiliation(ctx, owner, actor, { personId: sam, organizationId: atlas, role: 'Co-founder', status: 'current' });
    // Maya's role was observed in her signature and is not confirmed as current employment.
    const mayaEvidence = ctx.db.get<{ evidence_id: string }>("SELECT evidence_id FROM interactions WHERE external_id = 'fx-maya-2'")!.evidence_id;
    ctx.db.run(`INSERT INTO affiliations (id, created_at, updated_at, revision, person_id, organization_id, role, valid_from, valid_to, observed_at, status, confidence, source_key, origin, evidence_id, decision, decision_key)
      VALUES (?, ?, ?, 1, ?, ?, 'Design lead', NULL, NULL, ?, 'unknown', 'observed', ?, 'signature', ?, NULL, ?)`, newId(), iso(ctx), iso(ctx), maya, northstar, at(-3, 19), PERSONAL, mayaEvidence, newId());
    ctx.db.run("UPDATE facts SET status = 'active', resolution = 'Recorded as an observed affiliation' WHERE subject_id = ? AND field = 'affiliation'", maya);
    linkInteraction(ctx, owner, { interactionId: fieldworkSent, expectedRevision: 1, operation: 'link', target: { kind: 'organization', id: fieldwork } }, () => MANUAL);

    const note = (subjectKind: 'person' | 'organization', subjectId: string, body: string, title?: string) => saveNote(ctx, owner, { subjectKind, subjectId, body, title: title ?? null });
    note('person', maya, 'Ask how the design and research teams work together.', 'Remember for next time');
    note('person', jordan, 'Keep the first phase focused on onboarding.');
    note('person', priya, 'Coordinates project access and the internal team.');
    note('person', alex, 'Talk through the research plan at the next catch-up.');
    note('person', sam, 'Interested in simplifying the product setup experience.');
    note('person', elena, 'Ask before making an introduction.');
    note('organization', fieldwork, 'First phase should deliver a useful onboarding flow. Keep research and delivery assumptions visible.');

    const list = (name: string, members: string[]) => {
      const created = saveList(ctx, owner, { name, recordKind: 'person' });
      updateListMembers(ctx, owner, actor, { listId: created.id, expectedRevision: 1, add: members });
    };
    list('Clients', [jordan, priya, sam]);
    list('Collaborators', [maya, elena]);
    list('Friends', [alex]);

    const pipeline = savePipeline(ctx, owner, { name: 'Client work', template: 'client_work' }).id;
    const stages = stagesOf(ctx, pipeline);
    const stage = (label: string) => stages.find((item) => item.label === label)!.id;
    saveOpportunity(ctx, owner, actor, newId(), { title: 'Product setup review', pipelineId: pipeline, stageId: stage('Exploring'), organizationId: atlas, personIds: [sam], nextAction: 'Arrange discovery call', nextActionDate: day(4) });
    saveOpportunity(ctx, owner, actor, newId(), { title: 'Research workshop', pipelineId: pipeline, stageId: stage('Discussing'), organizationId: fieldwork, personIds: [priya], nextAction: 'Confirm participants', nextActionDate: day(5) });
    saveOpportunity(ctx, owner, actor, newId(), { title: 'Onboarding project', pipelineId: pipeline, stageId: stage('Proposal'), organizationId: fieldwork, personIds: [jordan], nextAction: 'Send revised proposal', nextActionDate: day(1), value: { minor: 800000, currency: 'USD' }, targetDate: day(17) });

    const evidenceOf = (external: string) => ctx.db.get<{ id: string; evidence_id: string; occurred_at: string }>('SELECT id, evidence_id, occurred_at FROM interactions WHERE external_id = ?', external)!;
    const m = evidenceOf('fx-maya-1');
    suggestCommitment(ctx, { personId: maya, organizationId: null, direction: 'i_owe', actorLabel: 'You', recipientLabel: 'Maya Chen', action: 'Introduce Maya to a research lead', dueDate: null, evidenceId: m.evidence_id, interactionId: m.id, externalId: 'fx-maya-1', sourceKey: PERSONAL, passage: 'I would be happy to introduce you to the research lead I mentioned.', occurredAt: m.occurred_at, extractionVersion: 'fixture' });
    const f = evidenceOf('fx-fw-2');
    const proposal = suggestCommitment(ctx, { personId: jordan, organizationId: fieldwork, direction: 'i_owe', actorLabel: 'You', recipientLabel: 'Jordan Bell', action: 'Send the revised proposal', dueDate: day(1), evidenceId: f.evidence_id, interactionId: f.id, externalId: 'fx-fw-2', sourceKey: WORK, passage: 'I will send the revised proposal with a smaller first phase and an updated timeline.', occurredAt: f.occurred_at, extractionVersion: 'fixture' })!;
    ctx.db.run("UPDATE commitments SET state = 'accepted', revision = revision + 1 WHERE id = ?", proposal);
    const linked = prepareFollowUp(ctx, owner, { subject: { kind: 'commitment', id: proposal }, title: 'Send Jordan the revised proposal', dueAt: day(1) }, actor);
    ctx.db.run("UPDATE task_links SET task_id = 'fixture-task-revised-proposal', status = 'linked', task_status = 'open', last_checked_at = ? WHERE id = ?", iso(ctx), linked.link.id);
    const p = evidenceOf('fx-fw-3');
    const access = suggestCommitment(ctx, { personId: priya, organizationId: fieldwork, direction: 'waiting_on', actorLabel: 'Priya Shah', recipientLabel: 'You', action: 'Send the project access details', dueDate: null, evidenceId: p.evidence_id, interactionId: priyaMail, externalId: 'fx-fw-3', sourceKey: WORK, passage: 'I can confirm which systems the project team can access. I will send the details once I have checked with the team.', occurredAt: p.occurred_at, extractionVersion: 'fixture' })!;
    ctx.db.run("UPDATE commitments SET state = 'accepted', revision = revision + 1 WHERE id = ?", access);
    saveCommitment(ctx, owner, actor, { direction: 'i_owe', personId: alex, action: 'Share the research plan outline before the catch-up', dueDate: day(4) }, { person: 'Alex Rivera' });

    for (const person of [maya, jordan, priya, sam, alex, elena]) refreshPerson(ctx, person);
    saveNavigation(ctx, { companies: 'shown', pipelines: 'shown' });
    touch(ctx, PERSONAL, WORK, MANUAL);
  });
}

/** Seed only into an empty preview database. */
export function shouldSeed(ctx: Ctx) {
  return !ctx.settings.get('fixture', { safeParse: (value: unknown) => ({ success: true, data: value }) } as never, null) && !ctx.db.get('SELECT 1 AS ok FROM persons LIMIT 1');
}
export { createManualPerson };
