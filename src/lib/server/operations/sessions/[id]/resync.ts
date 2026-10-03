import { actorFromRequest } from '@/lib/auth/actor';
import * as executor from '@/lib/executor/adapter';
import { healthCheckSession } from '@/lib/executor/health';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

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
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    try {
      await executor.close(id, actorFromRequest(request.headers));
    } catch (err) {
      console.warn(`[POST /api/sessions/:id/resync] close failed for ${id}:`, err);
    }
    const report = await healthCheckSession(id, {
      redispatchOrphans: true,
      force: true,
    });
    if (report.error) {
      // Resync is a user asking "please make this right". Reporting success
      // when the transcript sync failed is how a session stays behind with
      // nobody able to tell why.
      return reply({ error: report.error }, { status: 500 });
    }
    return reply({
      ok: true,
      classification: report.classification,
      replayed: report.replayed,
      redispatched: report.redispatched,
      fixes: report.fixes,
    });
  } catch (err) {
    console.error('[POST /api/sessions/:id/resync]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
