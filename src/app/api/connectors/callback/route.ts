import { NextRequest } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';
import { desktopEnabled } from '@/lib/connectors/desktop-oauth';
import { oauthReturnRedirect, takeOAuthReturn } from '@/lib/connectors/oauth-return';

/**
 * OAuth redirect target (public — see proxy PUBLIC_PATHS). The provider sends the
 * browser here with `?code&state`; we complete the exchange and bounce back to the
 * page that started the connect (its origin and `returnTo`, recorded against the
 * `state`, see oauth-return.ts) with a result query (`?connected=` / `?error=`).
 * Security is the single-use `state` validated against the stored AuthRequest
 * inside `completeAuth`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  // Desktop attempts complete only through their temporary listener or the
  // authenticated deep-link endpoint, including cancellation/replay checks.
  if (desktopEnabled()) return new Response('Use the desktop sign-in callback', { status: 404 });
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const back = takeOAuthReturn(state);
  const redirect = (result: Record<string, string>) => oauthReturnRedirect(back, result);

  const error = url.searchParams.get('error');
  if (error) return redirect({ error });
  if (!code || !state) return redirect({ error: 'missing_code_or_state' });

  // Some providers return extra metadata on the redirect (e.g. Intuit's `realmId`). Forward
  // every non-reserved query param so the provider's identify() can capture it on the connection.
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'code' && k !== 'state' && k !== 'error') params[k] = v;
  }

  try {
    const connection = await (await getConnectorRuntime()).completeAuth({ code, state, params });
    return redirect({ connected: connection.email ?? connection.accountId });
  } catch (e) {
    // Map to a coarse code — never put the raw error (which may carry request detail) into the
    // redirect URL, where it would land in browser history / referrer / server logs.
    const errorCode = isConnectorError(e) ? e.code : 'connect_failed';
    console.error('[connectors] completeAuth failed', e);
    return redirect({ error: errorCode });
  }
}
