import { AppError } from '@ri/app-kit/contract';
import { accountSource } from '@ri/app-kit/data';
import type { AppInvocation } from '@ri/app-kit/sdk';
import { calendarCoverage, changeMailWindow, mailCoverage, type CalendarCheckpoint, type MailCheckpoint } from '@ri/app-kit/sources';
import { iso, newId, type Ctx } from './context.js';
import { Labels, extractionSetting, type ExtractionSetting } from './coverage.js';
import { cancelQueuedExtraction, enqueueBacklog } from './extraction.js';
import { exclusionCounts } from './exclusions.js';
import { refreshOrganization } from './organizations.js';
import { refreshPerson } from './people.js';
import { MANUAL, isAccountSource, isCollectionSource, isImportSource, touch } from './scope.js';
import { removeSearchForSource } from './search.js';
import { CALENDAR_FUTURE_DAYS, DEFAULT_HISTORY_DAYS, ensureAccountSetup } from './sync.js';
import { cleanName } from './text.js';
import type { SourceShare } from '../schemas.js';

type Access = NonNullable<AppInvocation['access']>;

/** Sources the owner can share with a chat: accounts, collections and imports, with labels. */
export function shareableSources(ctx: Ctx, access: Access | null): SourceShare[] {
  const labels = new Labels(ctx);
  const out: SourceShare[] = [];
  const seen = new Set<string>();
  for (const grant of access?.accounts ?? []) {
    const key = accountSource(grant.account);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: labels.of(key), kind: 'account', detail: 'Mail and calendar records imported from this account' });
  }
  for (const account of ctx.accounts.list()) {
    const key = accountSource(account.account);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: labels.of(key), kind: 'account', detail: 'Saved records from an account no longer granted to People' });
  }
  for (const row of ctx.db.all<{ source_key: string; label: string }>('SELECT source_key, label FROM collections WHERE archived_at IS NULL ORDER BY source_key = ? DESC, label', MANUAL))
    out.push({ key: row.source_key, label: row.label, kind: 'collection', detail: 'People, notes, lists and opportunities you added' });
  for (const row of ctx.db.all<{ source_key: string; label: string; counts: string }>('SELECT source_key, label, counts FROM imports ORDER BY created_at DESC LIMIT 100'))
    out.push({ key: row.source_key, label: row.label, kind: 'import', detail: 'Contacts from an imported file' });
  return out.slice(0, 200);
}

export function ensureDefaultCollection(ctx: Ctx) {
  const time = iso(ctx);
  ctx.db.run('INSERT INTO collections (id, created_at, updated_at, revision, source_key, label, archived_at) VALUES (?, ?, ?, 1, ?, ?, NULL) ON CONFLICT(source_key) DO NOTHING', newId(), time, time, MANUAL, 'Your records');
}

export function saveCollection(ctx: Ctx, input: { key?: string; label: string; archived?: boolean }) {
  const label = cleanName(input.label, 80);
  if (!label) throw new AppError('invalid_input', 'Name the collection');
  const time = iso(ctx);
  if (!input.key) {
    const id = newId();
    const key = `collection:${id}`;
    ctx.db.run('INSERT INTO collections (id, created_at, updated_at, revision, source_key, label, archived_at) VALUES (?, ?, ?, 1, ?, ?, NULL)', id, time, time, key, label);
    touch(ctx, key);
    return key;
  }
  if (!isCollectionSource(input.key)) throw new AppError('invalid_input', 'That is not a collection');
  if (input.key === MANUAL && input.archived) throw new AppError('invalid_input', 'Your main collection cannot be archived');
  const changed = ctx.db.run('UPDATE collections SET label = ?, archived_at = ?, revision = revision + 1, updated_at = ? WHERE source_key = ?', label, input.archived ? time : null, time, input.key);
  if (!Number(changed.changes)) throw new AppError('not_found', 'That collection is no longer available');
  touch(ctx, input.key);
  return input.key;
}

export function listSources(ctx: Ctx, access: Access | null) {
  const labels = new Labels(ctx);
  const granted = new Map((access?.accounts ?? []).map((grant) => [`${grant.account}:${grant.binding}`, grant]));
  const accounts: unknown[] = [];
  // Granted accounts not yet set up are listed with the default range, without writing anything.
  const known = ctx.accounts.list();
  const all = [...known];
  for (const grant of access?.accounts ?? []) {
    const kind = grant.binding === 'calendar' ? 'calendar' : grant.binding === 'mail' ? 'mail' : null;
    if (!kind || known.some((account) => account.account === grant.account && account.kind === kind)) continue;
    all.push({ account: grant.account, kind, createdAt: '', updatedAt: '', label: null, historyDays: DEFAULT_HISTORY_DAYS, checkpoint: null, calendars: kind === 'calendar' ? ['primary'] : [], paused: false, status: 'not_started', lastError: null, lastSuccessAt: null });
  }
  // Mail before calendar for each account, so one account's cards sit together.
  all.sort((a, b) => a.account.localeCompare(b.account) || (a.kind === 'mail' ? 0 : 1) - (b.kind === 'mail' ? 0 : 1));
  for (const account of all) {
    const source = accountSource(account.account);
    const grant = granted.get(`${account.account}:${account.kind}`);
    const job = ctx.jobs.find(account.kind, source);
    const coverage = account.kind === 'mail' ? mailCoverage(account.checkpoint as MailCheckpoint | null) : (() => {
      const map = (account.checkpoint ?? {}) as Record<string, CalendarCheckpoint>;
      const parts = Object.values(map).map((checkpoint) => calendarCoverage(checkpoint));
      return { from: parts.map((part) => part.from).filter(Boolean).sort()[0] ?? null, to: parts.map((part) => part.to).filter(Boolean).sort().at(-1) ?? null, partial: !parts.length || parts.some((part) => part.partial) };
    })();
    const pending = Number(ctx.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM work_items WHERE source_key = ? AND state = 'pending'", source)?.count ?? 0);
    const failed = Number(ctx.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM work_items WHERE source_key = ? AND state = 'failed'", source)?.count ?? 0) + (job?.state === 'failed' ? 1 : 0);
    accounts.push({
      account: account.account, source, kind: account.kind, label: account.label ?? labels.of(source),
      granted: !!grant, automatic: !!grant?.automatic,
      status: !grant ? 'disconnected' : account.status, coverage: { from: coverage.from, to: coverage.to, partial: coverage.partial },
      historyDays: account.historyDays, calendars: account.calendars, paused: account.paused,
      lastSuccessAt: account.lastSuccessAt, pending: pending + (job?.state === 'pending' && account.status === 'importing' ? 1 : 0), failed,
      lastError: account.lastError ?? job?.lastError ?? null,
      records: Number(ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM interactions WHERE source_key = ?', source)?.count ?? 0),
    });
  }
  const imports = ctx.db.all<{ id: string; source_key: string; label: string; format: string; file_name: string; counts: string; created_at: string }>('SELECT * FROM imports ORDER BY created_at DESC LIMIT 50')
    .map((row) => ({ id: row.id, source: row.source_key, label: row.label, format: row.format, fileName: row.file_name, counts: JSON.parse(row.counts), importedAt: row.created_at }));
  const extraction = extractionSetting(ctx);
  const workCounts = (kind: string, state: string) => Number(ctx.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM work_items WHERE kind = ? AND state = ?', kind, state)?.count ?? 0);
  const failedItems = ctx.db.all<{ id: string; kind: string; last_error: string | null; updated_at: string; source_key: string }>("SELECT id, kind, last_error, updated_at, source_key FROM work_items WHERE state = 'failed' ORDER BY updated_at DESC LIMIT 10")
    .map((row) => ({ id: row.id, kind: row.kind, reason: row.last_error ?? 'Failed', at: row.updated_at, source: labels.of(row.source_key) }));
  const excluded = exclusionCounts(ctx);
  return {
    accounts, imports,
    extraction: { ...extraction, pending: workCounts('extract', 'pending'), failed: workCounts('extract', 'failed'), briefingsPending: workCounts('briefing', 'pending') },
    failedItems,
    exclusions: { bulk: excluded.auto, excluded: excluded.excluded, included: excluded.included, suppressed: excluded.suppressed },
    largeEvents: Number(ctx.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM interactions WHERE excluded_reason = 'large_event' AND included = 0")?.count ?? 0),
    incomingOnly: Number(ctx.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_reviews WHERE kind = 'sender' AND state = 'open'")?.count ?? 0),
    identityReviews: Number(ctx.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM identity_reviews WHERE kind != 'sender' AND state = 'open'")?.count ?? 0),
    collections: ctx.db.all<{ source_key: string; label: string }>('SELECT source_key, label FROM collections WHERE archived_at IS NULL ORDER BY source_key = ? DESC, label', MANUAL).map((row) => ({ key: row.source_key, label: row.label })),
    scopes: ctx.scopes.list().filter((scope) => !scope.revokedAt).length,
  };
}

/** History range and calendars for one account. A wider window resumes older backfill only. */
export function configureSource(ctx: Ctx, access: Access | null, input: { account: string; kind: 'mail' | 'calendar'; historyDays?: number; calendars?: string[] }) {
  if (!access?.accounts.some((grant) => grant.account === input.account)) throw new AppError('forbidden', 'Grant People access to this account in Ri first');
  const setup = ensureAccountSetup(ctx, input.account, input.kind);
  const days = input.historyDays ?? setup.historyDays;
  if (![30, 90, 365].includes(days)) throw new AppError('invalid_input', 'Choose 30, 90 or 365 days of history');
  ctx.accounts.setup({ account: input.account, kind: input.kind, historyDays: days, calendars: input.calendars ?? setup.calendars });
  if (input.kind === 'mail' && setup.checkpoint && days !== setup.historyDays)
    ctx.accounts.commit(input.account, 'mail', changeMailWindow(setup.checkpoint as MailCheckpoint, days, ctx.now()), days > setup.historyDays ? 'importing' : setup.status === 'not_started' ? 'not_started' : 'ready');
  if (input.kind === 'calendar' && setup.checkpoint && (days !== setup.historyDays || input.calendars)) {
    const map = { ...(setup.checkpoint as Record<string, CalendarCheckpoint>) };
    for (const id of Object.keys(map)) if (days !== setup.historyDays || !(input.calendars ?? setup.calendars).includes(id)) delete map[id];
    ctx.accounts.commit(input.account, 'calendar', map, 'importing');
  }
  const source = accountSource(input.account);
  const job = ctx.jobs.ensure(input.kind, source, { idempotent: true });
  if (job.state === 'pending') ctx.jobs.wake(job.id);
  touch(ctx, source);
  void CALENDAR_FUTURE_DAYS; void DEFAULT_HISTORY_DAYS;
  return ctx.accounts.get(input.account, input.kind)!;
}

export function pauseSource(ctx: Ctx, input: { account: string; paused: boolean }) {
  const source = accountSource(input.account);
  if (!ctx.accounts.list().some((account) => account.account === input.account)) throw new AppError('not_found', 'People has no records for that account');
  ctx.accounts.pause(input.account, input.paused);
  if (input.paused) ctx.jobs.pause(source); else ctx.jobs.resume(source);
  touch(ctx, source);
}

/** Extraction is a separate choice from sync. Pausing cancels queued work and stops new AI calls. */
export function setExtraction(ctx: Ctx, enabled: boolean): ExtractionSetting {
  const time = iso(ctx);
  const current = extractionSetting(ctx);
  const next: ExtractionSetting = enabled ? { enabled: true, status: 'on', reason: null, updatedAt: time } : { enabled: false, status: current.enabled || current.status !== 'off' ? 'paused' : 'off', reason: null, updatedAt: time };
  ctx.settings.set('extraction', next);
  if (!enabled) cancelQueuedExtraction(ctx);
  else enqueueBacklog(ctx);
  touch(ctx);
  return next;
}

/**
 * Delete what one source imported: its conversations, stored text, observed
 * identities, affiliations, facts, suggestions, search rows and briefing
 * caches. Notes you wrote stay. Commitments you accepted stay as yours.
 * Ri tasks are never touched. Records supported by nothing else are removed.
 */
export function deleteSourceData(ctx: Ctx, source: string) {
  if (!isAccountSource(source) && !isImportSource(source)) throw new AppError('invalid_input', 'Only imported data can be deleted this way');
  const time = iso(ctx);
  const persons = ctx.db.all<{ person_id: string }>('SELECT person_id FROM person_sources WHERE source_key = ?', source).map((row) => row.person_id);
  const organizations = ctx.db.all<{ organization_id: string }>('SELECT organization_id FROM organization_sources WHERE source_key = ?', source).map((row) => row.organization_id);
  const counts = { interactions: 0, identities: 0, affiliations: 0, facts: 0, commitments: 0 };
  for (const evidence of ctx.db.all<{ blob_digest: string | null }>('SELECT DISTINCT blob_digest FROM evidence WHERE source_key = ? AND blob_digest IS NOT NULL', source))
    if (!ctx.db.get('SELECT 1 AS ok FROM evidence WHERE blob_digest = ? AND source_key != ?', evidence.blob_digest, source)) ctx.blobs.remove(evidence.blob_digest!);
  ctx.db.run('DELETE FROM evidence WHERE source_key = ?', source);
  ctx.db.run('DELETE FROM interaction_links WHERE source_key = ?', source);
  ctx.db.run('DELETE FROM interaction_participants WHERE source_key = ?', source);
  counts.interactions = Number(ctx.db.run('DELETE FROM interactions WHERE source_key = ?', source).changes);
  counts.identities = Number(ctx.db.run('DELETE FROM identity_observations WHERE source_key = ?', source).changes);
  ctx.db.run("DELETE FROM identity_keys WHERE decision = 'auto' AND NOT EXISTS (SELECT 1 FROM identity_observations o WHERE o.key_id = identity_keys.id) AND NOT EXISTS (SELECT 1 FROM interaction_participants p WHERE p.key_id = identity_keys.id) AND NOT EXISTS (SELECT 1 FROM identity_reviews r WHERE r.key_id = identity_keys.id AND r.state = 'open')");
  counts.affiliations = Number(ctx.db.run('DELETE FROM affiliations WHERE source_key = ?', source).changes);
  counts.facts = Number(ctx.db.run('DELETE FROM facts WHERE source_key = ?', source).changes);
  counts.commitments = Number(ctx.db.run("DELETE FROM commitments WHERE source_key = ? AND state IN ('suggested','dismissed','withdrawn')", source).changes);
  ctx.db.run("UPDATE commitments SET source_key = ?, passage = NULL, evidence_id = NULL, interaction_id = NULL, resolution = 'The original message was deleted with its source. Your decision is kept', revision = revision + 1, updated_at = ? WHERE source_key = ?", MANUAL, time, source);
  ctx.db.run('DELETE FROM organization_domains WHERE source_key = ?', source);
  ctx.db.run('DELETE FROM identity_reviews WHERE source_key = ?', source);
  ctx.db.run('DELETE FROM work_items WHERE source_key = ?', source);
  ctx.db.run('DELETE FROM briefings');
  ctx.db.run('DELETE FROM attribution_rules WHERE account_source = ?', source);
  if (isImportSource(source)) {
    ctx.db.run('DELETE FROM import_rows WHERE source_key = ?', source);
    ctx.db.run('DELETE FROM imports WHERE source_key = ?', source);
  } else {
    const account = source.slice('account:'.length);
    ctx.mailIndex.forget(account);
    ctx.accounts.remove(account);
    ctx.jobs.remove(source);
  }
  removeSearchForSource(ctx, source);
  let removedPeople = 0, removedOrganizations = 0;
  for (const id of persons) {
    refreshPerson(ctx, id);
    if (!ctx.db.get('SELECT 1 AS ok FROM person_sources WHERE person_id = ? LIMIT 1', id)) {
      ctx.db.run("UPDATE identity_keys SET owner_kind = 'none', owner_id = NULL, updated_at = ? WHERE owner_kind = 'person' AND owner_id = ?", time, id);
      ctx.db.run('UPDATE interaction_participants SET person_id = NULL WHERE person_id = ?', id);
      ctx.db.run('DELETE FROM persons WHERE id = ?', id);
      removedPeople++;
    }
  }
  for (const id of organizations) {
    refreshOrganization(ctx, id);
    if (!ctx.db.get('SELECT 1 AS ok FROM organization_sources WHERE organization_id = ? LIMIT 1', id)) {
      ctx.db.run('UPDATE opportunities SET organization_id = NULL WHERE organization_id = ?', id);
      ctx.db.run('DELETE FROM organizations WHERE id = ?', id);
      removedOrganizations++;
    }
  }
  ctx.scopes.forgetSource(source);
  ctx.db.run('DELETE FROM app_revisions WHERE id = ?', source);
  touch(ctx, MANUAL);
  return { ...counts, removedPeople, removedOrganizations };
}

export { newId };
