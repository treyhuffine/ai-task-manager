import { AppError } from '@ri/app-kit/contract';
import { boundText, type AccessScope } from '@ri/app-kit/data';
import { iso, type Ctx } from './context.js';
import { saveExclusion } from './exclusions.js';
import { getOrganizationRow, refreshOrganization, saveOrganization } from './organizations.js';
import { getPersonRow, refreshPerson, savePerson } from './people.js';
import { organizationVisible, personName, personVisible } from './projection.js';
import { canSee, MANUAL, touch } from './scope.js';
import { removeSearchForRecord } from './search.js';
import { updateListMembers } from './lists.js';
import type { Evidence } from '../schemas.js';

/**
 * Remove a person or company. Archive keeps everything. Remove deletes the
 * record's imported details and links, keeps conversations in their sources,
 * and either keeps your notes on an archived record or deletes them. Suppress
 * stops rediscovery of its addresses until you clear it in Sources. Ri tasks
 * are never deleted. Removing a company never removes its people.
 */
export function deleteRecord(ctx: Ctx, input: { kind: 'person' | 'organization'; id: string; expectedRevision: number; mode: 'archive' | 'remove'; notes: 'keep' | 'delete'; suppress: boolean }) {
  const time = iso(ctx);
  if (input.kind === 'person') {
    const person = getPersonRow(ctx, input.id);
    if (!person || person.merged_into) throw new AppError('not_found', 'This person is no longer available');
    if (person.revision !== input.expectedRevision) return { status: 'conflict' as const, message: 'This person changed since you opened it. Review again' };
    const emails = ctx.db.all<{ id: string; normalized: string }>("SELECT id, normalized FROM identity_keys WHERE owner_kind = 'person' AND owner_id = ? AND kind = 'email'", person.id);
    if (input.suppress) for (const email of emails) saveExclusion(ctx, { value: email.normalized, kind: 'sender', decision: 'suppressed' });
    if (input.mode === 'archive') {
      ctx.db.run('UPDATE persons SET archived_at = COALESCE(archived_at, ?), revision = revision + 1, updated_at = ? WHERE id = ?', time, time, person.id);
      touch(ctx, person.collection);
      return { status: 'saved' as const, message: input.suppress ? 'Archived. Its addresses will not be rediscovered' : 'Archived' };
    }
    ctx.db.run(`UPDATE identity_keys SET owner_kind = 'none', owner_id = NULL, decision = ?, revision = revision + 1, updated_at = ? WHERE owner_kind = 'person' AND owner_id = ?`, input.suppress ? 'user' : 'auto', time, person.id);
    ctx.db.run('UPDATE interaction_participants SET person_id = NULL, updated_at = ? WHERE person_id = ?', time, person.id);
    const organizations = ctx.db.all<{ organization_id: string }>('SELECT DISTINCT organization_id FROM affiliations WHERE person_id = ?', person.id).map((row) => row.organization_id);
    ctx.db.run('DELETE FROM affiliations WHERE person_id = ?', person.id);
    ctx.db.run("DELETE FROM facts WHERE subject_kind = 'person' AND subject_id = ?", person.id);
    ctx.db.run('DELETE FROM list_members WHERE member_id = ?', person.id);
    ctx.db.run('DELETE FROM opportunity_people WHERE person_id = ?', person.id);
    ctx.db.run('UPDATE import_rows SET person_id = NULL WHERE person_id = ?', person.id);
    ctx.db.run("DELETE FROM commitments WHERE person_id = ? AND state IN ('suggested','dismissed','withdrawn')", person.id);
    ctx.db.run("UPDATE identity_reviews SET state = 'rejected', updated_at = ? WHERE state = 'open' AND (left_id = ? OR right_id = ?)", time, person.id, person.id);
    ctx.db.run("DELETE FROM briefings WHERE subject_kind = 'person' AND subject_id = ?", person.id);
    const hasNotes = !!ctx.db.get("SELECT 1 AS ok FROM notes WHERE subject_kind = 'person' AND subject_id = ?", person.id);
    if (input.notes === 'keep' && hasNotes) {
      ctx.db.run("UPDATE persons SET origin = 'manual', name_override = COALESCE(name_override, display_name), archived_at = COALESCE(archived_at, ?), revision = revision + 1, updated_at = ? WHERE id = ?", time, time, person.id);
      refreshPerson(ctx, person.id);
    } else {
      ctx.db.run("DELETE FROM notes WHERE subject_kind = 'person' AND subject_id = ?", person.id);
      ctx.db.run("DELETE FROM commitments WHERE person_id = ?", person.id);
      // The link rows go with the record. The Ri tasks themselves stay in Ri.
      ctx.db.run("DELETE FROM task_links WHERE subject_kind = 'person' AND subject_id = ?", person.id);
      ctx.db.run('DELETE FROM person_sources WHERE person_id = ?', person.id);
      removeSearchForRecord(ctx, 'person', person.id);
      ctx.db.run('DELETE FROM persons WHERE id = ?', person.id);
    }
    for (const id of organizations) refreshOrganization(ctx, id);
    touch(ctx, person.collection, MANUAL);
    return { status: 'saved' as const, message: input.notes === 'keep' && hasNotes ? 'Removed imported details. Your notes stay on an archived record' : 'Removed. Ri tasks were not changed' };
  }
  const organization = getOrganizationRow(ctx, input.id);
  if (!organization || organization.merged_into) throw new AppError('not_found', 'This company is no longer available');
  if (organization.revision !== input.expectedRevision) return { status: 'conflict' as const, message: 'This company changed since you opened it. Review again' };
  if (input.suppress) for (const row of ctx.db.all<{ domain: string }>('SELECT DISTINCT domain FROM organization_domains WHERE organization_id = ?', organization.id)) saveExclusion(ctx, { value: row.domain, kind: 'domain', decision: 'suppressed' });
  if (input.mode === 'archive') {
    ctx.db.run('UPDATE organizations SET archived_at = COALESCE(archived_at, ?), revision = revision + 1, updated_at = ? WHERE id = ?', time, time, organization.id);
    touch(ctx, organization.collection);
    return { status: 'saved' as const, message: 'Archived. Its people and Ri tasks are unchanged' };
  }
  const people = ctx.db.all<{ person_id: string }>('SELECT DISTINCT person_id FROM affiliations WHERE organization_id = ?', organization.id).map((row) => row.person_id);
  ctx.db.run('DELETE FROM affiliations WHERE organization_id = ?', organization.id);
  ctx.db.run('DELETE FROM organization_domains WHERE organization_id = ?', organization.id);
  ctx.db.run("DELETE FROM interaction_links WHERE target_kind = 'organization' AND target_id = ?", organization.id);
  ctx.db.run("UPDATE attribution_rules SET state = 'disabled', updated_at = ? WHERE organization_id = ?", time, organization.id);
  ctx.db.run('UPDATE opportunities SET organization_id = NULL, updated_at = ? WHERE organization_id = ?', time, organization.id);
  ctx.db.run('UPDATE commitments SET organization_id = NULL WHERE organization_id = ?', organization.id);
  ctx.db.run('DELETE FROM list_members WHERE member_id = ?', organization.id);
  ctx.db.run('UPDATE import_rows SET organization_id = NULL WHERE organization_id = ?', organization.id);
  ctx.db.run("UPDATE identity_keys SET owner_kind = 'none', owner_id = NULL, updated_at = ? WHERE owner_kind = 'organization' AND owner_id = ?", time, organization.id);
  ctx.db.run("DELETE FROM facts WHERE subject_kind = 'organization' AND subject_id = ?", organization.id);
  ctx.db.run("UPDATE identity_reviews SET state = 'rejected', updated_at = ? WHERE state = 'open' AND (left_id = ? OR right_id = ?)", time, organization.id, organization.id);
  const hasNotes = !!ctx.db.get("SELECT 1 AS ok FROM notes WHERE subject_kind = 'organization' AND subject_id = ?", organization.id);
  if (input.notes === 'keep' && hasNotes) {
    ctx.db.run("UPDATE organizations SET origin = 'manual', name_override = COALESCE(name_override, display_name), state = 'confirmed', archived_at = COALESCE(archived_at, ?), revision = revision + 1, updated_at = ? WHERE id = ?", time, time, organization.id);
    refreshOrganization(ctx, organization.id);
  } else {
    ctx.db.run("DELETE FROM notes WHERE subject_kind = 'organization' AND subject_id = ?", organization.id);
    ctx.db.run('DELETE FROM organization_sources WHERE organization_id = ?', organization.id);
    removeSearchForRecord(ctx, 'organization', organization.id);
    ctx.db.run('DELETE FROM organizations WHERE id = ?', organization.id);
  }
  for (const id of people) refreshPerson(ctx, id);
  touch(ctx, organization.collection, MANUAL);
  return { status: 'saved' as const, message: 'Removed. Its people and Ri tasks are unchanged' };
}

export type BulkChange = { pinned?: boolean; archived?: boolean; addToListId?: string; removeFromListId?: string };
/**
 * Apply one small change to at most 50 selected records, each with its own
 * expected revision. Failures are reported per record and never block the rest.
 */
export function bulkUpdate(ctx: Ctx, scope: AccessScope, actor: string, input: { recordKind: 'person' | 'organization'; items: { id: string; expectedRevision: number }[]; change: BulkChange }) {
  const keys = Object.keys(input.change).filter((key) => input.change[key as keyof BulkChange] !== undefined);
  if (keys.length !== 1) throw new AppError('invalid_input', 'Choose one change for the selected records');
  const results: { id: string; status: 'saved' | 'conflict' | 'not_found' | 'forbidden'; message: string | null }[] = [];
  for (const item of input.items) {
    try {
      const visible = input.recordKind === 'person' ? personVisible(ctx, scope, item.id) : organizationVisible(ctx, scope, item.id);
      if (!visible) { results.push({ id: item.id, status: 'not_found', message: 'No longer available' }); continue; }
      const row = input.recordKind === 'person' ? getPersonRow(ctx, item.id) : getOrganizationRow(ctx, item.id);
      if (!row || row.revision !== item.expectedRevision) { results.push({ id: item.id, status: 'conflict', message: 'Changed since you selected it' }); continue; }
      if (input.change.addToListId || input.change.removeFromListId) {
        const listId = (input.change.addToListId ?? input.change.removeFromListId)!;
        const list = ctx.db.get<{ revision: number; record_kind: string }>('SELECT revision, record_kind FROM lists WHERE id = ?', listId);
        if (!list || list.record_kind !== input.recordKind) throw new AppError('invalid_input', 'Choose a list of the same kind');
        updateListMembers(ctx, scope, actor, { listId, expectedRevision: list.revision, ...(input.change.addToListId ? { add: [item.id] } : { remove: [item.id] }) });
      } else if (input.recordKind === 'person') {
        const result = savePerson(ctx, scope, { id: item.id, expectedRevision: item.expectedRevision, ...(input.change.pinned !== undefined ? { pinned: input.change.pinned } : {}), ...(input.change.archived !== undefined ? { archived: input.change.archived } : {}) });
        if (result.status === 'conflict') { results.push({ id: item.id, status: 'conflict', message: result.message }); continue; }
      } else {
        if (input.change.pinned !== undefined) throw new AppError('invalid_input', 'Companies cannot be pinned. Add them to a list instead');
        const result = saveOrganization(ctx, scope, { id: item.id, expectedRevision: item.expectedRevision, archived: input.change.archived }, refreshPerson);
        if (result.status === 'conflict') { results.push({ id: item.id, status: 'conflict', message: result.message ?? 'Changed' }); continue; }
      }
      results.push({ id: item.id, status: 'saved', message: null });
    } catch (error) {
      const code = (error as AppError)?.code;
      results.push({ id: item.id, status: code === 'forbidden' ? 'forbidden' : code === 'not_found' ? 'not_found' : 'conflict', message: (error as Error).message?.slice(0, 200) ?? null });
    }
  }
  return { results, saved: results.filter((result) => result.status === 'saved').length };
}

/** The source inspector: account, participants, date, exact passage with nearby text and the original link. */
export function getEvidence(ctx: Ctx, scope: AccessScope, input: { id: string; passage?: string }, full: boolean): Evidence {
  const row = ctx.db.get<{ id: string; kind: Evidence['kind']; source_key: string; title: string | null; source_date: string | null; participants: string; excerpt: string | null; link: string | null; status: Evidence['status']; blob_digest: string | null }>('SELECT * FROM evidence WHERE id = ?', input.id);
  if (!row || !canSee(scope, row.source_key)) throw new AppError('not_found', 'This source is not available');
  const sourceLabel = (() => {
    const account = row.source_key.startsWith('account:') ? ctx.accounts.list().find((item) => `account:${item.account}` === row.source_key && item.kind === 'mail') ?? ctx.accounts.list().find((item) => `account:${item.account}` === row.source_key) : null;
    if (account) return account.label ?? 'Connected account';
    return ctx.db.get<{ label: string }>('SELECT label FROM imports WHERE source_key = ?', row.source_key)?.label ?? 'Your records';
  })();
  let passage: string | null = null;
  let context: string | null = row.excerpt;
  if (row.status === 'available' && row.blob_digest) {
    const text = ctx.blobs.readText(row.blob_digest) ?? '';
    const squashed = text.replace(/\s+/g, ' ').trim();
    if (input.passage) {
      const needle = input.passage.replace(/\s+/g, ' ').trim();
      const at = squashed.indexOf(needle);
      if (at >= 0) { passage = needle; context = squashed.slice(Math.max(0, at - 300), at + needle.length + 300); }
    }
    if (full && !input.passage) context = boundText(squashed, 4000).text;
  }
  return {
    id: row.id, kind: row.kind, title: row.title ?? 'Source', sourceLabel, sourceDate: row.source_date,
    participants: (JSON.parse(row.participants) as string[]).slice(0, 30), passage, excerpt: context ? boundText(context, 4000).text : null,
    link: row.status === 'available' ? row.link : null, status: row.status,
    statusLabel: row.status === 'available' ? 'Exact passage retained from the source' : row.status === 'unavailable' ? 'The original was deleted or moved to Trash. Nothing was inferred in its place' : 'Deleted with its source',
  };
}
export { personName };
