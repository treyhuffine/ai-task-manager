import { NextRequest, NextResponse } from 'next/server';
import { getHostedMcpProvider, PROVIDER_CATALOG } from '@connectors/engine/providers';
import { getConnectorRuntime, getConnectorConnectionStore, getConnectorOwnerId, getMcpServerStore, invalidateConnectorRuntime } from '@/lib/connectors/runtime';
import { hostedMcpConnectionId } from '@/lib/connectors/hosted-mcp';
import { removeMcpServer } from '@/lib/connectors/mcp-lifecycle';
import { deleteChannelsForConnection } from '@/lib/db/queries';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  const connections = getConnectorConnectionStore();
  const stored = await connections.get(body.id);
  if (stored && stored.connection.ownerId !== getConnectorOwnerId()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const server = getMcpServerStore().list().find((entry) => hostedMcpConnectionId(entry) === body.id);
  if (server) {
    // The MCP store is authoritative. Remove it too, otherwise a rebuild resurrects the connection.
    if (!await removeMcpServer(server, getMcpServerStore(), connections, getConnectorOwnerId())) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
    invalidateConnectorRuntime();
  } else if (stored && (getHostedMcpProvider(stored.connection.providerId) || !PROVIDER_CATALOG.some((provider) => provider.id === stored.connection.providerId))) {
    await connections.delete(body.id); // A pre-MCP connection may have no registered provider now.
    invalidateConnectorRuntime();
  } else {
    await (await getConnectorRuntime()).disconnectConnection(body.id);
  }
  // Notifier cascade (spec §2.13): drop any notification channels that delivered through it.
  deleteChannelsForConnection(body.id);
  return NextResponse.json({ ok: true });
}
