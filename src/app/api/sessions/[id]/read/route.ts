import type { NextRequest } from 'next/server';
import { markSessionRead } from '@/lib/db/queries';

/**
 * Mark the session as read. Bumps `last_viewed_at = now()` and clears
 * any prior `unread_marker_at` (which the "Mark as unread" affordance
 * may have set). Fired by the client on actual interaction with the
 * chat — textarea focus, send, or explicit Mark read.
 *
 * Opening the session no longer hits this endpoint on its own; the
 * change is intentional so a chat that flips into the agent-finished
 * state while the user is looking at it still surfaces as Unread until
 * the user engages.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = markSessionRead(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/read]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
