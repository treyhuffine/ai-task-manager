/**
 * Context assembly for a triage sweep (spec §3.7). The agent judges
 * retrieved candidates — it never free-associates merge targets from
 * memory — so this module is the retrieval boundary: per-item embedding
 * neighbors for combine candidates and merge targets, compact world state,
 * the user's recent corrections as few-shot ground truth, and the autonomy
 * snapshot so the agent knows what will auto-apply.
 */

import {
  listStream,
  getStream,
  listTriageDecisions,
  listAreas,
  listTasks,
  listNotes,
  getTask,
  getNote,
  getStreamAutonomy,
  type ResolvedStreamAutonomy,
} from '@/lib/db/queries';
import { hybridSearch } from '@/lib/embeddings/search';
import type { StreamRecord, TriageDecisionRecord } from '@/db/types';
import {
  SWEEP_ITEM_CAP,
  CORRECTIONS_FEWSHOT_LIMIT,
  COMBINE_CANDIDATE_LIMIT,
  MERGE_CANDIDATE_LIMIT,
} from './constants';

/** Keep individual capture texts bounded so one voice ramble can't eat the
 *  whole context window. The agent can get_stream_item for the rest. */
const ITEM_TEXT_CAP = 2_000;

export interface TriageItemContext {
  id: string;
  createdAt: string;
  source: string;
  media: string;
  status: string;
  rawText: string;
  rawTextTruncated: boolean;
  attachmentNames: string[];
  /** Other PENDING captures that may be the same underlying thought. */
  combineCandidates: Array<{ id: string; score: number; preview: string }>;
  /** Existing entities this capture may belong inside. updatedAt doubles as
   *  the optimistic concurrency token (draft.expectedTargetUpdatedAt). */
  mergeCandidates: Array<{
    entityType: 'task' | 'note';
    entityId: string;
    title: string | null;
    score: number;
    updatedAt: string;
  }>;
}

export interface TriageSweepContext {
  items: TriageItemContext[];
  /** Pending items beyond the cap, left for the next sweep. 0 = full drain. */
  itemsBeyondCap: number;
  autonomy: ResolvedStreamAutonomy;
  worldState: {
    areas: Array<{ id: string; name: string }>;
    activeTasks: Array<{ id: string; title: string }>;
    recentNotes: Array<{ id: string; title: string | null; updatedAt: string }>;
  };
  /** The user's judgment, as data. Corrections and undos of past agent
   *  decisions plus a sample of their own manual routing. */
  corrections: Array<{
    disposition: string;
    outcome: string;
    correctedTo: string | null;
    rationale: string | null;
    itemPreview: string | null;
  }>;
  urgentItemId?: string;
}

function preview(text: string, n = 160): string {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length <= n ? line : line.slice(0, n - 1) + '…';
}

async function candidatesForItem(
  item: StreamRecord,
  pendingById: Map<string, StreamRecord>,
): Promise<Pick<TriageItemContext, 'combineCandidates' | 'mergeCandidates'>> {
  try {
    const hits = await hybridSearch(preview(item.rawText, 500), { limit: 24 });
    const combine: TriageItemContext['combineCandidates'] = [];
    const merge: TriageItemContext['mergeCandidates'] = [];
    for (const hit of hits) {
      if (hit.entityType === 'stream') {
        if (hit.entityId === item.id) continue;
        if (combine.length >= COMBINE_CANDIDATE_LIMIT) continue;
        const other = pendingById.get(hit.entityId);
        if (other) combine.push({ id: other.id, score: round2(hit.score), preview: preview(other.rawText) });
      } else if (merge.length < MERGE_CANDIDATE_LIMIT) {
        if (hit.entityType === 'task') {
          const task = getTask(hit.entityId);
          if (task && task.status === 'active') {
            merge.push({ entityType: 'task', entityId: task.id, title: task.title, score: round2(hit.score), updatedAt: task.updatedAt });
          }
        } else {
          const note = getNote(hit.entityId);
          if (note && note.status === 'active') {
            merge.push({ entityType: 'note', entityId: note.id, title: note.title, score: round2(hit.score), updatedAt: note.updatedAt });
          }
        }
      }
    }
    return { combineCandidates: combine, mergeCandidates: merge };
  } catch (err) {
    // Retrieval is an accelerator, never a gate — a sweep with no candidates
    // still drains the queue (the agent just merges less).
    console.warn(`[stream-triage] candidate retrieval failed for ${item.id}:`, err);
    return { combineCandidates: [], mergeCandidates: [] };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function correctionRow(d: TriageDecisionRecord, itemPreviewText: string | null) {
  return {
    disposition: d.disposition,
    outcome: d.state,
    correctedTo: d.correctedDisposition,
    rationale: d.rationale,
    itemPreview: itemPreviewText,
  };
}

/**
 * Assemble the full sweep context. `urgentItemId` narrows the sweep to one
 * time-sensitive capture (lane 1) — candidates still come along so the agent
 * can act correctly, but only that item is in scope.
 */
export async function buildTriageContext(opts: { urgentItemId?: string } = {}): Promise<TriageSweepContext> {
  const allPending = listStream({ status: 'pending', limit: 1000 })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  let scoped = allPending;
  if (opts.urgentItemId) {
    scoped = allPending.filter((i) => i.id === opts.urgentItemId);
  }
  const capped = scoped.slice(0, SWEEP_ITEM_CAP);
  const pendingById = new Map(allPending.map((i) => [i.id, i]));

  const items: TriageItemContext[] = [];
  for (const item of capped) {
    const { combineCandidates, mergeCandidates } = await candidatesForItem(item, pendingById);
    items.push({
      id: item.id,
      createdAt: item.createdAt,
      source: item.source,
      media: item.media,
      status: item.status,
      rawText: item.rawText.length > ITEM_TEXT_CAP ? item.rawText.slice(0, ITEM_TEXT_CAP) : item.rawText,
      rawTextTruncated: item.rawText.length > ITEM_TEXT_CAP,
      attachmentNames: (item.attachments ?? []).map((a) => a.originalName),
      combineCandidates,
      mergeCandidates,
    });
  }

  // The user's judgment as few-shot data: agent decisions they corrected or
  // undid, plus a sample of their own manual routing (ground truth).
  const agentFeedback = listTriageDecisions({ actor: 'agent', state: ['corrected', 'undone'], limit: CORRECTIONS_FEWSHOT_LIMIT });
  const manualGroundTruth = listTriageDecisions({ actor: 'user', state: 'accepted', limit: 15 });
  const previewFor = (d: TriageDecisionRecord): string | null => {
    const first = d.streamItemIds[0];
    if (!first) return null;
    const item = getStream(first);
    return item ? preview(item.rawText, 120) : null;
  };
  const corrections = [
    ...agentFeedback.map((d) => correctionRow(d, previewFor(d))),
    ...manualGroundTruth.map((d) => correctionRow(d, previewFor(d))),
  ];

  return {
    items,
    itemsBeyondCap: Math.max(0, scoped.length - capped.length),
    autonomy: getStreamAutonomy(),
    worldState: {
      areas: listAreas().map((a) => ({ id: a.id, name: a.name })),
      activeTasks: listTasks({ status: 'active', limit: 150 }).map((t) => ({ id: t.id, title: t.title })),
      recentNotes: listNotes({ orderBy: 'updatedAt', limit: 30 }).map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt })),
    },
    corrections,
    ...(opts.urgentItemId ? { urgentItemId: opts.urgentItemId } : {}),
  };
}
