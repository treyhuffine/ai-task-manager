import type { NextRequest } from 'next/server';
import { retrySetupScript } from '@/lib/sessions/dispatch';
import { getChatSessionWithExecution } from '@/lib/db/queries';

/**
 * Re-run the workspace's setup script for a session whose background setup
 * failed (the SetupCard "Retry" button). Fires in the background — the status
 * flips to 'running' immediately and the returned session reflects that.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session?.executionId) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    const ok = retrySetupScript(session.executionId);
    if (!ok) {
      return Response.json({ error: 'No setup script to run' }, { status: 400 });
    }
    return Response.json(getChatSessionWithExecution(id));
  } catch (err) {
    console.error('[POST /api/sessions/:id/retry-setup-script]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: 'retry_failed', message }, { status: 500 });
  }
}
