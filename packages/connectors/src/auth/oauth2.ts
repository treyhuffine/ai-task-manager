/**
 * The OAuth2 authorization-code (+ PKCE) strategy (§9). Pure transport over an
 * injectable `fetch`: builds the authorization URL, exchanges the code, and
 * refreshes. It never touches storage, the clock, or the connection model — the
 * runtime owns those. Refresh failures are classified as `revoked` (definitive →
 * `needs_reauth`) vs transient (network/5xx → retry later), since only the former
 * should tear down a connection.
 */
import type {
  AuthStrategy,
  BuildAuthorizationUrlInput,
  Credentials,
  ExchangeCodeInput,
  OAuthFlow,
  RefreshInput,
  RevokeInput,
  TokenSet,
} from '../core/types';

export interface OAuth2Config {
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  usePkce?: boolean;
  /** Extra authorization-URL params, e.g. `{ access_type: 'offline', prompt: 'consent' }`. */
  authParams?: Record<string, string>;
  /**
   * Delimiter for the `scope` authorization-URL param. Default `' '` (RFC 6749). Some providers
   * diverge — Slack's authorize endpoint wants comma-separated scopes (`scopeSeparator: ','`).
   */
  scopeSeparator?: string;
  /**
   * Escape hatch for providers whose token response doesn't match the standard
   * `{ access_token, refresh_token, expires_in, scope }` shape — remap it here. Whatever it returns
   * overrides the standard fields; the original response is still preserved on `TokenSet.raw`.
   * (e.g. Slack v2 nests the user token under `authed_user.access_token`.)
   */
  mapTokenResponse?: (raw: unknown) => { accessToken?: string; refreshToken?: string; expiresInMs?: number; scope?: string };
  /** How client credentials reach the token endpoint. Default `client_secret_post`. */
  tokenAuthMethod?: 'client_secret_post' | 'client_secret_basic' | 'none';
  /** Statuses (beyond 401) that mean "expired" for this provider. Default `[401]`. */
  refreshableStatuses?: number[];
  /**
   * OAuth `error` codes that mean the grant is definitively gone (→ `needs_reauth`).
   * Default `['invalid_grant']` (RFC 6749 §5.2). Everything else — transport errors,
   * 429/408, 5xx, `invalid_request`, etc. — is treated as TRANSIENT so a rate-limited
   * or flaky refresh can't permanently tear down a healthy connection.
   */
  revocationErrors?: string[];
  /** Injectable fetch (tests). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export class OAuthRefreshError extends Error {
  /** True for definitive failures (invalid_grant / revoked) → flip to needs_reauth. */
  readonly revoked: boolean;
  readonly status?: number;
  constructor(message: string, opts: { revoked: boolean; status?: number; cause?: unknown }) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'OAuthRefreshError';
    this.revoked = opts.revoked;
    this.status = opts.status;
  }
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

export function oauth2(config: OAuth2Config): AuthStrategy {
  const fetchImpl = config.fetch ?? fetch;
  const usePkce = config.usePkce ?? false;
  const tokenAuthMethod = config.tokenAuthMethod ?? 'client_secret_post';
  const refreshableStatuses = config.refreshableStatuses ?? [401];
  const revocationErrors = config.revocationErrors ?? ['invalid_grant'];
  const scopeSeparator = config.scopeSeparator ?? ' ';

  async function tokenEndpoint(
    params: Record<string, string>,
    clientId: string,
    clientSecret: string | undefined,
  ): Promise<{ ok: boolean; status: number; json: TokenEndpointResponse }> {
    const body = new URLSearchParams(params);
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (tokenAuthMethod === 'client_secret_basic' && clientSecret) {
      headers.Authorization = basicAuthHeader(clientId, clientSecret);
    } else if (tokenAuthMethod !== 'none') {
      body.set('client_id', clientId);
      if (clientSecret) body.set('client_secret', clientSecret);
    } else {
      body.set('client_id', clientId);
    }
    const res = await fetchImpl(config.tokenUrl, { method: 'POST', headers, body });
    let json: TokenEndpointResponse = {};
    try {
      json = (await res.json()) as TokenEndpointResponse;
    } catch {
      /* tolerate empty/non-JSON bodies */
    }
    return { ok: res.ok, status: res.status, json };
  }

  function toTokenSet(json: TokenEndpointResponse): TokenSet {
    // A provider-specific remap (nested/renamed fields) overrides the standard shape; raw is kept.
    const mapped = config.mapTokenResponse?.(json);
    const accessToken = mapped?.accessToken ?? json.access_token;
    if (!accessToken) throw new Error('token endpoint returned no access_token');
    const scope = mapped?.scope ?? json.scope;
    return {
      accessToken,
      refreshToken: mapped?.refreshToken ?? json.refresh_token,
      expiresInMs: mapped?.expiresInMs ?? (typeof json.expires_in === 'number' ? json.expires_in * 1000 : undefined),
      ...(scope !== undefined ? { scope } : {}),
      raw: json,
    };
  }

  const oauth: OAuthFlow = {
    usePkce,
    refreshableStatuses,

    buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
      const u = new URL(config.authorizationUrl);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('client_id', input.clientId);
      u.searchParams.set('redirect_uri', input.redirectUri);
      u.searchParams.set('scope', input.scopes.join(scopeSeparator));
      u.searchParams.set('state', input.state);
      if (usePkce && input.codeChallenge) {
        u.searchParams.set('code_challenge', input.codeChallenge);
        u.searchParams.set('code_challenge_method', 'S256');
      }
      for (const [k, v] of Object.entries(config.authParams ?? {})) u.searchParams.set(k, v);
      return u.toString();
    },

    async exchangeCode(input: ExchangeCodeInput): Promise<TokenSet> {
      const params: Record<string, string> = {
        grant_type: 'authorization_code',
        code: input.code,
        redirect_uri: input.redirectUri,
      };
      if (usePkce && input.codeVerifier) params.code_verifier = input.codeVerifier;
      const { ok, status, json } = await tokenEndpoint(params, input.clientId, input.clientSecret);
      if (!ok) {
        throw new Error(`token exchange failed (${status}): ${json.error ?? 'unknown_error'}`);
      }
      return toTokenSet(json);
    },

    async refresh(input: RefreshInput): Promise<TokenSet> {
      let result: { ok: boolean; status: number; json: TokenEndpointResponse };
      try {
        result = await tokenEndpoint(
          { grant_type: 'refresh_token', refresh_token: input.refreshToken },
          input.clientId,
          input.clientSecret,
        );
      } catch (cause) {
        // Network/transport failure — transient, do not tear down the connection.
        throw new OAuthRefreshError('refresh request failed', { revoked: false, cause });
      }
      if (result.ok) return toTokenSet(result.json);
      // Only a declared revocation error (default `invalid_grant`) tears down the connection.
      // Status alone is NOT definitive: a 429 (rate-limited), 408, or transient 4xx must not
      // flip a healthy connection to needs_reauth — that's an availability bug, worse under load.
      const definitive = revocationErrors.includes(result.json.error ?? '');
      throw new OAuthRefreshError(`refresh failed (${result.status}): ${result.json.error ?? 'unknown'}`, {
        revoked: definitive,
        status: result.status,
      });
    },

    ...(config.revokeUrl
      ? {
          async revoke(input: RevokeInput): Promise<void> {
            const headers: Record<string, string> = {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
            };
            const body = new URLSearchParams({ token: input.token });
            if (tokenAuthMethod === 'client_secret_basic' && input.clientSecret) {
              headers.Authorization = basicAuthHeader(input.clientId, input.clientSecret);
            } else {
              body.set('client_id', input.clientId);
              if (input.clientSecret) body.set('client_secret', input.clientSecret);
            }
            await fetchImpl(config.revokeUrl as string, { method: 'POST', headers, body });
          },
        }
      : {}),
  };

  return {
    kind: 'oauth2',
    oauth,
    applyAuth(creds: Credentials, req: { headers: Record<string, string> }): void {
      if (creds.type !== 'oauth2') throw new Error('oauth2 strategy received non-oauth2 credentials');
      req.headers.Authorization = `Bearer ${creds.accessToken}`;
    },
    tokenOf(creds: Credentials): string {
      if (creds.type !== 'oauth2') throw new Error('oauth2 strategy received non-oauth2 credentials');
      return creds.accessToken;
    },
  };
}
