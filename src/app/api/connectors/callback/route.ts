import { NextRequest, NextResponse } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getConnectorRuntime } from '@/lib/connectors/runtime';

/**
 * OAuth redirect target (public — see proxy PUBLIC_PATHS). The provider sends the
 * browser here with `?code&state`; we complete the exchange and bounce back to the
 * Connectors settings pane with a result query (`?connected=` / `?error=`).
 * Security is the single-use `state` validated against the stored AuthRequest
 * inside `completeAuth`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  // A connect started with `returnTo` (e.g. onboarding) parks the destination
  // in a short-lived cookie — honor it (same-origin paths only), else land on
  // the connectors settings pane.
  const returnTo = request.cookies.get('connector_return_to')?.value;
  const backPath =
    returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')
      ? returnTo
      : '/?settings=connectors';
  const back = new URL(backPath, url.origin);
  const redirect = (target: URL) => {
    const res = NextResponse.redirect(target);
    res.cookies.delete('connector_return_to');
    return res;
  };

  const error = url.searchParams.get('error');
  if (error) {
    back.searchParams.set('error', error);
    return redirect(back);
  }

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    back.searchParams.set('error', 'missing_code_or_state');
    return redirect(back);
  }

  // Some providers return extra metadata on the redirect (e.g. Intuit's `realmId`). Forward
  // every non-reserved query param so the provider's identify() can capture it on the connection.
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k !== 'code' && k !== 'state' && k !== 'error') params[k] = v;
  }

  try {
    const connection = await (await getConnectorRuntime()).completeAuth({ code, state, params });
    back.searchParams.set('connected', connection.email ?? connection.accountId);
    return redirect(back);
  } catch (e) {
    // Map to a coarse code — never put the raw error (which may carry request detail) into the
    // redirect URL, where it would land in browser history / referrer / server logs.
    const code = isConnectorError(e) ? e.code : 'connect_failed';
    console.error('[connectors] completeAuth failed', e);
    back.searchParams.set('error', code);
    return redirect(back);
  }
}
