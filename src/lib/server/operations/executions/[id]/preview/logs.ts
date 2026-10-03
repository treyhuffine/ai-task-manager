import { failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Cursor-based log tail for a preview's supervised dev server. Each fetch
 * asks for everything since `seq N`; the client accumulates.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { previewLogs } from '@/lib/preview/service';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const service = searchParams(rpcInput.query).get('service');
    const cursor = Number(searchParams(rpcInput.query).get('cursor') ?? '0') || 0;
    return reply(previewLogs(id, service || null, cursor));
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'GET /api/executions/:id/preview/logs'));
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "service": rpcZ.string().optional(), "cursor": rpcZ.string().optional() }).strict().optional() }).strict();
