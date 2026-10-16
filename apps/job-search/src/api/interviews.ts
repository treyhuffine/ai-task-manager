import { z } from 'zod/v4';
import { AppError } from '@ri/app-kit/contract';
import { defineAction } from '@ri/app-kit/sdk';
import { allows, writeResultSchema, type AccessScope } from '@ri/app-kit/data';
import { instantFromLocal, isValidZone } from '@ri/app-kit/time';
import { id, INTERVIEW_FORMATS, INTERVIEW_STATUSES, interviewSchema, MANUAL_SOURCE, STAGE_ORDER, type Stage } from '../domain/model.js';
import { cleanUrl } from '../domain/text.js';
import { app } from '../server/state.js';
import { editInterview, insertInterview, type InterviewPatch } from '../server/interviews.js';
import { changeStageFor, requireOpportunityRow } from '../server/opportunities.js';
import { interviewsFor } from '../server/project.js';
import { listInterviews } from '../server/reads.js';
import { authorOf, COMMON_ERRORS, EX, exampleCoverage, exampleInterview, listOutput, listShape, readScope, WRITE_ERRORS, writeScope } from './common.js';
import { str } from '../server/util.js';

export const listInterviewsAction = defineAction({
  name: 'list_interviews',
  description: 'List interviews with their time, original time zone, format, meeting link, participants, status (scheduling needed, scheduled, canceled, completed) and full history of reschedules and cancellations. Filter by opportunity, status or upcoming only.',
  input: z.object({ ...listShape, opportunityId: id.optional(), status: z.enum(INTERVIEW_STATUSES).optional(), upcoming: z.boolean().optional() }).strict(),
  output: listOutput(interviewSchema),
  audience: ['user', 'agent'], effect: 'read', retry: 'read_safe', errors: [...COMMON_ERRORS],
  examples: [{ input: { limit: 20, upcoming: true }, output: { items: [exampleInterview], nextCursor: null, coverage: exampleCoverage, revision: 'r42' } }],
  handler: (input, invocation) => listInterviews(readScope(invocation), invocation.access, input),
});

function interviewFor(interviewId: string, scope: AccessScope) {
  const row = app().db.prepare('SELECT opportunity_id FROM interviews WHERE id = ?').get(interviewId);
  if (!row) throw new AppError('not_found', 'This interview is not available');
  const record = interviewsFor(requireOpportunityRow(str(row.opportunity_id)), scope).find((interview) => interview.id === interviewId);
  if (!record) throw new AppError('not_found', 'This interview is not available to this caller');
  return record;
}

function startFields(start: { local: string; zone: string } | null | undefined, durationMinutes: number | undefined, current?: { startAt: string | null; endAt: string | null }) {
  if (start === undefined && durationMinutes === undefined) return {};
  if (start === null) return { startAt: null, endAt: null, zone: null };
  if (start) {
    if (!isValidZone(start.zone)) throw new AppError('invalid_input', 'Choose a known time zone, such as America/Denver');
    const resolved = instantFromLocal(start.local, start.zone);
    const minutes = durationMinutes ?? (current?.startAt && current.endAt ? Math.round((Date.parse(current.endAt) - Date.parse(current.startAt)) / 60000) : 45);
    return { startAt: resolved.instant, endAt: new Date(Date.parse(resolved.instant) + minutes * 60000).toISOString(), zone: start.zone };
  }
  if (!current?.startAt) throw new AppError('invalid_input', 'Add the start time before the length');
  return { endAt: new Date(Date.parse(current.startAt) + durationMinutes! * 60000).toISOString() };
}

const startInput = z.object({ local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Use a time such as 2026-10-16T10:00'), zone: z.string().min(1).max(100) }).strict();
const participantInput = z.object({ name: z.string().max(200).nullable(), email: z.string().max(320).nullable() }).strict();

export const saveInterviewAction = defineAction({
  name: 'save_interview',
  description: 'Add an interview by hand or edit one. Times are given as local wall-clock time with the interview\'s own time zone. Editing an interview that came from a calendar or email keeps the change as a correction that later syncs do not overwrite. Marking it canceled never closes the application. Nothing is sent and no calendar is changed.',
  input: z.object({
    id: id.optional(),
    expectedRevision: z.number().int().min(0).optional(),
    opportunityId: id.optional(),
    title: z.string().min(1).max(300).optional(),
    status: z.enum(INTERVIEW_STATUSES).optional(),
    start: startInput.nullable().optional(),
    durationMinutes: z.number().int().min(5).max(600).optional(),
    format: z.enum(INTERVIEW_FORMATS).optional(),
    location: z.string().max(500).nullable().optional(),
    meetingLink: z.string().max(2000).nullable().optional(),
    participants: z.array(participantInput).max(20).optional(),
    notes: z.string().max(20000).nullable().optional(),
  }).strict(),
  output: writeResultSchema(interviewSchema),
  audience: ['user', 'agent'], effect: 'app_write', retry: 'idempotent', errors: [...WRITE_ERRORS],
  examples: [{ input: { opportunityId: EX.opportunity, title: 'Portfolio discussion', status: 'scheduled', start: { local: '2026-10-16T10:00', zone: 'America/Denver' }, durationMinutes: 45, format: 'video' }, output: { status: 'saved', record: { ...exampleInterview, origin: 'manual', source: 'manual' } } }],
  handler: (input, invocation) => {
    const scope = writeScope(invocation);
    const author = authorOf(invocation);
    if (input.meetingLink && !cleanUrl(input.meetingLink)?.startsWith('https://')) throw new AppError('invalid_input', 'Use a meeting link that starts with https://');
    return app().store.mutate(invocation, 'save_interview', input, () => {
      const participants = input.participants?.map((person) => ({ name: person.name?.trim() || null, email: person.email?.trim().toLowerCase() || null, role: 'attendee' as const, response: null }));
      if (!input.id) {
        if (!input.opportunityId) throw new AppError('invalid_input', 'Choose the opportunity this interview belongs to');
        const opportunity = requireOpportunityRow(input.opportunityId);
        const time = startFields(input.start, input.durationMinutes);
        const status = input.status ?? (time.startAt ? 'scheduled' : 'scheduling_needed');
        if (status === 'scheduled' && !time.startAt) throw new AppError('invalid_input', 'Add the interview time, or save it as scheduling needed');
        const row = insertInterview(
          { opportunityId: input.opportunityId, sourceKey: MANUAL_SOURCE, origin: 'manual', matchBasis: [{ kind: 'user', detail: 'Added by you' }], notes: input.notes ?? null },
          { title: input.title ?? 'Interview', status, startAt: time.startAt ?? null, endAt: time.endAt ?? null, zone: time.zone ?? null, allDay: false, format: input.format ?? 'unknown', location: input.location ?? null, meetingLink: cleanUrl(input.meetingLink), participants: participants ?? [] },
          author,
        );
        const stage = str(opportunity.stage) as Stage;
        if (status === 'scheduled' && stage !== 'closed' && STAGE_ORDER[stage] < STAGE_ORDER.interviewing)
          changeStageFor({ opportunityId: input.opportunityId, target: { stage: 'interviewing', outcome: null }, kind: 'user', author, source: MANUAL_SOURCE, confidence: 'user', evidence: { kind: 'interview', id: str(row.id) }, note: 'You added an interview' });
        return { status: 'saved' as const, record: interviewFor(str(row.id), scope) };
      }
      if (input.expectedRevision === undefined) throw new AppError('invalid_input', 'Include the revision you edited');
      const current = app().db.prepare('SELECT * FROM interviews WHERE id = ?').get(input.id);
      if (!current || !allows(scope, str(current.source_key))) throw new AppError('not_found', 'This interview is not available');
      const patch: InterviewPatch = { ...startFields(input.start, input.durationMinutes, { startAt: (current.start_at as string | null) ?? null, endAt: (current.end_at as string | null) ?? null }) };
      for (const key of ['title', 'status', 'format', 'location', 'notes'] as const) if (input[key] !== undefined) (patch as Record<string, unknown>)[key] = input[key];
      if (input.meetingLink !== undefined) patch.meetingLink = cleanUrl(input.meetingLink);
      if (participants) patch.participants = participants;
      const row = editInterview(input.id, input.expectedRevision, patch, author);
      if (!row) return { status: 'conflict' as const, current: interviewFor(input.id, scope), message: 'This interview changed since you opened it. Compare and try again' };
      return { status: 'saved' as const, record: interviewFor(input.id, scope) };
    });
  },
});

export const interviewActions = [listInterviewsAction, saveInterviewAction];
