import { listNeedsReviewSessionCandidates } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Returns the *candidate* set — sessions where lastOutcomeEventAt has
 * advanced past lastViewedAt. The client filters out any session id in
 * its runtime streaming map; that map only exists in the browser, so the
 * server can't subtract it for us.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const rows = listNeedsReviewSessionCandidates();
    return reply(rows);
  } catch (err) {
    console.error('[GET /api/sessions/needs-review]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
