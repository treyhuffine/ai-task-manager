import type { NextRequest } from 'next/server';
import { setSessionPinned } from '@/lib/db/queries';

/**
 * Unpin this session's execution — clears `pinnedAt`, dropping it out of the
 * rail's "Pinned" group. Symmetric inverse of /pin. Idempotent: unpinning an
 * already-unpinned execution is a no-op that still returns the row.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = setSessionPinned(id, false);
    if (!row) {
      return Response.json({ error: 'Session not found or not pinnable' }, { status: 404 });
    }
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/unpin]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
