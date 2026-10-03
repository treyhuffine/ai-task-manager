import { reopenStream } from '@/lib/db/queries';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { z as rpcZ } from 'zod/v4';

/** POST /api/stream/:id/reopen — return a settled capture to pending.
 *  Detaches provenance for single-item outcomes; combined outcomes must be
 *  unwound through their decision. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = reopenStream(id);
    if (!row) return reply({ error: 'Stream item not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    return failureResponse(triageErrorResponse('POST /api/stream/:id/reopen', err));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
