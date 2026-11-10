import { AppError } from '@ri/app-kit/contract';
import type { AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx } from './context.js';
import { personName, personVisible } from './projection.js';
import { assertWritable, canSee, touch, writableCollection } from './scope.js';
import { cleanName, cleanText } from './text.js';
import type { Birthday, Relation, RelationKind } from '../schemas.js';

/**
 * The personal side of a person: owner-written details (birthday, where they
 * live, how you met, "My read") and relationships between people. Every value
 * here lives under a collection and is shown only to readers of that
 * collection. Nothing in this module is ever inferred or written by AI.
 */

export const LOCATION_MAX = 120;
export const HOW_MET_MAX = 500;
export const MY_READ_MAX = 4000;
export const RELATION_NOTE_MAX = 300;

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** A birthday's month and day must exist. February 29 needs a leap year when a year is given. */
export function validBirthday(input: Birthday): Birthday {
  const max = input.month === 2 && input.year !== null && !isLeap(input.year) ? 28 : DAYS_IN_MONTH[input.month - 1]!;
  if (input.day > max) throw new AppError('invalid_input', 'That date does not exist. Check the month and day');
  return { month: input.month, day: input.day, year: input.year };
}

export function birthdayOf(row: { birthday_month: number | null; birthday_day: number | null; birthday_year: number | null }): Birthday | null {
  return row.birthday_month && row.birthday_day ? { month: row.birthday_month, day: row.birthday_day, year: row.birthday_year } : null;
}

/** "March 4" or "March 4, 1990". */
export function birthdayLabel(birthday: Birthday): string {
  const month = new Date(Date.UTC(2000, birthday.month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${birthday.day}${birthday.year ? `, ${birthday.year}` : ''}`;
}

export interface PersonalRow {
  collection: string;
  birthday_month: number | null; birthday_day: number | null; birthday_year: number | null;
  location: string | null; how_met: string | null; my_read: string | null;
}
/** The owner-written details a reader may see: all of them with the person's collection, none without it. */
export function personalDetails(scope: AccessScope, row: PersonalRow) {
  const visible = canSee(scope, row.collection);
  return {
    birthday: visible ? birthdayOf(row) : null,
    location: visible ? row.location : null,
    howMet: visible ? row.how_met : null,
    myRead: visible ? row.my_read : null,
  };
}

export interface PersonalInput {
  birthday?: Birthday | null;
  location?: string | null;
  howMet?: string | null;
  myRead?: string | null;
}
/** SQL assignments for the personal fields present in `input`, cleaned and validated. */
export function personalAssignments(input: PersonalInput): { columns: string[]; params: (string | number | null)[] } {
  const columns: string[] = [], params: (string | number | null)[] = [];
  if (input.birthday !== undefined) {
    const birthday = input.birthday === null ? null : validBirthday(input.birthday);
    columns.push('birthday_month = ?', 'birthday_day = ?', 'birthday_year = ?');
    params.push(birthday?.month ?? null, birthday?.day ?? null, birthday?.year ?? null);
  }
  if (input.location !== undefined) { columns.push('location = ?'); params.push(cleanName(input.location, LOCATION_MAX)); }
  if (input.howMet !== undefined) { columns.push('how_met = ?'); params.push(cleanText(input.howMet, HOW_MET_MAX)); }
  if (input.myRead !== undefined) { columns.push('my_read = ?'); params.push(cleanText(input.myRead, MY_READ_MAX)); }
  return { columns, params };
}

// ─── Relationships ───────────────────────────────────────────────────────────

const LABELS: Record<RelationKind, [string, string]> = {
  // [as written on the person, as read from the related person's side]
  partner: ['Partner', 'Partner'],
  child: ['Child', 'Parent'],
  parent: ['Parent', 'Child'],
  sibling: ['Sibling', 'Sibling'],
  family: ['Family', 'Family'],
  friend: ['Friend', 'Friend'],
  colleague: ['Colleague', 'Colleague'],
  introduced_by: ['Introduced by', 'Introduced'],
  other: ['Related', 'Related'],
};
export const relationLabel = (kind: RelationKind, direction: 'outgoing' | 'incoming') => LABELS[kind][direction === 'outgoing' ? 0 : 1];

type RelationRow = {
  id: string; created_at: string; updated_at: string; revision: number; person_id: string; kind: RelationKind;
  related_person_id: string | null; related_name: string | null; note: string | null; collection: string; archived_at: string | null;
};

/** One relationship read from `personId`'s side, or null when the reader may not see it or the other person. */
export function projectRelation(ctx: Ctx, scope: AccessScope, row: RelationRow, personId: string): Relation | null {
  if (!canSee(scope, row.collection)) return null;
  const direction = row.person_id === personId ? 'outgoing' as const : 'incoming' as const;
  const otherId = direction === 'outgoing' ? row.related_person_id : row.person_id;
  let person: Relation['person'] = null, name = row.related_name ?? '';
  if (otherId) {
    if (!personVisible(ctx, scope, otherId)) return null;
    const other = ctx.db.get<{ id: string; display_name: string; name_source: string | null; merged_into: string | null }>('SELECT id, display_name, name_source, merged_into FROM persons WHERE id = ?', otherId);
    if (!other || other.merged_into) return null;
    name = personName(ctx, scope, other);
    person = { id: other.id, name };
  }
  return { id: row.id, revision: row.revision, kind: row.kind, label: relationLabel(row.kind, direction), person, name, note: row.note, direction, collection: row.collection as Relation['collection'] };
}

/**
 * A person's relationships from both sides. A row shows only when the reader
 * may see its collection and every person it names, so a relationship never
 * reveals someone the reader can't see.
 */
export function relationsFor(ctx: Ctx, scope: AccessScope, personId: string, limit = 50): Relation[] {
  const rows = ctx.db.all<RelationRow>(
    'SELECT * FROM person_relations WHERE (person_id = ? OR related_person_id = ?) AND archived_at IS NULL ORDER BY created_at, id LIMIT ?', personId, personId, limit * 2);
  const out: Relation[] = [];
  for (const row of rows) {
    const relation = projectRelation(ctx, scope, row, personId);
    if (relation) out.push(relation);
    if (out.length >= limit) break;
  }
  return out;
}

/** A relationship by ID from the side it was written on, archived or not. */
export function getRelation(ctx: Ctx, scope: AccessScope, id: string): Relation | null {
  const row = ctx.db.get<RelationRow>('SELECT * FROM person_relations WHERE id = ?', id);
  return row ? projectRelation(ctx, scope, row, row.person_id) : null;
}

export interface SaveRelationInput {
  id?: string; expectedRevision?: number;
  personId?: string; kind?: RelationKind; relatedPersonId?: string | null; relatedName?: string | null; note?: string | null;
  collection?: string; archived?: boolean;
}
/** Create, edit or remove (archive) one relationship. Edits check the revision. */
export function saveRelation(ctx: Ctx, scope: AccessScope, input: SaveRelationInput): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const time = iso(ctx);
  const target = (relatedPersonId: string | null | undefined, relatedName: string | null | undefined, personId: string) => {
    if (relatedPersonId) {
      if (relatedPersonId === personId) throw new AppError('invalid_input', 'Choose someone other than this person');
      if (!personVisible(ctx, scope, relatedPersonId)) throw new AppError('not_found', 'That person is no longer available');
      return { relatedPersonId, relatedName: null };
    }
    const name = cleanName(relatedName ?? null);
    if (!name) throw new AppError('invalid_input', 'Choose a person or type a name');
    return { relatedPersonId: null, relatedName: name };
  };
  if (!input.id) {
    if (!input.personId || !input.kind) throw new AppError('invalid_input', 'Choose the person and how they are related');
    if (!personVisible(ctx, scope, input.personId)) throw new AppError('not_found', 'This person is no longer available');
    const other = target(input.relatedPersonId, input.relatedName, input.personId);
    const collection = writableCollection(ctx, scope, input.collection);
    const id = newId();
    ctx.db.run(
      'INSERT INTO person_relations (id, created_at, updated_at, revision, person_id, kind, related_person_id, related_name, note, collection, archived_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, NULL)',
      id, time, time, input.personId, input.kind, other.relatedPersonId, other.relatedName, cleanName(input.note ?? null, RELATION_NOTE_MAX), collection);
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = ctx.db.get<RelationRow>('SELECT * FROM person_relations WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.collection)) throw new AppError('not_found', 'This relationship is no longer available');
  assertWritable(scope, row.collection);
  if (input.expectedRevision === undefined) throw new AppError('invalid_input', 'Include the revision you edited');
  if (row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This relationship changed since you opened it. Try again' };
  const other = input.relatedPersonId !== undefined || input.relatedName !== undefined
    ? target(input.relatedPersonId, input.relatedName, row.person_id)
    : { relatedPersonId: row.related_person_id, relatedName: row.related_name };
  const archived = input.archived === undefined ? row.archived_at : input.archived ? row.archived_at ?? time : null;
  ctx.db.run('UPDATE person_relations SET kind = ?, related_person_id = ?, related_name = ?, note = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
    input.kind ?? row.kind, other.relatedPersonId, other.relatedName, input.note !== undefined ? cleanName(input.note, RELATION_NOTE_MAX) : row.note, archived, time, row.id);
  touch(ctx, row.collection);
  return { status: 'saved', id: row.id };
}

// ─── Birthdays ───────────────────────────────────────────────────────────────

/** Days from `today` (YYYY-MM-DD) to the next month/day, 0 for today. February 29 falls on March 1 in other years. */
export function daysUntil(today: string, month: number, day: number): number {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(y, m - 1, d);
  const on = (year: number) => (month === 2 && day === 29 && !isLeap(year) ? Date.UTC(year, 2, 1) : Date.UTC(year, month - 1, day));
  const next = on(y) >= start ? on(y) : on(y + 1);
  return Math.round((next - start) / 864e5);
}

/** Birthdays in the next `days` days (today included) of people the reader may see, nearest first. */
export function upcomingBirthdays(ctx: Ctx, scope: AccessScope, today: string, days = 14, limit = 10) {
  const rows = ctx.db.all<{ id: string; display_name: string; name_source: string | null; collection: string; birthday_month: number; birthday_day: number; birthday_year: number | null }>(
    'SELECT id, display_name, name_source, collection, birthday_month, birthday_day, birthday_year FROM persons WHERE birthday_month IS NOT NULL AND merged_into IS NULL AND archived_at IS NULL LIMIT 5000');
  const start = Date.parse(`${today}T00:00:00Z`);
  return rows
    .filter((row) => canSee(scope, row.collection))
    .map((row) => ({ row, inDays: daysUntil(today, row.birthday_month, row.birthday_day) }))
    .filter(({ inDays }) => inDays <= days)
    .filter(({ row }) => personVisible(ctx, scope, row.id))
    .sort((a, b) => a.inDays - b.inDays || a.row.display_name.localeCompare(b.row.display_name))
    .slice(0, limit)
    .map(({ row, inDays }) => {
      const turns = row.birthday_year ? new Date(start + inDays * 864e5).getUTCFullYear() - row.birthday_year : null;
      return { id: row.id, name: personName(ctx, scope, row), month: row.birthday_month, day: row.birthday_day, inDays, turns };
    });
}
