/**
 * The fictional preview set: the same people, roles and dates as the design
 * concept, anchored to the current day so the interview is always tomorrow.
 * Seeded only for an isolated preview (fixture principal) with an empty
 * database. Mail and calendar evidence runs through the real ingestion rules.
 * Every name, address, company and message here is invented.
 */
import { z } from 'zod/v4';
import { sha256, transaction } from '@ri/app-kit/data';
import { newMailCheckpoint, newCalendarCheckpoint, type CalendarEvent, type MailMessage } from '@ri/app-kit/sources';
import { addDays, instantFromLocal, localDate, formatDate, zoneAbbreviation } from '@ri/app-kit/time';
import { parseCompensation } from '../domain/compensation.js';
import { MANUAL_SOURCE, type Preparation } from '../domain/model.js';
import { app, bumpRevision, now } from './state.js';
import { createOpportunity, updateOpportunityFields, requireOpportunityRow } from './opportunities.js';
import { saveSnapshot, latestSnapshot, snapshotExtract } from './postings.js';
import { createMaterial, saveMaterialVersion } from './materials.js';
import { recordSubmission } from './submissions.js';
import { ingestCalendarEvent, ingestMessage } from './ingest.js';
import { insertInterview } from './interviews.js';
import { savePreparation } from './preparation.js';
import { reserveFollowUp } from './followups.js';
import { num, str } from './util.js';

export const FIXTURE_ZONE = 'America/Denver';
export const FIXTURE_MAIL = 'fixture-mail';
export const FIXTURE_CALENDAR = 'fixture-calendar';
const OWNER = 'you@example.test';
const AUTHOR = 'fixture:preview';

const RESUME_V1 = `Sam Rivera
Product designer · Denver, CO · sam.rivera@example.test

Summary
Product designer with five years of experience in B2B planning and scheduling tools.

Experience
Harbor Logistics, Product designer (2022 to now)
- Led the redesign of account onboarding for dispatch teams.
- Ran monthly usability studies with customer operations staff.

Plainview Software, Associate product designer (2020 to 2022)
- Designed reporting dashboards for regional utilities.

Education
B.F.A. in Interaction Design, Front Range College`;
const RESUME_V2 = RESUME_V1.replace('- Ran monthly usability studies with customer operations staff.', '- Ran monthly usability studies with customer operations staff.\n- Wrote the design decision log the team now uses for every release.');
const RESUME_V3 = RESUME_V2.replace('Product designer with five years of experience in B2B planning and scheduling tools.', 'Product designer with five years of experience turning complex planning workflows into clear tools for operations teams.');
const RESUME_V4 = RESUME_V3.replace('- Designed reporting dashboards for regional utilities.', '- Designed reporting dashboards for regional utilities, working with research and engineering from discovery to launch.');

const NORTHSTAR_POSTING = `Product designer at Northstar
Location: Denver, CO (Hybrid, three days in office)
Req ID: R-4821

Northstar builds planning tools for regional energy cooperatives.

What you'll do
- Turn complex workflows into clear product experiences.
- Partner with research and engineering throughout delivery.
- Explain decisions with evidence and thoughtful tradeoffs.

What we're looking for
- Four or more years designing B2B or data-heavy products.
- A portfolio that shows process, not only final screens.
- Comfort running usability studies with customers.

Compensation
Base salary: $128,000 to $152,000 per year, plus equity and benefits.`;

const FIELDWORK_POSTING = `Product lead at Fieldwork
Location: Remote within the US

Fieldwork makes scheduling software for field service teams.

Requirements
- Six years in product roles, including two leading a team.
- Experience shipping mobile workflows used outdoors.
- Clear writing about tradeoffs for engineering and sales.

Pay range: $150,000 to $175,000 a year, base.`;

function mail(input: { id: string; thread: string; from: { name: string | null; address: string }; to?: { name: string | null; address: string }[]; subject: string; text: string; at: string; sent?: boolean; messageId?: string; inReplyTo?: string | null }): MailMessage {
  const address = (value: { name: string | null; address: string }) => ({ name: value.name, address: value.address, normalized: value.address.toLowerCase() });
  const to = (input.to ?? [{ name: 'Sam Rivera', address: OWNER }]).map(address);
  const parsed = {
    id: input.id, threadId: input.thread, historyId: null, receivedAt: input.at, labelIds: input.sent ? ['SENT'] : ['INBOX'], subject: input.subject, from: address(input.from), to, cc: [], bcc: [], replyTo: [],
    dateHeader: null, messageId: input.messageId ?? `<${input.id}@fixture.example.test>`, inReplyTo: input.inReplyTo ?? null, references: input.inReplyTo ? [input.inReplyTo] : [], listId: null,
    sent: !!input.sent, draft: false, discarded: false, bulkReasons: [], text: input.text, textTruncated: false, fromHtml: false, attachments: [], invite: null, snippet: input.text.slice(0, 120),
  };
  return { ...parsed, digest: sha256(JSON.stringify([parsed.id, parsed.subject, parsed.text])) };
}

/** Seed once, only into an empty preview database. */
export function seedFixtures(): boolean {
  const { db, settings, accounts, mail: index } = app();
  if (settings.get('fixture.seeded', z.boolean(), false)) return false;
  if (num(db.prepare('SELECT COUNT(*) AS count FROM opportunities').get()?.count) || num(db.prepare('SELECT COUNT(*) AS count FROM material_families').get()?.count)) return false;
  return transaction(db, () => {
    const today = localDate(now(), FIXTURE_ZONE);
    const day = (offset: number) => addDays(today, offset);
    const at = (offset: number, time: string) => instantFromLocal(`${day(offset)}T${time}`, FIXTURE_ZONE).instant;

    // Materials first, so submissions can name exact versions.
    const resume = createMaterial({ kind: 'resume', title: 'Product design résumé', text: RESUME_V1, note: 'Imported from my last search' }, AUTHOR, { fictional: true, at: at(-15, '09:00') });
    const familyId = str(resume.family.id);
    let parent = str(resume.version.id);
    for (const [text, offset, note] of [[RESUME_V2, -13, 'Added the decision log'], [RESUME_V3, -7, 'Summary aimed at planning tools'], [RESUME_V4, -1, 'More on research partnership']] as const) {
      const family = db.prepare('SELECT revision FROM material_families WHERE id = ?').get(familyId)!;
      const saved = saveMaterialVersion({ familyId, parentVersionId: parent, expectedRevision: num(family.revision), text, note, at: at(offset, '18:00') }, AUTHOR);
      if (saved.status === 'saved') parent = str(saved.version.id);
    }
    const v3 = str(db.prepare('SELECT id FROM material_versions WHERE family_id = ? AND number = 3').get(familyId)!.id);
    const cover = createMaterial({ kind: 'cover_letter', title: 'Cover letter for Lumen', text: 'Dear Lumen hiring team,\n\nI design tools that make complex operations feel calm. At Harbor Logistics I led the onboarding redesign for dispatch teams, and I would bring the same care to Lumen.\n\nSam Rivera' }, AUTHOR, { fictional: true, at: at(-4, '20:00') });
    createMaterial({ kind: 'other', title: 'Portfolio talking points', text: 'Onboarding redesign: the problem, what usability testing showed, the decision log, and the result I can describe in my own words.\nReporting dashboards: partnering with research and engineering from discovery to launch.' }, AUTHOR, { fictional: true, at: at(0, '07:30') });

    // Opportunities, as saved by the fictional person.
    const northstar = str(createOpportunity({ company: 'Northstar', role: 'Product designer', sourceUrl: 'https://jobs.northstar.example/product-designer' }, AUTHOR, { fictional: true, at: at(-7, '10:00'), note: 'Saved with its description' }).id);
    saveSnapshot({ opportunityId: northstar, text: NORTHSTAR_POSTING, origin: 'paste', capturedAt: at(-7, '10:00') }, AUTHOR);
    const cedar = str(createOpportunity({ company: 'Cedar', role: 'Design lead', location: 'Remote, US', workArrangement: 'remote' }, AUTHOR, { fictional: true, at: at(-20, '11:00') }).id);
    const lumen = str(createOpportunity({ company: 'Lumen', role: 'Staff designer', location: 'Remote, US', workArrangement: 'remote', sourceUrl: 'https://lumen.example/careers/staff-designer' }, AUTHOR, { fictional: true, at: at(-4, '19:00') }).id);
    const atlas = str(createOpportunity({ company: 'Atlas Studio', role: 'Senior product designer', location: 'Denver, CO', workArrangement: 'hybrid', sourceUrl: 'https://atlasstudio.example/jobs/senior-product-designer', nextAction: 'Compare with Northstar' }, AUTHOR, { fictional: true, at: at(-2, '12:00'), note: 'Saved from a link' }).id);
    const fieldwork = str(createOpportunity({ company: 'Fieldwork', role: 'Product lead', location: 'Remote, US', workArrangement: 'remote', nextAction: 'Review role requirements' }, AUTHOR, { fictional: true, at: at(-1, '08:30') }).id);
    saveSnapshot({ opportunityId: fieldwork, text: FIELDWORK_POSTING, origin: 'paste', capturedAt: at(-1, '08:30') }, AUTHOR);

    // A fictional mailbox and calendar with completed coverage, as a connected account would have.
    accounts.setup({ account: FIXTURE_MAIL, kind: 'mail', historyDays: 90, label: 'Fictional mailbox (preview)' });
    accounts.commit(FIXTURE_MAIL, 'mail', { ...newMailCheckpoint(90, now()), emailAddress: OWNER, backfill: { pageToken: null, pages: 2, complete: true, completedAt: now().toISOString(), oldestAt: at(-20, '09:00') }, history: { historyId: '1000', pageToken: null, checkedAt: now().toISOString() }, lastSuccessAt: now().toISOString() }, 'ready', 'Fictional mailbox (preview)');
    accounts.setup({ account: FIXTURE_CALENDAR, kind: 'calendar', historyDays: 90, label: 'Fictional calendar (preview)', calendars: ['primary'] });
    accounts.commit(FIXTURE_CALENDAR, 'calendar', { primary: { ...newCalendarCheckpoint('primary', 90, 180, now()), phase: 'incremental', syncToken: 'fixture', completedAt: now().toISOString(), lastSuccessAt: now().toISOString(), timeZone: FIXTURE_ZONE } }, 'ready', 'Fictional calendar (preview)');
    const context = { account: FIXTURE_MAIL, ownAddress: OWNER };
    const deliver = (message: MailMessage) => {
      const outcome = ingestMessage(message, context);
      index.record(FIXTURE_MAIL, message.id, message.threadId, outcome, { receivedAt: message.receivedAt, digest: message.digest });
    };

    // Cedar: acknowledged, a final conversation, then a written offer with a reply date.
    deliver(mail({ id: 'fx-cedar-ack', thread: 'fx-t-cedar-ack', from: { name: 'Cedar Recruiting', address: 'jobs@cedar.example' }, subject: 'Thank you for applying to Cedar', text: 'Thank you for applying for the Design lead role at Cedar. We have received your application and will be in touch.', at: at(-19, '09:12') }));
    insertInterview({ opportunityId: cedar, sourceKey: MANUAL_SOURCE, origin: 'manual', matchBasis: [{ kind: 'user', detail: 'Added by you' }] }, { title: 'Final conversation', status: 'completed', startAt: at(-9, '13:00'), endAt: at(-9, '14:00'), zone: FIXTURE_ZONE, allDay: false, format: 'video', location: null, meetingLink: null, participants: [{ email: 'priya.natarajan@cedar.example', name: 'Priya Natarajan', role: 'attendee', response: null }] }, AUTHOR, null, at(-9, '14:05'));
    const offerText = `Hi Sam,\n\nWe are delighted to extend an offer for the Design lead role at Cedar.\nBase salary: $172,000 per year, plus equity.\nPlease reply by ${formatDate(day(6), 'long')}.\n\nPriya Natarajan`;
    deliver(mail({ id: 'fx-cedar-offer', thread: 'fx-t-cedar-offer', from: { name: 'Priya Natarajan', address: 'priya.natarajan@cedar.example' }, subject: 'Your offer from Cedar', text: offerText, at: at(-1, '15:30') }));
    const cedarRow = requireOpportunityRow(cedar);
    updateOpportunityFields(cedar, num(cedarRow.revision), { deadline: day(6), deadlineLabel: 'Reply to the offer by', nextAction: 'Review terms', compensation: parseCompensation(offerText, 'offer') }, AUTHOR);

    // Northstar: acknowledged, application recorded with résumé v3, invited to choose times, then confirmed.
    deliver(mail({ id: 'fx-ns-ack', thread: 'fx-t-ns-ack', from: { name: 'Northstar Careers', address: 'no-reply@northstar.example' }, subject: 'Thank you for applying: Product designer', text: 'Thank you for applying for the Product designer role at Northstar (Req ID: R-4821). We have received your application.', at: at(-6, '11:10') }));
    const ack = db.prepare("SELECT id FROM correspondence WHERE message_id = 'fx-ns-ack'").get();
    recordSubmission({ opportunityId: northstar, expectedRevision: num(requireOpportunityRow(northstar).revision), appliedOn: day(-6), channel: 'company_site', materialVersionIds: [v3], evidenceId: ack ? str(ack.id) : null, confirmed: true }, AUTHOR);
    deliver(mail({ id: 'fx-ns-invite', thread: 'fx-t-ns-portfolio', from: { name: 'Maya Chen', address: 'maya.chen@northstar.example' }, subject: 'Portfolio discussion for the Product designer role', text: 'Hi Sam,\n\nThank you for your application. Could you share your availability for a 45 minute portfolio discussion next week?\n\nMaya Chen\nDesign lead, Northstar', at: at(-5, '14:20') }));
    const interviewDay = day(1);
    const interviewAt = at(1, '10:00');
    const confirmation = `Hi Sam,\n\nThank you. We look forward to discussing your portfolio on ${formatDate(interviewDay, 'weekdayLong')} at 10:00 ${zoneAbbreviation(interviewAt, FIXTURE_ZONE)}. Please bring an example of a complex product decision.\n\nMaya`;
    deliver(mail({ id: 'fx-ns-confirm', thread: 'fx-t-ns-portfolio', from: { name: 'Maya Chen', address: 'maya.chen@northstar.example' }, subject: 'Re: Portfolio discussion for the Product designer role', text: confirmation, at: at(-3, '09:04'), inReplyTo: '<fx-ns-invite@fixture.example.test>' }));
    const event: CalendarEvent = {
      id: 'fx-event-portfolio', iCalUID: 'fx-portfolio@northstar.example', summary: 'Portfolio discussion: Product designer', start: interviewAt, end: new Date(Date.parse(interviewAt) + 45 * 60000).toISOString(),
      status: 'confirmed', joinUrl: 'https://meet.example.test/northstar-portfolio', allDay: false, startTimeZone: FIXTURE_ZONE, endTimeZone: FIXTURE_ZONE,
      organizer: { email: 'maya.chen@northstar.example', displayName: 'Maya Chen', self: false },
      attendees: [
        { email: 'maya.chen@northstar.example', displayName: 'Maya Chen', self: false, organizer: true, resource: false, optional: false, responseStatus: 'accepted' },
        { email: OWNER, displayName: 'Sam Rivera', self: true, organizer: false, resource: false, optional: false, responseStatus: 'accepted' },
      ],
      attendeesOmitted: false, description: 'Video meeting. Bring one complex product decision to walk through.', updated: at(-3, '09:10'), cancelled: false,
    };
    ingestCalendarEvent(event, { account: FIXTURE_CALENDAR, calendarId: 'primary', calendarZone: FIXTURE_ZONE });

    // Lumen: the person recorded the application with two exact versions and chose a follow-up date.
    recordSubmission({ opportunityId: lumen, expectedRevision: num(requireOpportunityRow(lumen).revision), appliedOn: day(-3), channel: 'company_site', materialVersionIds: [v3, str(cover.version.id)], confirmed: true }, AUTHOR);
    updateOpportunityFields(lumen, num(requireOpportunityRow(lumen).revision), { nextAction: 'Follow up with Lumen', nextActionDue: day(4) }, AUTHOR);
    reserveFollowUp({ subject: { type: 'opportunity', id: lumen }, title: 'Follow up with Lumen', dueAt: day(4), operationId: '0192f0aa-0000-7000-8000-00000000f001' }, AUTHOR);

    // Atlas Studio: an acknowledgment that names only the company. One role there, so it is suggested, not applied.
    deliver(mail({ id: 'fx-atlas-ack', thread: 'fx-t-atlas', from: { name: 'Atlas Studio', address: 'careers@atlasstudio.example' }, subject: 'Thanks for applying to Atlas Studio', text: 'Thanks for applying to Atlas Studio. Our team reviews every application and will reply within two weeks.', at: at(-1, '17:45') }));

    // A recruiter naming two of the person's roles: it goes to review with both candidates.
    deliver(mail({ id: 'fx-recruiter', thread: 'fx-t-recruiter', from: { name: 'Jordan Bell', address: 'jordan.bell@talentbridge.example' }, subject: 'Two design roles', text: 'Hi Sam,\n\nI am reaching out about the Product lead role at Fieldwork and the Staff designer role at Lumen. Would an introduction to either hiring team help?\n\nJordan Bell, TalentBridge', at: at(-1, '16:00') }));

    // Preparation for tomorrow's interview, in the person's own words.
    const interview = db.prepare("SELECT id FROM interviews WHERE opportunity_id = ? AND status = 'scheduled' ORDER BY start_at DESC LIMIT 1").get(northstar);
    const snapshot = latestSnapshot(northstar)!;
    const requirements: Preparation['requirements'] = snapshotExtract(snapshot).requirements.map((requirement) => ({ ...requirement, origin: 'posting', snapshotId: str(snapshot.id) }));
    savePreparation({
      opportunityId: northstar, interviewId: interview ? str(interview.id) : null, expectedRevision: 0, postingSnapshotId: str(snapshot.id), requirements,
      examples: [{ id: 'ex-onboarding', text: 'The onboarding redesign at Harbor Logistics: what usability testing showed about account setup, and the decision log that came out of it. Add the outcome in my own words.', requirementIds: requirements.slice(0, 1).map((item) => item.id) }],
      questions: [
        { id: 'q-priorities', text: 'How does the team decide which customer problems to prioritize?', requirementIds: [] },
        { id: 'q-first-months', text: 'What would a useful first three months look like?', requirementIds: [] },
      ],
      notes: 'Maya asked for an example of a complex product decision.',
    }, AUTHOR);
    settings.set('fixture.seeded', true);
    void atlas;
    bumpRevision();
    return true;
  });
}
