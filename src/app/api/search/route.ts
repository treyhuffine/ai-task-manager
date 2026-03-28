import { NextRequest } from 'next/server';
import { getRawDb } from '@/lib/db';
import { hybridSearch, vectorSearch, ftsSearch } from '@/lib/embeddings/search';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q');
    const mode = (request.nextUrl.searchParams.get('mode') ?? 'hybrid') as
      | 'hybrid'
      | 'keyword'
      | 'vector';
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '20', 10);

    if (!q || q.trim().length === 0) {
      return Response.json([]);
    }

    let hits: Array<{ entity_type: string; entity_id: string; score: number }>;

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

    // Hydrate results with full entity data
    const db = getRawDb();
    const results = hits
      .map((hit) => {
        let entity: Record<string, unknown> | undefined;

        if (hit.entity_type === 'task') {
          entity = db.prepare('SELECT * FROM tasks WHERE id = ?').get(hit.entity_id) as
            | Record<string, unknown>
            | undefined;
        } else if (hit.entity_type === 'note') {
          entity = db.prepare('SELECT * FROM notes WHERE id = ?').get(hit.entity_id) as
            | Record<string, unknown>
            | undefined;
        } else if (hit.entity_type === 'stream') {
          entity = db.prepare('SELECT * FROM stream WHERE id = ?').get(hit.entity_id) as
            | Record<string, unknown>
            | undefined;
        }

        if (!entity) return null;

        return {
          ...entity,
          entity_type: hit.entity_type,
          score: hit.score,
        };
      })
      .filter(Boolean);

    return Response.json(results);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
