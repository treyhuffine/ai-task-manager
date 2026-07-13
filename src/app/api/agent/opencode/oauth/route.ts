import { clearAgentModelCache } from '@/lib/agent-model-discovery';
import { openCodeProviderManager, openCodeRuntimeContext } from '@/lib/agents/opencode';
import { clearHarnessRuntimeCache } from '@/lib/agents/runtime';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const manager = openCodeProviderManager();
    const context = await openCodeRuntimeContext();
    if (body.action === 'begin') {
      if (typeof body.providerId !== 'string' || typeof body.methodId !== 'string') {
        return Response.json({ error: 'providerId and methodId are required' }, { status: 400 });
      }
      const inputs = body.inputs && typeof body.inputs === 'object' && !Array.isArray(body.inputs)
        ? Object.fromEntries(Object.entries(body.inputs).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : undefined;
      return Response.json(await manager.beginOAuth(body.providerId, body.methodId, inputs, context));
    }
    if (body.action === 'complete') {
      if (typeof body.flowId !== 'string') return Response.json({ error: 'flowId is required' }, { status: 400 });
      await manager.completeOAuth(body.flowId, typeof body.code === 'string' ? body.code : undefined, context);
      const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
      await recycleHarnessSessions('opencode');
      clearAgentModelCache('opencode');
      clearHarnessRuntimeCache('opencode');
      return Response.json({ ok: true });
    }
    return Response.json({ error: 'Unknown OAuth action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
