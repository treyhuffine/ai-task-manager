import { NextRequest } from 'next/server';
import { isIntegrationError } from '@integrations/engine';
import { getIntegrationRuntime } from '@/lib/integrations/runtime';
import { withCompression } from '@/lib/api/compression';
import { oauthReturnRedirect, takeOAuthReturn } from '@/lib/integrations/oauth-return';
import { runAuthCompleted } from '@/lib/integrations/begin-connect';

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
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const back = takeOAuthReturn(state);
  const redirect = (result: Record<string, string>) => oauthReturnRedirect(back, result);

  const error = url.searchParams.get('error');
  if (error) {
    const valid = state && await (await getIntegrationRuntime()).cancelAuth(state, 'web');
    return redirect({ error: valid ? 'authorization_cancelled' : 'invalid_state' });
  }
  if (!code || !state) return redirect({ error: 'missing_code_or_state' });

  // Some providers return extra metadata on the redirect (e.g. Intuit's `realmId`). Forward
  // every non-reserved query param so the provider's identify() can capture it on the connection.
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'code' && k !== 'state' && k !== 'error') params[k] = v;
  }

  try {
    const connection = await (await getIntegrationRuntime()).completeAuth({ code, state, params, expectedChannel: 'web' });
    // Whatever the connect start asked for next (a Connect card recording itself, say).
    await runAuthCompleted(state, connection);
    return redirect({ connected: connection.email ?? connection.accountId });
  } catch (e) {
    // Map to a coarse code — never put the raw error (which may carry request detail) into the
    // redirect URL, where it would land in browser history / referrer / server logs.
    const errorCode = isIntegrationError(e) ? e.code : 'connect_failed';
    console.error(`[integrations] completeAuth failed`, e);
    return redirect({ error: errorCode });
  }
}
