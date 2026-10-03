import { actorFromRequest } from '@/lib/auth/actor';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { finishOnDestination, TransferError, viewOf } from '@/lib/transfer/continue';
import { z as rpcZ } from 'zod/v4';

/**
 * A move stopped after the destination took the work: finish it there
 * (P4.4). The messages it still holds go to the destination, once.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const session = getChatSessionWithExecution(id);
  if (!session?.executionId) return reply({ error: 'Session not found' }, { status: 404 });
  try {
    return reply({ transfer: viewOf(await finishOnDestination(session.executionId, actorFromRequest(request.headers))) });
  } catch (err) {
    if (err instanceof TransferError) return reply({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
