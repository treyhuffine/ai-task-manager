import { clearCursorApiKey, cursorCredentialStatus, setCursorApiKey } from '@/lib/harness/credentials';
import { clearHarnessModelCache } from '@/lib/harness/model-discovery';
import { clearHarnessRuntimeCache } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { clearAuthCache } from '@agentex/agent';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply(cursorCredentialStatus());
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body as { apiKey?: unknown };
    if (typeof body.apiKey !== 'string') return reply({ error: 'apiKey is required' }, { status: 400 });
    const status = await setCursorApiKey(body.apiKey);
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('cursor');
    clearAuthCache();
    clearHarnessRuntimeCache('cursor');
    clearHarnessModelCache('cursor');
    return reply(status);
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(_rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const status = clearCursorApiKey();
  const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
  await recycleHarnessSessions('cursor');
  clearAuthCache();
  clearHarnessRuntimeCache('cursor');
  clearHarnessModelCache('cursor');
  return reply(status);
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PUTInput = rpcZ.object({ body: rpcZ.object({ "apiKey": rpcZ.string().optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ body: rpcZ.object({}).strict().default({}) }).strict();
