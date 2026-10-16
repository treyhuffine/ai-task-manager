import { AppError } from '@ri/app-kit/contract';
import type { AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx } from './context.js';
import type { Labels } from './coverage.js';
import { refreshOrganization } from './organizations.js';
import { refreshPerson } from './people.js';
import { organizationVisible, personVisible } from './projection.js';
import { assertWritable, canSee, canSeeOpportunity, sourceFilter, touch, writableCollection } from './scope.js';
import { removeSearchRow, setSearchRow } from './search.js';
import { cleanName, cleanText } from './text.js';
import type { Note } from '../schemas.js';

type NoteRow = { id: string; created_at: string; updated_at: string; revision: number; subject_kind: Note['subjectKind']; subject_id: string; title: string | null; body: string; collection: string; archived_at: string | null };

export function projectNote(row: NoteRow, labels: Labels): Note {
  return {
    id: row.id, revision: row.revision, subjectKind: row.subject_kind, subjectId: row.subject_id, title: row.title, body: row.body,
    collection: row.collection, collectionLabel: labels.of(row.collection), createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function refreshSubject(ctx: Ctx, kind: string, id: string) {
  if (kind === 'person') refreshPerson(ctx, id);
  else if (kind === 'organization') refreshOrganization(ctx, id);
}

function assertSubject(ctx: Ctx, scope: AccessScope, kind: Note['subjectKind'], id: string) {
  const visible = kind === 'person' ? personVisible(ctx, scope, id) : kind === 'organization' ? organizationVisible(ctx, scope, id)
    : canSeeOpportunity(ctx, scope, ctx.db.get<{ collection: string; pipeline_id: string }>('SELECT collection, pipeline_id FROM opportunities WHERE id = ?', id));
  if (!visible) throw new AppError('not_found', 'That record is no longer available');
}

/**
 * Notes are user-authored and keep their own collection. Linking a note to a
 * company never shares the note with anyone who can see the company.
 */
export function saveNote(ctx: Ctx, scope: AccessScope, input: { id?: string; expectedRevision?: number; subjectKind?: Note['subjectKind']; subjectId?: string; title?: string | null; body?: string; collection?: string; archived?: boolean }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const time = iso(ctx);
  if (!input.id) {
    if (!input.subjectKind || !input.subjectId) throw new AppError('invalid_input', 'Choose what this note is about');
    const body = cleanText(input.body, 20000);
    if (!body) throw new AppError('invalid_input', 'Write something before saving');
    assertSubject(ctx, scope, input.subjectKind, input.subjectId);
    const collection = writableCollection(ctx, scope, input.collection);
    const id = newId();
    ctx.db.run('INSERT INTO notes (id, created_at, updated_at, revision, subject_kind, subject_id, title, body, collection, archived_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, NULL)',
      id, time, time, input.subjectKind, input.subjectId, cleanName(input.title ?? null), body, collection);
    setSearchRow(ctx, `note:${id}`, input.subjectKind, input.subjectId, collection, `${input.title ?? ''} ${body}`);
    refreshSubject(ctx, input.subjectKind, input.subjectId);
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = ctx.db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.collection)) throw new AppError('not_found', 'This note is no longer available');
  assertWritable(scope, row.collection);
  if (input.expectedRevision === undefined) throw new AppError('invalid_input', 'Include the note revision you edited');
  if (row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This note changed since you opened it. Your text is kept. Compare and save again' };
  const body = input.body !== undefined ? cleanText(input.body, 20000) : row.body;
  if (!body) throw new AppError('invalid_input', 'Write something before saving, or archive the note');
  const collection = input.collection !== undefined && input.collection !== row.collection ? writableCollection(ctx, scope, input.collection) : row.collection;
  const archived = input.archived === undefined ? row.archived_at : input.archived ? row.archived_at ?? time : null;
  ctx.db.run('UPDATE notes SET title = ?, body = ?, collection = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?',
    input.title !== undefined ? cleanName(input.title) : row.title, body, collection, archived, time, row.id);
  if (archived) removeSearchRow(ctx, `note:${row.id}`);
  else setSearchRow(ctx, `note:${row.id}`, row.subject_kind, row.subject_id, collection, `${input.title ?? row.title ?? ''} ${body}`);
  refreshSubject(ctx, row.subject_kind, row.subject_id);
  touch(ctx, collection, row.collection);
  return { status: 'saved', id: row.id };
}

export function getNote(ctx: Ctx, scope: AccessScope, id: string, labels: Labels): Note | null {
  const row = ctx.db.get<NoteRow>('SELECT * FROM notes WHERE id = ?', id);
  return row && canSee(scope, row.collection) ? projectNote(row, labels) : null;
}
export function notesFor(ctx: Ctx, scope: AccessScope, kind: string, id: string, labels: Labels, limit = 30): Note[] {
  const filter = sourceFilter(scope, 'collection');
  return ctx.db.all<NoteRow>(`SELECT * FROM notes WHERE subject_kind = ? AND subject_id = ? AND archived_at IS NULL AND ${filter.sql} ORDER BY updated_at DESC LIMIT ?`, kind, id, ...filter.params, limit)
    .map((row) => projectNote(row, labels));
}
