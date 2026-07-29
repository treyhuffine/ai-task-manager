import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { mapWithConcurrency, readWorktreeDiffStats } from '@/lib/workspaces/diff-stats';

/**
 * Diff stats for many sessions in one round trip.
 *
 * The rail renders one badge per row — up to 200 on the history tab — and each
 * row asking for its own stats meant 200 requests that the browser serialised
 * six at a time, each one paying full request overhead for two git spawns of
 * real work. Batching turns that into one request whose cost is bounded by the
 * concurrency limit below rather than by the browser's connection pool.
 *
 * POST (not GET) because the id list is unbounded and would blow past URL
 * length limits; this is a read either way and safe to retry.
 *
 * Unknown ids, non-git workspaces, and missing worktrees all map to `null`
 * rather than an error — the client renders "no badge" for all three, and one
 * archived session must not fail the other 199.
 */

/**
 * Concurrent worktrees inspected at once. Each costs two `git` spawns, and the
 * client sends several chunks in parallel, so this multiplies up — keep it low
 * enough that a full history tab can't fork hundreds of processes on a machine
 * that is usually also running agents.
 */
const WORKTREE_CONCURRENCY = 6;

/** Guard against a pathological client payload. */
const MAX_IDS = 500;

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const rawIds = (body as { ids?: unknown })?.ids;
    if (!Array.isArray(rawIds)) {
      return Response.json({ error: '`ids` must be an array of session ids' }, { status: 400 });
    }
    const ids = Array.from(
      new Set(rawIds.filter((v): v is string => typeof v === 'string' && v.length > 0)),
    ).slice(0, MAX_IDS);

    const entries = await mapWithConcurrency(ids, WORKTREE_CONCURRENCY, async (id) => {
      try {
        const session = getChatSessionWithExecution(id);
        if (!session?.worktreePath || !session.workspaceId) return [id, null] as const;
        const ws = getWorkspace(session.workspaceId);
        if (!ws?.isGit) return [id, null] as const;
        const stats = await readWorktreeDiffStats({
          worktreePath: session.worktreePath,
          baseBranch: ws.baseBranch,
          baseSha: session.baseSha,
          // Live mode runs in the workspace's own checkout, which changes
          // which ref the diff must be anchored to. See `resolveAnchor`.
          inPlace: session.worktreePath === ws.cwd,
        });
        return [id, stats] as const;
      } catch (err) {
        console.error(`[POST /api/sessions/diff-stats] ${id}:`, err);
        return [id, null] as const;
      }
    });

    return Response.json({ stats: Object.fromEntries(entries) });
  } catch (err) {
    console.error('[POST /api/sessions/diff-stats]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
