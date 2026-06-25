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
  };
  const providerId = typeof body.providerId === 'string' ? body.providerId : 'google';
  try {
    const result = await (await getConnectorRuntime()).beginAuth(providerId, {
      scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
      existingConnectionId: typeof body.existingConnectionId === 'string' ? body.existingConnectionId : undefined,
      // Connect through a SPECIFIC auth client (BYO work/personal); else §4a default resolves.
      authConfigId: typeof body.authConfigId === 'string' ? body.authConfigId : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    // A multi-client provider with no resolvable default surfaces a picker — relay the choices.
    if (isAuthConfigRequiredError(e)) {
      return NextResponse.json({ error: 'auth_config_required', choices: e.choices }, { status: 409 });
    }
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}
