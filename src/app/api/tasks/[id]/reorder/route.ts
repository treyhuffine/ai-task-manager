import type { NextRequest } from 'next/server';
import { reorderTaskInLane } from '@/lib/db/queries';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

/**
 * Reorder a task within its status lane, atomically and against the full sibling
 * set (including Area-hidden cards). Body: { prevId?, nextId? } — the ids of the
 * visible cards the task was dropped between (null = lane boundary). Returns the
 * new sortKey.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const prevId = typeof body.prevId === 'string' ? body.prevId : null;
    const nextId = typeof body.nextId === 'string' ? body.nextId : null;
    return Response.json(reorderTaskInLane(id, prevId, nextId));
  } catch (err) {
    if (isTaskLifecycleError(err)) {
      return Response.json({ error: err.message, code: err.code }, { status: LIFECYCLE_ERROR_HTTP_STATUS[err.code] });
    }
    console.error('[POST /api/tasks/:id/reorder]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
