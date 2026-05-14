import type { NextRequest } from 'next/server';
import { retryProvisionWorktree } from '@/lib/sessions/dispatch';

/**
 * Retry worktree provisioning for a session that failed setup. Triggered
 * from the SetupCard's Pull button after the user fixes the cause (auth,
 * network, missing remote, etc.). Clears `setup_error` up front so the UI
 * flips out of the failed chip immediately; the column is repopulated if
 * the retry itself fails.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await retryProvisionWorktree(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json(session);
  } catch (err) {
    console.error('[POST /api/sessions/:id/retry-setup]', err);
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: name, message }, { status: 500 });
  }
}
