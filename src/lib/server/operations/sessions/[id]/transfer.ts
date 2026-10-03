import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Moving work between devices (docs/homes-spec.md §8.2, P4.2): the
 * execution's latest move, and starting one. The destination is any of the
 * person's devices that can take it, named from any screen: "Move to
 * MacBook" (docs/homes-model.md). Whether it can is `startTransfer`'s to say:
 * set up there, connected, and able to run the agent's harness.
 */

import { actorFromRequest } from '@/lib/auth/actor';
import { getRequestKey } from '@/lib/auth/request-key';
import { getChatSessionWithExecution, latestTransfer } from '@/lib/db/queries';
import { startTransfer, TransferError, viewOf } from '@/lib/transfer/continue';

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const session = getChatSessionWithExecution(id);
  if (!session) return reply({ error: 'Session not found' }, { status: 404 });
  const transfer = session.executionId ? latestTransfer(session.executionId) : null;
  return reply({ transfer: transfer ? viewOf(transfer) : null });
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  const body = (rpcInput.body) as { toDeviceId?: unknown; includeUntracked?: unknown } | null;
  if (!body || typeof body.toDeviceId !== 'string') {
    return reply({ error: 'invalid_params', message: 'Body must include toDeviceId.' }, { status: 400 });
  }
  const includeUntracked = Array.isArray(body.includeUntracked) ? body.includeUntracked.filter((f): f is string => typeof f === 'string') : [];
  const key = getRequestKey(request.headers);
  try {
    const transfer = startTransfer({
      chatSessionId: id,
      toDeviceId: body.toDeviceId,
      includeUntracked,
      requestedByApiKeyId: key?.apiKeyId ?? null,
      actor: actorFromRequest(request.headers),
    });
    return reply({ transfer: viewOf(transfer) }, { status: 202 });
  } catch (err) {
    if (err instanceof TransferError) return reply({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "toDeviceId": rpcZ.string(), "includeUntracked": rpcZ.array(rpcZ.string()).default([]) }).strict() }).strict();
