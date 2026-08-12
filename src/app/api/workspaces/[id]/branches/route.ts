import type { NextRequest } from 'next/server';
import { getWorkspace } from '@/lib/db/queries';
import { listWorkspaceBranches } from '@/lib/workspaces';
import { withCompression } from '@/lib/api/compression';

/**
 * Remote-tracking branches in the workspace. Used by the "Create from
 * → Branch" tab. Returns just the branch names (`origin/main`,
 * `origin/feature-x`) so the UI can render a flat list.
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
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    const branches = await listWorkspaceBranches(ws);
    return Response.json(branches);
  } catch (err) {
    console.error('[GET /api/workspaces/:id/branches]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
