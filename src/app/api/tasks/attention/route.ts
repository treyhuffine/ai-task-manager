import type { NextRequest } from 'next/server';
import { getTasksAttentionSignals } from '@/lib/db/queries';
import { listRunningSessions } from '@/lib/executor/status-snapshot';

/**
 * Batch attention badges for tasks. `?ids=a,b,c` -> { [id]: signals }.
 * Used by Current Work and visible In-progress rows to show
 * Blocked / Stalled / Review / Working without an N+1 from the client.
 * Runs in the server process, so it passes the live running-session set to make
 * Working/Stalled reflect a genuinely running turn, not just an active row.
 */
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get('ids');
    const ids = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200) : [];
    if (ids.length === 0) return Response.json({});
    return Response.json(getTasksAttentionSignals(ids, new Set(listRunningSessions())));
  } catch (err) {
    console.error('[GET /api/tasks/attention]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
