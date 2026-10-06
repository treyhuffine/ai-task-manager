import { hostedMcpConnectionId, hostedMcpRequiresAuth } from '@/lib/integrations/hosted-mcp';
import { getIntegrationConnectionStore, getIntegrationOwnerId, getIntegrationRuntime, getMcpServerStore, invalidateIntegrationRuntime } from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isIntegrationError } from '@integrations/engine';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { z as rpcZ } from 'zod/v4';

/**
 * Health-probe a connection: forces a token refresh and (if the provider can) an identify call,
 * returning { ok, status, error?, checkedAt } without running a real action. Heals a stale status.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    return reply({ error: 'id required' }, { status: 400 });
  }
  try {
    const stored = await getIntegrationConnectionStore().get(body.id);
    if (!stored || stored.connection.ownerId !== getIntegrationOwnerId()) {
      return reply({ error: 'connection_not_found' }, { status: 404 });
    }
    const hosted = getHostedMcpProvider(stored.connection.providerId);
    if (hosted) {
      // Reconnect and discover tools, rather than testing the engine's derived bearer placeholder.
      invalidateIntegrationRuntime();
      await getIntegrationRuntime();
      const entry = getMcpServerStore().list().find((server) => server.providerId === hosted.id && hostedMcpConnectionId(server) === body.id);
      const requiresAuth = await hostedMcpRequiresAuth(entry, getMcpServerStore());
      const ok = !requiresAuth && entry?.lastStatus === 'ok';
      return reply({
        connectionId: body.id, ok, status: ok ? 'active' : requiresAuth ? 'needs_reauth' : 'error', verified: true,
        checkedAt: new Date().toISOString(), ...(ok ? {} : { error: entry?.lastError ?? (requiresAuth ? hosted.auth?.kind === 'bearer' ? `Update the connection token for ${hosted.displayName}.` : hosted.auth?.kind === 'none' ? `Reconnect ${hosted.displayName}.` : `Sign in to reconnect ${hosted.displayName}.` : `${hosted.displayName} could not be reached. Try testing the connection again.`) })
      });
    }
    const result = await (await getIntegrationRuntime()).testConnection(body.id, { ownerId: getIntegrationOwnerId() });
    return reply(result);
  } catch (e) {
    const code = isIntegrationError(e) ? e.code : 'test_failed';
    const status = code === 'connection_not_found' ? 404 : 500;
    return reply({ error: code }, { status });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "id": rpcZ.string().optional() }).strict().default({}) }).strict();
