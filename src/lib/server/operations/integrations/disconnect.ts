import { hostedMcpConnectionId } from '@/lib/integrations/hosted-mcp';
import { removeMcpServer } from '@/lib/integrations/mcp-lifecycle';
import { getIntegrationConnectionStore, getIntegrationOwnerId, getIntegrationRuntime, getMcpServerStore, invalidateIntegrationRuntime } from '@/lib/integrations/runtime';
import { deleteChannelsForConnection } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { getHostedMcpProvider, PROVIDER_CATALOG } from '@integrations/engine/providers';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = (rpcInput.body) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    return reply({ error: 'id required' }, { status: 400 });
  }
  const connections = getIntegrationConnectionStore();
  const stored = await connections.get(body.id);
  if (stored && stored.connection.ownerId !== getIntegrationOwnerId()) {
    return reply({ error: 'not_found' }, { status: 404 });
  }
  const server = getMcpServerStore().list().find((entry) => hostedMcpConnectionId(entry) === body.id);
  if (server) {
    // The MCP store is authoritative. Remove it too, otherwise a rebuild resurrects the connection.
    if (!await removeMcpServer(server, getMcpServerStore(), connections, getIntegrationOwnerId())) {
      return reply({ error: 'not_found' }, { status: 404 });
    }
    invalidateIntegrationRuntime();
  } else if (stored && (getHostedMcpProvider(stored.connection.providerId) || !PROVIDER_CATALOG.some((provider) => provider.id === stored.connection.providerId))) {
    await connections.delete(body.id); // A pre-MCP connection may have no registered provider now.
    invalidateIntegrationRuntime();
  } else {
    await (await getIntegrationRuntime()).disconnectConnection(body.id);
  }
  // Notifier cascade (spec §2.13): drop any notification channels that delivered through it.
  deleteChannelsForConnection(body.id);
  return reply({ ok: true });
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "id": rpcZ.string().optional() }).strict().default({}) }).strict();
