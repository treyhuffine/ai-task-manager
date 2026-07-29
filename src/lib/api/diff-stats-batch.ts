/**
 * Request coalescer for session diff stats.
 *
 * Every rail row asks for its own badge through `useDiffStats`, which is the
 * right shape for the component (one row, one cache entry, one invalidation)
 * but the wrong shape for the network: the history tab renders up to 200 rows,
 * and 200 parallel GETs queue six-at-a-time behind the browser's per-origin
 * connection limit while the server forks git for each one.
 *
 * This keeps the per-row call site intact and fixes the transport underneath.
 * Ids requested inside the same microtask-plus-`WINDOW_MS` window are gathered
 * and posted to `/api/sessions/diff-stats` in chunks, and each caller's promise
 * resolves from the response its id landed in.
 *
 * Chunked rather than one giant request, and the chunks go out in parallel, so
 * badges still paint progressively. One request for all 200 rows would collapse
 * the request count nicely and then show nothing at all until the slowest
 * worktree in the list finished — trading a network problem for a worse
 * perceived-latency one. At `CHUNK_SIZE` the tab issues a handful of requests
 * that each resolve a visible band of rows.
 */

import { api } from './client';
import type { DiffStats } from './sessions';

/**
 * How long to keep gathering ids before flushing. Long enough to span a render
 * pass that mounts rows in separate effects, short enough to stay invisible.
 */
const WINDOW_MS = 10;

/**
 * Ids per request. Small enough that the first chunk paints quickly, large
 * enough that a 200-row history tab issues eight requests instead of 200.
 */
const CHUNK_SIZE = 25;

type Resolver = {
  resolve: (value: DiffStats | null) => void;
  reject: (reason: unknown) => void;
};

/** Ids waiting for the next flush, each with every caller awaiting it. */
const pending = new Map<string, Resolver[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = new Map(pending);
  pending.clear();
  if (batch.size === 0) return;

  const ids = Array.from(batch.keys());
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    // Not awaited: chunks race each other so the earliest response paints its
    // rows rather than waiting behind the rest.
    void api
      .post<{ stats: Record<string, DiffStats | null> }>('/sessions/diff-stats', { ids: chunk })
      .then(({ stats }) => {
        for (const id of chunk) {
          // An id the server omitted is "no stats", same as an explicit null.
          for (const r of batch.get(id) ?? []) r.resolve(stats?.[id] ?? null);
        }
      })
      .catch((err: unknown) => {
        for (const id of chunk) {
          for (const r of batch.get(id) ?? []) r.reject(err);
        }
      });
  }
}

/**
 * Diff stats for one session, transparently batched with every other request
 * made in the same window. Resolves null when the session has no worktree,
 * isn't in a git workspace, or the worktree is gone from disk.
 */
export function fetchDiffStatsBatched(id: string): Promise<DiffStats | null> {
  return new Promise<DiffStats | null>((resolve, reject) => {
    const existing = pending.get(id);
    if (existing) existing.push({ resolve, reject });
    else pending.set(id, [{ resolve, reject }]);
    timer ??= setTimeout(flush, WINDOW_MS);
  });
}
