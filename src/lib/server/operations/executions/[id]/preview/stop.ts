import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Stop a preview: tear down the supervised dev server and close the remote
 * tunnel (if any). The desired-state row survives, so the name/URL stays
 * reserved for a later cold-start.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { getPreviewState, stopPreview } from '@/lib/preview/service';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { service?: string | null };
    const service = body.service ?? null;
    await stopPreview(id, service);
    return reply(getPreviewState(id, service));
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'POST /api/executions/:id/preview/stop'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "service": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional() }).strict().default({}) }).strict();
