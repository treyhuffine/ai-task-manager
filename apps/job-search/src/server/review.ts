/**
 * The review queue. One open item per group: a mail thread, a calendar event
 * or an opportunity's stage. New evidence for the same group joins the open
 * item instead of creating another prompt.
 */
import { newId, transaction } from '@ri/app-kit/data';
import type { EvidenceItem, MatchLevel, ReviewItem } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { json, str, type Row } from './util.js';

export interface StoredCandidate { opportunityId: string; level: MatchLevel; evidence: EvidenceItem[] }
export type ReviewProposal = ReviewItem['proposal'];

export interface ReviewInput {
  kind: ReviewItem['kind'];
  groupKey: string;
  sourceKey: string;
  title: string;
  summary: string;
  candidates: StoredCandidate[];
  evidenceIds: string[];
  proposal: ReviewProposal;
  opportunityId: string | null;
}

function mergeCandidates(existing: StoredCandidate[], incoming: StoredCandidate[]): StoredCandidate[] {
  const byId = new Map(existing.map((candidate) => [candidate.opportunityId, { ...candidate, evidence: [...candidate.evidence] }]));
  const rank: Record<MatchLevel, number> = { exact: 0, strong: 1, probable: 2, ambiguous: 3, none: 4 };
  for (const candidate of incoming) {
    const prior = byId.get(candidate.opportunityId);
    if (!prior) { byId.set(candidate.opportunityId, candidate); continue; }
    for (const entry of candidate.evidence) if (!prior.evidence.some((item) => item.kind === entry.kind && item.detail === entry.detail)) prior.evidence.push(entry);
    prior.evidence = prior.evidence.slice(0, 12);
    if (rank[candidate.level] < rank[prior.level]) prior.level = candidate.level;
  }
  return [...byId.values()].slice(0, 10);
}

/** Create the group's open review item, or add this evidence to it. Returns the item ID. */
export function upsertReview(input: ReviewInput): string {
  const { db } = app();
  return transaction(db, () => {
    const time = nowAt();
    const open = db.prepare("SELECT * FROM review_items WHERE group_key = ? AND status = 'open'").get(input.groupKey);
    if (open) {
      const evidence = [...new Set([...json<string[]>(open.evidence_ids, []), ...input.evidenceIds])].slice(-30);
      db.prepare('UPDATE review_items SET summary = ?, candidates = ?, evidence_ids = ?, proposal = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(
        input.summary.slice(0, 600), JSON.stringify(mergeCandidates(json(open.candidates, []), input.candidates)), JSON.stringify(evidence), JSON.stringify(input.proposal), time, str(open.id),
      );
      bumpRevision();
      return str(open.id);
    }
    const id = newId();
    db.prepare(`INSERT INTO review_items (id, created_at, updated_at, revision, kind, group_key, status, source_key, title, summary, candidates, evidence_ids, proposal, opportunity_id, decision, decided_by, decided_at)
      VALUES (?, ?, ?, 1, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`).run(
      id, time, time, input.kind, input.groupKey, input.sourceKey, input.title.slice(0, 200), input.summary.slice(0, 600), JSON.stringify(input.candidates.slice(0, 10)),
      JSON.stringify(input.evidenceIds.slice(-30)), JSON.stringify(input.proposal), input.opportunityId,
    );
    bumpRevision();
    return id;
  });
}

export function resolveOpenReviews(groupKey: string, status: 'resolved' | 'ignored', decision: string, author: string) {
  const { db } = app();
  const time = nowAt();
  const result = db.prepare("UPDATE review_items SET status = ?, decision = ?, decided_by = ?, decided_at = ?, revision = revision + 1, updated_at = ? WHERE group_key = ? AND status = 'open'").run(status, decision.slice(0, 300), author, time, time, groupKey);
  if (Number(result.changes)) bumpRevision();
}

/** Whether a mail thread or calendar event was ignored before, so later messages stay quiet. */
export function groupIgnored(groupKey: string): boolean {
  return !!app().db.prepare("SELECT 1 FROM review_items WHERE group_key = ? AND status = 'ignored' AND kind <> 'stage' LIMIT 1").get(groupKey);
}

export function getReviewRow(id: string): Row | undefined {
  return app().db.prepare('SELECT * FROM review_items WHERE id = ?').get(id);
}
