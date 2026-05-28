import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, clearExecutionTakeover } from '@/lib/db/queries';

/**
 * Abandon an in-flight takeover without pulling from the remote branch.
 * Local clone (if the user ran `flow takeover`) is left alone — the
 * user can clean it up at their leisure. The server's worktree retains
 * the WIP commit; squash-on-merge cleans that up downstream.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.takeoverStartedAt) {
      return Response.json(
        { error: 'not_in_takeover', message: 'Session is not in takeover.' },
        { status: 400 },
      );
    }
    if (session.executionId) clearExecutionTakeover(session.executionId);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/takeover-cancel]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
