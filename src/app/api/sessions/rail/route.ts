import { listRailSessions } from '@/lib/db/queries';
// Read running/pending state via a leaf snapshot module (globalThis-backed)
// rather than the executor modules directly. Importing adapter.ts /
// pending-input.ts drags in the full executor + @agentex/agent graph, which
// Turbopack dev is extremely slow to compile — it made this route hang on
// cold compile. The snapshot reads the same live state with no heavy imports.
import {
  listBackgroundTaskSessions,
  listRunningSessions,
  listSessionsWithPending,
} from '@/lib/executor/status-snapshot';
import { withCompression } from '@/lib/api/compression';
import { toRailSessionDTOs } from '@/lib/api/dto/rail-session';

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
// Compressed: the rail is polled every 15s and carries full session rows,
// so it is one of the largest repeat payloads in the app. The `request`
// argument is unused by the handler but required to read Accept-Encoding.
// See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(_request: Request) {
  try {
    // Redacted: this poll ran every 15s carrying a live takeover token.
    // See lib/api/dto/rail-session.ts.
    const sessions = toRailSessionDTOs(listRailSessions());
    const pendingSessionIds = listSessionsWithPending();
    const runningSessionIds = listRunningSessions();
    const backgroundSessionIds = listBackgroundTaskSessions();
    return Response.json({ sessions, pendingSessionIds, runningSessionIds, backgroundSessionIds });
  } catch (err) {
    console.error('[GET /api/sessions/rail]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
