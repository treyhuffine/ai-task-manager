import type { NextRequest } from 'next/server';
import { reconcileSession } from '@/lib/executor/reconcile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Trigger a Claude transcript reconcile for one session. Synchronous —
 * the response includes whether drift was found and how many events
 * were replayed. The replay itself emits `chat_event` frames over the
 * SSE stream as rows land, so clients connected to the same session
 * see the catch-up in real time regardless of who initiated the
 * reconcile.
 *
 * The client mounts this on session open as a fire-and-forget call;
 * the UI's "Syncing…" indicator is driven separately by the
 * `reconcile: started` / `reconcile: done` SSE frames so any open tab
 * surfaces it consistently.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await reconcileSession(id);
    return Response.json(result);
  } catch (err) {
    console.error('[POST /api/sessions/:id/reconcile]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
