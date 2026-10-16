/**
 * Per-account setup and the Sources screen. An account connected in Ri, the
 * access granted to this app and automatic updates are reported separately.
 * Deleting imported data removes that source's messages, interviews, derived
 * stage changes and review items, and keeps everything the user wrote.
 */
import { AppError, type InvocationAccess } from '@ri/app-kit/contract';
import { accountSource, transaction } from '@ri/app-kit/data';
import { calendarCheckpointSchema, calendarCoverage, changeMailWindow, isPersonalMailDomain, mailCheckpointSchema, mailCoverage, type SourceKind } from '@ri/app-kit/sources';
import { isServiceDomain } from '../domain/text.js';
import { MANUAL_SOURCE, MATERIALS_SOURCE, type Outcome, type Stage } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { accountLabel, COLLECTION_LABELS } from './project.js';
import { json, num, opt, str } from './util.js';

export interface SourceSummary {
  key: string;
  account: string | null;
  kind: 'mail' | 'calendar' | 'collection';
  label: string;
  /** In this app's access for the current caller. */
  granted: boolean;
  automatic: boolean;
  paused: boolean;
  status: string;
  historyDays: number | null;
  calendars: string[];
  coverage: { from: string | null; to: string | null; partial: boolean };
  lastSuccessAt: string | null;
  pending: number;
  failed: number;
  lastError: string | null;
  records: number;
}

function recordCount(key: string): number {
  const db = app().db;
  if (key === MANUAL_SOURCE) return num(db.prepare('SELECT COUNT(*) AS count FROM opportunities').get()?.count);
  if (key === MATERIALS_SOURCE) return num(db.prepare('SELECT COUNT(*) AS count FROM material_families').get()?.count);
  return num(db.prepare('SELECT COUNT(*) AS count FROM correspondence WHERE source_key = ?').get(key)?.count) + num(db.prepare('SELECT COUNT(*) AS count FROM interviews WHERE source_key = ?').get(key)?.count);
}

export function listSources(access: InvocationAccess | null): SourceSummary[] {
  const { accounts, jobs } = app();
  const result: SourceSummary[] = [];
  for (const key of [MANUAL_SOURCE, MATERIALS_SOURCE])
    result.push({ key, account: null, kind: 'collection', label: COLLECTION_LABELS[key], granted: true, automatic: false, paused: false, status: 'ready', historyDays: null, calendars: [], coverage: { from: null, to: null, partial: false }, lastSuccessAt: null, pending: 0, failed: 0, lastError: null, records: recordCount(key) });
  const known = new Map(accounts.list().map((item) => [`${item.account}|${item.kind}`, item]));
  const bindings = (access?.accounts ?? []).flatMap((item) => (item.binding === 'mail' || item.binding === 'calendar' ? [{ ...item, kind: item.binding as SourceKind }] : []));
  const keys = new Set([...known.keys(), ...bindings.map((item) => `${item.account}|${item.kind}`)]);
  for (const id of keys) {
    const [account, kind] = id.split('|') as [string, SourceKind];
    const stored = known.get(id);
    const binding = bindings.find((item) => item.account === account && item.kind === kind);
    const key = accountSource(account);
    const kindJobs = jobs.list(key).filter((job) => job.sourceKey === key && (kind === 'mail' ? job.kind !== 'sync_calendar' : job.kind === 'sync_calendar'));
    let coverage = { from: null as string | null, to: null as string | null, partial: true };
    if (stored && kind === 'mail') {
      const parsed = mailCheckpointSchema.safeParse(stored.checkpoint);
      const mail = mailCoverage(parsed.success ? parsed.data : null);
      coverage = { from: mail.from, to: mail.to, partial: mail.partial };
    } else if (stored) {
      const parts = Object.values((stored.checkpoint ?? {}) as Record<string, unknown>).map((value) => calendarCheckpointSchema.safeParse(value)).filter((parsed) => parsed.success).map((parsed) => calendarCoverage(parsed.data!));
      if (parts.length) coverage = { from: parts.map((part) => part.from).filter(Boolean).sort()[0] ?? null, to: parts.map((part) => part.to).filter(Boolean).sort().at(-1) ?? null, partial: parts.some((part) => part.partial) };
    }
    const failedJob = kindJobs.find((job) => job.state === 'failed');
    result.push({
      key, account, kind, label: accountLabel(account, kind, access), granted: !!binding, automatic: !!binding?.automatic, paused: !!stored?.paused,
      status: !binding ? 'disconnected' : stored?.status ?? 'not_started', historyDays: stored?.historyDays ?? null, calendars: stored?.calendars ?? [], coverage,
      lastSuccessAt: stored?.lastSuccessAt ?? null, pending: kindJobs.filter((job) => job.state === 'pending').length, failed: kindJobs.filter((job) => job.state === 'failed').length,
      lastError: stored?.lastError ?? failedJob?.lastError ?? null, records: recordCount(key),
    });
  }
  return result;
}

export function sourceSetup(access: InvocationAccess | null, input: { account: string; kind: SourceKind; historyDays?: 30 | 90 | 365; calendars?: string[]; paused?: boolean }) {
  const { accounts, jobs } = app();
  const granted = access?.accounts.some((item) => item.account === input.account && item.binding === input.kind);
  const stored = accounts.get(input.account, input.kind);
  if (!granted && !stored) throw new AppError('forbidden', 'Give this app access to the account in Ri first');
  transaction(app().db, () => {
    const current = stored ?? accounts.setup({ account: input.account, kind: input.kind, historyDays: input.historyDays ?? 90, calendars: input.kind === 'calendar' ? ['primary'] : [] });
    const historyDays = input.historyDays ?? current.historyDays;
    const calendars = input.kind === 'calendar' ? (input.calendars?.length ? [...new Set(input.calendars)].slice(0, 10) : current.calendars) : [];
    accounts.setup({ account: input.account, kind: input.kind, historyDays, calendars });
    const source = accountSource(input.account);
    if (input.kind === 'mail' && historyDays !== current.historyDays && current.checkpoint) {
      const parsed = mailCheckpointSchema.safeParse(current.checkpoint);
      if (parsed.success) accounts.commit(input.account, 'mail', changeMailWindow(parsed.data, historyDays), 'importing');
    }
    if (input.paused !== undefined) {
      accounts.pause(input.account, input.paused);
      if (input.paused) jobs.pause(source);
      else jobs.resume(source);
    }
    if (granted && !input.paused) {
      jobs.ensure(input.kind === 'mail' ? 'sync_mail' : 'sync_calendar', source, { idempotent: true });
      if (input.kind === 'mail') jobs.ensure('enrich_mail', source, { idempotent: true });
    }
    bumpRevision();
  });
  return listSources(access).find((item) => item.account === input.account && item.kind === input.kind)!;
}

/**
 * Remove one account's imported records: messages and their cached bodies,
 * interviews from it, stage changes it caused and its review items. The
 * user's notes, preparation, materials and opportunities stay.
 */
export function deleteSourceData(source: string): { removedMessages: number; removedInterviews: number; restoredStages: number } {
  if (!source.startsWith('account:')) throw new AppError('invalid_input', 'Only imported account data can be deleted here. Manage your own records from their screens');
  const account = source.slice('account:'.length);
  const { db, blobs, jobs, accounts, mail, scopes } = app();
  return transaction(db, () => {
    jobs.remove(source);
    const messages = db.prepare('SELECT id, body_digest FROM correspondence WHERE source_key = ?').all(source);
    const ids = messages.map((row) => str(row.id));
    for (const id of ids) {
      db.prepare('UPDATE submissions SET evidence_id = NULL WHERE evidence_id = ?').run(id);
    }
    db.prepare('DELETE FROM correspondence WHERE source_key = ?').run(source);
    for (const row of messages) {
      const digest = opt(row.body_digest);
      if (digest && !db.prepare('SELECT 1 FROM correspondence WHERE body_digest = ? LIMIT 1').get(digest)) blobs.remove(digest);
    }
    // Interviews from this account go. Notes written on them move to the opportunity, and preparation stays.
    const interviews = db.prepare('SELECT id, opportunity_id, title, notes FROM interviews WHERE source_key = ?').all(source);
    for (const interview of interviews) {
      const notes = opt(interview.notes);
      if (notes) {
        const opportunity = db.prepare('SELECT notes FROM opportunities WHERE id = ?').get(str(interview.opportunity_id));
        const combined = `${opt(opportunity?.notes) ? `${opt(opportunity?.notes)}\n\n` : ''}Notes from the removed interview “${str(interview.title)}”:\n${notes}`;
        db.prepare('UPDATE opportunities SET notes = ? WHERE id = ?').run(combined.slice(0, 20000), str(interview.opportunity_id));
      }
    }
    db.prepare('DELETE FROM interviews WHERE source_key = ?').run(source);
    db.prepare('DELETE FROM review_items WHERE source_key = ?').run(source);
    // Stage changes that only this source supported are removed, and the stage falls back to what remains.
    const affected = db.prepare('SELECT DISTINCT opportunity_id FROM stage_events WHERE source_key = ?').all(source).map((row) => str(row.opportunity_id));
    db.prepare('DELETE FROM stage_events WHERE source_key = ?').run(source);
    let restored = 0;
    for (const id of affected) {
      const row = db.prepare('SELECT stage, outcome, stage_lock FROM opportunities WHERE id = ?').get(id);
      if (!row || row.stage_lock) continue;
      const last = db.prepare("SELECT to_stage, to_outcome FROM stage_events WHERE opportunity_id = ? AND decision IN ('applied','accepted') ORDER BY created_at DESC, rowid DESC LIMIT 1").get(id);
      const stage = (opt(last?.to_stage) ?? 'saved') as Stage, outcome = opt(last?.to_outcome) as Outcome | null;
      if (stage !== row.stage || outcome !== opt(row.outcome)) {
        db.prepare('UPDATE opportunities SET stage = ?, outcome = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(stage, outcome, nowAt(), id);
        restored++;
      }
    }
    // Contacts and domains learned from this account are derived data too.
    for (const row of db.prepare('SELECT id, contacts FROM opportunities').all()) {
      const contacts = json<{ email: string; name: string | null; source?: string }[]>(row.contacts, []);
      const kept = contacts.filter((contact) => contact.source !== source);
      if (kept.length !== contacts.length) {
        const domains = [...new Set(kept.map((contact) => contact.email.slice(contact.email.lastIndexOf('@') + 1)).filter((domain) => !isServiceDomain(domain) && !isPersonalMailDomain(domain)))];
        db.prepare('UPDATE opportunities SET contacts = ?, company_domains = ? WHERE id = ?').run(JSON.stringify(kept), JSON.stringify(domains), str(row.id));
      }
    }
    mail.forget(account);
    accounts.remove(account);
    scopes.forgetSource(source);
    bumpRevision();
    return { removedMessages: ids.length, removedInterviews: interviews.length, restoredStages: restored };
  });
}
