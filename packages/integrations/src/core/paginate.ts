/**
 * Cursor pagination — an authoring primitive (§4). Most provider "list" endpoints page with an
 * opaque cursor (Slack `next_cursor`, Google `nextPageToken`, GitHub `Link`, offset/limit). This
 * drives one to completion, BOUNDED so an action can never run away or blow the context budget:
 * `maxItems` caps results, `maxPages` caps round-trips. A sync layer (a Ri-style incremental pull)
 * is built ON this — it owns the watermark/cursor persistence; the engine owns one bounded sweep.
 *
 * It is deliberately transport-agnostic: you pass a `fetchPage(cursor)` closure (usually over
 * `ctx.http`), so it composes with the trust spine (auth, refresh, retry, redaction) for free.
 */

export interface Page<T> {
  items: T[];
  /** Opaque cursor for the next page. `undefined`/`null`/`''` ⇒ no more pages. */
  nextCursor?: string | null;
}

export interface PaginateOptions {
  /** Hard cap on items collected — bounds context + runaway. Default 1000. */
  maxItems?: number;
  /** Hard cap on page round-trips — backstop for a provider that never stops returning a cursor. Default 50. */
  maxPages?: number;
}

/**
 * Collect every item across pages (bounded). `fetchPage` receives the cursor (`undefined` on the
 * first call) and returns a {@link Page}. Stops at the first empty/absent `nextCursor`, or when a
 * cap is hit (the result is truncated to `maxItems`).
 */
export async function collectPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: PaginateOptions = {},
): Promise<T[]> {
  const maxItems = options.maxItems ?? 1000;
  const maxPages = options.maxPages ?? 50;
  const out: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    out.push(...items);
    if (out.length >= maxItems) return out.slice(0, maxItems);
    if (nextCursor == null || nextCursor === '') break;
    cursor = nextCursor;
  }
  return out;
}
