import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';

/**
 * POST /api/sessions/[id]/interrupt
 *
 * Cancels the in-flight agent turn for this chat_session, if any. The
 * underlying provider gets `interrupt()` called on it (typically SIGTERM
 * to the CLI subprocess), which causes the in-flight `send()` to
 * resolve and the dispatcher to clear `runningSessions`. The next poll
 * of `runtime-status` will see `running: false`.
 *
 * Idempotent: a no-op when no turn is running. Returns 200 either way
 * so the client doesn't have to special-case the race where the agent
 * finished naturally between "show stop button" and "click stop."
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await executor.abort(id);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/interrupt]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
