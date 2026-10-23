import { conversationViews } from '@/lib/sessions/view-state';
import { listAgentMainChats, listRailSessions, listWorkResultReviewAttentionSessions, runningTeamChatTurn, isTeamError } from '@/lib/db/queries';
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
import { getRequestKey } from '@/lib/auth/request-key';
import { executionCatalogAuthority, sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';

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

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const key = getRequestKey(request.headers);
    const authority = executionCatalogAuthority(key);
    const visible = (chatId: string) => {
      if (!authority) return true;
      try { sessionAuthority(key, chatId, 'read'); return true; }
      catch (error) { if (!isTeamError(error)) throw error; return false; }
    };
    // Redacted to what the rail draws. See lib/api/dto/rail-session.ts.
    const rows = toRailSessionDTOs(conversationViews(key, listRailSessions().filter(session => visible(session.id))));
    const mainRows = conversationViews(key, listAgentMainChats().filter(chat => visible(chat.id)));
    const ids = new Set([...rows.map(session => session.id), ...mainRows.map(chat => chat.id)]);
    const pendingSessionIds = listSessionsWithPending().filter(id => !authority || ids.has(id));
    const runningSessionIds = [...new Set([...listRunningSessions().filter(visible), ...(authority ? [...ids].filter(id => runningTeamChatTurn(id)) : [])])];
    const backgroundSessionIds = listBackgroundTaskSessions().filter(visible);
    const pending = new Set(pendingSessionIds);
    // Board context uses live requests after the owning Home's visibility checks.
    const sessions = rows.map(session => {
      const request = pending.has(session.id) ? listForSession(session.id)[0] : undefined;
      return { ...session, ...(request ? { waitingOn: pendingSummary(request) } : {}) };
    });
    const mainChats: RailMainChat[] = mainRows.map((chat) => {
      const request = pending.has(chat.id) ? listForSession(chat.id)[0] : undefined;
      return { ...chat, waitingOn: request ? pendingSummary(request) : null };
    });
    const resultReviewAttention = listWorkResultReviewAttentionSessions().filter((review) => visible(review.sessionId) && (
      pendingSessionIds.includes(review.sessionId) || review.status === 'queued' || review.status === 'running'
      || (review.status === 'failed' && (review.lastOutcomeEventAt ?? '') > (review.lastViewedAt ?? ''))));
    return reply({ sessions, pendingSessionIds, runningSessionIds, backgroundSessionIds, mainChats, resultReviewAttention });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[GET /api/sessions/rail]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
