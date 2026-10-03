import { listSessionsWithPending } from '@/lib/executor/live-state';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Snapshot of every session that currently has at least one pending input
 * registered (permission prompt or AskUserQuestion blocking the agent).
 * Used by the rail on first mount to seed its "Needs Approval" bucket;
 * subsequent updates arrive over the global SSE channel.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    return reply({ sessionIds: listSessionsWithPending() });
  } catch (err) {
    console.error('[GET /api/sessions/pending-input]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
