import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, unarchiveExecution } from '@/lib/db/queries';

/**
 * Lightweight resume: flip an archived execution's status back to active,
 * cascading to its chats. The worktree on disk is NOT recreated — that's
 * the `Continue` path. Use this when the user wants to re-read or ask the
 * agent a question about an old execution without committing to a fresh
 * checkout.
 *
 * The implicit "send to archived = unarchive" path in `/messages` covers
 * the case where the user just types and sends. This route exists so the
 * UI can offer an explicit "Resume" button up front (e.g. before the user
 * decides what they want to type).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.executionId) {
      // Chat-only sessions (orchestration/content) have no execution to
      // flip; their resume story isn't part of this change.
      return Response.json(
        { error: 'No execution to resume on this session' },
        { status: 400 },
      );
    }
    if (session.status === 'archived') {
      unarchiveExecution(session.executionId);
    }
    return Response.json(getChatSessionWithExecution(id));
  } catch (err) {
    console.error('[POST /api/sessions/:id/unarchive]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
