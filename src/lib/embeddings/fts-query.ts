/**
 * Tiny, dependency-free FTS5 helpers shared by the entity search
 * (`./search.ts`) and chat/session search (`@/lib/db/queries`). Kept in their
 * own module so `queries.ts` can reuse them without importing the vector/
 * embedding machinery in `./search.ts` / `./embed.ts`.
 */

/**
 * Turn a user's free-text query into an FTS5 MATCH expression: strip quotes
 * (FTS5 syntax), then wrap each whitespace-delimited term in double quotes with
 * a trailing `*` for prefix matching. Returns an empty string for a blank
 * query — callers treat that as "no search."
 */
export function toFtsMatchQuery(query: string): string {
  return query
    .trim()
    .replace(/['"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"*`)
    .join(' ');
}

/**
 * Normalize an FTS5 `rank` (bm25, more-negative = better) into a 0-1 score,
 * matching what the hybrid merge and chat search both expect.
 */
export function normalizeFtsRank(rank: number): number {
  return Math.abs(rank) / (1 + Math.abs(rank));
}
