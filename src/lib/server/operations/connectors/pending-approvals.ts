import { listPendingApprovals } from '@/lib/connectors/approval';
import { getConnectorOwnerId } from '@/lib/connectors/runtime';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Connector actions awaiting human approval (mutating actions the agent attempted). `?sessionId=`
 * narrows to the approvals one chat asked for: its transcript's approval cards read this to know
 * which requests are still live (the session stream pushes the same ids as they change).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const sessionId = searchParams(rpcInput.query).get('sessionId') ?? undefined;
  return reply({ pending: listPendingApprovals({ ownerId: getConnectorOwnerId(), sessionId }) });
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "sessionId": rpcZ.string().optional() }).strict().optional() }).strict().default({});
