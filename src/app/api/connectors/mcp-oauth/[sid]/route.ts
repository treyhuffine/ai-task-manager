import { NextRequest, NextResponse } from 'next/server';
import { finishMcpOAuth } from '@connectors/engine/mcp';
import { withCompression } from '@/lib/api/compression';
import {
  getMcpServerStore,
  getConnectorRuntime,
  invalidateConnectorRuntime,
  mcpOAuthProviderFor,
} from '@/lib/connectors/runtime';

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
  const { sid } = await params;
  const url = new URL(request.url);
  const back = new URL('/?settings=connectors', url.origin);

  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const entry = getMcpServerStore().get(sid);

  if (error) {
    back.searchParams.set('error', error);
    return NextResponse.redirect(back);
  }
  if (!entry) {
    back.searchParams.set('error', 'unknown_mcp_server');
    return NextResponse.redirect(back);
  }
  if (!code) {
    back.searchParams.set('error', 'missing_code');
    return NextResponse.redirect(back);
  }

  try {
    await finishMcpOAuth({ url: entry.url, authProvider: mcpOAuthProviderFor(entry), authorizationCode: code });
    invalidateConnectorRuntime();
    await getConnectorRuntime(); // force a rebuild so the tools are ingested before the UI loads
    back.searchParams.set('connected', entry.displayName);
  } catch (e) {
    console.error('[connectors] MCP OAuth callback failed', e);
    back.searchParams.set('error', e instanceof Error ? e.message : 'authorization_failed');
  }
  return NextResponse.redirect(back);
}
