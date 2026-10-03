import {
  beginProviderDisconnectSaga,
  completeProviderDisconnectSaga,
  failProviderDisconnectSaga,
  getUserState,
} from '@/lib/db/queries';
import { clearHarnessModelCache, getHarnessModelCatalog } from '@/lib/harness/model-discovery';
import {
  isAlreadyDisconnected,
  openCodeProviderManager,
  openCodeRuntimeContext,
  safeOpenCodeErrorCode,
} from '@/lib/harness/opencode';
import { isHarnessId } from '@/lib/harness/registry';
import { clearHarnessRuntimeCache } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { providerId } = rpcInput.params;
    const manager = openCodeProviderManager();
    const context = await openCodeRuntimeContext();
    const [methods, canDisconnect] = await Promise.all([
      manager.authMethods(providerId, context),
      manager.canDisconnect(providerId, context),
    ]);
    return reply({ methods, canDisconnect });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const { providerId } = rpcInput.params;
    const body = rpcInput.body as { apiKey?: unknown };
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
      return reply({ error: 'apiKey is required' }, { status: 400 });
    }
    await openCodeProviderManager().setApiKey(providerId, body.apiKey, await openCodeRuntimeContext());
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('opencode');
    clearHarnessModelCache('opencode');
    clearHarnessRuntimeCache('opencode');
    return reply({ ok: true });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { providerId } = rpcInput.params;
  let operationId: string | null = null;
  try {
    const body = rpcInput.body as Record<string, unknown>;
    const replacementHarness = isHarnessId(body.replacementHarness) ? body.replacementHarness : null;
    const replacementModel = typeof body.replacementModel === 'string' ? body.replacementModel : null;
    const manager = openCodeProviderManager();
    const context = await openCodeRuntimeContext();
    if (!await manager.canDisconnect(providerId, context)) {
      return reply({ error: 'disconnect_unsupported', guidance: 'Run opencode auth logout' }, { status: 409 });
    }
    const state = getUserState();
    if (state?.defaultHarness === 'opencode' && state.defaultModel) {
      const catalog = await getHarnessModelCatalog('opencode');
      const active = catalog.find((model) => model.id === state.defaultModel);
      if (active?.provider === providerId && (!replacementHarness || !replacementModel)) {
        return reply({
          error: 'replacement_required',
          guidance: 'Choose a default model from another provider before disconnecting this one',
        }, { status: 409 });
      }
    }
    const operation = beginProviderDisconnectSaga({
      upstreamProviderId: providerId,
      replacementHarness,
      replacementModel,
    });
    operationId = operation.id;
    try {
      await manager.disconnect(providerId, context);
    } catch (error) {
      if (!isAlreadyDisconnected(error)) throw error;
    }
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('opencode');
    const completed = completeProviderDisconnectSaga(operation.id);
    clearHarnessModelCache('opencode');
    clearHarnessRuntimeCache('opencode');
    return reply({ operation: completed });
  } catch (error) {
    if (operationId) failProviderDisconnectSaga(operationId, safeOpenCodeErrorCode(error));
    return reply({
      error: safeOpenCodeErrorCode(error),
      operationId,
    }, { status: 502 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "providerId": rpcZ.string().min(1) }).strict() }).strict();
export const PUTInput = rpcZ.object({ params: rpcZ.object({ "providerId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "apiKey": rpcZ.string().optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "providerId": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ replacementHarness: rpcZ.enum(['claude', 'codex', 'cursor', 'opencode', 'antigravity']).optional(), replacementModel: rpcZ.string().optional() }).strict().default({}) }).strict();
