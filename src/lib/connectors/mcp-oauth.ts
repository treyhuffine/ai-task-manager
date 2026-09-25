/**
 * `OAuthClientProvider` for OAuth-protected MCP servers (docs/connectors-mcp-ingest-spec.md §12, #1).
 *
 * The MCP SDK's Streamable HTTP transport drives the whole OAuth flow when given an
 * `OAuthClientProvider`: it discovers the protected-resource + authorization-server metadata,
 * dynamically registers a client (RFC 7591), runs the auth-code + PKCE exchange, and refreshes the
 * access token on 401 — calling back into this provider only to *persist/load* state and to hand us
 * the authorization URL to redirect the user to.
 *
 * So OAuth lives entirely at the transport layer; the engine ingest stays auth-agnostic (it just
 * gets a connected client). This provider persists the SDK's state (client registration, tokens,
 * PKCE verifier) SEALED via the MCP-server store. Types are imported type-only, so there is no
 * runtime dependency on the SDK here (no ESM/boot coupling).
 */
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { randomBytes } from 'node:crypto';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export interface McpOAuthState {
  clientInformation?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  authorizationState?: string;
  authorizationExpiresAt?: number;
  redirectUri?: string;
}

export interface McpOAuthProviderDeps {
  /** Where the authorization server redirects back (DCR-registered; reachable by the browser). */
  redirectUrl: string;
  /** Client name presented during dynamic registration. */
  clientName: string;
  load: () => Promise<McpOAuthState>;
  save: (state: McpOAuthState) => Promise<void>;
  /** Invoked with the authorization URL when the user must be redirected to consent. */
  onRedirect?: (url: URL) => void;
  interactive?: boolean;
}

export function makeMcpOAuthProvider(deps: McpOAuthProviderDeps): OAuthClientProvider {
  let cache: McpOAuthState | null = null;
  const get = async (): Promise<McpOAuthState> => (cache ??= await deps.load());
  const put = async (next: McpOAuthState): Promise<void> => {
    cache = next;
    await deps.save(next);
  };

  return {
    get redirectUrl() {
      return deps.interactive ? deps.redirectUrl : cache?.redirectUri ?? deps.redirectUrl;
    },
    async state() {
      const state = randomBytes(32).toString('base64url');
      await put({ ...(await get()), authorizationState: state, authorizationExpiresAt: Date.now() + 10 * 60_000, redirectUri: deps.redirectUrl });
      return state;
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: deps.clientName,
        redirect_uris: [deps.redirectUrl],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // public client; auth-code + PKCE
      };
    },
    async clientInformation() {
      const saved = await get();
      // A fresh listener can have a new port. Re-register a dynamic client when
      // its registered callback changes, including web-to-desktop migration.
      if (deps.interactive && saved.redirectUri && saved.redirectUri !== deps.redirectUrl) return undefined;
      return saved.clientInformation;
    },
    async saveClientInformation(info: OAuthClientInformationMixed) {
      await put({ ...(await get()), clientInformation: info });
    },
    async tokens() {
      return deps.interactive ? undefined : (await get()).tokens;
    },
    async saveTokens(tokens: OAuthTokens) {
      const next = { ...(await get()), tokens };
      delete next.authorizationState;
      delete next.authorizationExpiresAt;
      delete next.codeVerifier;
      await put(next);
    },
    async redirectToAuthorization(url: URL) {
      deps.onRedirect?.(url);
    },
    async saveCodeVerifier(verifier: string) {
      await put({ ...(await get()), codeVerifier: verifier });
    },
    async codeVerifier() {
      const v = (await get()).codeVerifier;
      if (!v) throw new Error('no PKCE code verifier saved for this MCP server');
      return v;
    },
    async invalidateCredentials(scope) {
      const next: McpOAuthState = { ...(await get()) };
      if (scope === 'all' || scope === 'tokens') delete next.tokens;
      if (scope === 'all' || scope === 'client') delete next.clientInformation;
      if (scope === 'all' || scope === 'verifier') delete next.codeVerifier;
      await put(next);
    },
  };
}
