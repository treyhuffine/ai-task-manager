/**
 * Two-step imports. A preview reads the pasted text, link or chosen file
 * (PDF and Word through Ri's extract_text), stores the exact parse under an
 * expiring ID and digest, and shows what would be saved. Applying uses only
 * that stored parse, once: a retry or a repeated import of the same source
 * returns the same records instead of duplicates.
 */
import { AppError } from '@ri/app-kit/contract';
import { newId, sha256, transaction } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { z } from 'zod/v4';
import { extractPosting } from '../domain/posting.js';
import { MATERIAL_KINDS, OUTCOMES, type Outcome, type PostingExtract, type Stage } from '../domain/model.js';
import { cleanUrl, companyKey, roleKey, urlKey, excerpt } from '../domain/text.js';
import { app, bumpRevision, now, nowAt } from './state.js';
import { changeStageFor, createOpportunity, requireOpportunityRow } from './opportunities.js';
import { saveSnapshot, POSTING_TEXT_LIMIT } from './postings.js';
import { createMaterial } from './materials.js';
import { MANUAL_SOURCE } from '../domain/model.js';
import { json, num, opt, str } from './util.js';

export const fileSchema = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(120),
  base64: z.string().max(Math.ceil((512 * 1024) / 3) * 4 + 8),
}).strict();
export type ImportFile = z.infer<typeof fileSchema>;

const EXTRACTABLE = new Set(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
const TEXT_TYPES = /^(text\/(plain|markdown|html|csv)|message\/rfc822)$/;
const PREVIEW_TTL_MS = 24 * 3600_000;

/** Text from a chosen file. Text types decode here. PDF and Word go through Ri's extract_text. */
export async function fileText(invocation: AppInvocation, file: ImportFile): Promise<{ text: string; truncated: boolean; bytes: Buffer }> {
  const bytes = Buffer.from(file.base64, 'base64');
  if (bytes.byteLength > 512 * 1024) throw new AppError('invalid_input', 'Choose a file under 512 KB, or paste the text instead');
  if (TEXT_TYPES.test(file.mimeType)) {
    let text = bytes.toString('utf8').replace(/^﻿/, '');
    if (file.mimeType === 'text/html') text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<li[^>]*>/gi, '- ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
    return { text: text.slice(0, POSTING_TEXT_LIMIT), truncated: text.length > POSTING_TEXT_LIMIT, bytes };
  }
  if (!EXTRACTABLE.has(file.mimeType)) throw new AppError('invalid_input', 'Choose a PDF, Word or text file, or paste the text instead');
  try {
    const result = z.object({ text: z.string(), truncated: z.boolean().optional() }).passthrough().parse(await invocation.capability('extract_text', { fileName: file.name, mimeType: file.mimeType, base64: file.base64 }));
    return { text: result.text, truncated: !!result.truncated, bytes };
  } catch (error) {
    const code = (error as AppError)?.code;
    if (code === 'unsupported' || code === 'forbidden') throw new AppError('unsupported', 'Reading PDF and Word files is not available here. Paste the text instead, or allow file reading for this app in Sources');
    if (code === 'invalid_input') throw new AppError('invalid_input', 'This file could not be read. Paste the text instead');
    throw error;
  }
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

export function parseCsv(text: string, maxRows = 501): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      row.push(field); field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      if (rows.length >= maxRows) return rows;
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const COLUMN = {
  company: /^(company|company name|employer|organization)$/i,
  role: /^(title|job title|position|role|job|position title)$/i,
  url: /^(url|link|job url|job link|posting|posting url|application link)$/i,
  location: /^(location|city|job location)$/i,
  status: /^(status|stage|application status)$/i,
  applied: /^(applied|date applied|applied on|application date|applied at)$/i,
  notes: /^(notes?|comments?)$/i,
};
export interface CsvOpportunity { index: number; company: string; role: string; sourceUrl: string | null; location: string | null; stage: Stage; outcome: Outcome | null; appliedOn: string | null; notes: string | null; duplicateOf: string | null }

function stageFromStatus(status: string): { stage: Stage; outcome: Outcome | null } {
  const value = status.toLowerCase();
  if (/reject|declined by|not selected|no longer/.test(value)) return { stage: 'closed', outcome: 'rejected' };
  if (/withdr/.test(value)) return { stage: 'closed', outcome: 'withdrawn' };
  if (/accept|hired/.test(value)) return { stage: 'closed', outcome: 'accepted' };
  if (/offer/.test(value)) return { stage: 'offer', outcome: null };
  if (/interview|screen|onsite/.test(value)) return { stage: 'interviewing', outcome: null };
  if (/appl|submitted/.test(value)) return { stage: 'applied', outcome: null };
  return { stage: 'saved', outcome: null };
}
function dateOf(value: string): string | null {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (iso) return iso[1];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(value.trim());
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

export function csvOpportunities(text: string): { rows: CsvOpportunity[]; skipped: number; columns: string[] } {
  const table = parseCsv(text);
  if (table.length < 2) throw new AppError('invalid_input', 'This file has no rows to import. Use a CSV with a header row');
  const header = table[0].map((value) => value.trim());
  const find = (pattern: RegExp) => header.findIndex((value) => pattern.test(value));
  const columns = { company: find(COLUMN.company), role: find(COLUMN.role), url: find(COLUMN.url), location: find(COLUMN.location), status: find(COLUMN.status), applied: find(COLUMN.applied), notes: find(COLUMN.notes) };
  if (columns.company < 0 || columns.role < 0) throw new AppError('invalid_input', 'The CSV needs a Company column and a Title or Role column');
  const existing = app().db.prepare('SELECT id, company_key, role_key FROM opportunities').all();
  const rows: CsvOpportunity[] = [];
  let skipped = 0;
  table.slice(1, 501).forEach((cells, index) => {
    const cell = (at: number) => (at >= 0 ? (cells[at] ?? '').trim() : '');
    const company = cell(columns.company).slice(0, 200), role = cell(columns.role).slice(0, 200);
    if (!company || !role) { skipped++; return; }
    const status = stageFromStatus(cell(columns.status));
    const duplicate = existing.find((row) => str(row.company_key) === companyKey(company) && str(row.role_key) === roleKey(role));
    rows.push({ index, company, role, sourceUrl: cleanUrl(cell(columns.url)), location: cell(columns.location) || null, stage: status.stage, outcome: status.outcome, appliedOn: cell(columns.applied) ? dateOf(cell(columns.applied)) : null, notes: cell(columns.notes) || null, duplicateOf: duplicate ? str(duplicate.id) : null });
  });
  return { rows, skipped, columns: Object.entries(columns).filter(([, at]) => at >= 0).map(([name]) => name) };
}

// ─── Preview and apply ───────────────────────────────────────────────────────

export const previewInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('posting'), text: z.string().max(POSTING_TEXT_LIMIT).optional(), url: z.string().max(2000).optional(), file: fileSchema.optional(), opportunityId: z.string().max(128).optional() }).strict(),
  z.object({ kind: z.literal('material'), text: z.string().max(200_000).optional(), file: fileSchema.optional(), title: z.string().max(200).optional(), materialKind: z.enum(MATERIAL_KINDS).optional() }).strict(),
  z.object({ kind: z.literal('opportunities'), text: z.string().max(400_000).optional(), file: fileSchema.optional() }).strict(),
]);
export type PreviewInput = z.infer<typeof previewInputSchema>;

interface StoredPayload {
  kind: PreviewInput['kind'];
  text: string;
  truncated: boolean;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileDigest: string | null;
  opportunityId: string | null;
  title: string | null;
  materialKind: (typeof MATERIAL_KINDS)[number] | null;
}

export async function previewImport(invocation: AppInvocation, input: PreviewInput, author: string) {
  const { db, blobs } = app();
  let text = input.text?.trim() ?? '', truncated = false, fileDigest: string | null = null;
  if (input.file) {
    const read = await fileText(invocation, input.file);
    text = read.text.trim();
    truncated = read.truncated;
    fileDigest = blobs.put(read.bytes).digest;
  }
  const url = input.kind === 'posting' ? cleanUrl(input.url) : null;
  if (input.kind === 'posting' && input.url?.trim() && !url) throw new AppError('invalid_input', 'Use a web address that starts with https://');
  if (input.kind === 'posting' && !text && !url) throw new AppError('invalid_input', 'Paste the description, choose a file or add the link');
  if (input.kind !== 'posting' && !text) throw new AppError('invalid_input', input.kind === 'material' ? 'Paste the material text or choose a file' : 'Choose a CSV file or paste its text');
  if (input.kind === 'posting' && input.opportunityId) requireOpportunityRow(input.opportunityId);
  const payload: StoredPayload = {
    kind: input.kind, text, truncated, url, fileName: input.file?.name ?? null, mimeType: input.file?.mimeType ?? null, fileDigest,
    opportunityId: input.kind === 'posting' ? input.opportunityId ?? null : null, title: input.kind === 'material' ? input.title?.trim() || null : null,
    materialKind: input.kind === 'material' ? input.materialKind ?? null : null,
  };
  const serialized = JSON.stringify(payload);
  const stored = blobs.put(serialized);
  const sourceDigest = sha256(`${input.kind}|${text}|${url ?? ''}`);
  const id = newId(), time = nowAt(), expiresAt = new Date(now().getTime() + PREVIEW_TTL_MS).toISOString();
  const summary = summarizePayload(payload);
  db.prepare('INSERT INTO import_previews (id, created_at, updated_at, kind, digest, source_digest, payload_digest, summary, expires_at, applied_at, result, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)').run(
    id, time, time, input.kind, stored.digest, sourceDigest, stored.digest, JSON.stringify(summary), expiresAt, author,
  );
  // Expired previews and their unshared parse files are cleared as new ones arrive.
  for (const old of db.prepare('SELECT id, payload_digest FROM import_previews WHERE expires_at < ? LIMIT 20').all(time)) {
    db.prepare('DELETE FROM import_previews WHERE id = ?').run(str(old.id));
    if (!db.prepare('SELECT 1 FROM import_previews WHERE payload_digest = ?').get(str(old.payload_digest))) blobs.remove(str(old.payload_digest));
  }
  return { previewId: id, digest: stored.digest, kind: input.kind, expiresAt, ...summary };
}

function summarizePayload(payload: StoredPayload) {
  const db = app().db;
  const warnings: string[] = [];
  if (payload.truncated) warnings.push('Only the first part of this file was read. The rest is not saved.');
  if (payload.kind === 'posting') {
    const extracted: PostingExtract | null = payload.text ? extractPosting(payload.text) : null;
    if (!payload.text) warnings.push('Only the link is saved. Add the description to prepare with this role.');
    const key = urlKey(payload.url);
    const company = extracted?.company?.value ?? null, role = extracted?.role?.value ?? null;
    const duplicates = db.prepare('SELECT id, company, role, stage, source_url, company_key, role_key FROM opportunities').all()
      .filter((row) => (key && urlKey(opt(row.source_url)) === key) || (company && role && str(row.company_key) === companyKey(company) && str(row.role_key) === roleKey(role)))
      .slice(0, 5).map((row) => ({ id: str(row.id), company: str(row.company), role: str(row.role), stage: str(row.stage) as Stage }));
    return {
      posting: {
        company, role, location: extracted?.location?.value ?? null, workArrangement: extracted?.workArrangement?.value ?? null, sourceUrl: payload.url,
        requisitionId: extracted?.requisitionId?.value ?? null, requirements: (extracted?.requirements ?? []).slice(0, 12), requirementCount: extracted?.requirements.length ?? 0,
        compensation: extracted?.compensation ?? [], characters: payload.text.length, hasText: !!payload.text, excerpt: excerpt(payload.text, 1200), fileName: payload.fileName,
      },
      duplicates, warnings,
    };
  }
  if (payload.kind === 'material') {
    const existing = db.prepare('SELECT v.id, v.number, f.title FROM material_versions v JOIN material_families f ON f.id = v.family_id WHERE v.content_digest = ? LIMIT 1').get(sha256(payload.text.replace(/\r\n?/g, '\n').trim()));
    if (existing) warnings.push(`This text matches ${str(existing.title)} v${num(existing.number)} already saved.`);
    const firstLine = payload.text.split('\n').find((line) => line.trim())?.trim() ?? '';
    return {
      material: { title: payload.title ?? (payload.fileName?.replace(/\.[a-z0-9]+$/i, '') || firstLine.slice(0, 80) || 'Untitled material'), kind: payload.materialKind ?? 'resume', characters: payload.text.length, excerpt: excerpt(payload.text, 1200), fileName: payload.fileName },
      duplicates: [], warnings,
    };
  }
  const parsed = csvOpportunities(payload.text);
  if (parsed.skipped) warnings.push(`${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} without a company or role will be skipped.`);
  const duplicates = parsed.rows.filter((row) => row.duplicateOf).length;
  if (duplicates) warnings.push(`${duplicates} row${duplicates === 1 ? ' matches' : 's match'} a saved role and will be skipped.`);
  return { rows: parsed.rows.slice(0, 100).map(({ duplicateOf, ...row }) => ({ ...row, duplicate: !!duplicateOf })), rowCount: parsed.rows.length, columns: parsed.columns, duplicates: [], warnings };
}

export interface ApplyDecisions {
  company?: string;
  role?: string;
  location?: string | null;
  workArrangement?: 'onsite' | 'hybrid' | 'remote' | null;
  sourceUrl?: string | null;
  attachTo?: string | null;
  title?: string;
  materialKind?: (typeof MATERIAL_KINDS)[number];
  skipRows?: number[];
}
export interface ApplyResult {
  status: 'applied';
  kind: PreviewInput['kind'];
  opportunityIds: string[];
  materialId: string | null;
  snapshotId: string | null;
  created: number;
  skipped: number;
}

export function applyImport(input: { previewId: string; digest: string; decisions?: ApplyDecisions }, author: string): ApplyResult {
  const { db, blobs } = app();
  return transaction(db, () => {
    const preview = db.prepare('SELECT * FROM import_previews WHERE id = ?').get(input.previewId);
    if (!preview) throw new AppError('not_found', 'This preview is no longer available. Choose the file or paste the text again');
    if (str(preview.digest) !== input.digest) throw new AppError('conflict', 'This preview changed. Review it again before saving');
    if (preview.applied_at) return json<ApplyResult>(preview.result, null as never);
    if (str(preview.expires_at) < nowAt()) throw new AppError('invalid_input', 'This preview expired. Choose the file or paste the text again');
    const raw = blobs.readText(str(preview.payload_digest));
    if (!raw) throw new AppError('not_found', 'This preview is no longer available. Choose the file or paste the text again');
    const payload = JSON.parse(raw) as StoredPayload;
    const decisions = input.decisions ?? {};
    const sourceDigest = str(preview.source_digest);
    let result: ApplyResult;
    if (payload.kind === 'posting') {
      const extracted = payload.text ? extractPosting(payload.text) : null;
      let opportunityId = decisions.attachTo ?? payload.opportunityId;
      let created = 0;
      if (opportunityId) requireOpportunityRow(opportunityId);
      else {
        const company = decisions.company?.trim() || extracted?.company?.value;
        const role = decisions.role?.trim() || extracted?.role?.value;
        if (!company || !role) throw new AppError('invalid_input', 'Add the company and the role before saving');
        const before = db.prepare('SELECT COUNT(*) AS count FROM opportunities').get();
        opportunityId = str(createOpportunity({
          company, role, location: decisions.location !== undefined ? decisions.location : extracted?.location?.value ?? null,
          workArrangement: decisions.workArrangement !== undefined ? decisions.workArrangement : extracted?.workArrangement?.value ?? null,
          sourceUrl: decisions.sourceUrl !== undefined ? decisions.sourceUrl : payload.url,
        }, author, { dedupeKey: `posting:${sourceDigest}:${companyKey(company)}:${roleKey(role)}`, note: payload.text ? 'Saved with its description' : 'Saved from a link' }).id);
        created = num(db.prepare('SELECT COUNT(*) AS count FROM opportunities').get()?.count) - num(before?.count);
      }
      let snapshotId: string | null = null;
      if (payload.text) {
        const file = payload.fileDigest ? blobs.read(payload.fileDigest) : null;
        snapshotId = str(saveSnapshot({ opportunityId, text: payload.text, origin: payload.fileName ? 'file' : 'paste', sourceUrl: decisions.sourceUrl ?? payload.url, fileName: payload.fileName, mimeType: payload.mimeType, fileBytes: file, truncated: payload.truncated }, author).row.id);
      } else if (payload.url && !opt(requireOpportunityRow(opportunityId).source_url)) {
        db.prepare('UPDATE opportunities SET source_url = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(payload.url, nowAt(), opportunityId);
      }
      result = { status: 'applied', kind: 'posting', opportunityIds: [opportunityId], materialId: null, snapshotId, created, skipped: 0 };
    } else if (payload.kind === 'material') {
      const digest = sha256(payload.text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim());
      const existing = db.prepare('SELECT family_id FROM material_versions WHERE content_digest = ? LIMIT 1').get(digest);
      const materialId = existing
        ? str(existing.family_id)
        : str(createMaterial({ kind: decisions.materialKind ?? payload.materialKind ?? 'resume', title: decisions.title?.trim() || payload.title || payload.fileName?.replace(/\.[a-z0-9]+$/i, '') || 'Untitled material', text: payload.text, fileName: payload.fileName, mimeType: payload.mimeType, fileBytes: payload.fileDigest ? blobs.read(payload.fileDigest) : null }, author).family.id);
      result = { status: 'applied', kind: 'material', opportunityIds: [], materialId, snapshotId: null, created: existing ? 0 : 1, skipped: existing ? 1 : 0 };
    } else {
      const parsed = csvOpportunities(payload.text);
      const skip = new Set(decisions.skipRows ?? []);
      const ids: string[] = [];
      let skipped = parsed.skipped;
      for (const row of parsed.rows) {
        if (skip.has(row.index) || row.duplicateOf) { skipped++; continue; }
        const before = db.prepare('SELECT 1 FROM opportunities WHERE dedupe_key = ?').get(`csv:${sourceDigest}:${row.index}`);
        const opportunity = createOpportunity({ company: row.company, role: row.role, sourceUrl: row.sourceUrl, location: row.location, notes: row.notes }, author, { dedupeKey: `csv:${sourceDigest}:${row.index}`, note: 'Imported from a file' });
        if (!before && row.stage !== 'saved' && (row.stage !== 'closed' || OUTCOMES.includes(row.outcome as Outcome)))
          changeStageFor({ opportunityId: str(opportunity.id), target: { stage: row.stage, outcome: row.outcome }, kind: 'user', author, source: MANUAL_SOURCE, confidence: 'user', at: row.appliedOn ? `${row.appliedOn}T12:00:00.000Z` : undefined, note: 'Imported status' });
        ids.push(str(opportunity.id));
      }
      result = { status: 'applied', kind: 'opportunities', opportunityIds: ids.slice(0, 500), materialId: null, snapshotId: null, created: ids.length, skipped };
    }
    db.prepare('UPDATE import_previews SET applied_at = ?, result = ?, updated_at = ? WHERE id = ?').run(nowAt(), JSON.stringify(result), nowAt(), input.previewId);
    bumpRevision();
    return result;
  });
}

// ─── Imported files ──────────────────────────────────────────────────────────

const KIND_LABELS = { posting: 'Job description', material: 'Material', opportunities: 'Opportunities file' } as const;

/** Files the person imported and applied, newest first. Pasted text is not a file and is not listed. */
export function listImportedFiles() {
  const { db, blobs } = app();
  return db.prepare('SELECT * FROM import_previews WHERE applied_at IS NOT NULL ORDER BY applied_at DESC LIMIT 100').all().flatMap((row) => {
    const payload = JSON.parse(blobs.readText(str(row.payload_digest)) ?? 'null') as StoredPayload | null;
    if (!payload?.fileName) return [];
    const result = json<ApplyResult | null>(row.result, null);
    return [{ id: str(row.id), name: payload.fileName, kind: KIND_LABELS[payload.kind], importedAt: str(row.applied_at), records: (result?.created ?? 0) + (result?.snapshotId ? 1 : 0), status: 'imported' }];
  }).slice(0, 50);
}

/**
 * Delete what one imported file created, when nothing the person built on
 * depends on it. A description used by preparation, a submitted material and
 * an opportunity with its own history are kept, with the reason.
 */
export function deleteImportedFile(previewId: string): { removed: number; kept: number; message: string } {
  const { db, blobs } = app();
  return transaction(db, () => {
    const row = db.prepare('SELECT * FROM import_previews WHERE id = ? AND applied_at IS NOT NULL').get(previewId);
    if (!row) throw new AppError('not_found', 'This import is not available');
    const payload = JSON.parse(blobs.readText(str(row.payload_digest)) ?? 'null') as StoredPayload | null;
    const result = json<ApplyResult | null>(row.result, null);
    let removed = 0, kept = 0;
    const untouched = (id: string) =>
      !db.prepare('SELECT 1 FROM submissions WHERE opportunity_id = ? LIMIT 1').get(id) && !db.prepare('SELECT 1 FROM interviews WHERE opportunity_id = ? LIMIT 1').get(id)
      && !db.prepare('SELECT 1 FROM preparations WHERE opportunity_id = ? LIMIT 1').get(id) && !db.prepare("SELECT 1 FROM correspondence WHERE opportunity_id = ? LIMIT 1").get(id)
      && !db.prepare('SELECT 1 FROM follow_up_links WHERE opportunity_id = ? LIMIT 1').get(id);
    if (result?.kind === 'posting') {
      if (result.snapshotId) {
        if (db.prepare('SELECT 1 FROM preparations WHERE posting_snapshot_id = ? LIMIT 1').get(result.snapshotId)) throw new AppError('conflict', 'Your preparation uses this description. Switch the preparation to another description first');
        const snapshot = db.prepare('SELECT text_digest, file_digest FROM posting_snapshots WHERE id = ?').get(result.snapshotId);
        if (snapshot) {
          db.prepare('DELETE FROM posting_snapshots WHERE id = ?').run(result.snapshotId);
          for (const digest of [opt(snapshot.text_digest), opt(snapshot.file_digest)]) if (digest && !db.prepare('SELECT 1 FROM posting_snapshots WHERE text_digest = ? OR file_digest = ? LIMIT 1').get(digest, digest)) blobs.remove(digest);
          removed++;
        }
      }
      for (const id of result.created ? result.opportunityIds : []) {
        if (db.prepare('SELECT 1 FROM posting_snapshots WHERE opportunity_id = ? LIMIT 1').get(id) || !untouched(id)) { kept++; continue; }
        db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
        removed++;
      }
    } else if (result?.kind === 'material' && result.materialId && result.created) {
      const versions = db.prepare('SELECT id FROM material_versions WHERE family_id = ?').all(result.materialId);
      if (versions.some((version) => db.prepare('SELECT 1 FROM submission_materials WHERE version_id = ? LIMIT 1').get(str(version.id)))) throw new AppError('conflict', 'A version of this material was submitted with an application, so it is kept. Archive it instead');
      if (versions.length > 1) throw new AppError('conflict', 'You saved newer versions of this material. Archive it instead');
      db.prepare('DELETE FROM material_families WHERE id = ?').run(result.materialId);
      removed++;
    } else if (result?.kind === 'opportunities') {
      for (const id of result.opportunityIds) {
        if (!untouched(id) || db.prepare('SELECT 1 FROM posting_snapshots WHERE opportunity_id = ? LIMIT 1').get(id)) { kept++; continue; }
        db.prepare('DELETE FROM opportunities WHERE id = ?').run(id);
        removed++;
      }
    }
    if (payload?.fileDigest && !db.prepare('SELECT 1 FROM posting_snapshots WHERE file_digest = ? LIMIT 1').get(payload.fileDigest) && !db.prepare('SELECT 1 FROM material_versions WHERE file_digest = ? LIMIT 1').get(payload.fileDigest)) blobs.remove(payload.fileDigest);
    db.prepare('DELETE FROM import_previews WHERE id = ?').run(previewId);
    if (!db.prepare('SELECT 1 FROM import_previews WHERE payload_digest = ?').get(str(row.payload_digest))) blobs.remove(str(row.payload_digest));
    bumpRevision();
    return { removed, kept, message: kept ? `${removed} removed. ${kept} kept because you added to them since the import` : `${removed} removed` };
  });
}
