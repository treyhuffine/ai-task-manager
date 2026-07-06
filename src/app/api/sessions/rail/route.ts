import type { NextRequest } from 'next/server';
import { listRailSessions } from '@/lib/db/queries';
// Read running/pending state via a leaf snapshot module (globalThis-backed)
// rather than the executor modules directly. Importing adapter.ts /
// pending-input.ts drags in the full executor + @agentex/agent graph, which
// Turbopack dev is extremely slow to compile — it made this route hang on
// cold compile. The snapshot reads the same live state with no heavy imports.
import { listRunningSessions, listSessionsWithPending } from '@/lib/executor/status-snapshot';

/**
 * One-shot fetch for the left rail's "by status" view. Returns all active
 * sessions joined with workspace metadata, plus a snapshot of which
 * sessions currently have a pending input request or are streaming live.
 *
 * The client classifies each row into a bucket (Needs Approval / Working
 * / Unread / Waiting Response) from these three signals. The bucketizer
 * lives client-side so re-buckets are reactive to the in-memory
 * pending/streaming sets without a server round trip.
 */
export async function GET(_request: NextRequest) {
  try {
    const sessions = listRailSessions();
    const pendingSessionIds = listSessionsWithPending();
    const runningSessionIds = listRunningSessions();
    return Response.json({ sessions, pendingSessionIds, runningSessionIds });
  } catch (err) {
    console.error('[GET /api/sessions/rail]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
