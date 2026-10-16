/**
 * Opportunities and their stage history. Every stage change goes through
 * `changeStageFor`, which records an event with author, source, confidence
 * and decision. A stage the user sets is a correction: it stays in force and
 * automatic changes that disagree are recorded as suppressed and offered for
 * review, until the user accepts one or turns automatic updates back on.
 * Automatic changes never move a stage backward.
 */
import { AppError } from '@ri/app-kit/contract';
import { newId, transaction } from '@ri/app-kit/data';
import { isNoReply, normalizeEmail, emailDomain, isPersonalMailDomain } from '@ri/app-kit/sources';
import { companyKey, isServiceDomain, roleKey, cleanUrl, requisitionKey } from '../domain/text.js';
import { MANUAL_SOURCE, STAGE_ORDER, stageLabel, type Compensation, type Outcome, type Stage, type StageEvent } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { json, opt, str, num, type Row } from './util.js';
import { upsertReview, resolveOpenReviews } from './review.js';

export interface OpportunityFields {
  company: string;
  role: string;
  location?: string | null;
  workArrangement?: 'onsite' | 'hybrid' | 'remote' | null;
  sourceUrl?: string | null;
  requisitionId?: string | null;
  nextAction?: string | null;
  nextActionDue?: string | null;
  deadline?: string | null;
  deadlineLabel?: string | null;
  compensation?: Compensation[];
  notes?: string | null;
  contacts?: { email: string; name: string | null }[];
}

export function getOpportunityRow(id: string): Row | undefined {
  return app().db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id);
}
export function requireOpportunityRow(id: string): Row {
  const row = getOpportunityRow(id);
  if (!row) throw new AppError('not_found', 'This opportunity is not available. It may have been removed');
  return row;
}

const clean = (value: string | null | undefined, max: number) => {
  const text = value?.trim();
  return text ? text.slice(0, max) : null;
};

export function createOpportunity(fields: OpportunityFields, author: string, options: { dedupeKey?: string; fictional?: boolean; at?: string; note?: string } = {}): Row {
  const { db } = app();
  const company = clean(fields.company, 200), role = clean(fields.role, 200);
  if (!company || !role) throw new AppError('invalid_input', 'Add the company and the role')
  return transaction(db, () => {
    if (options.dedupeKey) {
      const existing = db.prepare('SELECT * FROM opportunities WHERE dedupe_key = ?').get(options.dedupeKey);
      if (existing) return existing;
    }
    const id = newId(), at = options.at ?? nowAt();
    const contacts = (fields.contacts ?? []).map((contact) => ({ email: normalizeEmail(contact.email), name: contact.name, source: MANUAL_SOURCE }));
    const domains = [...new Set(contacts.map((contact) => emailDomain(contact.email)).filter((domain): domain is string => !!domain && !isServiceDomain(domain) && !isPersonalMailDomain(domain)))];
    db.prepare(`INSERT INTO opportunities (id, created_at, updated_at, revision, source_key, company, company_key, role, role_key, location, work_arrangement, source_url,
      requisition_id, stage, outcome, stage_lock, next_action, next_action_due, deadline, deadline_label, compensation, contacts, company_domains, notes,
      listing_closed_at, archived_at, created_by, dedupe_key, fictional) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`).run(
      id, at, at, MANUAL_SOURCE, company, companyKey(company), role, roleKey(role), clean(fields.location, 200), fields.workArrangement ?? null, cleanUrl(fields.sourceUrl),
      requisitionKey(fields.requisitionId), clean(fields.nextAction, 300), fields.nextActionDue ?? null, fields.deadline ?? null, clean(fields.deadlineLabel, 120),
      JSON.stringify(fields.compensation ?? []), JSON.stringify(contacts), JSON.stringify(domains), clean(fields.notes, 20000), author, options.dedupeKey ?? null, options.fictional ? 1 : 0,
    );
    insertStageEvent({ opportunityId: id, from: null, to: { stage: 'saved', outcome: null }, at, author, source: MANUAL_SOURCE, confidence: 'user', decision: 'applied', revision: 1, note: options.note ?? 'Saved' });
    bumpRevision();
    return db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id)!;
  });
}

/** Apply field edits when the expected revision is current. Returns the new row, or null on a stale revision. */
export function updateOpportunityFields(id: string, expectedRevision: number, fields: Partial<OpportunityFields> & { archived?: boolean; listingClosed?: boolean }, _author: string): Row | null {
  const { db } = app();
  return transaction(db, () => {
    const row = requireOpportunityRow(id);
    if (num(row.revision) !== expectedRevision) return null;
    const at = nowAt();
    const next: Record<string, unknown> = {};
    if (fields.company !== undefined) {
      const company = clean(fields.company, 200);
      if (!company) throw new AppError('invalid_input', 'The company cannot be empty');
      next.company = company;
      next.company_key = companyKey(company);
    }
    if (fields.role !== undefined) {
      const role = clean(fields.role, 200);
      if (!role) throw new AppError('invalid_input', 'The role cannot be empty');
      next.role = role;
      next.role_key = roleKey(role);
    }
    if (fields.location !== undefined) next.location = clean(fields.location, 200);
    if (fields.workArrangement !== undefined) next.work_arrangement = fields.workArrangement;
    if (fields.sourceUrl !== undefined) {
      if (fields.sourceUrl && !cleanUrl(fields.sourceUrl)) throw new AppError('invalid_input', 'Use a web address that starts with https://');
      next.source_url = cleanUrl(fields.sourceUrl);
    }
    if (fields.requisitionId !== undefined) next.requisition_id = requisitionKey(fields.requisitionId);
    if (fields.nextAction !== undefined) next.next_action = clean(fields.nextAction, 300);
    if (fields.nextActionDue !== undefined) next.next_action_due = fields.nextActionDue;
    if (fields.deadline !== undefined) next.deadline = fields.deadline;
    if (fields.deadlineLabel !== undefined) next.deadline_label = clean(fields.deadlineLabel, 120);
    if (fields.compensation !== undefined) next.compensation = JSON.stringify(fields.compensation);
    if (fields.notes !== undefined) next.notes = clean(fields.notes, 20000);
    if (fields.contacts !== undefined) {
      // Contacts learned from an account keep their source, so deleting that account's data can remove them.
      const learnedContacts = json<{ email: string; name: string | null; source?: string }[]>(row.contacts, []);
      const contacts = fields.contacts.map((contact) => {
        const email = normalizeEmail(contact.email);
        return { email, name: contact.name, source: learnedContacts.find((item) => item.email === email)?.source ?? MANUAL_SOURCE };
      });
      next.contacts = JSON.stringify(contacts);
      const learned = json<string[]>(row.company_domains, []);
      const domains = new Set([...learned, ...contacts.map((contact) => emailDomain(contact.email)).filter((domain): domain is string => !!domain && !isServiceDomain(domain) && !isPersonalMailDomain(domain))]);
      next.company_domains = JSON.stringify([...domains].slice(0, 20));
    }
    if (fields.archived !== undefined) next.archived_at = fields.archived ? (row.archived_at ?? at) : null;
    if (fields.listingClosed !== undefined) next.listing_closed_at = fields.listingClosed ? (row.listing_closed_at ?? at) : null;
    const keys = Object.keys(next);
    if (!keys.length) return row;
    db.prepare(`UPDATE opportunities SET ${keys.map((key) => `${key} = ?`).join(', ')}, revision = revision + 1, updated_at = ? WHERE id = ?`).run(
      ...keys.map((key) => next[key] as string | number | null), at, id,
    );
    bumpRevision();
    return requireOpportunityRow(id);
  });
}

// ─── Stage events ────────────────────────────────────────────────────────────

export interface StageTarget { stage: Stage; outcome: Outcome | null }
interface EventInput {
  opportunityId: string;
  from: StageTarget | null;
  to: StageTarget;
  at: string;
  author: string;
  source: string;
  confidence: StageEvent['confidence'];
  decision: StageEvent['decision'];
  revision: number;
  evidence?: { kind: NonNullable<StageEvent['evidence']>['kind']; id: string } | null;
  note?: string | null;
  dedupeKey?: string | null;
}
export function insertStageEvent(input: EventInput): string | null {
  const { db } = app();
  if (input.dedupeKey && db.prepare('SELECT 1 FROM stage_events WHERE dedupe_key = ?').get(input.dedupeKey)) return null;
  const id = newId(), time = nowAt();
  db.prepare(`INSERT INTO stage_events (id, created_at, updated_at, opportunity_id, from_stage, from_outcome, to_stage, to_outcome, occurred_at, author, source_key,
    evidence_kind, evidence_id, confidence, decision, revision, note, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, time, time, input.opportunityId, input.from?.stage ?? null, input.from?.outcome ?? null, input.to.stage, input.to.outcome, input.at, input.author, input.source,
    input.evidence?.kind ?? null, input.evidence?.id ?? null, input.confidence, input.decision, input.revision, input.note?.slice(0, 500) ?? null, input.dedupeKey ?? null,
  );
  return id;
}

export function stageEventRecord(row: Row): StageEvent {
  return {
    id: str(row.id),
    opportunityId: str(row.opportunity_id),
    fromStage: opt(row.from_stage) as Stage | null,
    fromOutcome: opt(row.from_outcome) as Outcome | null,
    toStage: str(row.to_stage) as Stage,
    toOutcome: opt(row.to_outcome) as Outcome | null,
    occurredAt: str(row.occurred_at),
    author: str(row.author),
    source: str(row.source_key),
    confidence: str(row.confidence) as StageEvent['confidence'],
    decision: str(row.decision) as StageEvent['decision'],
    evidence: row.evidence_kind ? { kind: str(row.evidence_kind) as NonNullable<StageEvent['evidence']>['kind'], id: str(row.evidence_id) } : null,
    revision: num(row.revision),
    note: opt(row.note),
    createdAt: str(row.created_at),
  };
}

function normalizeTarget(target: StageTarget): StageTarget {
  if (target.stage !== 'closed') return { stage: target.stage, outcome: null };
  if (!target.outcome) throw new AppError('invalid_input', 'Choose whether the opportunity was rejected, withdrawn or accepted');
  return target;
}
const same = (a: StageTarget, b: StageTarget) => a.stage === b.stage && (a.outcome ?? null) === (b.outcome ?? null);

export type StageChangeResult =
  | { status: 'applied'; eventId: string }
  | { status: 'unchanged' }
  | { status: 'suppressed'; eventId: string | null; reviewId: string }
  | { status: 'duplicate' };

export interface StageChange {
  opportunityId: string;
  target: StageTarget;
  /** user: a person's decision, which becomes the stage in force. automatic: evidence from a source. */
  kind: 'user' | 'automatic';
  author: string;
  source: string;
  confidence: StageEvent['confidence'];
  at?: string;
  evidence?: EventInput['evidence'];
  note?: string | null;
  dedupeKey?: string | null;
  /** Shown in the review when an automatic change is suppressed. */
  reason?: string;
}

export function changeStageFor(change: StageChange): StageChangeResult {
  const { db } = app();
  return transaction(db, () => {
    const row = requireOpportunityRow(change.opportunityId);
    const current: StageTarget = { stage: str(row.stage) as Stage, outcome: opt(row.outcome) as Outcome | null };
    const target = normalizeTarget(change.target);
    const at = change.at ?? nowAt();
    const lock = json<{ stage: Stage; outcome: Outcome | null } | null>(row.stage_lock, null);
    if (change.dedupeKey && db.prepare('SELECT 1 FROM stage_events WHERE dedupe_key = ?').get(change.dedupeKey)) return { status: 'duplicate' };

    if (change.kind === 'automatic') {
      if (lock && !same(lock, target)) {
        const eventId = insertStageEvent({ opportunityId: change.opportunityId, from: current, to: target, at, author: change.author, source: change.source, confidence: change.confidence, decision: 'suppressed', revision: num(row.revision), evidence: change.evidence, note: change.note, dedupeKey: change.dedupeKey });
        const reviewId = upsertReview({
          kind: 'stage',
          groupKey: `stage:${change.opportunityId}`,
          sourceKey: change.source,
          title: `${str(row.company)} · ${str(row.role)}`,
          summary: `You set ${stageLabel(lock.stage, lock.outcome)}. ${change.reason ?? 'New evidence'} suggests ${stageLabel(target.stage, target.outcome)}. Your stage stays until you decide.`,
          candidates: [{ opportunityId: change.opportunityId, level: change.confidence === 'user' || change.confidence === 'ai' ? 'probable' : change.confidence, evidence: [] }],
          evidenceIds: change.evidence?.kind === 'correspondence' ? [change.evidence.id] : [],
          proposal: { stage: target.stage, outcome: target.outcome, company: null, role: null, classification: null, interviewId: change.evidence?.kind === 'interview' ? change.evidence.id : null },
          opportunityId: change.opportunityId,
        });
        bumpRevision();
        return { status: 'suppressed', eventId, reviewId };
      }
      if (same(current, target)) return { status: 'unchanged' };
      // Automatic evidence never moves a stage backward or reopens a closed opportunity.
      if (current.stage === 'closed' || STAGE_ORDER[target.stage] < STAGE_ORDER[current.stage]) return { status: 'unchanged' };
    } else if (same(current, target) && lock && same(lock, target)) {
      return { status: 'unchanged' };
    }

    const revision = num(row.revision) + 1;
    const eventId = insertStageEvent({
      opportunityId: change.opportunityId, from: current, to: target, at, author: change.author, source: change.source, confidence: change.confidence,
      decision: change.kind === 'user' && change.confidence !== 'user' ? 'accepted' : 'applied', revision, evidence: change.evidence, note: change.note, dedupeKey: change.dedupeKey,
    })!;
    const nextLock = change.kind === 'user' ? JSON.stringify({ stage: target.stage, outcome: target.outcome, at: nowAt(), by: change.author, eventId }) : row.stage_lock ?? null;
    db.prepare('UPDATE opportunities SET stage = ?, outcome = ?, stage_lock = ?, revision = ?, updated_at = ? WHERE id = ?').run(target.stage, target.outcome, nextLock as string | null, revision, nowAt(), change.opportunityId);
    if (change.kind === 'user') resolveOpenReviews(`stage:${change.opportunityId}`, 'resolved', `Stage set to ${stageLabel(target.stage, target.outcome)}`, change.author);
    bumpRevision();
    return { status: 'applied', eventId };
  });
}

/** Let email and calendar evidence update this stage again, or keep the user's stage in force. */
export function setStageTracking(id: string, expectedRevision: number, automatic: boolean, author: string): Row | null {
  const { db } = app();
  return transaction(db, () => {
    const row = requireOpportunityRow(id);
    if (num(row.revision) !== expectedRevision) return null;
    const current = { stage: str(row.stage) as Stage, outcome: opt(row.outcome) as Outcome | null };
    const lock = automatic ? null : JSON.stringify({ ...current, at: nowAt(), by: author, eventId: 'manual-hold' });
    db.prepare('UPDATE opportunities SET stage_lock = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(lock, nowAt(), id);
    bumpRevision();
    return requireOpportunityRow(id);
  });
}

/** Remember an employer contact and domain learned from linked correspondence. ATS and personal addresses never count. */
export function learnContact(opportunityId: string, address: string | null | undefined, name: string | null | undefined, source: string) {
  if (!address || isNoReply(address)) return;
  const domain = emailDomain(address);
  if (!domain || isServiceDomain(domain)) return;
  const { db } = app();
  const row = getOpportunityRow(opportunityId);
  if (!row) return;
  const normalized = normalizeEmail(address);
  const contacts = json<{ email: string; name: string | null; source?: string }[]>(row.contacts, []);
  const domains = json<string[]>(row.company_domains, []);
  let changed = false;
  if (!contacts.some((contact) => contact.email === normalized) && contacts.length < 50) {
    contacts.push({ email: normalized, name: name?.slice(0, 200) ?? null, source });
    changed = true;
  }
  if (!isPersonalMailDomain(domain) && !domains.includes(domain) && domains.length < 20) {
    domains.push(domain);
    changed = true;
  }
  if (changed) db.prepare('UPDATE opportunities SET contacts = ?, company_domains = ? WHERE id = ?').run(JSON.stringify(contacts), JSON.stringify(domains), opportunityId);
}

export function currentStage(row: Row): StageTarget {
  return { stage: str(row.stage) as Stage, outcome: opt(row.outcome) as Outcome | null };
}
