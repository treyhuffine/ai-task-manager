import type { WorkResultAiReviewRecord, WorkResultRecord, WorkResultDecisionRecord } from '@/db/types';
import type { ChatEventRecord } from '@/lib/api/dto/records';

/** Only HTTP links belong in result content. Preview references resolve separately. */
export function resultLinkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function resultEventId(event: Pick<ChatEventRecord, 'source' | 'raw' | 'content'>): string | null {
  if (event.source !== 'work_result') return null;
  const raw = event.raw && typeof event.raw === 'object' && !Array.isArray(event.raw)
    ? event.raw as Record<string, unknown>
    : null;
  const id = raw?.resultId ?? raw?.result_id;
  return typeof id === 'string' && id ? id : null;
}

export function resultReviewLabel(review: WorkResultAiReviewRecord, result: WorkResultRecord, hasSuccessor: boolean): string {
  if (review.status === 'queued') return 'AI review queued';
  if (review.status === 'running') return 'Reviewing with AI';
  if (review.status === 'failed') return review.statusReason === 'missing_report' ? 'AI review ended without a report' : 'AI review failed';
  if (review.status === 'cancelled') return review.statusReason === 'reused_existing_review' ? 'Existing AI review reused' : 'AI review cancelled';
  if (review.provenance.independence !== 'observed') return 'Agent reports an AI review';
  if (hasSuccessor || review.scope.observed?.drift) return 'AI review of an earlier work snapshot';
  if (result.codeRevision && (!result.codeRevision.commitSha || (result.codeRevision.workingTreeState !== 'clean' && !result.codeRevision.checkpointRef))) {
    return 'AI review recorded, working copy identity uncertain';
  }
  if (!review.scope.observed) return 'AI review recorded, inspected scope unknown';
  return 'AI review recorded';
}

export function dispositionLabel(review: WorkResultDecisionRecord): string {
  const action = review.disposition === 'accepted' ? 'Accepted' : review.disposition === 'changes_requested' ? 'Changes requested' : 'Dismissed';
  const actor = review.actorSource === 'human' ? (review.actorUserId === 'local' ? 'you' : review.actorUserId) : review.actorSource === 'ai' ? 'agent' : 'system';
  return `${action} by ${actor}`;
}

export function reviewReportExcerpt(body: string): string {
  const paragraphs = body.split(/\n\s*\n/).filter((part) => part.trim() && !part.trim().startsWith('#'));
  const paragraph = paragraphs.find((part) => /^\s*(?:\*\*)?(?:Verdict|Result|Outcome|Summary)\b/i.test(part))
    ?? paragraphs.find((part) => !/^\s*Target:/i.test(part)) ?? '';
  return paragraph.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

export function orderedNewest<T extends { createdAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

/** Ordinary transcript rows stay append-only. Feature delivery envelopes can advance. */
export function refreshResultOperationEvent<T extends Pick<ChatEventRecord, 'id' | 'raw'>>(rows: T[], event: T): T[] {
  const raw = event.raw as { resultOperation?: unknown } | null;
  if (!raw?.resultOperation) return rows;
  const index = rows.findIndex((row) => row.id === event.id);
  if (index < 0 || JSON.stringify(rows[index].raw) === JSON.stringify(event.raw)) return rows;
  return rows.map((row, position) => position === index ? event : row);
}
