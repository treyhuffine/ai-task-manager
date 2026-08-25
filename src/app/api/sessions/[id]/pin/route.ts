import type { NextRequest } from 'next/server';
import { setSessionPinned } from '@/lib/db/queries';

/**
 * Pin this session's execution to the top of the rail's "Pinned" group.
 * Pinning is a transient working-set marker ("keep this reachable while I
 * bounce between things"), not a durable priority — archiving the execution
 * clears it automatically. Idempotent: re-pinning just refreshes the stamp.
 *
 * Keyed by session id (like /archive, /read) so every rail surface, which
 * addresses rows by their primary chat, can drive it without knowing the
 * execution id. Returns the session flattened with the updated execution
 * state so the client can echo `execution.pinnedAt` into its caches.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = setSessionPinned(id, true);
    if (!row) {
      return Response.json({ error: 'Session not found or not pinnable' }, { status: 404 });
    }
    return Response.json(row);
  } catch (err) {
    console.error('[POST /api/sessions/:id/pin]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
