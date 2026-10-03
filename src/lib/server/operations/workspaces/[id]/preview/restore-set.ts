import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Restore-set (§4): bring up a workspace's pinned previews at once, reading
 * from the §2 desired-state. Returns a per-target outcome summary.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { restoreWorkspacePreviews } from '@/lib/preview/service';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const results = await restoreWorkspacePreviews(id);
    return reply({ results });
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'POST /api/workspaces/:id/preview/restore-set'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
