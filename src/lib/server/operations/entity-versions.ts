import { listEntityVersions } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Change history for a note or task — newest first. Powers the in-document
 * chat's "view changes" diff modal. Each row is a point-in-time snapshot
 * captured by `queries.ts` on every content edit (UI = human, MCP = ai).
 *
 *   GET ?entityType=task|note&entityId=<id>&limit=<n>
 */
// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, req: OperationContext) {
  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entityType');
  const entityId = searchParams.get('entityId');
  if ((entityType !== 'task' && entityType !== 'note') || !entityId) {
    return reply({ error: 'entityType (task|note) and entityId are required' }, { status: 400 });
  }
  const limitRaw = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
  try {
    const versions = listEntityVersions(entityType, entityId, { limit });
    return reply({ versions });
  } catch (err) {
    console.error('[GET /api/entity-versions]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "entityType": rpcZ.string().optional(), "entityId": rpcZ.string().optional(), "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
