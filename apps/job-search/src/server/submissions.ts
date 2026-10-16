/**
 * Recorded applications. A submission names the exact material versions that
 * were used and never changes afterwards. Recording one never sends anything.
 */
import { AppError } from '@ri/app-kit/contract';
import { allows, newId, transaction, type AccessScope } from '@ri/app-kit/data';
import { MANUAL_SOURCE, MATERIALS_SOURCE, type Submission } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { changeStageFor, requireOpportunityRow } from './opportunities.js';
import { bool, groupBy, marks, num, opt, str, type Row } from './util.js';

export interface SubmissionInput {
  opportunityId: string;
  expectedRevision: number;
  appliedOn: string;
  channel: Submission['channel'];
  materialVersionIds: string[];
  evidenceId?: string | null;
  confirmed: boolean;
  note?: string | null;
}

export function recordSubmission(input: SubmissionInput, author: string): { status: 'saved'; submission: Row } | { status: 'conflict' } {
  const { db } = app();
  return transaction(db, () => {
    const opportunity = requireOpportunityRow(input.opportunityId);
    if (num(opportunity.revision) !== input.expectedRevision) return { status: 'conflict' };
    const versions = [...new Set(input.materialVersionIds)];
    if (versions.length) {
      const found = db.prepare(`SELECT id FROM material_versions WHERE id IN (${marks(versions.length)})`).all(...versions).length;
      if (found !== versions.length) throw new AppError('invalid_input', 'One of the chosen material versions is no longer available');
    }
    if (input.evidenceId) {
      const evidence = db.prepare('SELECT opportunity_id FROM correspondence WHERE id = ?').get(input.evidenceId);
      if (!evidence) throw new AppError('invalid_input', 'The receipt you chose is not available');
    } else if (!input.confirmed) {
      throw new AppError('invalid_input', 'Confirm that you submitted this application, since there is no receipt to show it');
    }
    const id = newId(), time = nowAt();
    db.prepare('INSERT INTO submissions (id, created_at, updated_at, opportunity_id, applied_on, channel, evidence_id, confirmed_by_user, note, source_key, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, time, time, input.opportunityId, input.appliedOn, input.channel, input.evidenceId ?? null, input.confirmed ? 1 : 0, input.note?.trim().slice(0, 1000) || null, MANUAL_SOURCE, author,
    );
    for (const versionId of versions)
      db.prepare('INSERT INTO submission_materials (id, created_at, updated_at, submission_id, version_id) VALUES (?, ?, ?, ?, ?)').run(newId(), time, time, id, versionId);
    if (str(opportunity.stage) === 'saved')
      changeStageFor({ opportunityId: input.opportunityId, target: { stage: 'applied', outcome: null }, kind: 'user', author, source: MANUAL_SOURCE, confidence: 'user', at: `${input.appliedOn}T12:00:00.000Z`, evidence: { kind: 'submission', id }, note: 'You recorded the application' });
    else {
      db.prepare('UPDATE opportunities SET revision = revision + 1, updated_at = ? WHERE id = ?').run(time, input.opportunityId);
    }
    bumpRevision();
    return { status: 'saved', submission: db.prepare('SELECT * FROM submissions WHERE id = ?').get(id)! };
  });
}

export function submissionRecords(opportunityIds: string[], scope: AccessScope): Map<string, Submission[]> {
  const result = new Map<string, Submission[]>();
  if (!opportunityIds.length || !allows(scope, MANUAL_SOURCE)) return result;
  const db = app().db;
  const rows = db.prepare(`SELECT * FROM submissions WHERE opportunity_id IN (${marks(opportunityIds.length)}) ORDER BY applied_on DESC, created_at DESC`).all(...opportunityIds);
  if (!rows.length) return result;
  const ids = rows.map((row) => str(row.id));
  const links = db.prepare(`SELECT sm.submission_id, v.id AS version_id, v.family_id, v.title, v.number, f.kind FROM submission_materials sm JOIN material_versions v ON v.id = sm.version_id
    LEFT JOIN material_families f ON f.id = v.family_id WHERE sm.submission_id IN (${marks(ids.length)}) ORDER BY v.number`).all(...ids);
  const shared = allows(scope, MATERIALS_SOURCE);
  const bySubmission = groupBy(links, (row) => str(row.submission_id));
  for (const row of rows) {
    const materials = (bySubmission.get(str(row.id)) ?? []).map((link) => shared
      ? { versionId: str(link.version_id), familyId: opt(link.family_id), title: str(link.title), number: num(link.number), kind: opt(link.kind) as Submission['materials'][number]['kind'], shared: true }
      : { versionId: str(link.version_id), familyId: null, title: 'Material not shared with this chat', number: null, kind: null, shared: false });
    const evidence = opt(row.evidence_id);
    const evidenceRow = evidence ? db.prepare('SELECT source_key FROM correspondence WHERE id = ?').get(evidence) : undefined;
    const record: Submission = {
      id: str(row.id), opportunityId: str(row.opportunity_id), appliedOn: str(row.applied_on), channel: str(row.channel) as Submission['channel'], materials,
      evidenceId: evidenceRow && allows(scope, str(evidenceRow.source_key)) ? evidence : null, confirmedByUser: bool(row.confirmed_by_user), note: opt(row.note), author: str(row.author), createdAt: str(row.created_at),
    };
    const list = result.get(record.opportunityId) ?? [];
    list.push(record);
    result.set(record.opportunityId, list);
  }
  return result;
}
