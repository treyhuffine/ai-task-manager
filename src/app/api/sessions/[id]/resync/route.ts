import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';
import { healthCheckSession } from '@/lib/executor/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * User-initiated "Resync" — the deterministic fallback when the
 * automated layers (per-send, per-view, sweeps) can't or didn't
 * recover. Force-close the cached subprocess, then run the full
 * health check with throttle bypass.
 *
 * Recovery itself (orphan redispatch, synthetic Continue for
 * incomplete turns) lives inside `healthCheckSession` so every
 * trigger goes through the same code path. This route only adds:
 *   - Force-close before the check, killing any zombie subprocess
 *     regardless of what the SDK's lifecycle thinks.
 *   - `force: true`, which lets the user override the 3-min
 *     redispatch throttle so their click actually does something
 *     even right after an automated retry just ran.
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
      console.warn(`[POST /api/sessions/:id/resync] close failed for ${id}:`, err);
    }
    const report = await healthCheckSession(id, {
      redispatchOrphans: true,
      force: true,
    });
    return Response.json({
      ok: true,
      classification: report.classification,
      replayed: report.replayed,
      redispatched: report.redispatched,
      fixes: report.fixes,
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/resync]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
