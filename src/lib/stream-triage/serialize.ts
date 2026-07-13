/**
 * Wire serialization shared by the stream triage routes: decisions and
 * passes are enriched with target titles and source-capture previews so
 * the client renders outcome lines without extra fetches.
 */

import { getStream, getTask, getNote } from '@/lib/db/queries';
import type { TriageDecisionRecord } from '@/db/types';

/** Display title of a decision's target entity, for merge proposals and
 *  digest lines. */
export function decisionTargetTitle(d: TriageDecisionRecord): string | null {
  if (!d.targetType || !d.targetId) return null;
  if (d.targetType === 'task') return getTask(d.targetId)?.title ?? null;
  const note = getNote(d.targetId);
  return note ? (note.title ?? note.body.slice(0, 60)) : null;
}

export function decisionItemPreviews(d: TriageDecisionRecord) {
  return d.streamItemIds
    .map((id) => getStream(id))
    .filter((i) => i != null)
    .map((i) => ({ id: i.id, rawText: i.rawText, createdAt: i.createdAt, media: i.media, status: i.status }));
}

export function serializeDecision(d: TriageDecisionRecord) {
  return { ...d, targetTitle: decisionTargetTitle(d), items: decisionItemPreviews(d) };
}
