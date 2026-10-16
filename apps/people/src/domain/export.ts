import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import type { Ctx, Param } from './context.js';
import { Labels } from './coverage.js';
import { peopleQuery } from './people.js';
import { organizationQuery } from './organizations.js';
import { canSee, sourceFilter } from './scope.js';
import { DEFAULT_SORT, getView } from './views.js';
import type { OrganizationFilters, PeopleFilters } from '../schemas.js';

export const EXPORT_FORMAT_VERSION = 1 as const;
export const EXPORT_TABLES = ['people', 'companies', 'affiliations', 'lists', 'opportunities', 'stages', 'stage_history', 'notes', 'evidence', 'decisions'] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];
export const PART_BYTES = 400_000;
const PAGE = 500;

/** CSV cell: quoted when needed, and a leading formula character is neutralized. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
const csvLine = (values: unknown[]) => values.map(csvCell).join(',');
const cursorSchema = z.object({ after: z.string() }).strict();

type Rows = Record<string, string | number | null>[];
interface TableSpec { columns?: string[]; json?: boolean; fetch(after: string): Rows; row(row: Record<string, string | number | null>): unknown[] | Record<string, unknown> | null }

/**
 * One part of a scoped owner export: CSV for people, companies, affiliations,
 * lists, opportunities, stages and stage history, JSON for notes, evidence
 * references and decisions. Stable IDs and a format version are included and
 * every part ends at a record boundary. Source bodies are never exported, and
 * a filtered view exports only the records it shows to this caller.
 */
export function exportPart(ctx: Ctx, scope: AccessScope, input: { table: ExportTable; cursor?: string; viewId?: string }) {
  const after = decodeCursor(cursorSchema, input.cursor)?.after ?? '';
  const labels = new Labels(ctx);
  const filtered: { people: Set<string> | null; organizations: Set<string> | null } = { people: null, organizations: null };
  if (input.viewId) {
    const view = getView(ctx, scope, input.viewId);
    if (!view) throw new AppError('not_found', 'That view is no longer available');
    if (view.recordKind === 'person') {
      const query = peopleQuery(ctx, scope, view.filters as PeopleFilters, DEFAULT_SORT.person);
      filtered.people = new Set(ctx.db.all<{ id: string }>(`${query.with}SELECT p.id FROM persons p ${query.joins} WHERE ${query.where} LIMIT 20000`, ...query.withParams, ...query.params).map((row) => row.id));
    } else if (view.recordKind === 'organization') {
      const query = organizationQuery(ctx, scope, view.filters as OrganizationFilters, DEFAULT_SORT.organization);
      filtered.organizations = new Set(ctx.db.all<{ id: string }>(`${query.with}SELECT o.id FROM organizations o ${query.joins} WHERE ${query.where} LIMIT 20000`, ...query.withParams, ...query.params).map((row) => row.id));
    }
  }
  const visible = (table: 'person_sources' | 'organization_sources', column: 'person_id' | 'organization_id') => {
    if (scope.kind === 'owner') return { sql: '1', params: [] as Param[] };
    const filter = sourceFilter(scope, 's.source_key');
    return { sql: `EXISTS (SELECT 1 FROM ${table} s WHERE s.${column} = x.id AND ${filter.sql})`, params: filter.params };
  };
  const identifiers = (ownerKind: string, id: string, kind: string) => {
    const filter = sourceFilter(scope, 'o.source_key');
    return [...new Set(ctx.db.all<{ value: string }>(`SELECT o.value FROM identity_keys k JOIN identity_observations o ON o.key_id = k.id WHERE k.owner_kind = ? AND k.owner_id = ? AND k.kind = ? AND ${filter.sql} LIMIT 20`, ownerKind, id, kind, ...filter.params).map((row) => row.value))].join('; ');
  };
  const f = (column: string) => sourceFilter(scope, column);
  const specs: Record<ExportTable, TableSpec> = {
    people: {
      columns: ['id', 'name', 'headline', 'pinned', 'archived', 'origin', 'collection', 'emails', 'phones', 'linkedin', 'sources', 'created_at', 'updated_at', 'revision'],
      fetch: (from) => { const v = visible('person_sources', 'person_id'); return ctx.db.all(`SELECT x.* FROM persons x WHERE x.merged_into IS NULL AND x.id > ? AND ${v.sql} ORDER BY x.id LIMIT ?`, from, ...v.params, PAGE); },
      row: (row) => {
        const id = String(row.id);
        if (filtered.people && !filtered.people.has(id)) return null;
        const s = f('source_key');
        const sources = ctx.db.all<{ source_key: string }>(`SELECT source_key FROM person_sources WHERE person_id = ? AND ${s.sql}`, id, ...s.params).map((item) => labels.of(item.source_key)).join('; ');
        return [id, scope.kind === 'owner' || canSee(scope, row.name_source as string) ? row.display_name : '', canSee(scope, row.collection as string) ? row.headline : '', row.pinned, row.archived_at ? 1 : 0, row.origin, row.collection,
          identifiers('person', id, 'email'), identifiers('person', id, 'phone'), identifiers('person', id, 'linkedin'), sources, row.created_at, row.updated_at, row.revision];
      },
    },
    companies: {
      columns: ['id', 'name', 'kind', 'website', 'state', 'domains', 'archived', 'collection', 'created_at', 'updated_at', 'revision'],
      fetch: (from) => { const v = visible('organization_sources', 'organization_id'); return ctx.db.all(`SELECT x.* FROM organizations x WHERE x.merged_into IS NULL AND x.id > ? AND ${v.sql} ORDER BY x.id LIMIT ?`, from, ...v.params, PAGE); },
      row: (row) => {
        const id = String(row.id);
        if (filtered.organizations && !filtered.organizations.has(id)) return null;
        const d = f('source_key');
        const domains = ctx.db.all<{ domain: string }>(`SELECT DISTINCT domain FROM organization_domains WHERE organization_id = ? AND ${d.sql}`, id, ...d.params).map((item) => item.domain).join('; ');
        return [id, scope.kind === 'owner' || canSee(scope, row.name_source as string) ? row.display_name : '', row.kind, canSee(scope, row.collection as string) ? row.website : '', row.state, domains, row.archived_at ? 1 : 0, row.collection, row.created_at, row.updated_at, row.revision];
      },
    },
    affiliations: {
      columns: ['id', 'person_id', 'organization_id', 'role', 'valid_from', 'valid_to', 'observed_at', 'status', 'confidence', 'origin', 'source', 'decision'],
      fetch: (from) => { const s = f('source_key'); return ctx.db.all(`SELECT * FROM affiliations WHERE id > ? AND ${s.sql} ORDER BY id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => (filtered.people && !filtered.people.has(String(row.person_id)) ? null
        : [row.id, row.person_id, row.organization_id, row.role, row.valid_from, row.valid_to, row.observed_at, row.status, row.confidence, row.origin, labels.of(row.source_key as string), row.decision]),
    },
    lists: {
      columns: ['list_id', 'list_name', 'record_kind', 'collection', 'member_id', 'position'],
      fetch: (from) => { const s = f('l.collection'); return ctx.db.all(`SELECT m.id, l.id AS list_id, l.name, l.record_kind, l.collection, m.member_id, m.position FROM list_members m JOIN lists l ON l.id = m.list_id WHERE m.id > ? AND ${s.sql} ORDER BY m.id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => [row.list_id, row.name, row.record_kind, row.collection, row.member_id, row.position],
    },
    opportunities: {
      columns: ['id', 'title', 'pipeline_id', 'stage_id', 'organization_id', 'person_ids', 'target_date', 'value_minor', 'currency', 'next_action', 'next_action_date', 'archived', 'closed_at', 'collection', 'revision'],
      fetch: (from) => { const s = f('collection'); return ctx.db.all(`SELECT * FROM opportunities WHERE id > ? AND ${s.sql} ORDER BY id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => {
        const people = ctx.db.all<{ person_id: string }>('SELECT person_id FROM opportunity_people WHERE opportunity_id = ?', String(row.id)).map((item) => item.person_id).join('; ');
        return [row.id, row.title, row.pipeline_id, row.stage_id, row.organization_id, people, row.target_date, row.value_minor, row.currency, row.next_action, row.next_action_date, row.archived_at ? 1 : 0, row.closed_at, row.collection, row.revision];
      },
    },
    stages: {
      columns: ['pipeline_id', 'pipeline_name', 'stage_id', 'label', 'kind', 'position', 'archived'],
      fetch: (from) => { const s = f('p.collection'); return ctx.db.all(`SELECT s.*, p.name AS pipeline FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE s.id > ? AND ${s.sql} ORDER BY s.id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => [row.pipeline_id, row.pipeline, row.id, row.label, row.kind, row.position, row.archived_at ? 1 : 0],
    },
    stage_history: {
      columns: ['id', 'opportunity_id', 'from_pipeline_id', 'from_stage_id', 'to_pipeline_id', 'to_stage_id', 'actor', 'at', 'reason', 'evidence_id'],
      fetch: (from) => { const s = f('o.collection'); return ctx.db.all(`SELECT c.* FROM stage_changes c JOIN opportunities o ON o.id = c.opportunity_id WHERE c.id > ? AND ${s.sql} ORDER BY c.id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => [row.id, row.opportunity_id, row.from_pipeline_id, row.from_stage_id, row.to_pipeline_id, row.to_stage_id, row.actor, row.created_at, row.reason, row.evidence_id],
    },
    notes: {
      json: true,
      fetch: (from) => { const s = f('collection'); return ctx.db.all(`SELECT id, subject_kind, subject_id, title, body, collection, archived_at, created_at, updated_at, revision FROM notes WHERE id > ? AND ${s.sql} ORDER BY id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => (filtered.people && row.subject_kind === 'person' && !filtered.people.has(String(row.subject_id)) ? null : { ...row }),
    },
    evidence: {
      json: true,
      fetch: (from) => { const s = f('source_key'); return ctx.db.all(`SELECT id, kind, source_key, interaction_id, title, source_date, link, status, created_at FROM evidence WHERE id > ? AND ${s.sql} ORDER BY id LIMIT ?`, from, ...s.params, PAGE); },
      row: (row) => ({ ...row, source: labels.of(String(row.source_key)) }),
    },
    decisions: {
      json: true,
      fetch: (from) => ctx.db.all('SELECT id, decision_key, kind, subject_kind, subject_id, decision, extracted_value, user_value, actor, created_at, updated_at FROM decisions WHERE id > ? ORDER BY id LIMIT ?', from, PAGE),
      row: (row) => ({ type: 'decision', ...row }),
    },
  };
  if (input.table === 'decisions' && scope.kind !== 'owner') throw new AppError('forbidden', 'Only the owner can export decisions');
  const spec = specs[input.table];
  const lines: string[] = [];
  const records: unknown[] = [];
  let bytes = 0, last = after, fetched = 0, stopped = false;
  if (spec.columns && !after) { const line = csvLine(['format_version', ...spec.columns]); lines.push(line); bytes += Buffer.byteLength(line) + 1; }
  if (input.table === 'decisions' && !after) {
    records.push({ type: 'identity_reviews', items: ctx.db.all("SELECT id, kind, left_id, right_id, reason, state, decided_at, merge_id FROM identity_reviews WHERE state != 'open' ORDER BY id LIMIT 2000") });
    records.push({ type: 'merges', items: ctx.db.all('SELECT id, kind, survivor_id, merged_id, moves, state, created_at, undone_at FROM merges ORDER BY id LIMIT 2000') });
    records.push({ type: 'fact_decisions', items: ctx.db.all("SELECT id, subject_kind, subject_id, field, value, user_value, status, resolution, decided_at FROM facts WHERE status IN ('active','rejected','withdrawn','superseded') ORDER BY id LIMIT 5000") });
    bytes += Buffer.byteLength(JSON.stringify(records));
  }
  const rows = spec.fetch(after);
  for (const row of rows) {
    const value = spec.row(row);
    if (value !== null) {
      const text = Array.isArray(value) ? csvLine([EXPORT_FORMAT_VERSION, ...value]) : JSON.stringify(value);
      const size = Buffer.byteLength(text) + 2;
      if (bytes + size > PART_BYTES && (lines.length > 1 || records.length)) { stopped = true; break; }
      bytes += size;
      if (Array.isArray(value)) lines.push(text); else records.push(value);
    }
    last = String(row.id);
    fetched++;
  }
  const more = stopped || rows.length === PAGE;
  const content = spec.json ? JSON.stringify({ formatVersion: EXPORT_FORMAT_VERSION, table: input.table, records }, null, 1) : `${lines.join('\n')}\n`;
  return {
    fileName: `people-${input.table.replace('_', '-')}${after ? '-continued' : ''}.${spec.json ? 'json' : 'csv'}`,
    mimeType: spec.json ? 'application/json' as const : 'text/csv' as const,
    content,
    rows: spec.json ? records.length : lines.length - (after ? 0 : 1),
    nextCursor: more && last !== after ? encodeCursor({ after: last }) : null,
    formatVersion: EXPORT_FORMAT_VERSION,
    fetched,
  };
}
