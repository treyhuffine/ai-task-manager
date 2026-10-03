import {
  completeProviderDisconnectSaga,
  failProviderDisconnectSaga,
  getProviderDisconnectSaga,
} from '@/lib/db/queries';
import { clearHarnessModelCache } from '@/lib/harness/model-discovery';
import {
  isAlreadyDisconnected,
  openCodeProviderManager,
  openCodeRuntimeContext,
  safeOpenCodeErrorCode,
} from '@/lib/harness/opencode';
import { clearHarnessRuntimeCache } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const operation = getProviderDisconnectSaga(id);
  if (!operation || operation.operation !== 'disconnect_upstream_provider') {
    return reply({ error: 'Operation not found' }, { status: 404 });
  }
  if (operation.status === 'completed') return reply({ operation });
  try {
    try {
      await openCodeProviderManager().disconnect(operation.upstreamProviderId, await openCodeRuntimeContext());
    } catch (error) {
      if (!isAlreadyDisconnected(error)) throw error;
    }
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('opencode');
    const completed = completeProviderDisconnectSaga(id);
    clearHarnessModelCache('opencode');
    clearHarnessRuntimeCache('opencode');
    return reply({ operation: completed });
  } catch (error) {
    const failed = failProviderDisconnectSaga(id, safeOpenCodeErrorCode(error));
    return reply({ error: safeOpenCodeErrorCode(error), operation: failed }, { status: 502 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
