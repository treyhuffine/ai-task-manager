/**
 * Where Ri's OAuth lives (docs/mcp-oauth.md). A Home answers on two origins:
 * its saved remote address (Settings → Devices), which ChatGPT and other
 * cloud clients use, and its own local one, which agents on this computer
 * use. Each is its own issuer, because a client checks that the issuer and
 * resource it is told match the address it connected to, character for
 * character.
 */
import { getLocalBaseUrl, getRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { HOME_MCP_PATH } from '@/lib/external-ai/policy';

/** The one scope: the content tools an outside assistant may use (`HOME_CONTENT_ACTIONS`). */
export const OAUTH_SCOPE = 'content';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function originOf(raw: string | null): URL | null {
  if (!raw) return null;
  try { return new URL(raw); } catch { return null; }
}

/**
 * The issuer a request reached: the Home origin with the request's host.
 * The local address also answers as any loopback name on its port. A host
 * Ri doesn't know gets the remote address (or the local one when there is
 * none), never the caller's Host, so no request can make Ri's metadata name
 * another site.
 */
export function issuerFor(headers: Headers, requestUrl: string, bases: { remote: string | null; local: string } = { remote: getRemoteBaseUrl(), local: getLocalBaseUrl() }): string {
  const host = (headers.get('host') ?? originOf(requestUrl)?.host ?? '').toLowerCase();
  const remote = originOf(bases.remote);
  const local = originOf(bases.local);
  if (remote && remote.host === host) return remote.origin;
  if (local && local.host === host) return local.origin;
  if (local && LOOPBACK.has(local.hostname)) {
    const asked = originOf(`${local.protocol}//${host}`);
    if (asked && LOOPBACK.has(asked.hostname) && asked.port === local.port) return asked.origin;
  }
  return (remote ?? local ?? originOf(requestUrl)!).origin;
}

/** The MCP endpoint a token from this issuer is for (RFC 8707). */
export function resourceFor(issuer: string): string {
  return `${issuer}${HOME_MCP_PATH}`;
}

/** Where a client learns how to sign in to the MCP endpoint (RFC 9728, path-suffixed). */
export function protectedResourceMetadataUrl(issuer: string): string {
  return `${issuer}/.well-known/oauth-protected-resource${HOME_MCP_PATH}`;
}

/**
 * The hub (docs/personal-apps.md "The hub"): Ri's integrations endpoint, where a personal app
 * connects with its own OAuth client to borrow the person's accounts. A second resource on the
 * same authorization server. Its tokens expire and refresh, and reach nothing else.
 */
export const HUB_MCP_PATH = '/api/integrations/mcp';
export function hubResourceFor(issuer: string): string {
  return `${issuer}${HUB_MCP_PATH}`;
}
export function hubProtectedResourceMetadataUrl(issuer: string): string {
  return `${issuer}/.well-known/oauth-protected-resource${HUB_MCP_PATH}`;
}
/** No scope is advertised: an app asks for what it needs, and the person's choice on Ri's screen is the grant. */
export function hubChallenge(issuer: string, error?: 'invalid_token'): string {
  return `Bearer resource_metadata="${hubProtectedResourceMetadataUrl(issuer)}"${error ? `, error="${error}"` : ''}`;
}
/** RFC 9728 for the hub. */
export function hubProtectedResourceMetadata(issuer: string) {
  return {
    resource: hubResourceFor(issuer),
    authorization_servers: [issuer],
    bearer_methods_supported: ['header'],
    resource_name: 'Ri: your accounts for your apps',
  };
}

/** The challenge on a 401 from the MCP endpoint, which starts a client's sign-in. */
export function mcpChallenge(issuer: string, error?: 'invalid_token'): string {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl(issuer)}", scope="${OAUTH_SCOPE}"${error ? `, error="${error}"` : ''}`;
}

export const OAUTH_PATHS = {
  authorize: '/oauth/authorize',
  decide: '/api/oauth/authorize',
  token: '/api/oauth/token',
  register: '/api/oauth/register',
  revoke: '/api/oauth/revoke',
} as const;

/** Routes whose request carries its own credential (a code, a token) or none, like a provider's callback. */
export const OAUTH_PUBLIC_PATHS: ReadonlySet<string> = new Set([OAUTH_PATHS.token, OAUTH_PATHS.register, OAUTH_PATHS.revoke]);

/** RFC 8414. Only what Ri supports is advertised, so a client never picks something it can't finish. */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${issuer}${OAUTH_PATHS.token}`,
    registration_endpoint: `${issuer}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${issuer}${OAUTH_PATHS.revoke}`,
    scopes_supported: [OAUTH_SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    // Refresh tokens are issued for the hub only. Outside assistants' keys don't expire.
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    resource_parameter_supported: true,
  };
}

/** RFC 9728. */
export function protectedResourceMetadata(issuer: string) {
  return {
    resource: resourceFor(issuer),
    authorization_servers: [issuer],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Ri',
  };
}

/** Discovery and token calls come from browsers too (the MCP Inspector, web clients). None of them use cookies. */
export const OAUTH_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};
