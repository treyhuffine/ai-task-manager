import { openCodeProviderManager, openCodeRuntimeContext } from '@/lib/harness/opencode';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const refresh = new URL(request.url).searchParams.get('refresh') === 'true';
    const manager = openCodeProviderManager();
    const providers = await manager.list(await openCodeRuntimeContext(refresh));
    return reply({ providers });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "refresh": rpcZ.string().optional() }).strict().optional() }).strict().default({});
