/**
 * `OAuthClientProvider` for OAuth-protected MCP servers (docs/integrations-mcp-ingest-spec.md §12, #1).
 *
 * The MCP SDK's Streamable HTTP transport drives the whole OAuth flow when given an
 * `OAuthClientProvider`: it discovers the protected-resource + authorization-server metadata,
 * uses a registered client or dynamically registers one (RFC 7591), runs the auth-code + PKCE
 * exchange, and refreshes the access token on 401. This provider persists authorization state and
 * supplies the authorization URL to redirect the user to.
 *
 * So OAuth lives entirely at the transport layer; the engine ingest stays auth-agnostic (it just
 * gets a connected client). This provider persists the SDK's state (discovery, dynamic client
 * registration, tokens, PKCE verifier) SEALED via the MCP-server store. Registered client secrets
 * remain in the host's credential registry. SDK types are imported type-only, so there is no
 * runtime dependency on the SDK here (no ESM/boot coupling).
 */
import { INTEGRATION_LABELS } from '@/constants/integrations';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import { createHash, randomBytes } from 'node:crypto';
import { NeedsReauthError } from '@integrations/engine';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

export interface McpOAuthState {
  /** Store-generated revision for atomic conditional writes, including legacy state without one. */
  revision?: string;
  /** A new interactive authorization supersedes every provider bound to the previous session. */
  sessionId?: string;
  clientInformation?: OAuthClientInformationMixed;
  /** Sealed identity binding for a pre-registered client, without copying its secret. */
  registeredClientFingerprint?: string;
  /** Preserve challenge-specific discovery through the browser callback's fresh transport. */
  discoveryState?: OAuthDiscoveryState;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  authorizationState?: string;
  authorizationExpiresAt?: number;
  /** Identifies the consumed consent until a newer session replaces it. */
  consumedAuthorizationId?: string;
  redirectUri?: string;
  /** Explicit client binding survives a change to the configured public URL. */
  callbackChannel?: 'web' | 'desktop';
}

export interface RegisteredMcpOAuthClient {
  clientId: string;
  clientSecret?: string;
}

export interface McpOAuthProviderDeps {
  /** Registered or dynamically registered callback, reachable by the browser. */
  redirectUrl: string;
  /** Client name presented during dynamic registration. */
  clientName: string;
  /** Trusted catalog selection for the server's OAuth client profile. */
  grantTypes?: readonly ('authorization_code' | 'refresh_token')[];
  tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
  /** Trusted host registry identity. Registered clients never fall back to DCR. */
  registeredClient?: RegisteredMcpOAuthClient | (() => Promise<RegisteredMcpOAuthClient>);
  /** Complete trusted metadata for providers without discovery, never remote/client input. */
  discoveryState?: OAuthDiscoveryState;
  /** Client scope fallback. Challenge and resource scopes retain the SDK's precedence. */
  scopes?: readonly string[];
  /** Trusted provider-specific authorization flags, never core OAuth/PKCE fields. */
  authorizationParams?: Readonly<Record<string, string>>;
  load: () => Promise<McpOAuthState>;
  compareAndSave: (expectedRevision: string | undefined, state: McpOAuthState) => Promise<McpOAuthState | null>;
  /** Invoked with the authorization URL when the user must be redirected to consent. */
  onRedirect?: (url: URL) => void;
  interactive?: boolean;
  /** Profiles with explicit preauthorization must restart consent through that interactive path. */
  requireInteractiveAuthorization?: boolean;
  callbackChannel?: 'web' | 'desktop';
  /** Register secret values on both initial load and token rotation before they can reach errors or results. */
  onState?: (state: McpOAuthState) => void;
}

export function makeMcpOAuthProvider(deps: McpOAuthProviderDeps): OAuthClientProvider {
  let cache: McpOAuthState | null = null;
  let sessionBound = false;
  let sessionId: string | undefined;
  let superseded = false;
  let clientSnapshot: McpOAuthState | null = null;
  let credentialSnapshot: McpOAuthState | null = null;
  let authorizationSnapshot: McpOAuthState | null = null;
  let registeredFingerprint: string | undefined;
  let registeredInformation: OAuthClientInformationMixed | undefined;
  const registered = deps.registeredClient !== undefined;
  const discovery = deps.discoveryState ? structuredClone(deps.discoveryState) : undefined;
  const authorizationParams = { ...deps.authorizationParams };
  const reservedAuthorizationParams = new Set([
    'client_id', 'client_secret', 'redirect_uri', 'state', 'scope', 'response_type',
    'code', 'code_challenge', 'code_challenge_method', 'resource',
  ]);
  if (Object.keys(authorizationParams).some(key => reservedAuthorizationParams.has(key))) {
    throw new Error('Provider authorization parameters cannot override core OAuth or PKCE fields.');
  }
  if (discovery && (!discovery.authorizationServerUrl || !discovery.authorizationServerMetadata || !discovery.resourceMetadata)) {
    throw new Error('Explicit MCP OAuth discovery must include authorization-server and protected-resource metadata.');
  }
  const metadata = (): OAuthClientMetadata => ({
    client_name: deps.clientName,
    redirect_uris: [deps.redirectUrl],
    grant_types: [...(deps.grantTypes ?? ['authorization_code', 'refresh_token'])],
    response_types: ['code'],
    token_endpoint_auth_method: deps.tokenEndpointAuthMethod ?? 'none',
    ...(deps.scopes ? { scope: deps.scopes.join(' ') } : {}),
  });
  const stale = (): never => {
    // The SDK may fall back from a failed refresh to authorization. Poison this
    // provider as well as rejecting the write so that fallback cannot replace
    // the newer session's client registration or PKCE state.
    superseded = true;
    throw new NeedsReauthError(undefined, 'MCP authorization changed during this request. Reconnect using the current session.');
  };
  const loadRegisteredClient = async () => {
    if (!registered) return;
    if (superseded) stale();
    const client = typeof deps.registeredClient === 'function' ? await deps.registeredClient() : deps.registeredClient!;
    const info: OAuthClientInformationMixed = {
      ...metadata(), client_id: client.clientId,
      ...(client.clientSecret !== undefined ? { client_secret: client.clientSecret } : {}),
    };
    // Redact the registry secret before configuration, binding or server errors
    // can escape. This callback does not persist a copy in the MCP store.
    deps.onState?.({ clientInformation: info });
    if (!client.clientId || (deps.tokenEndpointAuthMethod && deps.tokenEndpointAuthMethod !== 'none' && !client.clientSecret)) {
      throw new NeedsReauthError(undefined, 'The registered OAuth client configuration is incomplete. Update it before connecting.');
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({
      clientId: client.clientId, clientSecret: client.clientSecret,
      tokenEndpointAuthMethod: deps.tokenEndpointAuthMethod ?? 'none',
    })).digest('hex');
    if (registeredFingerprint && registeredFingerprint !== fingerprint) stale();
    registeredFingerprint = fingerprint;
    registeredInformation = info;
  };
  // The synchronous redirect getter needs the last loaded state, but tokens and
  // writes must observe other providers/processes completing or refreshing OAuth.
  const get = async (): Promise<McpOAuthState> => {
    if (superseded) stale();
    await loadRegisteredClient();
    let saved = await deps.load();
    deps.onState?.(saved);
    if (sessionBound && sessionId !== saved.sessionId) stale();
    if (registered && saved.registeredClientFingerprint !== registeredFingerprint) {
      // A missing binding is safe only before credentials or PKCE exist. Never
      // guess that old dynamic-client or different-registry tokens belong here.
      if (saved.registeredClientFingerprint || saved.clientInformation || saved.tokens || saved.codeVerifier || saved.authorizationState) stale();
      const bound = await deps.compareAndSave(saved.revision, { ...saved, registeredClientFingerprint: registeredFingerprint });
      if (!bound) return stale();
      saved = bound;
    }
    sessionBound = true;
    sessionId = saved.sessionId;
    cache = saved;
    return cache;
  };
  const put = async (expected: McpOAuthState, next: McpOAuthState): Promise<McpOAuthState> => {
    if (superseded) stale();
    await loadRegisteredClient();
    deps.onState?.(next);
    const saved = await deps.compareAndSave(expected.revision, next);
    if (!saved) return stale();
    cache = saved;
    sessionBound = true;
    sessionId = saved.sessionId;
    return saved;
  };

  return {
    // Providing complete metadata avoids SDK fallback discovery. Invalidation
    // cannot replace these trusted endpoints with a remotely advertised issuer.
    async discoveryState() {
      const saved = await get();
      return structuredClone(discovery ?? saved.discoveryState);
    },
    ...(!discovery ? { async saveDiscoveryState(state: OAuthDiscoveryState) {
      const previous = await get();
      await put(previous, { ...previous, discoveryState: structuredClone(state) });
    } } : {}),
    get redirectUrl() {
      return deps.interactive ? deps.redirectUrl : cache?.redirectUri ?? deps.redirectUrl;
    },
    async state() {
      // SDK refresh recovery can otherwise start a hidden consent using the
      // resource's broad default scopes instead of the host's explicit profile.
      if (deps.requireInteractiveAuthorization && !deps.interactive) {
        throw new NeedsReauthError(undefined, `Reconnect this ${INTEGRATION_LABELS.singular.toLowerCase()} to authorize access.`);
      }
      const state = randomBytes(32).toString('base64url');
      const previous = credentialSnapshot ?? await get();
      authorizationSnapshot = await put(previous, { ...previous, sessionId: randomBytes(32).toString('base64url'), authorizationState: state, authorizationExpiresAt: Date.now() + 10 * 60_000,
        redirectUri: deps.redirectUrl, callbackChannel: deps.callbackChannel ?? 'web' });
      return state;
    },
    get clientMetadata(): OAuthClientMetadata {
      return metadata();
    },
    async clientInformation() {
      const saved = await get();
      clientSnapshot = saved;
      if (registered) return registeredInformation;
      // Block background DCR before the SDK sends a registration request. A
      // callback with an existing client and ordinary refresh remain allowed.
      if (!saved.clientInformation && deps.requireInteractiveAuthorization && !deps.interactive) {
        throw new NeedsReauthError(undefined, `Reconnect this ${INTEGRATION_LABELS.singular.toLowerCase()} to register its OAuth client.`);
      }
      // A fresh listener can have a new port. Re-register a dynamic client when
      // its registered callback changes, including web-to-desktop migration.
      if (deps.interactive && saved.redirectUri && saved.redirectUri !== deps.redirectUrl) return undefined;
      return saved.clientInformation;
    },
    ...(!registered ? { async saveClientInformation(info: OAuthClientInformationMixed) {
      const previous = clientSnapshot ?? await get();
      clientSnapshot = await put(previous, { ...previous, clientInformation: info });
    } } : {}),
    async tokens() {
      credentialSnapshot = await get();
      return deps.interactive ? undefined : credentialSnapshot.tokens;
    },
    async saveTokens(tokens: OAuthTokens) {
      const previous = credentialSnapshot ?? clientSnapshot ?? await get();
      const next = { ...previous, tokens };
      // A background refresh must not erase a newer interactive sign-in's PKCE
      // state. The callback atomically consumes its state before exchanging code.
      if (deps.interactive || !next.authorizationState) {
        delete next.authorizationState;
        delete next.authorizationExpiresAt;
        delete next.codeVerifier;
      }
      credentialSnapshot = await put(previous, next);
    },
    async redirectToAuthorization(url: URL) {
      const target = new URL(url);
      for (const [key, value] of Object.entries(authorizationParams)) target.searchParams.set(key, value);
      deps.onRedirect?.(target);
    },
    async saveCodeVerifier(verifier: string) {
      const previous = authorizationSnapshot ?? await get();
      authorizationSnapshot = await put(previous, { ...previous, codeVerifier: verifier });
    },
    async codeVerifier() {
      credentialSnapshot = await get();
      const v = credentialSnapshot.codeVerifier;
      if (!v) throw new Error('no PKCE code verifier saved for this MCP server');
      return v;
    },
    async invalidateCredentials(scope) {
      const previous = credentialSnapshot ?? clientSnapshot ?? await get();
      const next: McpOAuthState = { ...previous };
      if (scope === 'all' || scope === 'tokens') delete next.tokens;
      if (scope === 'all' || scope === 'client') delete next.clientInformation;
      if (scope === 'all' || scope === 'verifier') delete next.codeVerifier;
      if (scope === 'all' || scope === 'discovery') delete next.discoveryState;
      credentialSnapshot = await put(previous, next);
    },
  };
}
