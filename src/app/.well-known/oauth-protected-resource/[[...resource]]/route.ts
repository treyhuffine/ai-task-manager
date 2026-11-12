/**
 * RFC 9728 metadata for Ri's MCP endpoint: at the root, and suffixed with
 * the endpoint's path, which is where the 401 challenge points.
 */
import { HOME_MCP_PATH } from '@/lib/external-ai/policy';
import { HUB_MCP_PATH, hubProtectedResourceMetadata, issuerFor, protectedResourceMetadata } from '@/lib/oauth/issuer';
import { oauthPreflight, oauthResponse, teamRefusal } from '@/lib/oauth/http';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ resource?: string[] }> }) {
  const { resource } = await params;
  const path = resource?.length ? `/${resource.join('/')}` : '';
  // The hub, where personal apps borrow the person's accounts (docs/personal-apps.md).
  if (path === HUB_MCP_PATH) return teamRefusal() ?? oauthResponse({ status: 200, body: hubProtectedResourceMetadata(issuerFor(request.headers, request.url)) });
  if (path && path !== HOME_MCP_PATH) return oauthResponse({ status: 404, body: { error: 'not_found', error_description: `Ri's MCP endpoint is ${HOME_MCP_PATH}.` } });
  return teamRefusal() ?? oauthResponse({ status: 200, body: protectedResourceMetadata(issuerFor(request.headers, request.url)) });
}

export const OPTIONS = oauthPreflight;
