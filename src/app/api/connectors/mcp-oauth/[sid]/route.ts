import { NextRequest, NextResponse } from 'next/server';
import { withCompression } from '@/lib/api/compression';
import {
  getMcpServerStore,
} from '@/lib/connectors/runtime';
import { completeMcpAuthorization } from '@/lib/connectors/mcp-authorization';
import { desktopEnabled } from '@/lib/connectors/desktop-oauth';

/**
 * OAuth redirect target for an MCP server (public — see proxy PUBLIC_PATHS). The authorization
 * server sends the browser here with `?code&state`. The SDK provider (keyed by `sid`) still holds
 * the dynamically-registered client + the PKCE verifier from the initial attempt, so `finishMcpOAuth`
 * can exchange the code and save the tokens. We then rebuild the runtime to ingest the now-authorized
 * server's tools and bounce back to the Connectors pane.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest, { params }: { params: Promise<{ sid: string }> }) {
  if (desktopEnabled()) return new Response('Use the desktop sign-in callback', { status: 404 });
  const { sid } = await params;
  const url = new URL(request.url);
  const back = new URL('/?settings=connectors', url.origin);

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const entry = getMcpServerStore().get(sid);

  if (error) {
    if (!state || !await getMcpServerStore().consumeOAuthState(sid, state)) {
      back.searchParams.set('error', 'invalid_state');
      return NextResponse.redirect(back);
    }
    back.searchParams.set('error', 'authorization_cancelled');
    return NextResponse.redirect(back);
  }
  if (!entry) {
    back.searchParams.set('error', 'unknown_mcp_server');
    return NextResponse.redirect(back);
  }
  if (!code || !state) {
    back.searchParams.set('error', 'missing_code');
    return NextResponse.redirect(back);
  }

  try {
    await completeMcpAuthorization(entry, code, state);
    back.searchParams.set('connected', entry.displayName);
  } catch (e) {
    console.error('[connectors] MCP OAuth callback failed', e instanceof Error ? e.name : 'Error');
    back.searchParams.set('error', 'authorization_failed');
  }
  return NextResponse.redirect(back);
}
