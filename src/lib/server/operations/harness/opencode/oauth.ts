import { clearHarnessModelCache } from '@/lib/harness/model-discovery';
import { openCodeProviderManager, openCodeRuntimeContext } from '@/lib/harness/opencode';
import { clearHarnessRuntimeCache } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body as Record<string, unknown>;
    const manager = openCodeProviderManager();
    const context = await openCodeRuntimeContext();
    if (body.action === 'begin') {
      if (typeof body.providerId !== 'string' || typeof body.methodId !== 'string') {
        return reply({ error: 'providerId and methodId are required' }, { status: 400 });
      }
      const inputs = body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
        ? Object.fromEntries(Object.entries(body.inputs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : undefined;
      return reply(await manager.beginOAuth(body.providerId, body.methodId, inputs, context));
    }
    if (body.action === 'complete') {
      if (typeof body.flowId !== 'string') return reply({ error: 'flowId is required' }, { status: 400 });
      await manager.completeOAuth(body.flowId, typeof body.code === 'string' ? body.code : undefined, context);
      const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
      await recycleHarnessSessions('opencode');
      clearHarnessModelCache('opencode');
      clearHarnessRuntimeCache('opencode');
      return reply({ ok: true });
    }
    return reply({ error: 'Unknown OAuth action' }, { status: 400 });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({
  body: rpcZ.discriminatedUnion('action', [
    rpcZ.object({ action: rpcZ.literal('begin'), providerId: rpcZ.string(), methodId: rpcZ.string().optional(), inputs: rpcZ.record(rpcZ.string(), rpcZ.string()).optional() }).strict(),
    rpcZ.object({ action: rpcZ.literal('complete'), flowId: rpcZ.string().optional(), code: rpcZ.string().optional() }).strict(),
  ])
}).strict();
