import { getConnectorOwnerId, getConnectorRuntime } from '@/lib/connectors/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Bot identity (username) for a Telegram connection — used to build the `t.me/<bot>?start=…` link. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!connectionId) return reply({ error: 'connectionId required' }, { status: 400 });

  const outcome = await (await getConnectorRuntime()).runAction<{ id?: number; username?: string; first_name?: string }>(
    'telegram.get_me',
    {},
    { ownerId: getConnectorOwnerId(), connectionId, caller: { type: 'app', id: 'notifier' } },
  );
  if (!outcome.ok) {
    return reply({ error: outcome.reason === 'error' ? outcome.message : outcome.reason }, { status: 400 });
  }
  return reply({ id: outcome.result.id, username: outcome.result.username });
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "connectionId": rpcZ.string().optional() }).strict().optional() }).strict().default({});
