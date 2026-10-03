import { getDeckVersions } from '@/lib/db/queries';
import { todayLocalDate } from '@/lib/deck/date';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * All deck versions produced for a day (oldest → newest). Drives the
 * "revert to an earlier deck" control. Defaults to today.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const date = searchParams(rpcInput.query).get('date') ?? todayLocalDate();
    return reply(getDeckVersions(date));
  } catch (err) {
    console.error('[GET /api/deck/versions]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "date": rpcZ.string().optional() }).strict().optional() }).strict().default({});
