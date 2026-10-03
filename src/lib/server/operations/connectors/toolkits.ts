import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const runtime = await getConnectorRuntime();
  const toolkits = runtime.getToolkits().map((t) => ({
    id: t.id,
    displayName: t.displayName,
    providerId: t.providerId,
    scopes: t.scopes ?? [],
    actions: t.actions.map((a) => ({
      id: a.id,
      description: a.description,
      mutating: a.mutating ?? false,
      risk: a.risk ?? (a.mutating ? 'medium' : 'low'),
      scopes: a.scopes ?? [],
    })),
  }));
  return reply({ toolkits });
}

export const GETInput = rpcZ.object({}).strict().default({});
