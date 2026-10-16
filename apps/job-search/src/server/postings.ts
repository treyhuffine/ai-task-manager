/**
 * Immutable posting snapshots. Each saved description is stored once by its
 * SHA-256 digest with its extracted fields and exact passages. A changed
 * description becomes a new snapshot, and every earlier snapshot stays
 * readable, including the one a preparation cites.
 */
import { AppError } from '@ri/app-kit/contract';
import { newId, sha256, transaction } from '@ri/app-kit/data';
import { extractPosting } from '../domain/posting.js';
import { MANUAL_SOURCE, postingExtractSchema, type PostingExtract } from '../domain/model.js';
import { cleanUrl } from '../domain/text.js';
import { app, bumpRevision, nowAt } from './state.js';
import { requireOpportunityRow } from './opportunities.js';
import { bool, json, num, opt, str, type Row } from './util.js';

export const POSTING_TEXT_LIMIT = 200_000;

export interface SnapshotInput {
  opportunityId: string;
  text: string;
  origin: 'paste' | 'file' | 'import';
  sourceUrl?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileBytes?: Uint8Array | null;
  truncated?: boolean;
  capturedAt?: string;
}

/** Save a snapshot, or return the existing one with the same text. Fills only empty opportunity fields from it. */
export function saveSnapshot(input: SnapshotInput, author: string): { row: Row; created: boolean } {
  const { db, blobs } = app();
  const text = input.text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (text.length < 20) throw new AppError('invalid_input', 'Paste the job description, at least a few sentences, so it can be kept with this role');
  const bounded = text.slice(0, POSTING_TEXT_LIMIT);
  const contentDigest = sha256(bounded);
  return transaction(db, () => {
    const opportunity = requireOpportunityRow(input.opportunityId);
    const existing = db.prepare('SELECT * FROM posting_snapshots WHERE opportunity_id = ? AND content_digest = ?').get(input.opportunityId, contentDigest);
    if (existing) return { row: existing, created: false };
    const extracted = postingExtractSchema.parse(extractPosting(bounded));
    const stored = blobs.put(bounded);
    const file = input.fileBytes ? blobs.put(input.fileBytes) : null;
    const id = newId(), time = nowAt();
    db.prepare(`INSERT INTO posting_snapshots (id, created_at, updated_at, opportunity_id, captured_at, origin, source_url, file_name, mime_type, file_digest, content_digest, text_digest,
      characters, truncated, extracted, source_key, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, time, time, input.opportunityId, input.capturedAt ?? time, input.origin, cleanUrl(input.sourceUrl) ?? opt(opportunity.source_url), input.fileName?.slice(0, 200) ?? null,
      input.mimeType?.slice(0, 120) ?? null, file?.digest ?? null, contentDigest, stored.digest, bounded.length, input.truncated || text.length > POSTING_TEXT_LIMIT ? 1 : 0,
      JSON.stringify(extracted), MANUAL_SOURCE, author,
    );
    // Fill only fields the user left empty, so a posting never overwrites what they entered.
    const fill: Record<string, string> = {};
    if (!opportunity.requisition_id && extracted.requisitionId) fill.requisition_id = extracted.requisitionId.value;
    if (!opportunity.location && extracted.location) fill.location = extracted.location.value;
    if (!opportunity.work_arrangement && extracted.workArrangement) fill.work_arrangement = extracted.workArrangement.value;
    if (json<unknown[]>(opportunity.compensation, []).length === 0 && extracted.compensation.length) fill.compensation = JSON.stringify(extracted.compensation);
    const keys = Object.keys(fill);
    db.prepare(`UPDATE opportunities SET ${keys.map((key) => `${key} = ?, `).join('')}revision = revision + 1, updated_at = ? WHERE id = ?`).run(...keys.map((key) => fill[key]), time, input.opportunityId);
    bumpRevision();
    return { row: db.prepare('SELECT * FROM posting_snapshots WHERE id = ?').get(id)!, created: true };
  });
}

export function snapshotRows(opportunityId: string): Row[] {
  return app().db.prepare('SELECT * FROM posting_snapshots WHERE opportunity_id = ? ORDER BY captured_at DESC, created_at DESC, rowid DESC').all(opportunityId);
}
export function latestSnapshot(opportunityId: string): Row | undefined {
  return snapshotRows(opportunityId)[0];
}
export function snapshotExtract(row: Row): PostingExtract {
  const parsed = postingExtractSchema.safeParse(json(row.extracted, null));
  return parsed.success ? parsed.data : { company: null, role: null, location: null, workArrangement: null, requisitionId: null, compensation: [], requirements: [] };
}
export function snapshotText(row: Row): string | null {
  return app().blobs.readText(str(row.text_digest));
}

export function postingSummary(row: Row, latestId: string | null) {
  const usedBy = num(app().db.prepare('SELECT COUNT(*) AS count FROM preparations WHERE posting_snapshot_id = ?').get(str(row.id))?.count);
  return {
    id: str(row.id),
    opportunityId: str(row.opportunity_id),
    capturedAt: str(row.captured_at),
    origin: str(row.origin) as 'paste' | 'file' | 'import',
    sourceUrl: opt(row.source_url),
    fileName: opt(row.file_name),
    contentDigest: str(row.content_digest),
    characters: num(row.characters),
    truncated: bool(row.truncated),
    requirements: snapshotExtract(row).requirements.length,
    latest: str(row.id) === latestId,
    usedByPreparations: usedBy,
  };
}
export function postingDetail(row: Row, latestId: string | null) {
  const text = snapshotText(row);
  return { ...postingSummary(row, latestId), text: text ?? '', textAvailable: text !== null, extracted: snapshotExtract(row) };
}
