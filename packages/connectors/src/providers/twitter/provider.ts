/**
 * The X (Twitter) auth provider — OAuth2 user-context over the X API v2. One consent backs the
 * single `twitter` toolkit (every v2 endpoint). Identity comes from `GET /2/users/me`.
 *
 * Auth note: XMCP signs requests with OAuth1.0a; we deliberately use the spec's OAuth2 user-token
 * scheme instead, because the engine does OAuth2 + automatic refresh natively and it covers every
 * v2 endpoint. X confidential clients authenticate to the token endpoint with HTTP Basic and use
 * PKCE; `offline.access` (an always-requested identity scope) is what makes X issue a refresh token
 * (access tokens otherwise expire in ~2h with nothing for the engine to refresh).
 */
import { oauth2 } from '../../auth/oauth2';
import { defineProvider } from '../../core/authoring';
import type { AuthedHttp, Provider } from '../../core/types';

export interface TwitterProviderOptions {
  /** Injectable fetch for the token/revoke endpoints (tests). */
  fetch?: typeof fetch;
}

const REVOKE_URL = 'https://api.x.com/2/oauth2/revoke';

interface MeResponse {
  data?: { id?: string; username?: string; name?: string };
}

export function twitter(options: TwitterProviderOptions = {}): Provider {
  return defineProvider({
    id: 'twitter',
    displayName: 'X (Twitter)',
    baseUrl: 'https://api.x.com',
    // Always requested: identify() needs users.read; tweet.read is the baseline read scope; and
    // offline.access is required for X to mint a refresh token (the engine's auto-refresh needs it).
    identityScopes: ['users.read', 'tweet.read', 'offline.access'],
    revokeUrl: REVOKE_URL,
    auth: oauth2({
      authorizationUrl: 'https://x.com/i/oauth2/authorize',
      tokenUrl: 'https://api.x.com/2/oauth2/token',
      revokeUrl: REVOKE_URL,
      usePkce: true,
      // X confidential clients send client credentials as HTTP Basic on the token endpoint.
      tokenAuthMethod: 'client_secret_basic',
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    async identify(http: AuthedHttp) {
      const res = await http.get<MeResponse>('/2/users/me');
      const u = res.data;
      if (!u?.id) throw new Error('twitter identify: /2/users/me returned no id');
      return {
        accountId: u.id,
        label: u.username ? `@${u.username}` : (u.name ?? u.id),
      };
    },
  });
}
