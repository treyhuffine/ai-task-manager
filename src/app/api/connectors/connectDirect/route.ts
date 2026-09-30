import { NextRequest, NextResponse } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { getConnectorRuntime, buildCredential, getConnectorConnectionStore, getConnectorOwnerId, getMcpServerStore, invalidateConnectorRuntime } from '@/lib/connectors/runtime';
import { ensureHostedMcpServer, hostedAccountSelection, hostedMcpConnectionId, hostedMcpDefinition } from '@/lib/connectors/hosted-mcp';

/**
 * Connect a non-OAuth provider (API key / custom) from pasted credential fields. The route maps
 * the posted `fields` to the engine credential shape the provider's strategy expects, then runs
 * `connectDirect` (which validates the shape, runs identify() if any, seals, and stores).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    providerId?: unknown;
    fields?: unknown;
    label?: unknown;
    endpointId?: unknown;
    instanceUrl?: unknown;
    existingConnectionId?: unknown;
    serverId?: unknown;
    addAccount?: unknown;
    setupId?: unknown;
  };
  const providerId = typeof body.providerId === 'string' ? body.providerId : '';
  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 });
  const hosted = getHostedMcpProvider(providerId);
  if (hosted && (!hosted.auth || hosted.auth.kind === 'oauth')) {
    return NextResponse.json({ error: 'This connector uses browser sign-in. Connect it from Settings.' }, { status: 400 });
  }
  const fields =
    body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, string>) : {};

  if (hosted) {
    const token = typeof fields.token === 'string' ? fields.token.trim() : '';
    if (hosted.auth?.kind === 'bearer' && !token) return NextResponse.json({ error: 'A connection token is required.' }, { status: 400 });
    if (hosted.auth?.kind === 'none' && Object.keys(fields).length > 0) return NextResponse.json({ error: 'This connector does not accept credentials.' }, { status: 400 });
    try {
      const servers = getMcpServerStore();
      const entry = await ensureHostedMcpServer(hosted, servers, getConnectorConnectionStore(), getConnectorOwnerId(), {
        ...hostedAccountSelection(body),
        ...(token ? { secret: token } : {}), endpointId: body.endpointId, instanceUrl: body.instanceUrl,
      });
      invalidateConnectorRuntime();
      await getConnectorRuntime();
      // The authoritative row may have been removed or its credential replaced
      // while discovery was running. Never report that stale attempt as connected.
      const current = servers.get(entry.id);
      if (!current?.enabled || current.credentialRevision !== entry.credentialRevision) {
        return NextResponse.json({ error: 'The connection changed. Try connecting again.' }, { status: 409 });
      }
      hostedMcpDefinition(current);
      if (current.lastStatus !== 'ok') {
        const detail = current.lastError ?? `Could not connect to ${hosted.displayName}. Check the connection settings and try again.`;
        return NextResponse.json({ error: token ? detail.split(token).join('[REDACTED]') : detail }, { status: 400 });
      }
      const stored = await getConnectorConnectionStore().get(hostedMcpConnectionId(current));
      if (!stored || stored.connection.ownerId !== getConnectorOwnerId()) return NextResponse.json({ error: 'The connector was disconnected. Try connecting again.' }, { status: 409 });
      return NextResponse.json({ connection: stored.connection });
    } catch (error) {
      // Token bytes must never be reflected into a response, including errors
      // raised by an unavailable credential store or transport.
      const message = isConnectorError(error) ? error.code : error instanceof Error ? error.message : 'Could not connect the service.';
      return NextResponse.json({ error: token ? message.split(token).join('[REDACTED]') : message }, { status: 400 });
    }
  }

  const runtime = await getConnectorRuntime();
  const provider = runtime.getProviders().find((p) => p.id === providerId);
  if (!provider) return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });

  try {
    const credential = buildCredential(provider.auth.kind, fields);
    const connection = await runtime.connectDirect(providerId, {
      credential,
      label: typeof body.label === 'string' ? body.label : undefined,
    });
    return NextResponse.json({ connection });
  } catch (e) {
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}
