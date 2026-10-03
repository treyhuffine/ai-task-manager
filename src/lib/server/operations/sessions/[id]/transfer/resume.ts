import { actorFromRequest } from '@/lib/auth/actor';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { resumeOnSource, TransferError, viewOf } from '@/lib/transfer/continue';
import { z as rpcZ } from 'zod/v4';

/**
 * A move stopped before the destination took the work: keep it where it was
 * (P4.4). The messages the move held go there, once.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const session = getChatSessionWithExecution(id);
  if (!session?.executionId) return reply({ error: 'Session not found' }, { status: 404 });
  try {
    return reply({ transfer: viewOf(await resumeOnSource(session.executionId, actorFromRequest(request.headers))) });
  } catch (err) {
    if (err instanceof TransferError) return reply({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
