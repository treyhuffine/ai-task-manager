import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { iso, newId, type Ctx, type Param } from './context.js';
import { refreshOrganization } from './organizations.js';
import { refreshPerson } from './people.js';
import { organizationNameFor, organizationRef, organizationVisible, personRef, personVisible } from './projection.js';
import { assertWritable, canSee, canSeeOpportunity, opportunityFilter, sourceFilter, touch, writableCollection } from './scope.js';
import { OWNER_ONLY_SOURCE, ftsQuery, removeSearchRow, setSearchRow } from './search.js';
import { cleanName, cleanText, isLocalDate } from './text.js';
import { projectTaskLink } from './commitments.js';
import type { OpportunitySummary, Pipeline, Sort } from '../schemas.js';

export type StageKind = 'open' | 'succeeded' | 'closed';
export const PIPELINE_TEMPLATES: Record<'client_work' | 'introductions' | 'blank', { label: string; kind: StageKind }[]> = {
  client_work: [
    { label: 'Exploring', kind: 'open' }, { label: 'Discussing', kind: 'open' }, { label: 'Proposal', kind: 'open' },
    { label: 'Won', kind: 'succeeded' }, { label: 'Closed', kind: 'closed' },
  ],
  introductions: [
    { label: 'Requested', kind: 'open' }, { label: 'Asked for consent', kind: 'open' }, { label: 'Introduced', kind: 'open' },
    { label: 'Connected', kind: 'succeeded' }, { label: 'Closed', kind: 'closed' },
  ],
  blank: [{ label: 'Open', kind: 'open' }, { label: 'Done', kind: 'succeeded' }, { label: 'Closed', kind: 'closed' }],
};

type PipelineRow = { id: string; revision: number; name: string; template: Pipeline['template']; collection: string; archived_at: string | null };
type StageRow = { id: string; pipeline_id: string; label: string; kind: StageKind; position: number; archived_at: string | null };
export type OpportunityRow = {
  id: string; created_at: string; updated_at: string; revision: number; title: string; pipeline_id: string; stage_id: string; organization_id: string | null;
  target_date: string | null; value_minor: number | null; currency: string | null; next_action: string | null; next_action_date: string | null;
  task_link_id: string | null; collection: string; archived_at: string | null; closed_at: string | null;
};

export function getPipelineRow(ctx: Ctx, scope: AccessScope, id: string): PipelineRow | null {
  const row = ctx.db.get<PipelineRow>('SELECT * FROM pipelines WHERE id = ?', id);
  return row && canSee(scope, row.collection) ? row : null;
}
export function stagesOf(ctx: Ctx, pipelineId: string, includeArchived = false): StageRow[] {
  return ctx.db.all<StageRow>(`SELECT * FROM pipeline_stages WHERE pipeline_id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY position, id`, pipelineId);
}

export function projectPipeline(ctx: Ctx, scope: AccessScope, row: PipelineRow): Pipeline {
  const filter = opportunityFilter(scope, 'o');
  const counts = new Map(ctx.db.all<{ stage_id: string; count: number }>(`SELECT o.stage_id, COUNT(*) AS count FROM opportunities o WHERE o.pipeline_id = ? AND o.archived_at IS NULL AND ${filter.sql} GROUP BY o.stage_id`, row.id, ...filter.params).map((item) => [item.stage_id, Number(item.count)]));
  const stages = stagesOf(ctx, row.id).map((stage, index) => ({ id: stage.id, label: stage.label, kind: stage.kind, position: index, count: counts.get(stage.id) ?? 0 }));
  return { id: row.id, revision: row.revision, name: row.name, template: row.template, collection: row.collection as Pipeline['collection'], archived: !!row.archived_at, stages, opportunityCount: stages.reduce((sum, stage) => sum + stage.count, 0) };
}

export function listPipelines(ctx: Ctx, scope: AccessScope, includeArchived = false): Pipeline[] {
  const filter = sourceFilter(scope, 'collection');
  return ctx.db.all<PipelineRow>(`SELECT * FROM pipelines WHERE ${filter.sql} ${includeArchived ? '' : 'AND archived_at IS NULL'} ORDER BY created_at, id LIMIT 50`, ...filter.params).map((row) => projectPipeline(ctx, scope, row));
}

const stageInput = z.object({ id: z.string().optional(), label: z.string(), kind: z.enum(['open', 'succeeded', 'closed']) });
/** Templates are only suggestions over the same fields. Stage IDs are stable and independent of labels and order. */
export function savePipeline(ctx: Ctx, scope: AccessScope, input: { id?: string; expectedRevision?: number; name?: string; template?: Pipeline['template']; stages?: z.infer<typeof stageInput>[]; collection?: string; archived?: boolean }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const time = iso(ctx);
  if (!input.id) {
    const name = cleanName(input.name, 120);
    if (!name) throw new AppError('invalid_input', 'Name the pipeline');
    const template = input.template ?? 'blank';
    const stages = (input.stages?.length ? input.stages : PIPELINE_TEMPLATES[template]).map((stage) => ({ label: cleanName(stage.label, 80), kind: stage.kind }));
    validateStages(stages);
    const collection = writableCollection(ctx, scope, input.collection);
    const id = newId();
    ctx.db.run('INSERT INTO pipelines (id, created_at, updated_at, revision, name, template, collection, archived_at) VALUES (?, ?, ?, 1, ?, ?, ?, NULL)', id, time, time, name, template, collection);
    stages.forEach((stage, index) => ctx.db.run('INSERT INTO pipeline_stages (id, created_at, updated_at, pipeline_id, label, kind, position, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', newId(), time, time, id, stage.label!, stage.kind, index));
    touch(ctx, collection);
    return { status: 'saved', id };
  }
  const row = getPipelineRow(ctx, scope, input.id);
  if (!row) throw new AppError('not_found', 'This pipeline is no longer available');
  assertWritable(scope, row.collection);
  if (input.expectedRevision === undefined || row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'This pipeline changed since you opened it. Compare and try again' };
  const name = input.name !== undefined ? cleanName(input.name, 120) : row.name;
  if (!name) throw new AppError('invalid_input', 'Name the pipeline');
  const archived = input.archived === undefined ? row.archived_at : input.archived ? row.archived_at ?? time : null;
  ctx.db.run('UPDATE pipelines SET name = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?', name, archived, time, row.id);
  touch(ctx, row.collection);
  return { status: 'saved', id: row.id };
}
function validateStages(stages: { label: string | null; kind: StageKind }[]) {
  if (!stages.length || stages.length > 20) throw new AppError('invalid_input', 'A pipeline needs between 1 and 20 stages');
  if (stages.some((stage) => !stage.label)) throw new AppError('invalid_input', 'Name every stage');
  if (!stages.some((stage) => stage.kind === 'open')) throw new AppError('invalid_input', 'Keep at least one open stage');
  const labels = stages.map((stage) => stage.label!.toLowerCase());
  if (new Set(labels).size !== labels.length) throw new AppError('invalid_input', 'Stage names must be different');
}

/**
 * Rename, add, reorder and remove stages by stable ID with one revision check.
 * A removed stage that still holds opportunities needs a replacement, and the
 * moves are recorded in stage history, so nothing is orphaned.
 */
export function savePipelineStages(ctx: Ctx, scope: AccessScope, actor: string, mutationId: string, input: { pipelineId: string; expectedRevision: number; stages: z.infer<typeof stageInput>[]; replacements?: { stageId: string; replacementStageId: string }[] }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const pipeline = getPipelineRow(ctx, scope, input.pipelineId);
  if (!pipeline) throw new AppError('not_found', 'This pipeline is no longer available');
  assertWritable(scope, pipeline.collection);
  if (pipeline.revision !== input.expectedRevision) return { status: 'conflict', id: pipeline.id, message: 'This pipeline changed since you opened it. Compare and try again' };
  const stages = input.stages.map((stage) => ({ id: stage.id, label: cleanName(stage.label, 80), kind: stage.kind }));
  validateStages(stages);
  const current = stagesOf(ctx, pipeline.id);
  const currentIds = new Set(current.map((stage) => stage.id));
  for (const stage of stages) if (stage.id && !currentIds.has(stage.id)) throw new AppError('invalid_input', 'A stage in this change does not belong to the pipeline');
  const time = iso(ctx);
  const kept = new Set(stages.filter((stage) => stage.id).map((stage) => stage.id!));
  const removed = current.filter((stage) => !kept.has(stage.id));
  const replacements = new Map((input.replacements ?? []).map((item) => [item.stageId, item.replacementStageId]));
  const ids = stages.map((stage) => stage.id ?? newId());
  stages.forEach((stage, index) => {
    if (stage.id) ctx.db.run('UPDATE pipeline_stages SET label = ?, kind = ?, position = ?, updated_at = ? WHERE id = ?', stage.label!, stage.kind, index, time, stage.id);
    else ctx.db.run('INSERT INTO pipeline_stages (id, created_at, updated_at, pipeline_id, label, kind, position, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)', ids[index], time, time, pipeline.id, stage.label!, stage.kind, index);
  });
  for (const stage of removed) {
    const occupied = ctx.db.all<{ id: string; collection: string }>('SELECT id, collection FROM opportunities WHERE stage_id = ?', stage.id);
    if (occupied.length) {
      const target = replacements.get(stage.id);
      if (!target || !kept.has(target)) throw new AppError('invalid_input', `Choose where the ${occupied.length} ${occupied.length === 1 ? 'opportunity' : 'opportunities'} in ${stage.label} should move before removing it`);
      const targetStage = ctx.db.get<StageRow>('SELECT * FROM pipeline_stages WHERE id = ?', target)!;
      for (const opportunity of occupied) {
        ctx.db.run('UPDATE opportunities SET stage_id = ?, closed_at = CASE WHEN ? = \'open\' THEN NULL ELSE COALESCE(closed_at, ?) END, revision = revision + 1, updated_at = ? WHERE id = ?', target, targetStage.kind, time, time, opportunity.id);
        ctx.db.run('INSERT INTO stage_changes (id, created_at, updated_at, opportunity_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, actor, mutation_id, suggestion_id, evidence_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)',
          newId(), time, time, opportunity.id, pipeline.id, stage.id, pipeline.id, target, actor, mutationId, `Stage ${stage.label} was removed`);
        touch(ctx, opportunity.collection);
      }
    }
    ctx.db.run('UPDATE pipeline_stages SET archived_at = ?, updated_at = ? WHERE id = ?', time, time, stage.id);
  }
  // Moving a stage between open and closed kinds keeps closed dates honest for opportunities already in it.
  for (const stage of stagesOf(ctx, pipeline.id)) ctx.db.run(`UPDATE opportunities SET closed_at = ${stage.kind === 'open' ? 'NULL' : 'COALESCE(closed_at, ?)'}, updated_at = updated_at WHERE stage_id = ?`, ...(stage.kind === 'open' ? [] : [time]), stage.id);
  ctx.db.run('UPDATE pipelines SET revision = revision + 1, updated_at = ? WHERE id = ?', time, pipeline.id);
  touch(ctx, pipeline.collection);
  return { status: 'saved', id: pipeline.id };
}

// ─── Opportunities ───────────────────────────────────────────────────────────

/** An opportunity this caller may see: its own collection and its pipeline's collection are both allowed. */
export function getOpportunityRow(ctx: Ctx, scope: AccessScope, id: string): OpportunityRow | null {
  const row = ctx.db.get<OpportunityRow>('SELECT * FROM opportunities WHERE id = ?', id);
  return row && canSeeOpportunity(ctx, scope, row) ? row : null;
}
/** Search text for an opportunity. The company name is indexed only as the opportunity's own collection knows it. */
export function indexOpportunity(ctx: Ctx, row: OpportunityRow) {
  const organization = row.organization_id ? organizationNameFor(ctx, row.organization_id, row.collection) : null;
  setSearchRow(ctx, `opportunity:${row.id}`, 'opportunity', row.id, row.collection, `${row.title} ${row.next_action ?? ''} ${organization ?? ''}`);
  const full = row.organization_id && !organization ? ctx.db.get<{ display_name: string }>('SELECT display_name FROM organizations WHERE id = ?', row.organization_id)?.display_name : null;
  if (full) setSearchRow(ctx, `opportunity:${row.id}:${OWNER_ONLY_SOURCE}`, 'opportunity', row.id, OWNER_ONLY_SOURCE, `${row.title} ${full}`);
  else removeSearchRow(ctx, `opportunity:${row.id}:${OWNER_ONLY_SOURCE}`);
}
function linkedPeople(ctx: Ctx, id: string) {
  return ctx.db.all<{ person_id: string }>('SELECT person_id FROM opportunity_people WHERE opportunity_id = ?', id).map((row) => row.person_id);
}

export interface SaveOpportunityInput {
  id?: string; expectedRevision?: number; title?: string; pipelineId?: string; stageId?: string;
  organizationId?: string | null; personIds?: string[]; targetDate?: string | null; value?: { minor: number; currency: string } | null;
  nextAction?: string | null; nextActionDate?: string | null; collection?: string; archived?: boolean;
}
/** Create or edit an opportunity. Value and currency are both set or both absent. A friend never needs one. */
export function saveOpportunity(ctx: Ctx, scope: AccessScope, actor: string, mutationId: string, input: SaveOpportunityInput): { status: 'saved' | 'conflict'; id: string; message?: string } {
  for (const value of [input.targetDate, input.nextActionDate]) if (value && !isLocalDate(value)) throw new AppError('invalid_input', 'Use a real calendar date');
  if (input.value && !/^[A-Z]{3}$/.test(input.value.currency)) throw new AppError('invalid_input', 'Use a three-letter currency code such as USD');
  if (input.value && !Number.isSafeInteger(input.value.minor)) throw new AppError('invalid_input', 'Enter the value in whole minor units');
  if (input.organizationId && !organizationVisible(ctx, scope, input.organizationId)) throw new AppError('not_found', 'That company is no longer available');
  for (const id of input.personIds ?? []) if (!personVisible(ctx, scope, id)) throw new AppError('not_found', 'A person in this change is no longer available');
  const time = iso(ctx);
  let row: OpportunityRow;
  if (!input.id) {
    const title = cleanName(input.title, 300);
    if (!title) throw new AppError('invalid_input', 'Name the opportunity');
    if (!input.pipelineId) throw new AppError('invalid_input', 'Choose a pipeline');
    const pipeline = getPipelineRow(ctx, scope, input.pipelineId);
    if (!pipeline || pipeline.archived_at) throw new AppError('not_found', 'That pipeline is no longer available');
    const stages = stagesOf(ctx, pipeline.id);
    const stage = input.stageId ? stages.find((item) => item.id === input.stageId) : stages.find((item) => item.kind === 'open');
    if (!stage) throw new AppError('invalid_input', 'Choose a stage in this pipeline');
    const collection = writableCollection(ctx, scope, input.collection ?? pipeline.collection);
    const id = newId();
    ctx.db.run(
      `INSERT INTO opportunities (id, created_at, updated_at, revision, title, pipeline_id, stage_id, organization_id, target_date, value_minor, currency, next_action, next_action_date, task_link_id, collection, archived_at, closed_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
      id, time, time, title, pipeline.id, stage.id, input.organizationId ?? null, input.targetDate ?? null, input.value?.minor ?? null, input.value?.currency ?? null,
      cleanText(input.nextAction, 300), input.nextActionDate ?? null, collection, stage.kind === 'open' ? null : time,
    );
    ctx.db.run('INSERT INTO stage_changes (id, created_at, updated_at, opportunity_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, actor, mutation_id, suggestion_id, evidence_id, reason) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?)',
      newId(), time, time, id, pipeline.id, stage.id, actor, mutationId, 'Created');
    row = ctx.db.get<OpportunityRow>('SELECT * FROM opportunities WHERE id = ?', id)!;
  } else {
    const existing = getOpportunityRow(ctx, scope, input.id);
    if (!existing) throw new AppError('not_found', 'This opportunity is no longer available');
    assertWritable(scope, existing.collection);
    if (input.expectedRevision === undefined || existing.revision !== input.expectedRevision) return { status: 'conflict', id: existing.id, message: 'This opportunity changed since you opened it. Compare and try again' };
    if (input.pipelineId && input.pipelineId !== existing.pipeline_id || input.stageId && input.stageId !== existing.stage_id) throw new AppError('invalid_input', 'Use Move to stage to change the stage or pipeline');
    const changes: string[] = [], params: Param[] = [];
    if (input.title !== undefined) { const title = cleanName(input.title, 300); if (!title) throw new AppError('invalid_input', 'Name the opportunity'); changes.push('title = ?'); params.push(title); }
    if (input.organizationId !== undefined) { changes.push('organization_id = ?'); params.push(input.organizationId); }
    if (input.targetDate !== undefined) { changes.push('target_date = ?'); params.push(input.targetDate); }
    if (input.value !== undefined) { changes.push('value_minor = ?', 'currency = ?'); params.push(input.value?.minor ?? null, input.value?.currency ?? null); }
    if (input.nextAction !== undefined) { changes.push('next_action = ?'); params.push(cleanText(input.nextAction, 300)); }
    if (input.nextActionDate !== undefined) { changes.push('next_action_date = ?'); params.push(input.nextActionDate); }
    if (input.archived !== undefined) { changes.push('archived_at = ?'); params.push(input.archived ? existing.archived_at ?? time : null); }
    if (input.collection !== undefined && input.collection !== existing.collection) { changes.push('collection = ?'); params.push(writableCollection(ctx, scope, input.collection)); }
    ctx.db.run(`UPDATE opportunities SET ${[...changes, 'revision = revision + 1', 'updated_at = ?'].join(', ')} WHERE id = ?`, ...params, time, existing.id);
    row = ctx.db.get<OpportunityRow>('SELECT * FROM opportunities WHERE id = ?', existing.id)!;
    if (existing.organization_id && existing.organization_id !== row.organization_id) refreshOrganization(ctx, existing.organization_id);
    touch(ctx, existing.collection);
  }
  const before = new Set(linkedPeople(ctx, row.id));
  if (input.personIds) {
    const next = new Set(input.personIds);
    for (const id of before) if (!next.has(id) && (scope.kind === 'owner' || personVisible(ctx, scope, id))) ctx.db.run('DELETE FROM opportunity_people WHERE opportunity_id = ? AND person_id = ?', row.id, id);
    for (const id of next) if (!before.has(id)) ctx.db.run('INSERT INTO opportunity_people (id, created_at, updated_at, opportunity_id, person_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT(opportunity_id, person_id) DO NOTHING', `${row.id}:${id}`, time, time, row.id, id);
  }
  for (const id of new Set([...before, ...(input.personIds ?? [])])) refreshPerson(ctx, id);
  if (row.organization_id) refreshOrganization(ctx, row.organization_id);
  indexOpportunity(ctx, row);
  touch(ctx, row.collection);
  return { status: 'saved', id: row.id };
}

/**
 * Move to a stage, optionally in another pipeline (which needs a destination
 * stage). Concurrent moves are caught by the revision check. History is
 * append-only. Moving never sends a message or completes a task.
 */
export function moveOpportunity(ctx: Ctx, scope: AccessScope, actor: string, mutationId: string, input: { id: string; expectedRevision: number; stageId: string; pipelineId?: string; suggestionId?: string; evidenceId?: string | null }): { status: 'saved' | 'conflict'; id: string; message?: string } {
  const row = getOpportunityRow(ctx, scope, input.id);
  if (!row) throw new AppError('not_found', 'This opportunity is no longer available');
  assertWritable(scope, row.collection);
  if (row.revision !== input.expectedRevision) return { status: 'conflict', id: row.id, message: 'Someone moved or changed this opportunity first. Compare and try again' };
  const pipelineId = input.pipelineId ?? row.pipeline_id;
  const pipeline = getPipelineRow(ctx, scope, pipelineId);
  if (!pipeline || pipeline.archived_at) throw new AppError('not_found', 'That pipeline is no longer available');
  const stage = stagesOf(ctx, pipeline.id).find((item) => item.id === input.stageId);
  if (!stage) throw new AppError('invalid_input', pipelineId !== row.pipeline_id ? 'Choose a destination stage in the other pipeline' : 'Choose a stage in this pipeline');
  if (stage.id === row.stage_id && pipeline.id === row.pipeline_id) return { status: 'saved', id: row.id };
  const time = iso(ctx);
  ctx.db.run(`UPDATE opportunities SET pipeline_id = ?, stage_id = ?, closed_at = ${stage.kind === 'open' ? 'NULL' : 'COALESCE(closed_at, ?)'}, revision = revision + 1, updated_at = ? WHERE id = ?`,
    pipeline.id, stage.id, ...(stage.kind === 'open' ? [] : [time]), time, row.id);
  ctx.db.run('INSERT INTO stage_changes (id, created_at, updated_at, opportunity_id, from_pipeline_id, from_stage_id, to_pipeline_id, to_stage_id, actor, mutation_id, suggestion_id, evidence_id, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId(), time, time, row.id, row.pipeline_id, row.stage_id, pipeline.id, stage.id, actor, mutationId, input.suggestionId ?? null, input.evidenceId ?? null, input.suggestionId ? 'Accepted a suggestion from a message' : null);
  touch(ctx, row.collection);
  return { status: 'saved', id: row.id };
}

// ─── Lists and projection ────────────────────────────────────────────────────

export function summarizeOpportunity(ctx: Ctx, scope: AccessScope, row: OpportunityRow): OpportunitySummary {
  const stage = ctx.db.get<StageRow>('SELECT * FROM pipeline_stages WHERE id = ?', row.stage_id);
  const people = linkedPeople(ctx, row.id).map((id) => personRef(ctx, scope, id)).filter((item): item is { id: string; name: string } => !!item);
  const link = row.task_link_id ? ctx.db.get<Record<string, unknown>>('SELECT * FROM task_links WHERE id = ?', row.task_link_id) : undefined;
  return {
    id: row.id, revision: row.revision, title: row.title, pipelineId: row.pipeline_id, stageId: row.stage_id,
    stageLabel: stage?.label ?? 'Unknown stage', stageKind: stage?.kind ?? 'open',
    organization: organizationRef(ctx, scope, row.organization_id), people,
    nextAction: row.next_action, nextActionDate: row.next_action_date, targetDate: row.target_date,
    value: row.value_minor !== null && row.currency ? { minor: row.value_minor, currency: row.currency } : null,
    taskLink: link && canSee(scope, String(link.collection)) ? projectTaskLink(link) : null,
    archived: !!row.archived_at, closed: !!row.closed_at, updatedAt: row.updated_at,
  };
}

const cursorSchema = z.object({ k: z.union([z.string(), z.number()]), id: z.string() }).strict();
export function listOpportunities(ctx: Ctx, scope: AccessScope, input: { cursor?: string; limit: number; filters: { text?: string; pipelineId?: string; stageIds?: string[]; organizationIds?: string[]; personIds?: string[]; archived?: 'active' | 'archived' | 'all' }; sort: Sort }) {
  const filter = opportunityFilter(scope, 'o');
  const where: string[] = [filter.sql];
  const params: Param[] = [...filter.params];
  const archived = input.filters.archived ?? 'active';
  if (archived === 'active') where.push('o.archived_at IS NULL');
  else if (archived === 'archived') where.push('o.archived_at IS NOT NULL');
  if (input.filters.pipelineId) { where.push('o.pipeline_id = ?'); params.push(input.filters.pipelineId); }
  const list = (column: string, values: string[]) => { where.push(`${column} IN (${values.map(() => '?').join(',')})`); params.push(...values); };
  if (input.filters.stageIds?.length) list('o.stage_id', input.filters.stageIds);
  if (input.filters.organizationIds?.length) list('o.organization_id', input.filters.organizationIds);
  if (input.filters.personIds?.length) { where.push(`EXISTS (SELECT 1 FROM opportunity_people op WHERE op.opportunity_id = o.id AND op.person_id IN (${input.filters.personIds.map(() => '?').join(',')}))`); params.push(...input.filters.personIds); }
  const fts = ftsQuery(input.filters.text);
  if (input.filters.text?.trim() && !fts) where.push('0');
  if (fts) { const s = sourceFilter(scope, 'r.source_key'); where.push(`o.id IN (SELECT r.record_id FROM search_fts f JOIN search_rows r ON r.id = f.rowid WHERE search_fts MATCH ? AND r.record_kind = 'opportunity' AND ${s.sql})`); params.push(fts, ...s.params); }
  const key = input.sort.key === 'title' ? 'lower(o.title)' : input.sort.key === 'next_action' ? "COALESCE(o.next_action_date, '9999')" : input.sort.key === 'target_date' ? "COALESCE(o.target_date, '9999')" : input.sort.key === 'added' ? 'o.created_at'
    : "printf('%04d', (SELECT s.position FROM pipeline_stages s WHERE s.id = o.stage_id)) || COALESCE(o.next_action_date, '9999')";
  const descending = input.sort.direction === 'desc';
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const rows = ctx.db.all<OpportunityRow & { k: string }>(
    `SELECT * FROM (SELECT o.*, ${key} AS k FROM opportunities o WHERE ${where.join(' AND ')}) ${cursor ? `WHERE (k, id) ${descending ? '<' : '>'} (?, ?)` : ''} ORDER BY k ${descending ? 'DESC' : 'ASC'}, id ${descending ? 'DESC' : 'ASC'} LIMIT ?`,
    ...params, ...(cursor ? [cursor.k, cursor.id] : []), input.limit + 1);
  const total = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM opportunities o WHERE ${where.join(' AND ')}`, ...params)?.count ?? 0);
  const items = rows.slice(0, input.limit);
  const last = items.at(-1);
  return { items: items.map((row) => summarizeOpportunity(ctx, scope, row)), nextCursor: rows.length > input.limit && last ? encodeCursor({ k: last.k, id: last.id }) : null, total };
}

/**
 * Append-only stage history. Names from a pipeline this caller may not see
 * (an earlier pipeline the card moved from) are replaced by a neutral label.
 */
export function stageHistory(ctx: Ctx, scope: AccessScope, opportunityId: string) {
  const visiblePipeline = (id: string | null) => {
    if (!id) return false;
    const pipeline = ctx.db.get<{ collection: string }>('SELECT collection FROM pipelines WHERE id = ?', id);
    return !!pipeline && canSee(scope, pipeline.collection);
  };
  const raw = (table: string, id: string | null) => (id ? ctx.db.get<{ name: string }>(`SELECT ${table === 'pipelines' ? 'name' : 'label'} AS name FROM ${table} WHERE id = ?`, id)?.name ?? null : null);
  const name = (table: string, id: string | null, pipelineId: string | null) => (id && !visiblePipeline(pipelineId) ? (table === 'pipelines' ? 'Another pipeline' : 'A stage in another pipeline') : raw(table, id));
  return ctx.db.all<{ id: string; created_at: string; from_pipeline_id: string | null; from_stage_id: string | null; to_pipeline_id: string; to_stage_id: string; actor: string; reason: string | null; evidence_id: string | null }>(
    'SELECT * FROM stage_changes WHERE opportunity_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 100', opportunityId)
    .map((row) => ({
      id: row.id, at: row.created_at, fromStage: name('pipeline_stages', row.from_stage_id, row.from_pipeline_id), toStage: name('pipeline_stages', row.to_stage_id, row.to_pipeline_id) ?? 'Unknown stage',
      fromPipeline: name('pipelines', row.from_pipeline_id, row.from_pipeline_id), toPipeline: name('pipelines', row.to_pipeline_id, row.to_pipeline_id) ?? 'Unknown pipeline',
      actor: row.actor.startsWith('owner-ui') || row.actor.startsWith('fixture') ? 'You' : row.actor.startsWith('chat:') ? 'A chat, at your request' : 'You',
      reason: row.reason, evidenceId: row.evidence_id,
    }));
}
export { validateStages };
