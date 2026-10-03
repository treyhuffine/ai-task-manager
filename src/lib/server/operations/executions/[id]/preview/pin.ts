import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Pin / unpin a preview for eager bring-up (the restore-set). Pinned
 * previews are kept warm (skipped by idle-evict) and brought up together by
 * the per-workspace restore-set action.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { getPreviewState, setPreviewPinned } from '@/lib/preview/service';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as { pinned?: boolean; service?: string | null };
    const service = body.service ?? null;
    setPreviewPinned(id, service, body.pinned ?? false);
    return reply(getPreviewState(id, service));
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'POST /api/executions/:id/preview/pin'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "pinned": rpcZ.boolean().optional(), "service": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional() }).strict().default({}) }).strict();
