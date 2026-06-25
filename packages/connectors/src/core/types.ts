/**
 * The domain model + ports (§3, §10). The core depends only on `zod`; every
 * environment-specific capability is a port the host implements.
 */
import type { z } from 'zod';
import type { ConnectorErrorCode } from './errors';

// ───────────────────────────── Credentials ──────────────────────────────────

/**
 * What lives sealed in the store. Never present on an in-memory `Connection`;
 * the runtime opens it only at call time and re-seals on rotation (§9).
 */
export type Credentials =
  | { type: 'oauth2'; accessToken: string; refreshToken?: string; expiresAt?: number; raw?: unknown }
  | { type: 'api_key'; apiKey: string }
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }
  // A user-provided escape-hatch strategy holds its declared secret fields here (§ custom).
  | { type: 'custom'; values: Record<string, string> }
  // OAuth 1.0a — consumer + token pairs; the strategy signs each request (HMAC-SHA1).
  | { type: 'oauth1'; consumerKey: string; consumerSecret: string; token?: string; tokenSecret?: string }
  // AWS Signature V4 — the strategy signs each request (SigV4). region/service may also come from config.
  | { type: 'aws_sigv4'; accessKeyId: string; secretAccessKey: string; sessionToken?: string; region?: string; service?: string }
  // Self-signed JWT — the strategy mints a fresh JWT per request from this signing key (HS secret or PEM).
  | { type: 'jwt'; key: string };

export type OAuth2Credentials = Extract<Credentials, { type: 'oauth2' }>;
export type CredentialType = Credentials['type'];

// ──────────────────────────── Auth strategy ─────────────────────────────────

export interface BuildAuthorizationUrlInput {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  /** PKCE S256 challenge (present when the strategy `usePkce`). */
  codeChallenge?: string;
}

export interface ExchangeCodeInput {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  code: string;
  codeVerifier?: string;
}

export interface RefreshInput {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}

export interface RevokeInput {
  clientId: string;
  clientSecret?: string;
  token: string;
}

/**
 * Token-endpoint result. The auth layer returns a *relative* lifetime
 * (`expiresInMs`); the runtime converts it to an absolute `expiresAt` with its
 * injected `Clock`, so the auth layer stays clock-free and deterministic to test.
 */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresInMs?: number;
  /** Granted scope string from the token response (space- or comma-delimited). Set by the strategy
   * (incl. a `mapTokenResponse` hook) when the provider nests/renames it; `grantedFrom` prefers it. */
  scope?: string;
  raw?: unknown;
}

/**
 * The OAuth2 authorization-code + refresh flow. Pure transport: it makes the
 * token-endpoint calls through an injected `fetch`, returns/raises domain
 * results, and never touches storage or the connection model.
 */
export interface OAuthFlow {
  readonly usePkce: boolean;
  /** Provider statuses that mean "expired, try refreshing once" — default `[401]` (§9/§13). */
  readonly refreshableStatuses: number[];
  buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string;
  exchangeCode(input: ExchangeCodeInput): Promise<TokenSet>;
  /** Resolve a fresh token. Throws `OAuthRefreshError({revoked})` on failure (§9). */
  refresh(input: RefreshInput): Promise<TokenSet>;
  revoke?(input: RevokeInput): Promise<void>;
}

/**
 * The request a strategy authenticates. Mutable: header-injectors set `headers`,
 * query-placement strategies call `addQueryParam`, and signers (oauth1/sigv4/jwt)
 * read `method`/`url`/`body` to compute a per-request signature and set a header.
 * `url` is the fully-resolved request URL *including* the caller's query; signers
 * sign over it, so a strategy that signs must not also add query params.
 */
export interface AuthApplyContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Serialized request body, when present — needed by body-signing schemes. */
  body?: string;
  /** Add a query parameter to the outgoing URL (for query-placement strategies). */
  addQueryParam(name: string, value: string): void;
  /** Merge a field into the JSON request body (for body-injected auth, e.g. Plaid). */
  setBodyField(name: string, value: unknown): void;
  /** Replace the request URL — for path-embedded auth (e.g. Telegram's `/bot<token>/…`). */
  setUrl(url: string): void;
}

/**
 * Selects credential shape + how auth is injected, and (for OAuth) owns the
 * token lifecycle. `apiKey`/`bearer`/`basic`/`custom` inject from stored secrets;
 * `oauth1`/`aws_sigv4`/`jwt` sign each request; `oauth2` runs a refresh flow.
 */
export interface AuthStrategy {
  readonly kind: CredentialType;
  /** Authenticate the outgoing request (set headers, add query params, or sign). */
  applyAuth(creds: Credentials, req: AuthApplyContext): void;
  /**
   * Pull the bearer-ish token string for the SDK escape hatch (`ctx.getToken`).
   * Signing strategies have no static token and throw — those providers use `ctx.http`.
   */
  tokenOf(creds: Credentials): string;
  /** Present for OAuth strategies; absent for direct/signing ones. */
  readonly oauth?: OAuthFlow;
}

// ──────────────────────────── Authed HTTP ───────────────────────────────────

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path resolved against the provider `baseUrl`, or an absolute URL. */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  headers?: Record<string, string>;
  /** JSON body (serialized) unless `rawBody` is set. */
  body?: unknown;
  /** Pre-serialized body (e.g. form-encoded); bypasses JSON. */
  rawBody?: string;
  /** Content-Type for `rawBody`. */
  contentType?: string;
  /** True for side-effecting calls — disables post-send retry (§5/§13). */
  mutating?: boolean;
  signal?: AbortSignal;
}

/**
 * Pre-authed client handed to action handlers. Resolves relative paths against
 * the provider base URL, injects (and silently refreshes) auth, maps provider
 * errors to the taxonomy, and routes everything through the `Redactor`.
 */
export interface AuthedHttp {
  request<T = unknown>(req: HttpRequest): Promise<T>;
  get<T = unknown>(path: string, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
  post<T = unknown>(path: string, body?: unknown, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
  put<T = unknown>(path: string, body?: unknown, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
  patch<T = unknown>(path: string, body?: unknown, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
  delete<T = unknown>(path: string, opts?: Omit<HttpRequest, 'method' | 'path' | 'body'>): Promise<T>;
}

// ───────────────────────────── Domain model ─────────────────────────────────

export type RiskLevel = 'low' | 'medium' | 'high';

export interface AccountIdentity {
  accountId: string;
  email?: string;
  label?: string;
  /**
   * Per-connection metadata discovered at connect (e.g. Jira/Confluence `cloudId`, QuickBooks
   * `realmId`) — stored on the connection and read by actions via `ctx.config` / an `httpAction`'s
   * `request(input, { config })`. Keeps per-site ids OFF the action's input schema (out of the
   * agent's hands).
   */
  config?: Record<string, unknown>;
  /** Per-connection API base (e.g. Salesforce `instance_url`) — overrides provider/config baseUrl. */
  baseUrl?: string;
}

/** Context handed to `identify()` / `resolveBaseUrl()` so they can read connect-time provider data. */
export interface IdentifyContext {
  /** The raw token-endpoint response (e.g. Salesforce returns `instance_url` here). */
  tokenResponse?: unknown;
  /** OAuth callback query params (e.g. QuickBooks returns `realmId` on the callback). */
  params?: Record<string, string>;
}

/** The auth boundary. One consent → one `Connection` per account (§3). */
export interface Provider {
  id: string;
  displayName: string;
  auth: AuthStrategy;
  baseUrl?: string;
  /** OAuth: always-requested scopes that `identify()` needs (e.g. `['openid','email']`). */
  identityScopes?: string[];
  /** Provider token-revocation endpoint, called on disconnect (§9). */
  revokeUrl?: string;
  /**
   * Optional scope-hierarchy predicate (§7): does the `granted` set authorize `required`?
   * Lets a broader granted scope satisfy a narrower action scope (e.g. Google's
   * `gmail.modify ⊇ gmail.compose`) so precise action scopes don't over-prompt. The
   * runtime falls back to flat membership when absent.
   */
  scopeSatisfies?(granted: string[], required: string): boolean;
  /**
   * Derive a per-connection API base from the token exchange (e.g. Salesforce's `instance_url`
   * in the token response) — used as the baseUrl for `identify()` AND every subsequent call on
   * this connection. Runs before `identify()`.
   */
  resolveBaseUrl?(ctx: IdentifyContext): string | undefined;
  /**
   * Discover the account identity right after auth. Optional for non-OAuth strategies. May also
   * return per-connection `config`/`baseUrl` (e.g. Jira cloudId) captured for later calls. `ctx`
   * carries the token response + callback params for providers that need them.
   */
  identify?(http: AuthedHttp, ctx: IdentifyContext): Promise<AccountIdentity>;
  /**
   * Cheap, runtime-safe liveness probe for `testConnection` — a minimal authed read that throws on
   * failure. DISTINCT from `identify`: `identify` runs once at connect (and may need connect-time
   * context like callback params); `healthCheck` runs anytime against an existing connection, so it
   * gets the stored `config` and nothing connect-specific. Prefer declaring this over relying on the
   * `identify` fallback when a provider's identify needs connect-time data (e.g. QuickBooks realmId).
   */
  healthCheck?(http: AuthedHttp, ctx: { config: Record<string, unknown> }): Promise<void>;
}

/** A capability surface bound to a provider (§3). */
export interface Toolkit {
  id: string;
  providerId: string;
  displayName: string;
  /** Optional upfront-consent bundle; defaults to the union of its actions' scopes. */
  scopes?: string[];
  actions: Action[];
}

export interface Action<I = unknown, O = unknown> {
  id: string;
  description: string;
  /** PURE domain input — never includes `account`; the projection injects it (§11). */
  input: z.ZodType<I>;
  output?: z.ZodType<O>;
  /** The precise per-call scope requirement (§3/§7). */
  scopes?: string[];
  mutating?: boolean;
  risk?: RiskLevel;
  /** Mark an action superseded — projections annotate the description but keep it callable (the
   * action name is a public contract; never silently drop it). */
  deprecated?: boolean;
  /** The action id to use instead, when `deprecated`. Surfaced in the projected description. */
  replacedBy?: string;
  execute(ctx: ActionContext, input: I): Promise<O>;
}

/** A user's authenticated account. Many per provider. Credentials are NOT here. */
export interface Connection {
  id: string;
  ownerId: string;
  providerId: string;
  accountId: string;
  email?: string;
  label?: string;
  scopes: string[];
  status: 'active' | 'needs_reauth';
  /**
   * Which `AuthConfig` (auth client) minted this connection (authconfig spec §3/§5).
   * `undefined` ⇒ the provider's default — either a pre-feature connection (OAuth) or a
   * self-credentialed non-OAuth connection that never consults a client. A token is
   * refreshed/revoked/re-consented ONLY with the config that minted it.
   */
  authConfigId?: string;
  config?: Record<string, unknown>;   // per-connection provider metadata captured at connect (cloudId, realmId, …)
  baseUrl?: string;                   // per-connection API base (e.g. Salesforce instance_url)
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

/** Safe metadata handed to handlers — explicitly NOT the credential. */
export interface ConnectionMetadata {
  id: string;
  ownerId: string;
  providerId: string;
  accountId: string;
  email?: string;
  label?: string;
  scopes: string[];
}

export interface ActionContext {
  connection: ConnectionMetadata;
  http: AuthedHttp;
  /** Escape hatch for SDK/signing; `ctx.http` is the blessed path. */
  getToken(): Promise<string>;
  config: Record<string, unknown>;
  clock: Clock;
  log: Logger;
}

// ───────────────────────────── Outcomes ─────────────────────────────────────

export interface AccountChoice {
  connectionId: string;
  email?: string;
  label?: string;
  /** Multi-client tiebreaker (reserved): the minting config's label, e.g. "Work" vs "Personal". */
  authConfigLabel?: string;
}

/**
 * Multi-client picker choice (reserved — connectors-authconfig-spec.md). Host/UI only; the
 * projection shows the model the `label`, never the opaque `authConfigId` (mirrors AccountChoice).
 * `label` is REQUIRED: a picker only appears with >1 config, where labels are mandatory, so every
 * choice is guaranteed nameable — the model-safe view never has to fall back to an id.
 */
export interface AuthConfigChoice {
  authConfigId: string;
  label: string;
}

export type ActionOutcome<O = unknown> =
  | { ok: true; result: O }
  | { ok: false; reason: 'auth_required'; providerId: string; authorizationUrl: string }
  | { ok: false; reason: 'needs_account'; providerId: string; choices: AccountChoice[] }
  | {
      ok: false;
      reason: 'needs_consent';
      providerId: string;
      connectionId: string;
      missingScopes: string[];
      authorizationUrl: string;
    }
  | { ok: false; reason: 'approval_required'; actionId: string; risk: RiskLevel; preview: unknown }
  // Multi-client layer (authconfig spec §6a): the analog of `auth_required` when a connect is
  // needed but >1 auth client is visible and none is the default. `runAction` returns it;
  // `beginAuth` throws `auth_config_required` instead (the host resolves the config via
  // `listForProvider` first). Never emitted while a provider has a single config.
  | { ok: false; reason: 'auth_config_required'; providerId: string; choices: AuthConfigChoice[] }
  | { ok: false; reason: 'error'; code: ConnectorErrorCode; message: string; indeterminate?: boolean };

// ───────────────────────────── Auth requests ────────────────────────────────

export type AuthIntent = 'new_connection' | 'add_scopes';

/** Short-lived OAuth state persisted across the redirect (§9). */
export interface AuthRequest {
  state: string;
  ownerId: string;
  providerId: string;
  scopes: string[];
  redirectUri: string;
  intent: AuthIntent;
  existingConnectionId?: string;
  label?: string;
  /**
   * The minting `AuthConfig` resolved at `beginAuth` (authconfig spec §3/§6). Stamped onto
   * the resulting `Connection` and used by `completeAuth` to open the right client secret.
   * `undefined` ⇒ the provider's legacy default.
   */
  authConfigId?: string;
  /** PKCE `code_verifier`, SEALED — a proof-of-possession secret (§9). */
  sealedVerifier?: SealedSecret;
  expiresAt: number;
  createdAt: number;
}

// ───────────────────────────── Ports ────────────────────────────────────────

export type SealedSecret = string;

export interface StoredConnection {
  connection: Connection;
  sealed: SealedSecret;
}

export interface ConnectionStore {
  list(filter?: { ownerId?: string; providerId?: string }): Promise<Connection[]>;
  get(id: string): Promise<StoredConnection | null>;
  save(connection: Connection, sealed: SealedSecret): Promise<void>;
  setStatus(id: string, status: Connection['status'], reason?: string): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AuthRequestStore {
  put(req: AuthRequest): Promise<void>;
  /** Single-use: returns and removes the request (or null if absent/expired). */
  take(state: string): Promise<AuthRequest | null>;
  sweepExpired(now: number): Promise<void>;
}

export interface SecretBox {
  seal(value: unknown): Promise<SealedSecret>;
  open<T = unknown>(secret: SealedSecret): Promise<T>;
}

/**
 * The single-config form (the original port). SUPERSEDED by `AuthConfig` +
 * `AuthConfigRegistry` (authconfig spec §3/§4), kept as the ergonomic shape the
 * `staticOAuthApps`/`staticAuthConfigs` legacy record accepts. The `clientSecret` here is
 * the env-sourced input; the registry splits it out so it never travels on safe metadata.
 */
export interface OAuthAppConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
}

/** @deprecated Superseded by {@link AuthConfigRegistry}; retained as a structural alias. */
export type OAuthAppRegistry = AuthConfigRegistry;

// ───────────────────────── Auth configs (multi-client) ──────────────────────
// The multi-client layer (connectors-authconfig-spec.md). One provider → 1..N AuthConfigs
// → N connections. One config per provider stays the invisible default; these types let a
// provider have a work/personal/BYO/per-tenant client without a migration. The client SECRET
// is never part of the safe `AuthConfig` record — it is sealed/held separately and surfaces
// only on `ResolvedAuthConfig`, returned by the single secret-opening registry method.

/** Mirrors {@link CredentialType} exactly (§3a invariant): a config's scheme must equal its provider's strategy kind. */
export type AuthScheme = CredentialType;

/** Lifecycle status — what it permits depends on the flow's purpose (§8 table). */
export type AuthConfigStatus = 'active' | 'disabled' | 'archived';

/** Visibility scope — SEPARATE from a connection's `ownerId` (§4). */
export type AuthConfigScope = 'global' | 'tenant' | 'owner';

/**
 * The app-level setup for connecting to a provider via one scheme (Nango *Integration* /
 * Composio *Auth Config*). SAFE METADATA ONLY — flows to UI, persists as-is, NEVER a secret.
 */
export interface AuthConfig {
  /** Stable, GLOBALLY UNIQUE (looked up by id alone). Convention: provider-prefixed. */
  id: string;
  providerId: string;
  /** MUST equal the provider's strategy kind in v1 (§3a). */
  scheme: AuthScheme;
  /** UI label. REQUIRED whenever a provider has >1 config (every pickable config is nameable). */
  label?: string;
  /** At most one default per (provider × EXACT visibility key: 'global' | a tenantId | an ownerId) (§4a). */
  isDefault?: boolean;

  // ── visibility / ownership — distinct from a connection's ownerId (§4) ──
  scope: AuthConfigScope;
  tenantId?: string; // when scope === 'tenant'
  ownerId?: string; // when scope === 'owner' (a single user's BYO client)

  // ── scopes ──
  /** Requested when the host passes no explicit scopes (§6). */
  defaultScopes?: string[];
  /** Optional max / validation boundary. "Covered" = direct member OR implied via Provider.scopeSatisfies. */
  allowedScopes?: string[];

  // ── OAuth client identity — NON-SECRET parts only (present iff scheme === 'oauth2') ──
  oauth?: { clientId: string; redirectUri: string };

  /** API base override for a self-hosted instance — threaded into identify()/ctx.http (§6). */
  baseUrl?: string;

  status: AuthConfigStatus;
}

/** Safe to expose to pickers/UI — NEVER carries a secret. */
export interface AuthConfigSummary {
  id: string;
  providerId: string;
  scheme: AuthScheme;
  label?: string;
  isDefault: boolean;
  status: AuthConfigStatus;
}

/**
 * RUNTIME-FACING resolution result — the ONLY shape that carries the opened client secret.
 * Returned ONLY by {@link AuthConfigRegistry.openConfigForConnection}, for code exchange /
 * refresh / revoke. The runtime registers the secret with the Redactor and never lets it flow
 * to UI, logs, or `AuthConfig`/`AuthConfigSummary`.
 */
export interface ResolvedAuthConfig {
  config: AuthConfig;
  clientSecret?: string;
}

/** Connect-/list-time visibility context the host supplies; the engine stays tenancy-agnostic (§4). */
export interface ResolutionContext {
  ownerId?: string;
  tenantId?: string;
}

/**
 * A visibility-scoped data source over a provider's auth configs (authconfig spec §4). The
 * SELECTION policy (default precedence, scope-filtering, status×purpose gating — §4a/§8) lives
 * in the runtime, which has the scope inputs the registry lacks; the registry just answers
 * "which configs exist, by id, with or without the secret." Mirrors how the dumb
 * `ConnectionStore` pairs with the runtime's resolution.
 */
export interface AuthConfigRegistry {
  /**
   * CONNECT data source: the configs VISIBLE in this ctx (visibility enforced HERE; ctx
   * REQUIRED). Returns ALL visible configs regardless of status — secret-free.
   */
  listForConnect(providerId: string, ctx: ResolutionContext): Promise<AuthConfig[]>;
  /**
   * CONNECTION-BOUND, by stamped id, NO ctx. SECRET-FREE — for building consent / reconnect
   * authorization URLs (clientId + redirectUri only). `undefined` ⇒ the provider's legacy default.
   */
  getConfigForConnection(providerId: string, authConfigId: string | undefined): Promise<AuthConfig | null>;
  /**
   * CONNECTION-BOUND, by stamped id, NO ctx. THE ONLY secret-opening method — for the token
   * endpoint only (code exchange, refresh, revoke). `undefined` ⇒ the provider's legacy default.
   */
  openConfigForConnection(
    providerId: string,
    authConfigId: string | undefined,
  ): Promise<ResolvedAuthConfig | null>;
  /** Pickers / management UI — visible summaries, NEVER secrets. ctx REQUIRED (visibility). */
  listForProvider(providerId: string, ctx: ResolutionContext): Promise<AuthConfigSummary[]>;
}

/**
 * Persistence for user/tenant-supplied (BYO) auth configs (authconfig spec §9 Case B). RAW and
 * mechanical — like {@link ConnectionStore}, it holds only opaque bytes: safe `AuthConfig`
 * metadata + a pre-sealed `clientSecret` blob. It NEVER receives a plaintext secret (the admin
 * service seals first) and enforces NO cross-store policy (delete-blocking / default immutability
 * need the ConnectionStore, which a raw store can't see — the admin service owns those).
 */
export interface AuthConfigStore {
  /** Upsert by `config.id`. `sealedSecret` is pre-sealed (PKCE/public clients pass none). */
  create(config: AuthConfig, sealedSecret?: SealedSecret): Promise<void>;
  get(id: string): Promise<{ config: AuthConfig; sealedSecret?: SealedSecret } | null>;
  /** ALL configs for the provider (raw — visibility filtering is the registry's job). */
  listForProvider(providerId: string): Promise<AuthConfig[]>;
  /** Flip the default flag to `id` (clearing others at the same visibility level). */
  setDefault(providerId: string, id: string): Promise<void>;
  setStatus(id: string, status: AuthConfigStatus): Promise<void>;
  delete(id: string): Promise<void>;
}

export type ApprovalDecision = 'allow' | 'deny' | 'ask';

export interface ApprovalCheckInput {
  actionId: string;
  /** Runtime-derived hash of schema + risk + mutating; grants auto-invalidate on change (§8). */
  actionVersion: string;
  risk: RiskLevel;
  mutating: boolean;
  connection: ConnectionMetadata;
  /** Canonical hash of the post-Zod-parse input; the grant key (§8). */
  inputDigest: string;
  inputPreview: unknown;
  caller: Caller;
}

export interface ApprovalPolicy {
  check(input: ApprovalCheckInput): Promise<ApprovalDecision>;
}

export interface Lock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

/**
 * Transient-failure retry policy for the authed HTTP client. Retries are idempotency-aware (set by
 * the client from the request's `mutating` flag), so this only bounds *how* it backs off, never
 * *whether* a side-effecting call is replayed. `maxRetries: 0` disables retry.
 */
export interface RetryPolicy {
  /** Retry attempts AFTER the first try. */
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export interface Redactor {
  register(value: string, label?: string): void;
  redact<T>(value: T): T;
}

export interface Clock {
  now(): number;
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

// ───────────────────────────── Audit ────────────────────────────────────────

export type CallerType = 'app' | 'agent' | 'mcp' | 'schedule';

export interface Caller {
  type: CallerType;
  /** Optional human/agent identity for audit. */
  id?: string;
}

export type ActionRunStatus =
  | 'ok'
  | 'auth_required'
  | 'auth_config_required'
  | 'needs_account'
  | 'needs_consent'
  | 'approval_required'
  | 'denied'
  | 'unknown'
  | 'error';

export interface ActionRunEvent {
  /** Stable across the start/finish pair; distinct per concurrent attempt (§8). */
  attemptId: string;
  phase: 'start' | 'finish';
  actionId: string;
  connectionId?: string;
  caller: Caller;
  mutating: boolean;
  risk: RiskLevel;
  status: ActionRunStatus;
  errorCode?: ConnectorErrorCode;
  error?: string;
  inputPreview?: unknown;
  outputPreview?: unknown;
}

export type OnActionRun = (event: ActionRunEvent) => void;

// ───────────────────────────── Runtime ──────────────────────────────────────

export interface BeginAuthOptions {
  ownerId?: string;
  /** Scopes to request; defaults to the provider identity scopes plus the toolkit bundle. */
  scopes?: string[];
  label?: string;
  /** Where the provider redirects back. Falls back to the registered OAuth app's redirectUri. */
  redirectUri?: string;
  /** Present for the incremental-consent flow (`add_scopes`) (§7). */
  existingConnectionId?: string;
  // Multi-client / hosted layer (connectors-authconfig-spec.md §6). `authConfigId` picks a
  // specific auth client (else the default resolves per §4a); `tenantId` is the hosted half of
  // the resolution context ({ownerId, tenantId}) used for visibility-scoped config selection.
  authConfigId?: string;
  tenantId?: string;
}

export interface BeginAuthResult {
  authorizationUrl: string;
  /** The opaque `state`; the host round-trips it through the redirect. */
  requestId: string;
}

export interface RunActionOptions {
  ownerId?: string;
  connectionId?: string;
  /** Account hint (email or label) for multi-account resolution (§6). */
  account?: string;
  caller?: Caller;
  // Multi-client / hosted layer (authconfig spec §6): the tenant half of the resolution context,
  // used when the agent path auto-initiates auth and must pick a visible client per §4a.
  tenantId?: string;
  // NOTE: idempotency is a deliberately-deferred seam (spec §9), NOT an API field yet —
  // shipping a typed `idempotencyKey` that nothing reads is a false safety affordance. The
  // honest interim signal is the `indeterminate` flag on post-send mutating failures. The
  // field returns when it is backed by an attempt/result ledger.
}

export interface DisconnectOptions {
  ownerId?: string;
  /** Best-effort provider-side revoke before deleting local state (default true) (§9). */
  revokeProvider?: boolean;
}

/**
 * Connect a non-OAuth provider from a credential the user supplies directly (API key, bearer,
 * basic, custom, or a signer's keys) — the analog of `beginAuth`+`completeAuth` for strategies
 * with no authorization-code flow. The runtime validates the shape, runs `identify()` when the
 * provider has one, seals the credential, and stores the connection.
 */
export interface ConnectDirectOptions {
  credential: Credentials;
  ownerId?: string;
  label?: string;
  email?: string;
  /** Stable account id when the provider has no `identify()` (else identify wins). */
  accountId?: string;
  /** Which auth config minted this (for per-instance baseUrl / multi-client); usually omitted. */
  authConfigId?: string;
}

/**
 * The result of a cheap connection health probe ({@link ConnectorRuntime.testConnection}) — does a
 * minimal authed call (forcing a refresh, then `identify()` when present) to tell active from
 * needs-reauth WITHOUT running a real action. Heals the stored status as a side effect.
 */
export interface ConnectionTestResult {
  connectionId: string;
  ok: boolean;
  status: Connection['status'] | 'error';
  /**
   * Whether a real authed call confirmed the connection works (a `healthCheck`/`identify` probe, or
   * — for OAuth — a successful forced token refresh). `false` means `ok` is a best-effort inference:
   * a non-OAuth provider with no probe (the secret is present but unexercised), or an OAuth probe
   * that couldn't run for connect-time reasons while the refresh still proved the grant live.
   */
  verified: boolean;
  /** Redacted failure detail when `status === 'error'`. */
  error?: string;
  checkedAt: string;
}

export interface ConnectorRuntime {
  beginAuth(providerId: string, opts: BeginAuthOptions): Promise<BeginAuthResult>;
  completeAuth(p: { code: string; state: string; params?: Record<string, string> }): Promise<Connection>;
  /** Connect a non-OAuth provider from a directly-supplied credential (§ direct strategies). */
  connectDirect(providerId: string, opts: ConnectDirectOptions): Promise<Connection>;
  listConnections(filter?: { ownerId?: string; providerId?: string }): Promise<Connection[]>;
  /** Disambiguated account choices for a provider — for account-picker UI and tool `account` hints. */
  listAccountChoices(providerId: string, opts?: { ownerId?: string }): Promise<AccountChoice[]>;
  runAction<O = unknown>(actionId: string, input: unknown, opts?: RunActionOptions): Promise<ActionOutcome<O>>;
  /** Cheap health probe for a connection — refresh + identify, heals stored status (Ri `testRequest`). */
  testConnection(connectionId: string, opts?: { ownerId?: string }): Promise<ConnectionTestResult>;
  disconnectConnection(id: string, opts?: DisconnectOptions): Promise<void>;
  getToolkits(): Toolkit[];
  getProviders(): Provider[];
}
