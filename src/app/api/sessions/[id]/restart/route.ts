import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';
import { clearHarnessRuntimeCache } from '@/lib/agents/runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * User-initiated "Restart agent" — recycle the coding session's CLI
 * subprocess without losing the conversation.
 *
 * We keep coding sessions open for the life of the server (snappy reuse,
 * no idle spin-down), so a long-lived process never picks up an in-place
 * CLI upgrade and can accumulate working-memory cruft. This is the manual
 * escape hatch: force-close the cached subprocess so the very next send
 * spawns a fresh one, resuming the on-disk transcript via `--resume`.
 *
 * Distinct from Resync (`/resync`): Restart does NOT force a transcript
 * replay or re-fire any unanswered message — it only kills the process.
 * Restart is the proactive "give me a clean process / pick up the new
 * binary" gesture; Resync is the reactive "this session is stuck, recover
 * it" gesture.
 *
 * Also flush the harness runtime cache (60s TTL on the reported version +
 * model catalog) so the UI reflects an in-place binary upgrade immediately
 * rather than up to a minute later.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    try {
      await executor.close(id);
    } catch (err) {
      console.warn(`[POST /api/sessions/:id/restart] close failed for ${id}:`, err);
    }
    // Whole-cache flush (no harness arg): the resolved binary is shared
    // process-wide, so a version bump should refresh for every session.
    clearHarnessRuntimeCache();
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/restart]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
