import type { NextRequest } from 'next/server';
import { markSessionUnread } from '@/lib/db/queries';

/**
 * Force the session into the Unread bucket. Sets `unread_marker_at = now`
 * so the rail's read derivation flags this row as unread on the next
 * render, even when no new agent outcome has landed. Cleared on the next
 * Mark read / interaction.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = markSessionUnread(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/unread]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
