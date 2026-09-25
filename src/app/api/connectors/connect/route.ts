import { NextRequest, NextResponse } from 'next/server';
import { isAuthConfigRequiredError, isConnectorError } from '@connectors/engine';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { desktopEnabled, desktopOAuth, desktopRelayFor, type DesktopOAuthFlow } from '@/lib/connectors/desktop-oauth';

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
  };
  const providerId = typeof body.providerId === 'string' ? body.providerId : 'google';
  // Where the OAuth callback should land the browser afterwards. Same-origin
  // paths only (single leading slash) — anything else is ignored, and the
  // callback falls back to the connectors settings pane.
  const returnTo =
    typeof body.returnTo === 'string' && body.returnTo.startsWith('/') && !body.returnTo.startsWith('//')
      ? body.returnTo
      : null;
  let desktopFlow: DesktopOAuthFlow | undefined;
  try {
    const runtime = await getConnectorRuntime();
    if (desktopEnabled()) {
      const provider = runtime.getProviders().find((p) => p.id === providerId);
      if (!provider?.auth.oauth) throw new Error('This provider does not support OAuth sign-in');
      desktopFlow = await desktopOAuth().begin(`connector:${providerId}`, {
        returnTo,
        relayUrl: desktopRelayFor(providerId, provider.auth.oauth.usePkce ?? false),
      });
    }
    const result = await runtime.beginAuth(providerId, {
      ...(desktopFlow ? { redirectUri: desktopFlow.redirectUri } : {}),
      scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
      existingConnectionId: typeof body.existingConnectionId === 'string' ? body.existingConnectionId : undefined,
      // Connect through a SPECIFIC auth client (BYO work/personal); else §4a default resolves.
      authConfigId: typeof body.authConfigId === 'string' ? body.authConfigId : undefined,
    });
    desktopFlow?.arm(result.requestId, async (params) => {
      const metadata = Object.fromEntries([...params].filter(([key]) => !['code', 'state', 'error'].includes(key)));
      await runtime.completeAuth({ code: params.get('code')!, state: params.get('state')!, params: metadata });
    });
    const res = NextResponse.json({ ...result, ...(desktopFlow ? { desktopFlowId: desktopFlow.id } : {}) });
    if (returnTo && !desktopFlow) {
      res.cookies.set('connector_return_to', returnTo, {
        path: '/',
        maxAge: 600,
        httpOnly: true,
        sameSite: 'lax',
      });
    }
    return res;
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
