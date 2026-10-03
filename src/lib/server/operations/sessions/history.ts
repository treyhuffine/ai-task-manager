import { listHistorySessions } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Execution history feed for the rail's "By history" tab. Returns every
 * execution session in chronological order — active AND archived — so
 * the user can scroll back through past work. Distinct from
 * `/sessions/rail`, which filters to active sessions in active workspaces
 * to feed the by-workspace and by-status surfaces.
 *
 * Capped at 200 rows. Older sessions are reachable from the workspace
 * tree directly; the rail doesn't try to be infinite scroll.
 */
// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const sessions = listHistorySessions({ limit: 200 });
    return reply({ sessions });
  } catch (err) {
    console.error('[GET /api/sessions/history]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
