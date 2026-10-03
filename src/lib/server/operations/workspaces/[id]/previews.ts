import { getWorkspace } from '@/lib/db/queries';
import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { listWorkspacePreviews } from '@/lib/preview/service';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * The previews on this agent's active executions, with live state, for the
 * agent view's Preview tab and Overview. Starting, stopping and pinning stay
 * on `/api/executions/:id/preview/*`. Reading here never keeps a preview
 * warm. See `listWorkspacePreviews`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    if (!getWorkspace(id)) return reply({ error: 'Workspace not found' }, { status: 404 });
    return reply({ previews: listWorkspacePreviews(id) });
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'GET /api/workspaces/:id/previews'));
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
