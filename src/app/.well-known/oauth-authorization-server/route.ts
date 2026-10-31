/** RFC 8414 discovery for Ri's MCP sign-in (docs/mcp-oauth.md). */
import { authorizationServerMetadata, issuerFor } from '@/lib/oauth/issuer';
import { oauthPreflight, oauthResponse, teamRefusal } from '@/lib/oauth/http';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  return teamRefusal() ?? oauthResponse({ status: 200, body: authorizationServerMetadata(issuerFor(request.headers, request.url)) });
}

export const OPTIONS = oauthPreflight;
