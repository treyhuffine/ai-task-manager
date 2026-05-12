import type { NextRequest } from 'next/server';
import { listRailSessions } from '@/lib/db/queries';
import { listSessionsWithPending } from '@/lib/executor/pending-input';
import { listRunningSessions } from '@/lib/executor/adapter';

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
