import { getAppRoot } from '@/lib/config/paths';
import { ensureHarnessSettings } from '@/lib/db/queries';
import { HARNESS_IDS, HARNESS_REGISTRY } from '@/lib/harness/registry';
import { getHarnessRuntime } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  const url = new URL(request.url);
  const refresh = url.searchParams.get('refresh') === 'true';
  const cwd = url.searchParams.get('cwd') || getAppRoot();
  const harnesses = await Promise.all(HARNESS_IDS.map(async (id) => ({
    ...HARNESS_REGISTRY[id],
    runtime: await getHarnessRuntime(id, { cwd, refresh }),
    settings: ensureHarnessSettings(id),
  })));
  return reply({ harnesses });
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "refresh": rpcZ.string().optional(), "cwd": rpcZ.string().optional() }).strict().optional() }).strict().default({});
