import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * GET /api/runs/<id>/observe
 *
 * Structured live status for a run. Cheap — one DB read + a bounded
 * chat_events scan + a process-liveness peek. Safe to poll on a
 * few-second cadence. See `src/lib/runs/observe.ts` for the
 * classification semantics.
 */

import { observeRun, summarizeActivity } from '@/lib/runs/observe';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const observation = observeRun(id);
  if (!observation) {
    return reply({ error: 'run not found' }, { status: 404 });
  }
  return reply({
    ...observation,
    summary: summarizeActivity(observation),
  });
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
