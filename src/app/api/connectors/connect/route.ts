import { NextRequest, NextResponse } from 'next/server';
import { isAuthConfigRequiredError, isConnectorError } from '@connectors/engine';
import { getConnectorRuntime } from '@/lib/connectors/runtime';

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
  try {
    const result = await (await getConnectorRuntime()).beginAuth(providerId, {
      scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
      existingConnectionId: typeof body.existingConnectionId === 'string' ? body.existingConnectionId : undefined,
      // Connect through a SPECIFIC auth client (BYO work/personal); else §4a default resolves.
      authConfigId: typeof body.authConfigId === 'string' ? body.authConfigId : undefined,
    });
    const res = NextResponse.json(result);
    if (returnTo) {
      res.cookies.set('connector_return_to', returnTo, {
        path: '/',
        maxAge: 600,
        httpOnly: true,
        sameSite: 'lax',
      });
    }
    return res;
  } catch (e) {
    // A multi-client provider with no resolvable default surfaces a picker — relay the choices.
    if (isAuthConfigRequiredError(e)) {
      return NextResponse.json({ error: 'auth_config_required', choices: e.choices }, { status: 409 });
    }
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}
