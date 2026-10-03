import { getStream, recordTriageDecisionAndApply } from '@/lib/db/queries';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { z as rpcZ } from 'zod/v4';

/** POST /api/stream/:id/dismiss — set a capture aside. Recorded as the
 *  user's own triage decision (telemetry baseline + undo). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const item = getStream(id);
    if (!item) return reply({ error: 'Stream item not found' }, { status: 404 });
    const result = recordTriageDecisionAndApply(
      { disposition: 'dismiss', streamItemIds: [id], actor: 'user' },
      'accepted',
    );
    return reply(result);
  } catch (err) {
    return failureResponse(triageErrorResponse('POST /api/stream/:id/dismiss', err));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
