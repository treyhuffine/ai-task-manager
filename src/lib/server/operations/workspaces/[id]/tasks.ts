import { getWorkspace, listWorkspaceExecutionTasks } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * The open tasks this agent's active executions are working, each with the
 * executions working it, for the agent view's Overview.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    if (!getWorkspace(id)) return reply({ error: 'Workspace not found' }, { status: 404 });
    return reply({ tasks: listWorkspaceExecutionTasks(id) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/tasks]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
