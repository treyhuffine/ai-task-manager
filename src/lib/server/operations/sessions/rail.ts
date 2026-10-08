import { listAgentMainChats, listRailSessions, listWorkResultReviewAttentionSessions } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
// Read running/pending state via a leaf snapshot module (globalThis-backed)
// rather than the executor modules directly. Importing adapter.ts /
// pending-input.ts drags in the full executor + @agentex/agent graph, which
// Turbopack dev is extremely slow to compile — it made this route hang on
// cold compile. The snapshot reads the same live state with no heavy imports.
import { toRailSessionDTOs } from '@/lib/api/dto/rail-session';
import { listForSession } from '@/lib/executor/live-state';
import {
  listBackgroundTaskSessions,
  listRunningSessions,
  listSessionsWithPending,
} from '@/lib/executor/status-snapshot';
import { pendingSummary } from '@/lib/runner/pending-summary';
import type { RailMainChat } from '@/lib/sessions/contracts';

/**
 * One-shot fetch for the left rail's "by status" view. Returns all active
 * sessions joined with workspace metadata, plus a snapshot of which
 * sessions currently have a pending input request or are streaming live.
 *
 * The client classifies each row into a bucket (Needs Approval / Working
 * / Unread / Waiting Response) from these three signals. The bucketizer
 * lives client-side so re-buckets are reactive to the in-memory
 * pending/streaming sets without a server round trip.
 *
 * `mainChats` carries each agent's current main chat, so an agent's row can
 * say what it last told you, that it replied, and (through the same
 * pending/running sets) that it is thinking or waiting on you, with
 * `waitingOn` saying what for. Riding the rail's refresh keeps it as fresh
 * as the execution rows.
 */
// Compressed: the rail is polled every 15s and carries full session rows,
// so it is one of the largest repeat payloads in the app. The `request`
// argument is unused by the handler but required to read Accept-Encoding.
// See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    // Redacted to what the rail draws. See lib/api/dto/rail-session.ts.
    const sessions = toRailSessionDTOs(listRailSessions());
    const pendingSessionIds = listSessionsWithPending();
    const runningSessionIds = listRunningSessions();
    const backgroundSessionIds = listBackgroundTaskSessions();
    const pending = new Set(pendingSessionIds);
    const mainChats: RailMainChat[] = listAgentMainChats().map((chat) => {
      const request = pending.has(chat.id) ? listForSession(chat.id)[0] : undefined;
      return { ...chat, waitingOn: request ? pendingSummary(request) : null };
    });
    const resultReviewAttention = listWorkResultReviewAttentionSessions().filter((review) =>
      pendingSessionIds.includes(review.sessionId) || review.status === 'queued' || review.status === 'running'
      || (review.status === 'failed' && (review.lastOutcomeEventAt ?? '') > (review.lastViewedAt ?? '')));
    return reply({ sessions, pendingSessionIds, runningSessionIds, backgroundSessionIds, mainChats, resultReviewAttention });
  } catch (err) {
    console.error('[GET /api/sessions/rail]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
