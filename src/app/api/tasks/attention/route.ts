import type { NextRequest } from 'next/server';
import { getTasksAttentionSignals } from '@/lib/db/queries';

/**
 * Batch attention badges for tasks. `?ids=a,b,c` -> { [id]: signals }.
 * Used by Current Work and visible In-progress rows to show
 * Blocked / Stalled / Review / Working without an N+1 from the client.
 */
export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get('ids');
    const ids = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200) : [];
    if (ids.length === 0) return Response.json({});
    return Response.json(getTasksAttentionSignals(ids));
  } catch (err) {
    console.error('[GET /api/tasks/attention]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
