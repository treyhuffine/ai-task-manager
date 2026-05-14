import type { NextRequest } from 'next/server';
import { getChatSession, getWorkspace } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { listTree, type TreeEntry } from '@/lib/workspaces/list-tree';

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
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspace_id) return Response.json({ entries: [] satisfies TreeEntry[] });

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ entries: [] satisfies TreeEntry[] });

    // No worktree yet (worktree provisioning in flight) — return empty.
    if (!session.worktree_path) return Response.json({ entries: [] satisfies TreeEntry[] });

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle) return Response.json({ entries: [] satisfies TreeEntry[] });

    const entries = await listTree(handle);
    return Response.json({ entries });
  } catch (err) {
    console.error('[GET /api/sessions/:id/tree]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
