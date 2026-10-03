import { failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Cheap preview status snapshot for an execution — no side effects, no
 * bring-up. The pane polls this; `start` is what actually spins things up.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { getPreviewState } from '@/lib/preview/service';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const service = searchParams(rpcInput.query).get('service');
    return reply(getPreviewState(id, service || null));
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'GET /api/executions/:id/preview/status'));
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "service": rpcZ.string().optional() }).strict().optional() }).strict();
