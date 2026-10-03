import { getNote, getStream, getTask } from '@/lib/db/queries';
import { ftsSearch, hybridSearch, vectorSearch } from '@/lib/embeddings/search';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const q = searchParams(rpcInput.query).get('q');
    const mode = (searchParams(rpcInput.query).get('mode') ?? 'hybrid') as
      | 'hybrid'
      | 'keyword'
      | 'vector';
    const limit = parseInt(searchParams(rpcInput.query).get('limit') ?? '100', 10);

    if (!q || q.trim().length === 0) {
      return reply([]);
    }

    let hits: Array<{ entityType: string; entityId: string; score: number }>;

    if (mode === 'keyword') {
      hits = ftsSearch(q, limit);
    } else if (mode === 'vector') {
      try {
        hits = await vectorSearch(q, limit);
      } catch {
        // Fall back to keyword if embedding fails
        hits = ftsSearch(q, limit);
      }
    } else {
      // hybrid (default)
      try {
        hits = await hybridSearch(q, { limit });
      } catch {
        // Fall back to keyword if embedding fails
        hits = ftsSearch(q, limit);
      }
    }

    const results = hits.map(hit => {
      if (hit.entityType === 'task') {
        const entity = getTask(hit.entityId);
        return entity ? { ...entity, entityType: 'task' as const, score: hit.score } : null;
      }
      if (hit.entityType === 'note') {
        const entity = getNote(hit.entityId);
        return entity ? { ...entity, entityType: 'note' as const, score: hit.score } : null;
      }
      if (hit.entityType === 'stream') {
        const entity = getStream(hit.entityId);
        return entity ? { ...entity, entityType: 'stream' as const, score: hit.score } : null;
      }
      return null;
    }).filter(result => result !== null);

    return reply(results);
  } catch (err) {
    console.error('[GET /api/search]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "q": rpcZ.string().optional(), "mode": rpcZ.string().optional(), "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
