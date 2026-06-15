import { getRawDb } from '@/lib/db';
import { generateEmbedding } from './embed';

export interface SearchHit {
  entityType: 'task' | 'note' | 'stream';
  entityId: string;
  score: number;
}

/**
 * Vector similarity search using sqlite-vec.
 * Returns results sorted by cosine similarity descending.
 */
export async function vectorSearch(query: string, limit = 20): Promise<SearchHit[]> {
  const db = getRawDb();
  const queryVector = await generateEmbedding(query);
  const queryEmbedding = new Float32Array(queryVector);

  const rows = db
    .prepare(
      `SELECT e.entity_type AS entityType, e.entity_id AS entityId, v.distance
       FROM embeddings_vec v
       JOIN embeddings e ON e.id = v.rowid
       WHERE v.embedding MATCH ?
       ORDER BY v.distance
       LIMIT ?`,
    )
    .all(queryEmbedding, limit) as Array<{
    entityType: 'task' | 'note' | 'stream';
    entityId: string;
    distance: number;
  }>;

  return rows.map((r) => ({
    entityType: r.entityType,
    entityId: r.entityId,
    score: 1 - r.distance, // cosine similarity = 1 - cosine distance
  }));
}

/**
 * BM25 keyword search across all FTS tables.
 * Normalizes scores to 0-1 range.
 */
export function ftsSearch(query: string, limit = 20): SearchHit[] {
  const db = getRawDb();
  // Escape FTS5 special chars and add prefix matching
  const searchTerm = query
    .trim()
    .replace(/['"]/g, '')
    .split(/\s+/)
    .map((t) => `"${t}"*`)
    .join(' ');

  const hits: SearchHit[] = [];

  // Tasks FTS
  try {
    const taskRows = db
      .prepare(
        `SELECT t.id, rank
         FROM tasks_fts
         JOIN tasks t ON t.rowid = tasks_fts.rowid
         WHERE tasks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(searchTerm, limit) as Array<{ id: string; rank: number }>;

    for (const r of taskRows) {
      hits.push({
        entityType: 'task',
        entityId: r.id,
        score: Math.abs(r.rank) / (1 + Math.abs(r.rank)),
      });
    }
  } catch {
    /* FTS query may fail on unusual input */
  }

  // Notes FTS
  try {
    const noteRows = db
      .prepare(
        `SELECT n.id, rank
         FROM notes_fts
         JOIN notes n ON n.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(searchTerm, limit) as Array<{ id: string; rank: number }>;

    for (const r of noteRows) {
      hits.push({
        entityType: 'note',
        entityId: r.id,
        score: Math.abs(r.rank) / (1 + Math.abs(r.rank)),
      });
    }
  } catch {
    /* FTS query may fail on unusual input */
  }

  // Stream FTS
  try {
    const streamRows = db
      .prepare(
        `SELECT s.id, rank
         FROM stream_fts
         JOIN stream s ON s.rowid = stream_fts.rowid
         WHERE stream_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(searchTerm, limit) as Array<{ id: string; rank: number }>;

    for (const r of streamRows) {
      hits.push({
        entityType: 'stream',
        entityId: r.id,
        score: Math.abs(r.rank) / (1 + Math.abs(r.rank)),
      });
    }
  } catch {
    /* FTS query may fail on unusual input */
  }

  // Sort merged cross-table results by score descending, then cap
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Hybrid search: merges vector similarity + BM25 keyword scores.
 * Default weighting: 70% vector, 30% BM25.
 */
export async function hybridSearch(
  query: string,
  { limit = 20, vectorWeight = 0.7 }: { limit?: number; vectorWeight?: number } = {},
): Promise<SearchHit[]> {
  const bm25Weight = 1 - vectorWeight;

  // Run both searches in parallel. The vector half needs OPENAI_API_KEY to
  // embed the query — degrade to FTS-only instead of failing the whole
  // search when it's unavailable (matches upsertEmbedding's silent skip).
  const [vecResults, ftsResults] = await Promise.all([
    vectorSearch(query, limit * 2).catch((err) => {
      if (process.env.OPENAI_API_KEY) {
        // A real failure, not the expected keyless path — keep it visible.
        console.warn('[search] vector search failed, falling back to FTS:', err);
      }
      return [] as SearchHit[];
    }),
    Promise.resolve(ftsSearch(query, limit * 2)),
  ]);

  // Merge scores by (entityType, entityId)
  const merged = new Map<string, SearchHit>();

  for (const hit of vecResults) {
    const key = `${hit.entityType}:${hit.entityId}`;
    merged.set(key, {
      entityType: hit.entityType,
      entityId: hit.entityId,
      score: vectorWeight * hit.score,
    });
  }

  for (const hit of ftsResults) {
    const key = `${hit.entityType}:${hit.entityId}`;
    const existing = merged.get(key);
    if (existing) {
      existing.score += bm25Weight * hit.score;
    } else {
      merged.set(key, {
        entityType: hit.entityType,
        entityId: hit.entityId,
        score: bm25Weight * hit.score,
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ─── Entity hydration ────────────────────────────────────────────

/** A SearchHit hydrated with the entity's display fields. */
export interface SearchHitWithEntity extends Record<string, unknown> {
  type: SearchHit['entityType'];
  score: number;
  id: string;
}

const SNIPPET_MAX = 500;

function truncate(value: unknown): unknown {
  return typeof value === 'string' && value.length > SNIPPET_MAX
    ? value.slice(0, SNIPPET_MAX) + '...'
    : value;
}

/**
 * Hybrid search + entity hydration. The single implementation behind the
 * chat agent's `searchKnowledgeBase` tool, the orchestrator `search`
 * action, and deck generation's context-gathering tool — keeps the
 * per-entity column selection and snippet truncation in one place.
 *
 * Hits whose row has since been deleted are dropped (embeddings can lag
 * a hard delete).
 */
export async function hybridSearchWithEntities(
  query: string,
  { limit = 10, vectorWeight }: { limit?: number; vectorWeight?: number } = {},
): Promise<SearchHitWithEntity[]> {
  const hits = await hybridSearch(query, { limit, ...(vectorWeight !== undefined ? { vectorWeight } : {}) });
  const db = getRawDb();

  return hits
    .map((hit) => {
      let entity: Record<string, unknown> | undefined;

      if (hit.entityType === 'task') {
        entity = db
          .prepare(
            'SELECT id, title, description, status, area_id AS areaId, hard_deadline AS hardDeadline, user_context AS userContext, body FROM tasks WHERE id = ?',
          )
          .get(hit.entityId) as Record<string, unknown> | undefined;
        if (entity) entity.body = truncate(entity.body);
      } else if (hit.entityType === 'note') {
        entity = db
          .prepare('SELECT id, title, body, area_id AS areaId, task_id AS taskId FROM notes WHERE id = ?')
          .get(hit.entityId) as Record<string, unknown> | undefined;
        if (entity) entity.body = truncate(entity.body);
      } else if (hit.entityType === 'stream') {
        entity = db
          .prepare('SELECT id, raw_text AS rawText, created_at AS createdAt, source FROM stream WHERE id = ?')
          .get(hit.entityId) as Record<string, unknown> | undefined;
        if (entity) entity.rawText = truncate(entity.rawText);
      }

      if (!entity) return null;
      return { type: hit.entityType, score: hit.score, ...entity } as SearchHitWithEntity;
    })
    .filter((e): e is SearchHitWithEntity => e !== null);
}
