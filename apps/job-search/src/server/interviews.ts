/**
 * Interviews keep one identity through scheduling, confirmation, reschedule,
 * cancellation and calendar removal, with every change in their history.
 * Imported values, the user's corrections and the effective values are
 * stored separately, so a sync never overwrites a correction. Nothing here
 * changes an opportunity's stage on a cancellation.
 */
import { AppError } from '@ri/app-kit/contract';
import { newId, transaction } from '@ri/app-kit/data';
import { formatInstant, zoneAbbreviation } from '@ri/app-kit/time';
import type { EvidenceItem, Interview } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { bool, json, num, opt, str, type Row } from './util.js';

export interface InterviewValues {
  title: string;
  status: Interview['status'];
  startAt: string | null;
  endAt: string | null;
  zone: string | null;
  allDay: boolean;
  format: Interview['format'];
  location: string | null;
  meetingLink: string | null;
  participants: Interview['participants'];
}
export type InterviewOverrides = Partial<Pick<InterviewValues, 'title' | 'status' | 'startAt' | 'endAt' | 'zone' | 'format' | 'location' | 'meetingLink'>>;

const VALUE_COLUMNS: [keyof InterviewValues, string][] = [
  ['title', 'title'], ['status', 'status'], ['startAt', 'start_at'], ['endAt', 'end_at'], ['zone', 'zone'], ['allDay', 'all_day'],
  ['format', 'format'], ['location', 'location'], ['meetingLink', 'meeting_link'], ['participants', 'participants'],
];
function columnValue(key: keyof InterviewValues, value: unknown): string | number | null {
  if (key === 'allDay') return value ? 1 : 0;
  if (key === 'participants') return JSON.stringify(value ?? []);
  return (value as string | null) ?? null;
}
export function effectiveValues(source: InterviewValues, overrides: InterviewOverrides): InterviewValues {
  return { ...source, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined)) } as InterviewValues;
}
export function sourceValuesOf(row: Row): InterviewValues {
  return json<InterviewValues>(row.source_values, valuesOf(row));
}
export function valuesOf(row: Row): InterviewValues {
  return {
    title: str(row.title), status: str(row.status) as Interview['status'], startAt: opt(row.start_at), endAt: opt(row.end_at), zone: opt(row.zone), allDay: bool(row.all_day),
    format: str(row.format) as Interview['format'], location: opt(row.location), meetingLink: opt(row.meeting_link), participants: json(row.participants, []),
  };
}

function describeTime(values: Pick<InterviewValues, 'startAt' | 'zone' | 'allDay'>): string {
  if (!values.startAt) return 'no time yet';
  const zone = values.zone ?? 'UTC';
  try {
    return values.allDay ? values.startAt.slice(0, 10) : formatInstant(values.startAt, zone, { date: 'weekday', zone: true });
  } catch {
    return values.startAt;
  }
}

export function recordInterviewEvent(interviewId: string, kind: Interview['history'][number]['kind'], summary: string, details: { before?: unknown; after?: unknown; source: string; author: string; evidenceId?: string | null; at?: string }) {
  const time = nowAt();
  app().db.prepare('INSERT INTO interview_events (id, created_at, updated_at, interview_id, occurred_at, kind, summary, before_json, after_json, source_key, author, evidence_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    newId(), time, time, interviewId, details.at ?? time, kind, summary.slice(0, 400), details.before === undefined ? null : JSON.stringify(details.before), details.after === undefined ? null : JSON.stringify(details.after), details.source, details.author, details.evidenceId ?? null,
  );
}

export interface InterviewIdentity {
  opportunityId: string;
  sourceKey: string;
  origin: Interview['origin'];
  account?: string | null;
  calendarId?: string | null;
  eventKey?: string | null;
  icalUid?: string | null;
  mailThread?: string | null;
  matchBasis: EvidenceItem[];
  notes?: string | null;
  sourceUpdatedAt?: string | null;
}

export function insertInterview(identity: InterviewIdentity, values: InterviewValues, author: string, evidenceId?: string | null, at?: string): Row {
  const { db } = app();
  return transaction(db, () => {
    const id = newId(), time = nowAt();
    db.prepare(`INSERT INTO interviews (id, created_at, updated_at, revision, opportunity_id, source_key, origin, account, calendar_id, event_key, ical_uid, mail_thread, title, status, start_at, end_at, zone,
      all_day, format, location, meeting_link, participants, source_values, overrides, source_state, match_basis, notes, source_updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`).run(
      id, time, time, identity.opportunityId, identity.sourceKey, identity.origin, identity.account ?? null, identity.calendarId ?? null, identity.eventKey ?? null, identity.icalUid ?? null,
      identity.mailThread ?? null, values.title.slice(0, 300), values.status, values.startAt, values.endAt, values.zone, values.allDay ? 1 : 0, values.format, values.location?.slice(0, 500) ?? null,
      values.meetingLink?.slice(0, 2000) ?? null, JSON.stringify(values.participants.slice(0, 50)), JSON.stringify(values), identity.origin === 'manual' ? 'none' : 'current',
      JSON.stringify(identity.matchBasis.slice(0, 12)), identity.notes?.slice(0, 20000) ?? null, identity.sourceUpdatedAt ?? null,
    );
    const kind = values.status === 'scheduling_needed' ? 'scheduling_needed' : values.status === 'canceled' ? 'canceled' : values.status === 'completed' ? 'completed' : values.startAt ? 'scheduled' : 'created';
    const how = identity.origin === 'manual' ? 'Added' : identity.origin === 'calendar' ? 'Found on your calendar' : 'Confirmed by email';
    const summary = values.status === 'scheduling_needed'
      ? 'Invitation to choose interview times. Not scheduled yet'
      : values.status === 'canceled' ? 'Recorded as canceled'
        : values.status === 'completed' ? `Recorded as held${values.startAt ? ` on ${describeTime(values)}` : ''}`
        : values.startAt ? `${how} for ${describeTime(values)}` : `${how}. The time was not stated in a form that could be read, so add it when you know it`;
    recordInterviewEvent(id, kind, summary, { after: values, source: identity.sourceKey, author, evidenceId, at });
    bumpRevision();
    return db.prepare('SELECT * FROM interviews WHERE id = ?').get(id)!;
  });
}

/**
 * Apply new values from a calendar or email source to an existing interview.
 * The user's corrections stay in force. Returns the kind of change recorded.
 */
export function applySourceUpdate(row: Row, incoming: InterviewValues, details: { sourceKey: string; author: string; evidenceId?: string | null; identity?: Partial<InterviewIdentity>; sourceUpdatedAt?: string | null; at?: string }): Interview['history'][number]['kind'] | null {
  const { db } = app();
  return transaction(db, () => {
    const before = sourceValuesOf(row);
    const merged: InterviewValues = {
      ...incoming,
      // A source that omits a value never erases what was known.
      title: incoming.title || before.title,
      startAt: incoming.startAt ?? before.startAt,
      endAt: incoming.startAt ? incoming.endAt : before.endAt,
      zone: incoming.zone ?? before.zone,
      location: incoming.location ?? before.location,
      meetingLink: incoming.meetingLink ?? before.meetingLink,
      participants: incoming.participants.length ? incoming.participants : before.participants,
      format: incoming.format !== 'unknown' ? incoming.format : before.format,
    };
    const timeChanged = merged.startAt !== before.startAt || merged.endAt !== before.endAt;
    const statusChanged = merged.status !== before.status;
    const otherChanged = JSON.stringify({ ...merged, startAt: 0, endAt: 0, status: 0 }) !== JSON.stringify({ ...before, startAt: 0, endAt: 0, status: 0 });
    const identity = details.identity ?? {};
    const identityChanged = (identity.eventKey && identity.eventKey !== opt(row.event_key)) || (identity.icalUid && identity.icalUid !== opt(row.ical_uid));
    if (!timeChanged && !statusChanged && !otherChanged && !identityChanged && row.source_state !== 'removed') return null;
    const overrides = json<InterviewOverrides>(row.overrides, {});
    const effective = effectiveValues(merged, overrides);
    const sets = VALUE_COLUMNS.map(([, column]) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE interviews SET ${sets}, source_values = ?, source_state = 'current', account = COALESCE(?, account), calendar_id = COALESCE(?, calendar_id), event_key = COALESCE(?, event_key),
      ical_uid = COALESCE(ical_uid, ?), origin = CASE WHEN ? = 'calendar' THEN 'calendar' ELSE origin END, source_key = CASE WHEN ? = 'calendar' THEN ? ELSE source_key END,
      source_updated_at = COALESCE(?, source_updated_at), revision = revision + 1, updated_at = ? WHERE id = ?`).run(
      ...VALUE_COLUMNS.map(([key]) => columnValue(key, effective[key])), JSON.stringify(merged), identity.account ?? null, identity.calendarId ?? null, identity.eventKey ?? null,
      identity.icalUid ?? null, identity.origin ?? '', identity.origin ?? '', details.sourceKey, details.sourceUpdatedAt ?? null, nowAt(), str(row.id),
    );
    let kind: Interview['history'][number]['kind'];
    let summary: string;
    if (statusChanged && merged.status === 'canceled') {
      kind = 'canceled';
      summary = 'Canceled by the organizer. The application stage is unchanged';
    } else if (statusChanged && merged.status === 'scheduling_needed') {
      kind = 'scheduling_needed';
      summary = 'Asked to choose a new time. Not scheduled until a time is confirmed';
    } else if (statusChanged && before.status === 'canceled') {
      kind = 'restored';
      summary = `Back on the calendar for ${describeTime(merged)}`;
    } else if (timeChanged && before.startAt) {
      kind = 'rescheduled';
      summary = `Moved from ${describeTime(before)} to ${describeTime(merged)}`;
    } else if (timeChanged || (statusChanged && merged.status === 'scheduled')) {
      kind = 'scheduled';
      summary = `Scheduled for ${describeTime(merged)}`;
    } else {
      kind = 'updated';
      summary = identityChanged ? 'Linked to the matching calendar event' : 'Details updated from the source';
    }
    if (overrides.startAt && timeChanged) summary += '. Your corrected time is kept';
    recordInterviewEvent(str(row.id), kind, summary, { before, after: merged, source: details.sourceKey, author: details.author, evidenceId: details.evidenceId, at: details.at ?? details.sourceUpdatedAt ?? undefined });
    bumpRevision();
    return kind;
  });
}

/** The calendar no longer has this event. Keep the interview, its preparation and history, and say so. */
export function markSourceRemoved(row: Row, sourceKey: string, author: string, at?: string) {
  const { db } = app();
  if (row.source_state === 'removed' && row.status === 'canceled') return;
  transaction(db, () => {
    const before = sourceValuesOf(row);
    const after = { ...before, status: 'canceled' as const };
    const overrides = json<InterviewOverrides>(row.overrides, {});
    const effective = effectiveValues(after, overrides);
    db.prepare("UPDATE interviews SET status = ?, source_values = ?, source_state = 'removed', revision = revision + 1, updated_at = ? WHERE id = ?").run(effective.status, JSON.stringify(after), nowAt(), str(row.id));
    recordInterviewEvent(str(row.id), 'source_removed', 'Canceled or removed from the calendar. Preparation and history are kept, and the application stage is unchanged', { before, after, source: sourceKey, author, at });
    bumpRevision();
  });
}

export interface InterviewPatch {
  title?: string;
  status?: Interview['status'];
  startAt?: string | null;
  endAt?: string | null;
  zone?: string | null;
  format?: Interview['format'];
  location?: string | null;
  meetingLink?: string | null;
  participants?: Interview['participants'];
  notes?: string | null;
}

/** A person's edit. Manual interviews change directly. Imported ones keep the edit as a correction that later syncs respect. */
export function editInterview(id: string, expectedRevision: number, patch: InterviewPatch, author: string): Row | null {
  const { db } = app();
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM interviews WHERE id = ?').get(id);
    if (!row) throw new AppError('not_found', 'This interview is not available');
    if (num(row.revision) !== expectedRevision) return null;
    const manual = row.origin === 'manual';
    const source = sourceValuesOf(row);
    const overrides = json<InterviewOverrides>(row.overrides, {});
    const before = valuesOf(row);
    const changes: Partial<InterviewValues> = {};
    for (const key of ['title', 'status', 'startAt', 'endAt', 'zone', 'format', 'location', 'meetingLink'] as const) {
      if (patch[key] === undefined) continue;
      (changes as Record<string, unknown>)[key] = patch[key];
    }
    if (patch.participants && manual) changes.participants = patch.participants;
    let nextSource = source, nextOverrides = overrides;
    if (manual) nextSource = { ...source, ...changes } as InterviewValues;
    else {
      nextOverrides = { ...overrides };
      for (const [key, value] of Object.entries(changes)) {
        if (key === 'participants') continue;
        // Setting a value back to what the source says removes the correction.
        if (JSON.stringify((source as unknown as Record<string, unknown>)[key]) === JSON.stringify(value)) delete (nextOverrides as Record<string, unknown>)[key];
        else (nextOverrides as Record<string, unknown>)[key] = value;
      }
    }
    const effective = effectiveValues(nextSource, nextOverrides);
    if (effective.status === 'scheduled' && !effective.startAt) throw new AppError('invalid_input', 'Add the interview time, or keep it as scheduling needed');
    if (effective.startAt && effective.endAt && effective.endAt < effective.startAt) throw new AppError('invalid_input', 'The interview cannot end before it starts');
    const sets = VALUE_COLUMNS.map(([, column]) => `${column} = ?`).join(', ');
    db.prepare(`UPDATE interviews SET ${sets}, source_values = ?, overrides = ?, notes = ?, revision = revision + 1, updated_at = ? WHERE id = ?`).run(
      ...VALUE_COLUMNS.map(([key]) => columnValue(key, effective[key])), JSON.stringify(nextSource), JSON.stringify(nextOverrides),
      patch.notes !== undefined ? patch.notes?.slice(0, 20000) ?? null : opt(row.notes), nowAt(), id,
    );
    const timeChanged = effective.startAt !== before.startAt || effective.endAt !== before.endAt;
    const kind = effective.status !== before.status
      ? effective.status === 'canceled' ? 'canceled' : effective.status === 'completed' ? 'completed' : before.status === 'canceled' ? 'restored' : 'scheduled'
      : timeChanged ? (before.startAt ? 'rescheduled' : 'scheduled') : manual ? 'updated' : 'corrected';
    const summary = kind === 'rescheduled' ? `Moved from ${describeTime(before)} to ${describeTime(effective)}`
      : kind === 'scheduled' ? `Scheduled for ${describeTime(effective)}`
        : kind === 'canceled' ? 'Marked canceled. The application stage is unchanged'
          : kind === 'completed' ? 'Marked as done'
            : kind === 'restored' ? 'Marked as happening again'
              : manual ? 'Details edited' : 'You corrected details from the source. Later syncs keep your correction';
    recordInterviewEvent(id, kind, summary, { before, after: effective, source: str(row.source_key), author });
    bumpRevision();
    return db.prepare('SELECT * FROM interviews WHERE id = ?').get(id)!;
  });
}

export function interviewEvents(interviewId: string): Row[] {
  return app().db.prepare('SELECT * FROM interview_events WHERE interview_id = ? ORDER BY created_at, rowid LIMIT 100').all(interviewId);
}

export function interviewRecord(row: Row, opportunity: Row, allowed: (source: string) => boolean): Interview {
  const preparation = app().db.prepare('SELECT id FROM preparations WHERE interview_id = ?').get(str(row.id));
  const overrides = json<InterviewOverrides>(row.overrides, {});
  return {
    id: str(row.id),
    revision: num(row.revision),
    opportunityId: str(row.opportunity_id),
    company: str(opportunity.company),
    role: str(opportunity.role),
    source: str(row.source_key),
    origin: str(row.origin) as Interview['origin'],
    ...valuesOf(row),
    sourceState: str(row.source_state) as Interview['sourceState'],
    matchBasis: json(row.match_basis, []),
    notes: opt(row.notes),
    corrected: Object.keys(overrides),
    preparationId: preparation ? str(preparation.id) : null,
    history: interviewEvents(str(row.id))
      .filter((event) => allowed(str(event.source_key)))
      .map((event) => ({ id: str(event.id), occurredAt: str(event.occurred_at), kind: str(event.kind) as Interview['history'][number]['kind'], summary: str(event.summary), source: str(event.source_key), author: str(event.author) })),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

export function zoneLabel(startAt: string | null, zone: string | null): string | null {
  if (!startAt || !zone) return null;
  try {
    return zoneAbbreviation(startAt, zone);
  } catch {
    return zone;
  }
}
