import type { NextRequest } from 'next/server';
import { healthCheckSession } from '@/lib/executor/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Trigger a health check (which runs transcript reconcile internally,
 * cleans in-memory state, and redispatches confirmed orphans).
 * Synchronous — the response includes whether drift was found and
 * how many events were replayed. Event replay emits `chat_event`
 * frames over the SSE stream as rows land, so clients connected to
 * the same session see the catch-up in real time regardless of who
 * initiated the call.
 *
 * The client mounts this on session open as a fire-and-forget call;
 * the UI's "Syncing…" indicator is driven separately by the
 * `reconcile: started` / `reconcile: done` SSE frames so any open
 * tab surfaces it consistently.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const report = await healthCheckSession(id, { redispatchOrphans: true });
    // Keep the wire shape compatible with the legacy reconcile route —
    // existing clients ignore extra fields.
    return Response.json({
      drift: report.replayed > 0,
      replayed: report.replayed,
      classification: report.classification,
      fixes: report.fixes,
      redispatched: report.redispatched,
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/reconcile]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
