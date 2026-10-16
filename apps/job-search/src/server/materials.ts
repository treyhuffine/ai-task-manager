/**
 * Résumés, cover letters and other materials as immutable versions. Editing
 * saves a new version that names its parent, so v3 stays exactly as it was
 * submitted while v4 is drafted. Text lives in content-addressed files.
 */
import { AppError } from '@ri/app-kit/contract';
import { allows, newId, sha256, transaction, type AccessScope } from '@ri/app-kit/data';
import { MANUAL_SOURCE, MATERIALS_SOURCE, type MaterialFamily, type MaterialVersion } from '../domain/model.js';
import { diffLines, diffSummary } from '../domain/diff.js';
import { app, bumpRevision, nowAt } from './state.js';
import { groupBy, likePattern, marks, num, opt, str, type Row } from './util.js';

export const MATERIAL_TEXT_LIMIT = 200_000;

function normalizeText(text: string) {
  return text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
}

export interface NewMaterial {
  kind: MaterialFamily['kind'];
  title: string;
  text: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileBytes?: Uint8Array | null;
  note?: string | null;
}

export function createMaterial(input: NewMaterial, author: string, options: { fictional?: boolean; at?: string } = {}): { family: Row; version: Row } {
  const { db, blobs } = app();
  const text = normalizeText(input.text);
  if (!text) throw new AppError('invalid_input', 'Add the material text, or choose a file to read it from');
  if (text.length > MATERIAL_TEXT_LIMIT) throw new AppError('invalid_input', 'This material is too long to keep as text. Keep it under 200,000 characters');
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new AppError('invalid_input', 'Name this material');
  return transaction(db, () => {
    const familyId = newId(), versionId = newId(), time = options.at ?? nowAt();
    const stored = blobs.put(text);
    const file = input.fileBytes ? blobs.put(input.fileBytes) : null;
    db.prepare('INSERT INTO material_families (id, created_at, updated_at, revision, source_key, kind, title, archived_at, created_by, fictional) VALUES (?, ?, ?, 1, ?, ?, ?, NULL, ?, ?)').run(
      familyId, time, time, MATERIALS_SOURCE, input.kind, title, author, options.fictional ? 1 : 0,
    );
    db.prepare(`INSERT INTO material_versions (id, created_at, updated_at, family_id, number, parent_id, title, origin, content_digest, text_digest, characters, file_name, mime_type, file_digest, author, note)
      VALUES (?, ?, ?, ?, 1, NULL, ?, 'original', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      versionId, time, time, familyId, title, sha256(text), stored.digest, text.length, input.fileName?.slice(0, 200) ?? null, input.mimeType?.slice(0, 120) ?? null, file?.digest ?? null, author, input.note?.slice(0, 500) ?? null,
    );
    bumpRevision();
    return { family: db.prepare('SELECT * FROM material_families WHERE id = ?').get(familyId)!, version: db.prepare('SELECT * FROM material_versions WHERE id = ?').get(versionId)! };
  });
}

export type NewVersionResult = { status: 'saved'; family: Row; version: Row } | { status: 'conflict'; family: Row };

/** Save edited text as the next version of a family. The parent must be one of its versions. */
export function saveMaterialVersion(input: { familyId: string; parentVersionId: string; expectedRevision: number; text: string; title?: string | null; note?: string | null; at?: string }, author: string): NewVersionResult {
  const { db, blobs } = app();
  const text = normalizeText(input.text);
  if (!text) throw new AppError('invalid_input', 'A version needs some text');
  if (text.length > MATERIAL_TEXT_LIMIT) throw new AppError('invalid_input', 'This material is too long to keep as text. Keep it under 200,000 characters');
  return transaction(db, () => {
    const family = db.prepare('SELECT * FROM material_families WHERE id = ?').get(input.familyId);
    if (!family) throw new AppError('not_found', 'This material is not available');
    if (num(family.revision) !== input.expectedRevision) return { status: 'conflict', family };
    const parent = db.prepare('SELECT * FROM material_versions WHERE id = ? AND family_id = ?').get(input.parentVersionId, input.familyId);
    if (!parent) throw new AppError('invalid_input', 'Choose a version of this material to edit');
    const digest = sha256(text);
    if (digest === str(parent.content_digest)) throw new AppError('invalid_input', 'No changes to save. This text matches the version you started from');
    const number = num(db.prepare('SELECT MAX(number) AS number FROM material_versions WHERE family_id = ?').get(input.familyId)?.number) + 1;
    const stored = blobs.put(text);
    const id = newId(), time = input.at ?? nowAt();
    const title = input.title?.trim().slice(0, 200) || str(family.title);
    db.prepare(`INSERT INTO material_versions (id, created_at, updated_at, family_id, number, parent_id, title, origin, content_digest, text_digest, characters, file_name, mime_type, file_digest, author, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'edited', ?, ?, ?, NULL, NULL, NULL, ?, ?)`).run(id, time, time, input.familyId, number, input.parentVersionId, title, digest, stored.digest, text.length, author, input.note?.slice(0, 500) ?? null);
    db.prepare('UPDATE material_families SET revision = revision + 1, updated_at = ?, title = ? WHERE id = ?').run(time, title, input.familyId);
    bumpRevision();
    return { status: 'saved', family: db.prepare('SELECT * FROM material_families WHERE id = ?').get(input.familyId)!, version: db.prepare('SELECT * FROM material_versions WHERE id = ?').get(id)! };
  });
}

export function setMaterialArchived(familyId: string, expectedRevision: number, archived: boolean): Row | null {
  const { db } = app();
  return transaction(db, () => {
    const family = db.prepare('SELECT * FROM material_families WHERE id = ?').get(familyId);
    if (!family) throw new AppError('not_found', 'This material is not available');
    if (num(family.revision) !== expectedRevision) return null;
    db.prepare('UPDATE material_families SET archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(archived ? nowAt() : null, nowAt(), familyId);
    bumpRevision();
    return db.prepare('SELECT * FROM material_families WHERE id = ?').get(familyId)!;
  });
}

/** Submissions that used each version, visible only when the scope includes the user's opportunities. */
function usesByVersion(versionIds: string[], scope: AccessScope): Map<string, MaterialVersion['usedBy']> {
  const map = new Map<string, MaterialVersion['usedBy']>();
  if (!versionIds.length || !allows(scope, MANUAL_SOURCE)) return map;
  const rows = app().db.prepare(`SELECT sm.version_id, s.id AS submission_id, s.applied_on, o.id AS opportunity_id, o.company, o.role FROM submission_materials sm
    JOIN submissions s ON s.id = sm.submission_id JOIN opportunities o ON o.id = s.opportunity_id WHERE sm.version_id IN (${marks(versionIds.length)}) ORDER BY s.applied_on DESC`).all(...versionIds);
  for (const row of rows) {
    const list = map.get(str(row.version_id)) ?? [];
    list.push({ submissionId: str(row.submission_id), opportunityId: str(row.opportunity_id), company: str(row.company), role: str(row.role), appliedOn: str(row.applied_on) });
    map.set(str(row.version_id), list);
  }
  return map;
}
/** Whether any submission used a version, regardless of the reader's scope. */
function submittedVersions(versionIds: string[]): Set<string> {
  if (!versionIds.length) return new Set();
  return new Set(app().db.prepare(`SELECT DISTINCT version_id FROM submission_materials WHERE version_id IN (${marks(versionIds.length)})`).all(...versionIds).map((row) => str(row.version_id)));
}

export function versionRecord(row: Row, uses: MaterialVersion['usedBy'], submitted: boolean): MaterialVersion {
  return {
    id: str(row.id), familyId: str(row.family_id), number: num(row.number), parentId: opt(row.parent_id), title: str(row.title), origin: str(row.origin) as MaterialVersion['origin'],
    submitted, contentDigest: str(row.content_digest), characters: num(row.characters), fileName: opt(row.file_name), mimeType: opt(row.mime_type), author: str(row.author), note: opt(row.note),
    createdAt: str(row.created_at), usedBy: uses,
  };
}

export function familyRecords(families: Row[], scope: AccessScope): MaterialFamily[] {
  if (!families.length) return [];
  const ids = families.map((family) => str(family.id));
  const versions = app().db.prepare(`SELECT * FROM material_versions WHERE family_id IN (${marks(ids.length)}) ORDER BY number DESC`).all(...ids);
  const versionIds = versions.map((row) => str(row.id));
  const uses = usesByVersion(versionIds, scope);
  const submitted = submittedVersions(versionIds);
  const byFamily = groupBy(versions, (row) => str(row.family_id));
  return families.map((family) => {
    const list = byFamily.get(str(family.id)) ?? [];
    return {
      id: str(family.id), revision: num(family.revision), kind: str(family.kind) as MaterialFamily['kind'], title: str(family.title), archivedAt: opt(family.archived_at),
      latestVersionId: str(list[0]?.id), latestNumber: num(list[0]?.number ?? 1),
      versions: list.map((row) => versionRecord(row, uses.get(str(row.id)) ?? [], submitted.has(str(row.id)))),
      createdAt: str(family.created_at), updatedAt: str(family.updated_at),
    };
  });
}

export function listFamilyRows(filters: { search?: string; kind?: MaterialFamily['kind']; archived?: boolean }): Row[] {
  const where: string[] = [], params: string[] = [];
  if (filters.search?.trim()) { where.push("title LIKE ? ESCAPE '\\'"); params.push(likePattern(filters.search.trim())); }
  if (filters.kind) { where.push('kind = ?'); params.push(filters.kind); }
  where.push(filters.archived ? 'archived_at IS NOT NULL' : 'archived_at IS NULL');
  return app().db.prepare(`SELECT * FROM material_families WHERE ${where.join(' AND ')} ORDER BY updated_at DESC, id LIMIT 2000`).all(...params);
}

export function versionRow(versionId: string): Row | undefined {
  return app().db.prepare('SELECT * FROM material_versions WHERE id = ?').get(versionId);
}
export function versionText(row: Row): string | null {
  return app().blobs.readText(str(row.text_digest));
}

export function compareVersions(fromId: string, toId: string) {
  const from = versionRow(fromId), to = versionRow(toId);
  if (!from || !to) throw new AppError('not_found', 'Choose two versions to compare');
  if (str(from.family_id) !== str(to.family_id)) throw new AppError('invalid_input', 'Compare two versions of the same material');
  const a = versionText(from), b = versionText(to);
  if (a === null || b === null) throw new AppError('not_found', 'The text of one version is unavailable');
  const diff = diffLines(a, b);
  return { from: { id: fromId, number: num(from.number) }, to: { id: toId, number: num(to.number) }, lines: diff.lines.slice(0, 4000), truncated: diff.truncated || diff.lines.length > 4000, ...diffSummary(diff.lines) };
}
