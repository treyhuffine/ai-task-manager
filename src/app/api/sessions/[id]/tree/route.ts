import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { listTree, type TreeEntry } from '@/lib/workspaces/list-tree';
import { withCompression } from '@/lib/api/compression';

/**
 * Flat list of the worktree's tracked + untracked files for the file
 * tree column of the execution view. Status flags are layered in for
 * changed files; everything else is bare path + name.
 *
 * Non-git workspaces fall back to a `ws.tree()` walk with the common
 * heavyweight directories (`node_modules`, `.next`, …) trimmed out.
 *
 * Returns `{ entries: [] }` when there's no worktree (settings-up or
 * non-git workspace without a path) so the client can render an empty
 * state instead of error.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspaceId) return Response.json({ entries: [] satisfies TreeEntry[] });

    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ entries: [] satisfies TreeEntry[] });

    // No worktree yet (worktree provisioning in flight) — return empty.
    if (!session.worktreePath) return Response.json({ entries: [] satisfies TreeEntry[] });

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle) return Response.json({ entries: [] satisfies TreeEntry[] });

    // Surface the workspace's copied-in ignored files (e.g. `.env*`) alongside
    // the tracked tree — they're hidden by `.gitignore` but put there on purpose.
    const entries = await listTree(handle, ws.filesToCopy ?? []);
    return Response.json({ entries });
  } catch (err) {
    console.error('[GET /api/sessions/:id/tree]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
