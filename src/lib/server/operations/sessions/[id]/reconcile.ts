import { healthCheckSession } from '@/lib/executor/health';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

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
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const report = await healthCheckSession(id, { redispatchOrphans: true });
    // Keep the wire shape compatible with the legacy reconcile route —
    // existing clients ignore extra fields.
    return reply({
      drift: report.replayed > 0,
      replayed: report.replayed,
      classification: report.classification,
      fixes: report.fixes,
      redispatched: report.redispatched,
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/reconcile]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
