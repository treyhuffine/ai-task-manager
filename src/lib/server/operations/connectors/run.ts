import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as {
    actionId?: unknown;
    input?: unknown;
    account?: unknown;
    connectionId?: unknown;
  };
  if (typeof body.actionId !== 'string' || !body.actionId) {
    return reply({ error: 'actionId required' }, { status: 400 });
  }
  const outcome = await (await getConnectorRuntime()).runAction(body.actionId, body.input ?? {}, {
    account: typeof body.account === 'string' && body.account ? body.account : undefined,
    connectionId: typeof body.connectionId === 'string' && body.connectionId ? body.connectionId : undefined,
    caller: { type: 'app' },
  });
  return reply({ outcome });
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "actionId": rpcZ.string().optional(), "input": rpcZ.record(rpcZ.string(), rpcZ.unknown()).optional(), "account": rpcZ.string().optional(), "connectionId": rpcZ.string().optional() }).strict().default({}) }).strict();
