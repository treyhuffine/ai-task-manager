/**
 * A person's decision on a review item. Attaching makes the identity certain
 * for the whole thread, so later messages in it match exactly. Ignoring keeps
 * the thread quiet. Stage effects apply only when the person chooses them, as
 * their own decision.
 */
import { AppError } from '@ri/app-kit/contract';
import { transaction } from '@ri/app-kit/data';
import { withoutQuotedReply } from '@ri/app-kit/sources';
import { STAGE_ORDER, stageLabel, type Classification, type EvidenceItem, type Outcome, type ReviewItem, type Stage } from '../domain/model.js';
import { app, bumpRevision, nowAt } from './state.js';
import { changeStageFor, createOpportunity, insertStageEvent, currentStage, requireOpportunityRow } from './opportunities.js';
import { correspondenceBody, linkCorrespondence, setMatchState } from './correspondence.js';
import { applyClassification, attachCalendarInterview, type PendingInterview } from './ingest.js';
import { getReviewRow, resolveOpenReviews } from './review.js';
import { json, num, opt, str, type Row } from './util.js';

export interface ResolveInput {
  reviewId: string;
  expectedRevision: number;
  decision: 'attach' | 'create' | 'ignore' | 'accept_stage' | 'keep_stage';
  opportunityId?: string;
  applyStage?: boolean;
  company?: string;
  role?: string;
}

const INTERVIEW_KINDS = new Set<Classification>(['scheduling', 'interview_confirmed', 'reschedule', 'cancellation']);

function ownAddress(account: string): string | null {
  const checkpoint = app().accounts.get(account, 'mail')?.checkpoint as { emailAddress?: string } | null;
  return checkpoint?.emailAddress ?? null;
}

/** Link every message of the review to the chosen role and apply what they say about interviews. */
function attachEvidence(review: Row, opportunityId: string, author: string) {
  const { db } = app();
  const basis: EvidenceItem[] = [{ kind: 'user', detail: 'You chose this role' }];
  for (const id of json<string[]>(review.evidence_ids, [])) {
    const row = db.prepare('SELECT * FROM correspondence WHERE id = ?').get(id);
    if (!row) continue;
    linkCorrespondence(id, opportunityId, 'exact', basis, author, ownAddress(str(row.account)));
    const classification = str(row.classification) as Classification;
    if (INTERVIEW_KINDS.has(classification)) {
      const message = { id: str(row.message_id), threadId: str(row.thread_id), subject: str(row.subject), receivedAt: str(row.received_at), messageId: opt(row.rfc_message_id), invite: null, text: withoutQuotedReply(correspondenceBody(row) ?? str(row.evidence)) };
      applyClassification(opportunityId, id, classification, 'exact', message, { account: str(row.account), ownAddress: ownAddress(str(row.account)) }, str(row.source_key), 'An email you attached to this role');
    }
  }
  const pending = json<{ pendingInterview?: PendingInterview }>(review.proposal, {}).pendingInterview;
  if (pending) attachCalendarInterview(opportunityId, pending, basis, 'exact', author);
}

export function resolveReview(input: ResolveInput, author: string): { status: 'saved'; opportunityId: string | null } | { status: 'conflict' } {
  const { db } = app();
  return transaction(db, () => {
    const review = getReviewRow(input.reviewId);
    if (!review) throw new AppError('not_found', 'This review item is not available');
    if (num(review.revision) !== input.expectedRevision) return { status: 'conflict' };
    if (review.status !== 'open') throw new AppError('conflict', 'This item was already decided');
    const kind = str(review.kind) as ReviewItem['kind'];
    const proposal = json<ReviewItem['proposal']>(review.proposal, { stage: null, outcome: null, company: null, role: null, classification: null, interviewId: null });
    const groupKey = str(review.group_key);
    const target = proposal.stage ? { stage: proposal.stage as Stage, outcome: (proposal.outcome ?? null) as Outcome | null } : null;

    if (input.decision === 'ignore') {
      if (kind === 'stage') throw new AppError('invalid_input', 'Choose to keep your stage or use the suggested one');
      for (const id of json<string[]>(review.evidence_ids, [])) setMatchState(id, 'ignored', { by: author });
      resolveOpenReviews(groupKey, 'ignored', 'Ignored', author);
      bumpRevision();
      return { status: 'saved', opportunityId: null };
    }

    if (kind === 'stage') {
      const opportunityId = opt(review.opportunity_id);
      if (!opportunityId || !target) throw new AppError('invalid_input', 'This suggestion has no stage to apply');
      const row = requireOpportunityRow(opportunityId);
      const suggestion = db.prepare("SELECT * FROM stage_events WHERE opportunity_id = ? AND decision IN ('suggested','suppressed') ORDER BY created_at DESC, rowid DESC LIMIT 1").get(opportunityId);
      if (input.decision === 'accept_stage') {
        changeStageFor({
          opportunityId, target, kind: 'user', author, source: str(suggestion?.source_key ?? review.source_key),
          confidence: (opt(suggestion?.confidence) as 'exact' | 'strong' | 'probable' | 'ai' | null) ?? 'probable',
          evidence: suggestion?.evidence_kind ? { kind: str(suggestion.evidence_kind) as 'correspondence', id: str(suggestion.evidence_id) } : null,
          note: 'You accepted the suggested stage',
        });
        resolveOpenReviews(groupKey, 'resolved', `Moved to ${stageLabel(target.stage, target.outcome)}`, author);
      } else if (input.decision === 'keep_stage') {
        const current = currentStage(row);
        insertStageEvent({ opportunityId, from: current, to: target, at: nowAt(), author, source: str(review.source_key), confidence: 'user', decision: 'dismissed', revision: num(row.revision), note: `You kept ${stageLabel(current.stage, current.outcome)}` });
        resolveOpenReviews(groupKey, 'resolved', `Kept ${stageLabel(current.stage, current.outcome)}`, author);
      } else throw new AppError('invalid_input', 'Choose to keep your stage or use the suggested one');
      bumpRevision();
      return { status: 'saved', opportunityId };
    }

    let opportunityId: string;
    if (input.decision === 'create') {
      const company = input.company?.trim() || proposal.company;
      const role = input.role?.trim() || proposal.role;
      if (!company || !role) throw new AppError('invalid_input', 'Add the company and role for the new opportunity');
      opportunityId = str(createOpportunity({ company, role }, author, { note: 'Added from email or calendar review' }).id);
    } else if (input.decision === 'attach') {
      if (!input.opportunityId) throw new AppError('invalid_input', 'Choose the opportunity to attach this to');
      opportunityId = str(requireOpportunityRow(input.opportunityId).id);
    } else throw new AppError('invalid_input', 'That choice does not apply to this item');

    attachEvidence(review, opportunityId, author);
    const now = currentStage(requireOpportunityRow(opportunityId));
    const forward = target && now.stage !== 'closed' && (target.stage === 'closed' || STAGE_ORDER[target.stage] > STAGE_ORDER[now.stage]);
    if (target && forward && input.applyStage !== false) {
      changeStageFor({ opportunityId, target, kind: 'user', author, source: str(review.source_key), confidence: 'exact', note: 'You confirmed this from review', evidence: json<string[]>(review.evidence_ids, [])[0] ? { kind: 'correspondence', id: json<string[]>(review.evidence_ids, [])[0] } : null });
    }
    resolveOpenReviews(groupKey, 'resolved', input.decision === 'create' ? 'Added as a new opportunity' : 'Attached', author);
    bumpRevision();
    return { status: 'saved', opportunityId };
  });
}
