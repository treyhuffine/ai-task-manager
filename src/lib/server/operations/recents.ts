import { getRecentEntities } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const limit = parseInt(searchParams(rpcInput.query).get('limit') ?? '10', 10);

    return reply(getRecentEntities(limit));
  } catch (err) {
    console.error('[GET /api/recents]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
