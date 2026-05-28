import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { hydrateRow } from '@/lib/db/hydrate';
import { tasks, notes, stream } from '@/lib/db/schema';
import { hybridSearch, vectorSearch, ftsSearch } from '@/lib/embeddings/search';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q');
    const mode = (request.nextUrl.searchParams.get('mode') ?? 'hybrid') as
      | 'hybrid'
      | 'keyword'
      | 'vector';
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '100', 10);

    if (!q || q.trim().length === 0) {
      return Response.json([]);
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

    // Hydrate results with full entity data. `hydrateRow` camelizes the
    // `attachments` JSON column so the API response stays camelCase
    // end-to-end.
    const db = getDb();
    const results = hits
      .map((hit) => {
        let entity: Record<string, unknown> | undefined;

        if (hit.entityType === 'task') {
          entity = hydrateRow(db.select().from(tasks).where(eq(tasks.id, hit.entityId)).get());
        } else if (hit.entityType === 'note') {
          entity = hydrateRow(db.select().from(notes).where(eq(notes.id, hit.entityId)).get());
        } else if (hit.entityType === 'stream') {
          entity = hydrateRow(db.select().from(stream).where(eq(stream.id, hit.entityId)).get());
        }

        if (!entity) return null;

        return {
          ...entity,
          entityType: hit.entityType,
          score: hit.score,
        };
      })
      .filter(Boolean);

    return Response.json(results);
  } catch (err) {
    console.error('[GET /api/search]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
