import type { AccessScope } from '@ri/app-kit/data';
import type { Ctx } from './context.js';
import { canSee, sourceFilter } from './scope.js';
import type { Labels } from './coverage.js';
import type { NextAction } from '../schemas.js';

/**
 * Read helpers that project one record for one caller. Every value here is
 * computed from rows whose source the caller may see, so names, companies,
 * dates and next actions never leak another account's data.
 */

export interface PersonCore {
  id: string;
  display_name: string;
  name_source: string | null;
  last_exchange_at: string | null;
  pinned: number;
  archived_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  collection: string;
  origin: string;
  name_override: string | null;
  keep_in_touch_days: number | null;
  headline: string | null;
}
export interface OrganizationCore {
  id: string;
  display_name: string;
  name_source: string | null;
  last_activity_at: string | null;
  archived_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  state: string;
  collection: string;
  name_override: string | null;
  kind: string | null;
  website: string | null;
}

export function personVisible(ctx: Ctx, scope: AccessScope, personId: string): boolean {
  if (scope.kind === 'owner') return !!ctx.db.get('SELECT 1 AS ok FROM persons WHERE id = ? AND merged_into IS NULL', personId);
  const filter = sourceFilter(scope, 'source_key');
  return !!ctx.db.get(`SELECT 1 AS ok FROM person_sources WHERE person_id = ? AND ${filter.sql} LIMIT 1`, personId, ...filter.params);
}
export function organizationVisible(ctx: Ctx, scope: AccessScope, organizationId: string): boolean {
  if (scope.kind === 'owner') return !!ctx.db.get('SELECT 1 AS ok FROM organizations WHERE id = ? AND merged_into IS NULL', organizationId);
  const filter = sourceFilter(scope, 'source_key');
  return !!ctx.db.get(`SELECT 1 AS ok FROM organization_sources WHERE organization_id = ? AND ${filter.sql} LIMIT 1`, organizationId, ...filter.params);
}

export function personName(ctx: Ctx, scope: AccessScope, person: Pick<PersonCore, 'id' | 'display_name' | 'name_source'>): string {
  if (scope.kind === 'owner' || canSee(scope, person.name_source)) return person.display_name;
  const filter = sourceFilter(scope, 'source_key');
  const row = ctx.db.get<{ name: string }>(`SELECT name FROM person_sources WHERE person_id = ? AND name IS NOT NULL AND ${filter.sql} ORDER BY name_rank ASC, name_at DESC LIMIT 1`, person.id, ...filter.params);
  return row?.name ?? 'Unnamed contact';
}
export function organizationName(ctx: Ctx, scope: AccessScope, organization: Pick<OrganizationCore, 'id' | 'display_name' | 'name_source'>): string {
  if (scope.kind === 'owner' || canSee(scope, organization.name_source)) return organization.display_name;
  const filter = sourceFilter(scope, 'source_key');
  const row = ctx.db.get<{ name: string }>(`SELECT name FROM organization_sources WHERE organization_id = ? AND name IS NOT NULL AND ${filter.sql} ORDER BY name_rank ASC, name_at DESC LIMIT 1`, organization.id, ...filter.params);
  return row?.name ?? 'Unnamed organization';
}
export function personNameById(ctx: Ctx, scope: AccessScope, personId: string): string | null {
  const person = ctx.db.get<PersonCore & { merged_into: string | null }>('SELECT * FROM persons WHERE id = ?', personId);
  if (!person || person.merged_into || !personVisible(ctx, scope, personId)) return null;
  return personName(ctx, scope, person);
}
export function organizationRef(ctx: Ctx, scope: AccessScope, organizationId: string | null): { id: string; name: string } | null {
  if (!organizationId) return null;
  const organization = ctx.db.get<OrganizationCore & { merged_into: string | null }>('SELECT * FROM organizations WHERE id = ?', organizationId);
  if (!organization || organization.merged_into || !organizationVisible(ctx, scope, organizationId)) return null;
  return { id: organization.id, name: organizationName(ctx, scope, organization) };
}
export function personRef(ctx: Ctx, scope: AccessScope, personId: string | null): { id: string; name: string } | null {
  if (!personId) return null;
  const name = personNameById(ctx, scope, personId);
  return name ? { id: personId, name } : null;
}

export function lastExchange(ctx: Ctx, scope: AccessScope, person: Pick<PersonCore, 'id' | 'last_exchange_at'>): string | null {
  if (scope.kind === 'owner') return person.last_exchange_at;
  const filter = sourceFilter(scope, 'source_key');
  return ctx.db.get<{ at: string | null }>(`SELECT MAX(last_exchange_at) AS at FROM person_sources WHERE person_id = ? AND ${filter.sql}`, person.id, ...filter.params)?.at ?? null;
}

export function nextMeeting(ctx: Ctx, scope: AccessScope, personId: string, now: string): { id: string; at: string; title: string } | null {
  const filter = sourceFilter(scope, 'ip.source_key');
  const row = ctx.db.get<{ id: string; at: string; subject: string | null }>(
    `SELECT i.id, i.occurred_at AS at, i.subject FROM interaction_participants ip JOIN interactions i ON i.id = ip.interaction_id
     WHERE ip.person_id = ? AND ip.kind = 'meeting' AND ip.active = 1 AND ip.occurred_at >= ? AND ${filter.sql}
     ORDER BY ip.occurred_at ASC LIMIT 1`, personId, now, ...filter.params);
  return row ? { id: row.id, at: row.at, title: row.subject?.trim() || 'Meeting scheduled' } : null;
}

export function primaryEmail(ctx: Ctx, scope: AccessScope, personId: string): string | null {
  const filter = sourceFilter(scope, 'o.source_key');
  return ctx.db.get<{ value: string }>(
    `SELECT o.value FROM identity_keys k JOIN identity_observations o ON o.key_id = k.id
     WHERE k.owner_kind = 'person' AND k.owner_id = ? AND k.kind = 'email' AND k.shared = 0 AND ${filter.sql}
     ORDER BY o.confirmation = 'confirmed' DESC, o.last_seen_at DESC LIMIT 1`, personId, ...filter.params)?.value ?? null;
}

export function memberLists(ctx: Ctx, scope: AccessScope, memberId: string): { id: string; name: string }[] {
  const filter = sourceFilter(scope, 'l.collection');
  return ctx.db.all<{ id: string; name: string }>(
    `SELECT l.id, l.name FROM list_members m JOIN lists l ON l.id = m.list_id WHERE m.member_id = ? AND l.archived_at IS NULL AND ${filter.sql} ORDER BY l.name LIMIT 20`,
    memberId, ...filter.params);
}

export function sourceLabels(ctx: Ctx, scope: AccessScope, table: 'person_sources' | 'organization_sources', column: 'person_id' | 'organization_id', id: string, labels: Labels): string[] {
  const filter = sourceFilter(scope, 'source_key');
  return [...new Set(ctx.db.all<{ source_key: string }>(`SELECT source_key FROM ${table} WHERE ${column} = ? AND ${filter.sql} ORDER BY source_key LIMIT 20`, id, ...filter.params).map((row) => labels.of(row.source_key)))];
}

type AffiliationRow = { id: string; organization_id: string; role: string | null; status: string; confidence: string; observed_at: string; valid_to: string | null; source_key: string; origin: string };
/** The affiliation to show beside a name: confirmed before observed, newest first, never a former or suggested one. */
export function bestAffiliation(ctx: Ctx, scope: AccessScope, personId: string, today: string): { company: { id: string; name: string } | null; role: string | null; status: 'current' | 'observed' | 'former' | 'uncertain' | null; row: AffiliationRow | null } {
  const filter = sourceFilter(scope, 'a.source_key');
  const rows = ctx.db.all<AffiliationRow>(
    `SELECT a.id, a.organization_id, a.role, a.status, a.confidence, a.observed_at, a.valid_to, a.source_key, a.origin
     FROM affiliations a WHERE a.person_id = ? AND a.confidence != 'suggested' AND (a.decision IS NULL OR a.decision != 'rejected') AND ${filter.sql}
     ORDER BY (a.status = 'former' OR (a.valid_to IS NOT NULL AND a.valid_to < ?)) ASC, a.confidence = 'confirmed' DESC, a.status = 'current' DESC, a.observed_at DESC LIMIT 5`,
    personId, today, ...filter.params);
  for (const row of rows) {
    const company = organizationRef(ctx, scope, row.organization_id);
    if (!company) continue;
    const former = row.status === 'former' || (!!row.valid_to && row.valid_to < today);
    const status = former ? 'former' : row.confidence === 'confirmed' ? (row.status === 'current' ? 'current' : 'uncertain') : 'observed';
    return { company, role: row.role, status, row };
  }
  return { company: null, role: null, status: null, row: null };
}

/**
 * The next chosen step for a record: the earliest dated Ri follow-up, accepted
 * commitment or opportunity step, then an undated one, then what you are
 * waiting on. Suggestions never count: they are not chosen.
 */
export function nextActionFor(ctx: Ctx, scope: AccessScope, subject: { kind: 'person' | 'organization'; id: string }, today: string): NextAction | null {
  const candidates: { label: string; dueDate: string | null; kind: NextAction['kind'] }[] = [];
  const tasks = sourceFilter(scope, 'collection');
  for (const row of ctx.db.all<{ title: string; due_at: string | null }>(
    `SELECT title, due_at FROM task_links WHERE subject_kind = ? AND subject_id = ? AND status IN ('pending','linked') AND (task_status IS NULL OR task_status NOT IN ('done','completed','archived')) AND ${tasks.sql} ORDER BY COALESCE(due_at, '9999') LIMIT 3`,
    subject.kind, subject.id, ...tasks.params))
    candidates.push({ label: row.title, dueDate: row.due_at ? row.due_at.slice(0, 10) : null, kind: 'task' });
  const commitments = sourceFilter(scope, 'source_key');
  const column = subject.kind === 'person' ? 'person_id' : 'organization_id';
  const accepted = ctx.db.all<{ action: string; due_date: string | null; direction: string; snoozed_until: string | null }>(
    `SELECT action, due_date, direction, snoozed_until FROM commitments WHERE ${column} = ? AND state = 'accepted' AND ${commitments.sql} ORDER BY COALESCE(due_date, '9999') LIMIT 6`,
    subject.id, ...commitments.params);
  for (const row of accepted) {
    if (row.snoozed_until && row.snoozed_until > today) continue;
    if (row.direction === 'i_owe') candidates.push({ label: row.action, dueDate: row.due_date, kind: 'commitment' });
  }
  const opportunities = sourceFilter(scope, 'o.collection');
  const opportunityRows = subject.kind === 'person'
    ? ctx.db.all<{ next_action: string | null; next_action_date: string | null }>(
      `SELECT o.next_action, o.next_action_date FROM opportunity_people op JOIN opportunities o ON o.id = op.opportunity_id JOIN pipeline_stages s ON s.id = o.stage_id
       WHERE op.person_id = ? AND o.archived_at IS NULL AND s.kind = 'open' AND o.next_action IS NOT NULL AND ${opportunities.sql} ORDER BY COALESCE(o.next_action_date, '9999') LIMIT 3`, subject.id, ...opportunities.params)
    : ctx.db.all<{ next_action: string | null; next_action_date: string | null }>(
      `SELECT o.next_action, o.next_action_date FROM opportunities o JOIN pipeline_stages s ON s.id = o.stage_id
       WHERE o.organization_id = ? AND o.archived_at IS NULL AND s.kind = 'open' AND o.next_action IS NOT NULL AND ${opportunities.sql} ORDER BY COALESCE(o.next_action_date, '9999') LIMIT 3`, subject.id, ...opportunities.params);
  for (const row of opportunityRows) candidates.push({ label: row.next_action!, dueDate: row.next_action_date, kind: 'opportunity' });
  const dated = candidates.filter((item) => item.dueDate).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const chosen = dated[0] ?? candidates[0];
  if (chosen) return { ...chosen, overdue: !!chosen.dueDate && chosen.dueDate < today };
  const waiting = accepted.find((row) => row.direction === 'waiting_on' && !(row.snoozed_until && row.snoozed_until > today));
  if (waiting) return { label: `Waiting on ${lowerFirst(waiting.action)}`, dueDate: waiting.due_date, kind: 'waiting', overdue: !!waiting.due_date && waiting.due_date < today };
  return null;
}
const lowerFirst = (value: string) => (/^[A-Z][a-z]/.test(value) ? value[0].toLowerCase() + value.slice(1) : value);

/** A month-and-year phrase in UTC for provenance lines, such as "October 2026". */
export function monthYear(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? 'an unknown date' : date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function longDate(instant: string): string {
  const date = new Date(instant);
  return Number.isNaN(date.getTime()) ? 'an unknown date' : date.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
