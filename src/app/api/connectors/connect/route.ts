import { NextRequest, NextResponse } from 'next/server';
import { isAuthConfigRequiredError, isConnectorError } from '@connectors/engine';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { getConnectorRuntime, getConnectorConnectionStore, getConnectorOwnerId, getMcpServerStore, invalidateConnectorRuntime, selectHostedOAuthConfig, withHostedOAuthConfigLock } from '@/lib/connectors/runtime';
import { ensureHostedMcpServer, hostedAccountSelection, resolveHostedMcpAccount } from '@/lib/connectors/hosted-mcp';
import { beginMcpAuthorization } from '@/lib/connectors/mcp-authorization';
import { isDesktopRequest, desktopOAuth, desktopRelayFor, type DesktopOAuthFlow } from '@/lib/connectors/desktop-oauth';
import { rememberOAuthReturn, safeReturnPath } from '@/lib/connectors/oauth-return';
import { usesRegisteredOAuth } from '@/lib/connectors/hosted-oauth-config';

/**
 * Start an OAuth connect for a provider. Returns the provider authorization URL; the client
 * navigates the browser to it. (We return the URL via an authed fetch rather than 302-ing here,
 * so only the *callback* needs to be a public path.)
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    providerId?: unknown;
    scopes?: unknown;
    label?: unknown;
    existingConnectionId?: unknown;
    authConfigId?: unknown;
    returnTo?: unknown;
    endpointId?: unknown;
    instanceUrl?: unknown;
    serverId?: unknown;
    addAccount?: unknown;
    setupId?: unknown;
  };
  const providerId = typeof body.providerId === 'string' ? body.providerId : 'google';
  // Where the OAuth callback should land the browser afterwards. Same-origin
  // paths only (single leading slash). Anything else is ignored, and the
  // callback falls back to the connectors settings pane.
  const returnTo = safeReturnPath(body.returnTo);
  let desktopFlow: DesktopOAuthFlow | undefined;
  try {
    const hosted = getHostedMcpProvider(providerId);
    if (hosted) {
      if (hosted.auth && hosted.auth.kind !== 'oauth') {
        return NextResponse.json({ error: hosted.auth.kind === 'bearer' ? 'This connector uses a connection token. Connect it from Settings.' : 'This connector does not use browser sign-in. Connect it from Settings.' }, { status: 400 });
      }
      const selection = hostedAccountSelection(body);
      const existing = await resolveHostedMcpAccount(hosted, getMcpServerStore(), getConnectorConnectionStore(), getConnectorOwnerId(), selection);
      const selectedId = typeof body.authConfigId === 'string' ? body.authConfigId : existing?.authConfigId;
      if (existing?.authConfigId && selectedId !== existing.authConfigId) throw new Error('Disconnect this connector before changing its OAuth app.');
      const registered = usesRegisteredOAuth(hosted);
      const selected = registered ? await selectHostedOAuthConfig(providerId, selectedId) : undefined;
      const create = async () => {
        // Resolve again under the same lock used by app deletion.
        if (selected) await selectHostedOAuthConfig(providerId, selected.config.id);
        return ensureHostedMcpServer(hosted, getMcpServerStore(), getConnectorConnectionStore(), getConnectorOwnerId(), {
          ...selection,
          endpointId: body.endpointId, instanceUrl: body.instanceUrl,
          ...(selected ? { authConfigId: selected.config.id } : {}),
        });
      };
      const entry = selected ? await withHostedOAuthConfigLock(selected.config.id, create) : await create();
      const result = await beginMcpAuthorization(entry, request, returnTo ?? undefined);
      invalidateConnectorRuntime();
      return NextResponse.json({ ...result, serverId: entry.id, ...('authUrl' in result ? { authorizationUrl: result.authUrl } : {}) });
    }
    const runtime = await getConnectorRuntime();
    if (isDesktopRequest(request)) {
      const provider = runtime.getProviders().find((p) => p.id === providerId);
      if (!provider?.auth.oauth) throw new Error('This provider does not support OAuth sign-in');
      desktopFlow = await desktopOAuth().begin(`connector:${providerId}`, {
        returnTo,
        relayUrl: desktopRelayFor(providerId, provider.auth.oauth.usePkce ?? false),
      });
    }
    const result = await runtime.beginAuth(providerId, {
      callbackChannel: desktopFlow ? 'desktop' : 'web',
      ...(desktopFlow ? { redirectUri: desktopFlow.redirectUri } : {}),
      scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
      existingConnectionId: typeof body.existingConnectionId === 'string' ? body.existingConnectionId : undefined,
      // Connect through a SPECIFIC auth client (BYO work/personal); else §4a default resolves.
      authConfigId: typeof body.authConfigId === 'string' ? body.authConfigId : undefined,
    });
    desktopFlow?.arm(result.requestId, async (params) => {
      const metadata = Object.fromEntries([...params].filter(([key]) => !['code', 'state', 'error'].includes(key)));
      await runtime.completeAuth({ code: params.get('code')!, state: params.get('state')!, params: metadata, expectedChannel: 'desktop' });
    });
    // The callback returns the browser to this page's origin (see oauth-return.ts).
    if (!desktopFlow) rememberOAuthReturn(result.requestId, request, returnTo);
    return NextResponse.json({ ...result, ...(desktopFlow ? { desktopFlowId: desktopFlow.id } : {}) });
  } catch (e) {
    desktopFlow?.cancel();
    // A multi-client provider with no resolvable default surfaces a picker — relay the choices.
    if (isAuthConfigRequiredError(e)) {
      return NextResponse.json({ error: 'auth_config_required', choices: e.choices }, { status: 409 });
    }
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}
