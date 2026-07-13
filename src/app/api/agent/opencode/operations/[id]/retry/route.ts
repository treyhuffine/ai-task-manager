import {
  completeProviderDisconnectSaga,
  failProviderDisconnectSaga,
  getProviderDisconnectSaga,
} from '@/lib/db/queries';
import { clearAgentModelCache } from '@/lib/agent-model-discovery';
import { clearHarnessRuntimeCache } from '@/lib/agents/runtime';
import {
  isAlreadyDisconnected,
  openCodeProviderManager,
  openCodeRuntimeContext,
  safeOpenCodeErrorCode,
} from '@/lib/agents/opencode';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const operation = getProviderDisconnectSaga(id);
  if (!operation || operation.operation !== 'disconnect_upstream_provider') {
    return Response.json({ error: 'Operation not found' }, { status: 404 });
  }
  if (operation.status === 'completed') return Response.json({ operation });
  try {
    try {
      await openCodeProviderManager().disconnect(operation.upstreamProviderId, await openCodeRuntimeContext());
    } catch (error) {
      if (!isAlreadyDisconnected(error)) throw error;
    }
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('opencode');
    const completed = completeProviderDisconnectSaga(id);
    clearAgentModelCache('opencode');
    clearHarnessRuntimeCache('opencode');
    return Response.json({ operation: completed });
  } catch (error) {
    const failed = failProviderDisconnectSaga(id, safeOpenCodeErrorCode(error));
    return Response.json({ error: safeOpenCodeErrorCode(error), operation: failed }, { status: 502 });
  }
}
