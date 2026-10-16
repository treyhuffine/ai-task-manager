import { AppError } from '@ri/app-kit/contract';
import { sha256, type AccessScope } from '@ri/app-kit/data';
import { iso, newId, type Ctx } from './context.js';
import { Labels } from './coverage.js';
import { getKey } from './identity.js';
import { refreshOrganization } from './organizations.js';
import { organizationRef, personRef } from './projection.js';
import { canSee, isAccountSource, touch, writableCollection } from './scope.js';
import { json } from './text.js';
import { projectInteraction } from './interactions.js';
import type { TimelineItem } from '../schemas.js';

export const LINK_BATCH = 500;
const PREVIEW_MS = 30 * 60_000;

type RuleRow = { id: string; revision: number; account_source: string; key_id: string; person_id: string | null; organization_id: string; effective_from: string | null; effective_to: string | null; state: 'active' | 'disabled'; collection: string; pending: number };
interface Draft { personId: string; keyId: string; organizationId: string; account: string; from: string | null; to: string | null; collection: string; ruleId: string | null; ruleRevision: number | null }

function matchSql(draft: Pick<Draft, 'keyId' | 'account' | 'from' | 'to'>) {
  const parts = ["ip.key_id = ?", 'ip.source_key = ?', "ip.kind = 'email'", 'ip.direct = 1', 'ip.active = 1'];
  const params: string[] = [draft.keyId, draft.account];
  if (draft.from) { parts.push('ip.occurred_at >= ?'); params.push(`${draft.from}T00:00:00.000Z`); }
  if (draft.to) { parts.push('ip.occurred_at < ?'); params.push(new Date(Date.parse(`${draft.to}T00:00:00Z`) + 864e5).toISOString()); }
  return { sql: parts.join(' AND '), params };
}

/**
 * A bounded preview of "Include work conversations with this address": the
 * account, work identity, company and date range, with representative
 * matches. It returns an expiring digest that apply must present unchanged.
 */
export function previewAttribution(ctx: Ctx, scope: AccessScope, input: { personId: string; keyId: string; organizationId: string; account: string; from?: string | null; to?: string | null; ruleId?: string; collection?: string }) {
  const person = personRef(ctx, scope, input.personId);
  if (!person) throw new AppError('not_found', 'This person is no longer available');
  const organization = organizationRef(ctx, scope, input.organizationId);
  if (!organization) throw new AppError('not_found', 'This company is no longer available');
  if (!isAccountSource(input.account) || !canSee(scope, input.account)) throw new AppError('forbidden', 'Choose a connected account you can see');
  const key = getKey(ctx, input.keyId);
  if (!key || key.ownerKind !== 'person' || key.ownerId !== input.personId || key.kind !== 'email') throw new AppError('invalid_input', 'Choose one of this person’s addresses');
  if (key.shared) throw new AppError('invalid_input', 'A shared inbox cannot stand for one person’s work');
  if (!ctx.db.get('SELECT 1 AS ok FROM identity_observations WHERE key_id = ? AND source_key = ?', key.id, input.account)) throw new AppError('invalid_input', 'This address has not been seen in that account');
  if (input.from && input.to && input.to < input.from) throw new AppError('invalid_input', 'The end date is before the start date');
  let rule: RuleRow | undefined;
  if (input.ruleId) {
    rule = ctx.db.get<RuleRow>('SELECT * FROM attribution_rules WHERE id = ?', input.ruleId);
    if (!rule || !canSee(scope, rule.collection)) throw new AppError('not_found', 'This rule is no longer available');
    if (rule.key_id !== key.id || rule.account_source !== input.account || rule.organization_id !== input.organizationId) throw new AppError('invalid_input', 'A rule keeps its account, address and company. Create a new rule instead');
  }
  const collection = rule?.collection ?? writableCollection(ctx, scope, input.collection);
  const draft: Draft = { personId: input.personId, keyId: key.id, organizationId: input.organizationId, account: input.account, from: input.from ?? null, to: input.to ?? null, collection, ruleId: rule?.id ?? null, ruleRevision: rule?.revision ?? null };
  const match = matchSql(draft);
  const total = Number(ctx.db.get<{ count: number }>(`SELECT COUNT(*) AS count FROM interaction_participants ip WHERE ${match.sql}`, ...match.params)?.count ?? 0);
  const labels = new Labels(ctx), now = iso(ctx);
  const sample: TimelineItem[] = ctx.db.all<Record<string, unknown>>(`SELECT i.* FROM interaction_participants ip JOIN interactions i ON i.id = ip.interaction_id WHERE ${match.sql} ORDER BY ip.occurred_at DESC LIMIT 8`, ...match.params)
    .map((row) => projectInteraction(ctx, scope, row as never, labels, now));
  const time = iso(ctx), id = newId();
  const payload = JSON.stringify(draft);
  const digest = sha256(`${id}:${payload}`);
  const expiresAt = new Date(ctx.now().getTime() + PREVIEW_MS).toISOString();
  ctx.db.run("INSERT INTO previews (id, created_at, updated_at, kind, expires_at, digest, payload, applied_at, result) VALUES (?, ?, ?, 'attribution', ?, ?, ?, NULL, NULL)", id, time, time, expiresAt, digest, payload);
  return {
    previewId: id, digest, expiresAt,
    draft: { person, organization, identity: key.normalized, account: labels.of(input.account), from: draft.from, to: draft.to, collection, ruleId: draft.ruleId },
    matches: { total, sample },
    note: 'Applies to direct work exchanges with this address in this account and range, now and on later syncs. Notes, other addresses, other accounts and history outside the range are unchanged.',
  };
}

/** Link up to one batch of matching exchanges for an active rule. Returns whether more remain. */
export function linkRuleBatch(ctx: Ctx, ruleId: string): { linked: number; more: boolean } {
  const rule = ctx.db.get<RuleRow>('SELECT * FROM attribution_rules WHERE id = ?', ruleId);
  if (!rule || rule.state !== 'active') return { linked: 0, more: false };
  const match = matchSql({ keyId: rule.key_id, account: rule.account_source, from: rule.effective_from, to: rule.effective_to });
  const rows = ctx.db.all<{ id: string; occurred_at: string; thread_key: string | null }>(
    `SELECT i.id, i.occurred_at, i.thread_key FROM interaction_participants ip JOIN interactions i ON i.id = ip.interaction_id
     WHERE ${match.sql} AND NOT EXISTS (SELECT 1 FROM interaction_links l WHERE l.interaction_id = i.id AND l.rule_id = ? AND l.target_id = ?) LIMIT ?`,
    ...match.params, rule.id, rule.organization_id, LINK_BATCH + 1);
  const time = iso(ctx);
  for (const row of rows.slice(0, LINK_BATCH))
    ctx.db.run(
      `INSERT INTO interaction_links (id, created_at, updated_at, revision, interaction_id, target_kind, target_id, state, origin, rule_id, collection, source_key, occurred_at, thread_key)
       VALUES (?, ?, ?, 1, ?, 'organization', ?, 'linked', 'rule', ?, ?, ?, ?, ?) ON CONFLICT(interaction_id, target_kind, target_id, origin, rule_id) DO NOTHING`,
      newId(), time, time, row.id, rule.organization_id, rule.id, rule.collection, rule.account_source, row.occurred_at, row.thread_key);
  const more = rows.length > LINK_BATCH;
  ctx.db.run('UPDATE attribution_rules SET pending = ?, updated_at = ? WHERE id = ?', more ? 1 : 0, time, rule.id);
  if (more) enqueueAttribution(ctx, rule);
  refreshOrganization(ctx, rule.organization_id);
  touch(ctx, rule.collection, rule.account_source);
  return { linked: Math.min(rows.length, LINK_BATCH), more };
}
function enqueueAttribution(ctx: Ctx, rule: RuleRow) {
  const time = iso(ctx);
  ctx.db.run(
    `INSERT INTO work_items (id, created_at, updated_at, kind, source_key, dedupe_key, state, attempts, priority, payload, last_error) VALUES (?, ?, ?, 'attribute', ?, ?, 'pending', 0, ?, ?, NULL)
     ON CONFLICT(dedupe_key) DO UPDATE SET state = 'pending', updated_at = excluded.updated_at`,
    newId(), time, time, rule.account_source, `attribute:${rule.id}`, time, JSON.stringify({ ruleId: rule.id }));
}

/** Apply the previewed rule exactly. It cannot widen the account or range shown in the preview. */
export function applyAttribution(ctx: Ctx, scope: AccessScope, actor: string, input: { previewId: string; digest: string }) {
  const preview = ctx.db.get<{ id: string; kind: string; expires_at: string; digest: string; payload: string; applied_at: string | null; result: string | null }>('SELECT * FROM previews WHERE id = ?', input.previewId);
  if (!preview || preview.kind !== 'attribution') throw new AppError('not_found', 'This preview expired. Preview the rule again');
  if (preview.digest !== input.digest) throw new AppError('conflict', 'The preview changed. Preview the rule again');
  if (preview.applied_at && preview.result) return JSON.parse(preview.result) as { status: 'saved'; ruleId: string; linked: number; more: boolean };
  if (preview.expires_at < iso(ctx)) throw new AppError('conflict', 'This preview expired. Preview the rule again');
  const draft = json<Draft>(preview.payload, null as never);
  if (!canSee(scope, draft.account) || !canSee(scope, draft.collection)) throw new AppError('forbidden', 'This rule uses an account you can no longer see');
  const time = iso(ctx);
  let ruleId = draft.ruleId;
  if (ruleId) {
    const rule = ctx.db.get<RuleRow>('SELECT * FROM attribution_rules WHERE id = ?', ruleId);
    if (!rule) throw new AppError('not_found', 'This rule is no longer available');
    if (rule.revision !== draft.ruleRevision) throw new AppError('conflict', 'This rule changed after the preview. Preview it again');
    ctx.db.run("UPDATE attribution_rules SET effective_from = ?, effective_to = ?, state = 'active', revision = revision + 1, updated_at = ? WHERE id = ?", draft.from, draft.to, time, rule.id);
    // Narrowing the range retracts only this rule's links outside it.
    const outside: string[] = [], params: string[] = [rule.id];
    if (draft.from) { outside.push('occurred_at < ?'); params.push(`${draft.from}T00:00:00.000Z`); }
    if (draft.to) { outside.push('occurred_at >= ?'); params.push(new Date(Date.parse(`${draft.to}T00:00:00Z`) + 864e5).toISOString()); }
    if (outside.length) ctx.db.run(`DELETE FROM interaction_links WHERE rule_id = ? AND (${outside.join(' OR ')})`, ...params);
  } else {
    ruleId = newId();
    ctx.db.run(
      `INSERT INTO attribution_rules (id, created_at, updated_at, revision, account_source, key_id, person_id, organization_id, effective_from, effective_to, state, collection, decided_by, pending)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'active', ?, ?, 1)`,
      ruleId, time, time, draft.account, draft.keyId, draft.personId, draft.organizationId, draft.from, draft.to, draft.collection, actor);
  }
  const batch = linkRuleBatch(ctx, ruleId);
  const result = { status: 'saved' as const, ruleId, linked: batch.linked, more: batch.more };
  ctx.db.run('UPDATE previews SET applied_at = ?, result = ?, updated_at = ? WHERE id = ?', time, JSON.stringify(result), time, preview.id);
  return result;
}

/** Disabling a rule removes its derived links and keeps every manual link. */
export function disableAttribution(ctx: Ctx, scope: AccessScope, input: { ruleId: string; expectedRevision: number }) {
  const rule = ctx.db.get<RuleRow>('SELECT * FROM attribution_rules WHERE id = ?', input.ruleId);
  if (!rule || !canSee(scope, rule.collection)) throw new AppError('not_found', 'This rule is no longer available');
  if (rule.revision !== input.expectedRevision) return { status: 'conflict' as const, ruleId: rule.id, linked: 0, more: false, message: 'This rule changed. Reload and try again' };
  const time = iso(ctx);
  ctx.db.run("UPDATE attribution_rules SET state = 'disabled', pending = 0, revision = revision + 1, updated_at = ? WHERE id = ?", time, rule.id);
  ctx.db.run("DELETE FROM interaction_links WHERE rule_id = ? AND origin = 'rule'", rule.id);
  ctx.db.run("UPDATE work_items SET state = 'cancelled', updated_at = ? WHERE dedupe_key = ?", time, `attribute:${rule.id}`);
  refreshOrganization(ctx, rule.organization_id);
  touch(ctx, rule.collection, rule.account_source);
  return { status: 'saved' as const, ruleId: rule.id, linked: 0, more: false };
}

/** New mail on a later sync joins the company automatically when an active rule covers it. */
export function applyRulesToInteraction(ctx: Ctx, interactionId: string): string[] {
  const organizations: string[] = [];
  const time = iso(ctx);
  for (const row of ctx.db.all<RuleRow & { occurred_at: string; thread_key: string | null }>(
    `SELECT r.*, ip.occurred_at, i.thread_key FROM interaction_participants ip JOIN interactions i ON i.id = ip.interaction_id
     JOIN attribution_rules r ON r.key_id = ip.key_id AND r.account_source = ip.source_key AND r.state = 'active'
     WHERE ip.interaction_id = ? AND ip.kind = 'email' AND ip.direct = 1 AND ip.active = 1`, interactionId)) {
    const day = row.occurred_at.slice(0, 10);
    if ((row.effective_from && day < row.effective_from) || (row.effective_to && day > row.effective_to)) continue;
    ctx.db.run(
      `INSERT INTO interaction_links (id, created_at, updated_at, revision, interaction_id, target_kind, target_id, state, origin, rule_id, collection, source_key, occurred_at, thread_key)
       VALUES (?, ?, ?, 1, ?, 'organization', ?, 'linked', 'rule', ?, ?, ?, ?, ?) ON CONFLICT(interaction_id, target_kind, target_id, origin, rule_id) DO NOTHING`,
      newId(), time, time, interactionId, row.organization_id, row.id, row.collection, row.account_source, row.occurred_at, row.thread_key);
    organizations.push(row.organization_id);
  }
  return organizations;
}

export function rulesFor(ctx: Ctx, scope: AccessScope, column: 'person_id' | 'organization_id', id: string, labels: Labels) {
  return ctx.db.all<RuleRow>(`SELECT * FROM attribution_rules WHERE ${column} = ? ORDER BY created_at DESC LIMIT 20`, id)
    .filter((rule) => canSee(scope, rule.collection) && canSee(scope, rule.account_source))
    .map((rule) => ({
      id: rule.id, revision: rule.revision,
      person: personRef(ctx, scope, rule.person_id), organization: organizationRef(ctx, scope, rule.organization_id),
      identity: getKey(ctx, rule.key_id)?.normalized ?? 'Unknown address', account: labels.of(rule.account_source),
      from: rule.effective_from, to: rule.effective_to, state: rule.state,
    }));
}
