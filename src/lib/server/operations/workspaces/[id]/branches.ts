import { getWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { listWorkspaceBranches } from '@/lib/workspaces';
import { z as rpcZ } from 'zod/v4';

/**
 * Remote-tracking branches in the workspace. Used by the "Create from
 * → Branch" tab. Returns just the branch names (`origin/main`,
 * `origin/feature-x`) so the UI can render a flat list.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const ws = getWorkspace(id);
    if (!ws) return reply({ error: 'Workspace not found' }, { status: 404 });
    const branches = await listWorkspaceBranches(ws);
    return reply(branches);
  } catch (err) {
    console.error('[GET /api/workspaces/:id/branches]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
