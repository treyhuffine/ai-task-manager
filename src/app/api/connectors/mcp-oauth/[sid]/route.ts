import { NextRequest } from 'next/server';
import { withCompression } from '@/lib/api/compression';
import {
  getMcpServerStore, getMcpOAuthRedirectUrl,
} from '@/lib/connectors/runtime';
import { completeMcpAuthorization } from '@/lib/connectors/mcp-authorization';
import { oauthReturnRedirect, takeOAuthReturn } from '@/lib/connectors/oauth-return';

/**
 * OAuth redirect target for an MCP server (public — see proxy PUBLIC_PATHS). The authorization
 * server sends the browser here with `?code&state`. The SDK provider (keyed by `sid`) still holds
 * the dynamically-registered client + the PKCE verifier from the initial attempt, so `finishMcpOAuth`
 * can exchange the code and save the tokens. We then rebuild the runtime to ingest the now-authorized
 * server's tools and bounce back to the Connectors pane, on the origin the add started from
 * (see oauth-return.ts).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const entry = getMcpServerStore().get(sid);
  const saved = await getMcpServerStore().getOAuthState(sid);
  // Bind the flow to its initiating client, not the current public URL. A web
  // sign-in can still finish after the configured tunnel address changes.
  // Untagged state from older installations retains the previous URI check.
  const wrongChannel = saved?.callbackChannel !== undefined
    ? saved.callbackChannel !== 'web'
    : saved?.redirectUri && saved.redirectUri !== getMcpOAuthRedirectUrl(sid);
  if (wrongChannel) {
    return new Response('This authorization belongs to the desktop callback', { status: 400 });
  }
  const back = takeOAuthReturn(state);
  const redirect = (result: Record<string, string>) => oauthReturnRedirect(back, result);

  if (error) {
    if (!state || !await getMcpServerStore().consumeOAuthState(sid, state)) {
      return redirect({ error: 'invalid_state' });
    }
    return redirect({ error: 'authorization_cancelled' });
  }
  if (!entry) return redirect({ error: 'unknown_mcp_server' });
  if (!code || !state) return redirect({ error: 'missing_code' });

  try {
    await completeMcpAuthorization(entry, code, state);
    return redirect({ connected: entry.displayName });
  } catch (e) {
    console.error('[connectors] MCP OAuth callback failed', e instanceof Error ? e.name : 'Error');
    return redirect({ error: 'authorization_failed' });
  }
}
