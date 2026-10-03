import { applyTriageDecision } from '@/lib/db/queries';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { z as rpcZ } from 'zod/v4';

/** POST /api/stream/decisions/:id/accept — apply a proposed decision. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return reply(applyTriageDecision(id, { decidedBy: 'user' }));
  } catch (err) {
    return failureResponse(triageErrorResponse('POST /api/stream/decisions/:id/accept', err));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
