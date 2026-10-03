import { markTriagePassDigestSeen } from '@/lib/db/queries';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { z as rpcZ } from 'zod/v4';

/** POST /api/stream/passes/:id/seen — calm unread handling for the digest. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const pass = markTriagePassDigestSeen(id);
    if (!pass) return reply({ error: 'Pass not found' }, { status: 404 });
    return reply(pass);
  } catch (err) {
    return failureResponse(triageErrorResponse('POST /api/stream/passes/:id/seen', err));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
