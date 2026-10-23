import { listNeedsReviewSessionCandidates, listRailSessions } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { executionCatalogAuthority, executionCatalogFilter, executionOperationFailure } from '@/lib/workspaces/access';
import { conversationViews } from '@/lib/sessions/view-state';

/**
 * Returns the *candidate* set — sessions where lastOutcomeEventAt has
 * advanced past lastViewedAt. The client filters out any session id in
 * its runtime streaming map; that map only exists in the browser, so the
 * server can't subtract it for us.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const key = getRequestKey(request.headers);
    const authority = executionCatalogAuthority(key);
    const visible = executionCatalogFilter(key);
    const rows = authority ? conversationViews(key, listRailSessions().filter(visible))
      .filter(row => [row.lastOutcomeEventAt, row.unreadMarkerAt].some(at => at && at > (row.lastViewedAt ?? '')))
      : listNeedsReviewSessionCandidates().filter(visible);
    return reply(rows);
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[GET /api/sessions/needs-review]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
