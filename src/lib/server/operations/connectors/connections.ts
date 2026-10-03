import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const connections = await (await getConnectorRuntime()).listConnections();
  return reply({ connections });
}

export const GETInput = rpcZ.object({}).strict().default({});
