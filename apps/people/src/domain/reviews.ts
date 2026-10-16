import { AppError } from '@ri/app-kit/contract';
import { decodeCursor, encodeCursor, type AccessScope } from '@ri/app-kit/data';
import { z } from 'zod/v4';
import { iso, newId, type Ctx } from './context.js';
import { getKey, attachKey, observe } from './identity.js';
import { createPersonForKey, getPersonRow, refreshPerson } from './people.js';
import { getOrganizationRow } from './organizations.js';
import { organizationName, organizationVisible, personName, personVisible } from './projection.js';
import { canSee, sourceFilter, touch } from './scope.js';
import { organizationKey, sortKey, json } from './text.js';
import { saveExclusion } from './exclusions.js';

export type ReviewKind = 'person' | 'organization' | 'alias' | 'sender';
type ReviewRow = { id: string; created_at: string; updated_at: string; revision: number; kind: ReviewKind; left_id: string; right_id: string | null; key_id: string | null; pair_key: string; reason: string; evidence: string; source_key: string; state: string; decided_at: string | null };

/** Create a review once per pair. A pair you kept separate is never proposed again. */
export function propose(ctx: Ctx, input: { kind: ReviewKind; leftId: string; rightId?: string | null; keyId?: string | null; reason: string; sourceKey: string; evidence: { summary: string; shared?: string[]; evidenceIds?: string[]; passage?: string | null } }): string | null {
  const pair = input.kind === 'person' || input.kind === 'organization'
    ? `${input.kind}:${[input.leftId, input.rightId].sort().join(':')}`
    : input.kind === 'alias' ? `alias:${input.leftId}:${input.keyId}` : `sender:${input.keyId}`;
  const time = iso(ctx), id = newId();
  const result = ctx.db.run(
    `INSERT INTO identity_reviews (id, created_at, updated_at, revision, kind, left_id, right_id, key_id, pair_key, reason, evidence, source_key, state, decided_at, decided_by, merge_id)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, NULL) ON CONFLICT(pair_key) DO NOTHING`,
    id, time, time, input.kind, input.leftId, input.rightId ?? null, input.keyId ?? null, pair, input.reason, JSON.stringify(input.evidence), input.sourceKey,
  );
  return Number(result.changes) ? id : null;
}

/** Same name is a reason to ask, never to merge. */
export function proposeSameName(ctx: Ctx, personId: string, sourceKey: string) {
  const person = getPersonRow(ctx, personId);
  if (!person || person.merged_into || !person.name_source || person.display_name.includes('@') || person.display_name === 'Unnamed contact') return;
  for (const other of ctx.db.all<{ id: string; display_name: string }>("SELECT id, display_name FROM persons WHERE sort_name = ? AND id != ? AND merged_into IS NULL LIMIT 5", sortKey(person.display_name), personId))
    propose(ctx, { kind: 'person', leftId: other.id, rightId: personId, reason: 'same_name', sourceKey, evidence: { summary: `Both records are named ${person.display_name}. A shared name alone does not show they are the same person.` } });
}
export function proposeOrganizationMatches(ctx: Ctx, organizationId: string, sourceKey: string) {
  const organization = getOrganizationRow(ctx, organizationId);
  if (!organization || organization.merged_into) return;
  const key = organizationKey(organization.display_name);
  if (key) for (const other of ctx.db.all<{ id: string; display_name: string }>('SELECT id, display_name FROM organizations WHERE merged_into IS NULL AND id != ? LIMIT 5000', organizationId))
    if (organizationKey(other.display_name) === key)
      propose(ctx, { kind: 'organization', leftId: other.id, rightId: organizationId, reason: 'same_name', sourceKey, evidence: { summary: `Both are named ${organization.display_name}. Two organizations may share a name.` } });
  for (const domain of ctx.db.all<{ domain: string }>('SELECT DISTINCT domain FROM organization_domains WHERE organization_id = ?', organizationId))
    for (const other of ctx.db.all<{ organization_id: string }>('SELECT DISTINCT organization_id FROM organization_domains WHERE domain = ? AND organization_id != ? LIMIT 5', domain.domain, organizationId))
      propose(ctx, { kind: 'organization', leftId: other.organization_id, rightId: organizationId, reason: 'same_domain', sourceKey, evidence: { summary: `Both use ${domain.domain}. A shared domain can mean subsidiaries, brands or teams, not one organization.`, shared: [domain.domain] } });
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export interface ReviewItem {
  id: string; revision: number; kind: ReviewKind; reason: string; summary: string; passage: string | null; evidenceIds: string[];
  left: { id: string; name: string; detail: string | null } ; right: { id: string; name: string; detail: string | null } | null;
  identifier: string | null; createdAt: string;
}
function describeRecord(ctx: Ctx, scope: AccessScope, kind: 'person' | 'organization', id: string) {
  if (kind === 'person') {
    const person = getPersonRow(ctx, id);
    if (!person || person.merged_into || !personVisible(ctx, scope, id)) return null;
    const filter = sourceFilter(scope, 'o.source_key');
    const emails = ctx.db.all<{ normalized: string }>(`SELECT DISTINCT k.normalized FROM identity_keys k JOIN identity_observations o ON o.key_id = k.id WHERE k.owner_kind = 'person' AND k.owner_id = ? AND k.kind = 'email' AND ${filter.sql} LIMIT 3`, id, ...filter.params).map((row) => row.normalized);
    return { id, name: personName(ctx, scope, person), detail: emails.join(', ') || null };
  }
  const organization = getOrganizationRow(ctx, id);
  if (!organization || organization.merged_into || !organizationVisible(ctx, scope, id)) return null;
  const filter = sourceFilter(scope, 'source_key');
  const domains = ctx.db.all<{ domain: string }>(`SELECT DISTINCT domain FROM organization_domains WHERE organization_id = ? AND ${filter.sql} LIMIT 3`, id, ...filter.params).map((row) => row.domain);
  return { id, name: organizationName(ctx, scope, organization), detail: domains.join(', ') || null };
}
export function projectReview(ctx: Ctx, scope: AccessScope, row: ReviewRow): ReviewItem | null {
  if (!canSee(scope, row.source_key)) return null;
  const evidence = json<{ summary: string; shared?: string[]; evidenceIds?: string[]; passage?: string | null }>(row.evidence, { summary: '' });
  const recordKind = row.kind === 'organization' ? 'organization' : 'person';
  const left = row.kind === 'sender' ? { id: row.left_id, name: getKey(ctx, row.key_id!)?.normalized ?? 'Unknown sender', detail: 'Incoming only' } : describeRecord(ctx, scope, recordKind, row.left_id);
  const right = row.right_id ? describeRecord(ctx, scope, recordKind, row.right_id) : null;
  if (!left || (row.right_id && !right)) return null;
  return {
    id: row.id, revision: row.revision, kind: row.kind, reason: row.reason, summary: evidence.summary, passage: evidence.passage ?? null, evidenceIds: evidence.evidenceIds ?? [],
    left, right, identifier: row.key_id ? getKey(ctx, row.key_id)?.normalized ?? null : evidence.shared?.[0] ?? null, createdAt: row.created_at,
  };
}

const cursorSchema = z.object({ k: z.string(), id: z.string() }).strict();
export function listReviews(ctx: Ctx, scope: AccessScope, input: { kind?: ReviewKind; recordId?: string; cursor?: string; limit: number }) {
  const cursor = decodeCursor(cursorSchema, input.cursor);
  const out: ReviewItem[] = [];
  let nextCursor: string | null = null;
  let after = cursor;
  // Filter by scope while paging so hidden reviews never shorten or pad a page.
  for (let round = 0; round < 10 && out.length < input.limit; round++) {
    const rows = ctx.db.all<ReviewRow>(
      `SELECT * FROM identity_reviews WHERE state = 'open' ${input.kind ? 'AND kind = ?' : ''} ${input.recordId ? 'AND (left_id = ? OR right_id = ?)' : ''} ${after ? 'AND (created_at, id) < (?, ?)' : ''} ORDER BY created_at DESC, id DESC LIMIT ?`,
      ...(input.kind ? [input.kind] : []), ...(input.recordId ? [input.recordId, input.recordId] : []), ...(after ? [after.k, after.id] : []), 200);
    if (!rows.length) { nextCursor = null; break; }
    for (const row of rows) {
      after = { k: row.created_at, id: row.id };
      const item = projectReview(ctx, scope, row);
      if (item) out.push(item);
      if (out.length >= input.limit) break;
    }
    nextCursor = out.length >= input.limit ? encodeCursor(after) : rows.length === 200 ? encodeCursor(after) : null;
    if (rows.length < 200) break;
  }
  return { items: out.slice(0, input.limit), nextCursor };
}

export function getReviewRow(ctx: Ctx, id: string) {
  return ctx.db.get<ReviewRow>('SELECT * FROM identity_reviews WHERE id = ?', id);
}
export function closeReview(ctx: Ctx, id: string, state: 'merged' | 'kept_separate' | 'accepted' | 'rejected', actor: string, mergeId: string | null = null) {
  const time = iso(ctx);
  ctx.db.run('UPDATE identity_reviews SET state = ?, decided_at = ?, decided_by = ?, merge_id = ?, revision = revision + 1, updated_at = ? WHERE id = ?', state, time, actor, mergeId, time, id);
}

/** Alias and sender decisions. Person and company merges go through merge actions. */
export function decideIdentity(ctx: Ctx, actor: string, row: ReviewRow, decision: 'accept' | 'reject' | 'keep_separate' | 'include' | 'exclude'): { personId: string | null } {
  if (row.state !== 'open') throw new AppError('conflict', 'This review was already decided');
  const time = iso(ctx);
  if (row.kind === 'alias') {
    if (decision === 'accept') {
      const key = getKey(ctx, row.key_id!);
      if (!key) throw new AppError('not_found', 'That address is no longer available');
      if (key.ownerKind === 'person' && key.ownerId && key.ownerId !== row.left_id) throw new AppError('conflict', 'That address now belongs to another person. Review a merge instead');
      observe(ctx, { keyId: key.id, sourceKey: row.source_key, value: key.normalized, at: time, confirmation: 'confirmed' });
      attachKey(ctx, key.id, 'person', row.left_id, 'user');
      refreshPerson(ctx, row.left_id);
      closeReview(ctx, row.id, 'accepted', actor);
    } else closeReview(ctx, row.id, 'rejected', actor);
    touch(ctx, row.source_key);
    return { personId: row.left_id };
  }
  if (row.kind === 'sender') {
    const key = getKey(ctx, row.key_id!);
    if (!key) throw new AppError('not_found', 'That sender is no longer available');
    if (decision === 'include') {
      saveExclusion(ctx, { value: key.normalized, kind: 'sender', decision: 'included' });
      const personId = key.ownerKind === 'person' && key.ownerId ? key.ownerId : createPersonForKey(ctx, key.id, 'incoming');
      refreshPerson(ctx, personId);
      closeReview(ctx, row.id, 'accepted', actor);
      touch(ctx, row.source_key);
      return { personId };
    }
    saveExclusion(ctx, { value: key.normalized, kind: 'sender', decision: 'excluded' });
    closeReview(ctx, row.id, 'rejected', actor);
    touch(ctx, row.source_key);
    return { personId: null };
  }
  if (decision !== 'keep_separate') throw new AppError('invalid_input', 'Use merge to combine these records');
  closeReview(ctx, row.id, 'kept_separate', actor);
  touch(ctx, row.source_key);
  return { personId: null };
}
