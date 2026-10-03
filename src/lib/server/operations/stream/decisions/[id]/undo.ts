import { undoTriageDecision } from '@/lib/db/queries';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { z as rpcZ } from 'zod/v4';

/** POST /api/stream/decisions/:id/undo — reverse a decision per the spec's
 *  undo table. Captures go back to pending; never deletes a stream item. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return reply(undoTriageDecision(id));
  } catch (err) {
    return failureResponse(triageErrorResponse('POST /api/stream/decisions/:id/undo', err));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
