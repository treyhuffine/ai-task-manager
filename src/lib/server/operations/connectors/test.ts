import { hostedMcpConnectionId, hostedMcpRequiresAuth } from '@/lib/connectors/hosted-mcp';
import { getConnectorConnectionStore, getConnectorOwnerId, getConnectorRuntime, getMcpServerStore, invalidateConnectorRuntime } from '@/lib/connectors/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isConnectorError } from '@connectors/engine';
import { getHostedMcpProvider } from '@connectors/engine/providers';
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
    const stored = await getConnectorConnectionStore().get(body.id);
    if (!stored || stored.connection.ownerId !== getConnectorOwnerId()) {
      return reply({ error: 'connection_not_found' }, { status: 404 });
    }
    const hosted = getHostedMcpProvider(stored.connection.providerId);
    if (hosted) {
      // Reconnect and discover tools, rather than testing the engine's derived bearer placeholder.
      invalidateConnectorRuntime();
      await getConnectorRuntime();
      const entry = getMcpServerStore().list().find((server) => server.providerId === hosted.id && hostedMcpConnectionId(server) === body.id);
      const requiresAuth = await hostedMcpRequiresAuth(entry, getMcpServerStore());
      const ok = !requiresAuth && entry?.lastStatus === 'ok';
      return reply({
        connectionId: body.id, ok, status: ok ? 'active' : requiresAuth ? 'needs_reauth' : 'error', verified: true,
        checkedAt: new Date().toISOString(), ...(ok ? {} : { error: entry?.lastError ?? (requiresAuth ? hosted.auth?.kind === 'bearer' ? `Update the connection token for ${hosted.displayName}.` : hosted.auth?.kind === 'none' ? `Reconnect ${hosted.displayName}.` : `Sign in to reconnect ${hosted.displayName}.` : `${hosted.displayName} could not be reached. Try testing the connection again.`) })
      });
    }
    const result = await (await getConnectorRuntime()).testConnection(body.id, { ownerId: getConnectorOwnerId() });
    return reply(result);
  } catch (e) {
    const code = isConnectorError(e) ? e.code : 'test_failed';
    const status = code === 'connection_not_found' ? 404 : 500;
    return reply({ error: code }, { status });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "id": rpcZ.string().optional() }).strict().default({}) }).strict();
