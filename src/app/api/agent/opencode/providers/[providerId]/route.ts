import {
  beginProviderDisconnectSaga,
  completeProviderDisconnectSaga,
  failProviderDisconnectSaga,
  getUserState,
} from '@/lib/db/queries';
import { clearAgentModelCache, getAgentModelCatalog } from '@/lib/agent-model-discovery';
import { clearHarnessRuntimeCache } from '@/lib/agents/runtime';
import {
  isAlreadyDisconnected,
  openCodeProviderManager,
  openCodeRuntimeContext,
  safeOpenCodeErrorCode,
} from '@/lib/agents/opencode';
import { isHarnessId } from '@/lib/agents/registry';
import { withCompression } from '@/lib/api/compression';

type Context = { params: Promise<{ providerId: string }> };

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(_request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const manager = openCodeProviderManager();
    const context = await openCodeRuntimeContext();
    const [methods, canDisconnect] = await Promise.all([
      manager.authMethods(providerId, context),
      manager.canDisconnect(providerId, context),
    ]);
    return Response.json({ methods, canDisconnect });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { providerId } = await params;
    const body = await request.json() as { apiKey?: unknown };
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim()) {
      return Response.json({ error: 'apiKey is required' }, { status: 400 });
    }
    await openCodeProviderManager().setApiKey(providerId, body.apiKey, await openCodeRuntimeContext());
    const { recycleHarnessSessions } = await import('@/lib/executor/adapter');
    await recycleHarnessSessions('opencode');
    clearAgentModelCache('opencode');
    clearHarnessRuntimeCache('opencode');
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const { providerId } = await params;
  let operationId: string | null = null;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const replacementHarness = isHarnessId(body.replacementHarness) ? body.replacementHarness : null;
    const replacementModel = typeof body.replacementModel === 'string' ? body.replacementModel : null;
    const manager = openCodeProviderManager();
    const context = await openCodeRuntimeContext();
    if (!await manager.canDisconnect(providerId, context)) {
      return Response.json({ error: 'disconnect_unsupported', guidance: 'Run opencode auth logout' }, { status: 409 });
    }
    const state = getUserState();
    if (state?.defaultAgentHarness === 'opencode' && state.defaultAgentModel) {
      const catalog = await getAgentModelCatalog('opencode');
      const active = catalog.find((model) => model.id === state.defaultAgentModel);
      if (active?.provider === providerId && (!replacementHarness || !replacementModel)) {
        return Response.json({
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
    clearAgentModelCache('opencode');
    clearHarnessRuntimeCache('opencode');
    return Response.json({ operation: completed });
  } catch (error) {
    if (operationId) failProviderDisconnectSaga(operationId, safeOpenCodeErrorCode(error));
    return Response.json({
      error: safeOpenCodeErrorCode(error),
      operationId,
    }, { status: 502 });
  }
}
