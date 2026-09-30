import { NextRequest } from 'next/server';
import { withCompression } from '@/lib/api/compression';
import {
  getMcpServerStore, getMcpOAuthRedirectUrl,
} from '@/lib/connectors/runtime';
import { completeMcpAuthorization } from '@/lib/connectors/mcp-authorization';
import { oauthReturnRedirect, takeOAuthReturn } from '@/lib/connectors/oauth-return';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { usesRegisteredOAuth } from '@/lib/connectors/hosted-oauth-config';
import { timingSafeEqual } from 'node:crypto';

/**
 * OAuth redirect target for an MCP server (public — see proxy PUBLIC_PATHS). The authorization
 * server sends the browser here with `?code&state`. Registered built-in slugs resolve to their
 * current server ID. The SDK provider retains the selected client and PKCE verifier, so `finishMcpOAuth`
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
  const servers = getMcpServerStore();
  const builtin = sid.startsWith('builtin_') ? getHostedMcpProvider(sid.slice('builtin_'.length)) : undefined;
  const candidates = builtin && usesRegisteredOAuth(builtin)
    ? servers.list().filter(server => server.providerId === builtin.id && server.auth.kind === 'oauth')
    : [];
  // A registered app has one stable callback for all its accounts. The sealed,
  // one-use state binds this response to exactly the setup which initiated it.
  const matching = state ? (await Promise.all(candidates.map(async candidate => {
    const candidateState = (await servers.getOAuthState(candidate.id))?.authorizationState;
    if (typeof candidateState !== 'string') return null;
    const supplied = Buffer.from(state);
    const expected = Buffer.from(candidateState);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? candidate : null;
  }))).filter(candidate => candidate !== null) : [];
  const entry = builtin && usesRegisteredOAuth(builtin)
    ? matching.length === 1 ? matching[0] : matching.length === 0 && candidates.length === 1 ? candidates[0] : null
    : servers.get(sid);
  const serverId = entry?.id ?? sid;
  const saved = await servers.getOAuthState(serverId);
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
    if (!entry || !state || !await servers.consumeOAuthState(serverId, state)) {
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
