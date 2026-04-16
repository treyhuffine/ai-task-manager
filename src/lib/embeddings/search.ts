import { getRawDb } from '@/lib/db';
import { generateEmbedding } from './embed';

export interface SearchHit {
  entity_type: 'task' | 'note' | 'stream';
  entity_id: string;
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
      `SELECT e.entity_type, e.entity_id, v.distance
       FROM embeddings_vec v
       JOIN embeddings e ON e.id = v.rowid
       WHERE v.embedding MATCH ?
       ORDER BY v.distance
       LIMIT ?`,
    )
    .all(queryEmbedding, limit) as Array<{
    entity_type: 'task' | 'note' | 'stream';
    entity_id: string;
    distance: number;
  }>;

  return rows.map((r) => ({
    entity_type: r.entity_type,
    entity_id: r.entity_id,
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
        entity_type: 'task',
        entity_id: r.id,
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
        entity_type: 'note',
        entity_id: r.id,
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
        entity_type: 'stream',
        entity_id: r.id,
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

  // Run both searches in parallel
  const [vecResults, ftsResults] = await Promise.all([
    vectorSearch(query, limit * 2),
    Promise.resolve(ftsSearch(query, limit * 2)),
  ]);

  // Merge scores by (entity_type, entity_id)
  const merged = new Map<string, SearchHit>();

  for (const hit of vecResults) {
    const key = `${hit.entity_type}:${hit.entity_id}`;
    merged.set(key, {
      entity_type: hit.entity_type,
      entity_id: hit.entity_id,
      score: vectorWeight * hit.score,
    });
  }

  for (const hit of ftsResults) {
    const key = `${hit.entity_type}:${hit.entity_id}`;
    const existing = merged.get(key);
    if (existing) {
      existing.score += bm25Weight * hit.score;
    } else {
      merged.set(key, {
        entity_type: hit.entity_type,
        entity_id: hit.entity_id,
        score: bm25Weight * hit.score,
      });
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
