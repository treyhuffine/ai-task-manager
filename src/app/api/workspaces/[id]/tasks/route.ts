import type { NextRequest } from 'next/server';
import { getWorkspace, listWorkspaceExecutionTasks } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

/**
 * The open tasks this agent's active executions are working, each with the
 * executions working it, for the agent view's Overview.
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
    if (!getWorkspace(id)) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    return Response.json({ tasks: listWorkspaceExecutionTasks(id) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
