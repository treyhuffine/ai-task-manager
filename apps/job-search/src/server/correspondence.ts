/**
 * Imported correspondence: identity, participants, bounded evidence and the
 * match decision with its basis. Bodies are kept as bounded text in
 * content-addressed files and are shown only to readers allowed that account.
 */
import { allows, transaction, type AccessScope } from '@ri/app-kit/data';
import { CLASSIFICATIONS, type CorrespondenceItem, type EvidenceItem, type MatchLevel } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { learnContact } from './opportunities.js';
import { bool, json, marks, opt, str, type Row } from './util.js';

type Address = { name: string | null; address: string; normalized: string };

export function correspondenceRecord(row: Row): CorrespondenceItem {
  const from = json<Address | null>(row.from_json, null);
  const to = json<Address[]>(row.to_json, []);
  const classification = str(row.classification) as CorrespondenceItem['classification'];
  return {
    id: str(row.id),
    source: str(row.source_key),
    account: str(row.account),
    threadId: str(row.thread_id),
    subject: str(row.subject),
    from: from ? { email: from.normalized, name: from.name } : null,
    to: to.slice(0, 20).map((item) => ({ email: item.normalized, name: item.name })),
    sent: bool(row.sent),
    receivedAt: str(row.received_at),
    evidence: str(row.evidence),
    classification: CLASSIFICATIONS.includes(classification) ? classification : 'other',
    opportunityId: opt(row.opportunity_id),
    matchStatus: str(row.match_status) as CorrespondenceItem['matchStatus'],
    matchLevel: opt(row.match_level) as MatchLevel | null,
    matchBasis: json<EvidenceItem[]>(row.match_basis, []),
    matchedBy: opt(row.matched_by),
    aiLabel: opt(row.ai_label),
    unavailable: !!row.unavailable_at,
  };
}

/** Link a message to an opportunity and learn the employer contact from it. */
export function linkCorrespondence(id: string, opportunityId: string, level: MatchLevel, basis: EvidenceItem[], by: string, ownAddress: string | null) {
  const { db } = app();
  transaction(db, () => {
    const row = db.prepare('SELECT * FROM correspondence WHERE id = ?').get(id);
    if (!row) return;
    db.prepare("UPDATE correspondence SET opportunity_id = ?, match_status = 'matched', match_level = ?, match_basis = ?, matched_by = ?, revision = revision + 1, updated_at = ? WHERE id = ?").run(
      opportunityId, level, JSON.stringify(basis.slice(0, 12)), by, nowAt(), id,
    );
    // Learn the other party: the sender of received mail, the recipients of sent mail.
    const own = ownAddress?.toLowerCase() ?? null;
    const parties: Address[] = bool(row.sent) ? json<Address[]>(row.to_json, []) : [json<Address | null>(row.from_json, null)].filter((item): item is Address => !!item);
    for (const party of parties.slice(0, 5)) if (party.normalized.toLowerCase() !== own) learnContact(opportunityId, party.normalized, party.name, str(row.source_key));
    bumpRevision();
  });
}

export function setMatchState(id: string, status: CorrespondenceItem['matchStatus'], fields: { level?: MatchLevel | null; basis?: EvidenceItem[]; reviewId?: string | null; by?: string | null }) {
  app().db.prepare('UPDATE correspondence SET match_status = ?, match_level = COALESCE(?, match_level), match_basis = COALESCE(?, match_basis), review_id = COALESCE(?, review_id), matched_by = COALESCE(?, matched_by), revision = revision + 1, updated_at = ? WHERE id = ?').run(
    status, fields.level ?? null, fields.basis ? JSON.stringify(fields.basis.slice(0, 12)) : null, fields.reviewId ?? null, fields.by ?? null, nowAt(), id,
  );
}

/** Opportunities already linked to a thread in this account. */
export function threadOpportunities(account: string, threadId: string): string[] {
  return app().db.prepare("SELECT DISTINCT opportunity_id FROM correspondence WHERE account = ? AND thread_id = ? AND match_status = 'matched' AND opportunity_id IS NOT NULL").all(account, threadId).map((row) => str(row.opportunity_id));
}
/** Opportunities linked to the messages this one replies to or references, in the same account, so a match never rests on another account's mail. */
export function replyOpportunities(account: string, messageIds: string[]): string[] {
  const ids = [...new Set(messageIds.filter(Boolean))].slice(0, 50);
  if (!ids.length) return [];
  return app().db.prepare(`SELECT DISTINCT opportunity_id FROM correspondence WHERE account = ? AND rfc_message_id IN (${marks(ids.length)}) AND match_status = 'matched' AND opportunity_id IS NOT NULL`).all(account, ...ids).map((row) => str(row.opportunity_id));
}
export function threadIgnored(account: string, threadId: string): boolean {
  return !!app().db.prepare("SELECT 1 FROM correspondence WHERE account = ? AND thread_id = ? AND match_status = 'ignored' AND matched_by IS NOT NULL LIMIT 1").get(account, threadId);
}

export function correspondenceFor(opportunityIds: string[], scope: AccessScope, limit = 50): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  if (!opportunityIds.length) return map;
  const rows = app().db.prepare(`SELECT * FROM correspondence WHERE opportunity_id IN (${marks(opportunityIds.length)}) AND match_status = 'matched' ORDER BY received_at DESC`).all(...opportunityIds);
  for (const row of rows) {
    if (!allows(scope, str(row.source_key))) continue;
    const list = map.get(str(row.opportunity_id)) ?? [];
    if (list.length < limit) list.push(row);
    map.set(str(row.opportunity_id), list);
  }
  return map;
}

export function correspondenceBody(row: Row): string | null {
  const digest = opt(row.body_digest);
  return digest ? app().blobs.readText(digest) : null;
}
