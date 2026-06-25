/**
 * The runtime (§5–§9): the single path through which every action executes, and
 * the one place the trust spine is enforced. `runAction`'s step order *is* the
 * spec — each step is where a guarantee lives. Also owns OAuth (`beginAuth`/
 * `completeAuth`), the refresh algorithm (`getValidCredentials`), and disconnect.
 *
 * Auth clients are resolved through the multi-client `AuthConfigRegistry`
 * (connectors-authconfig-spec.md): the SELECTION policy (§4a default precedence,
 * scope-filtering, status×purpose gating) lives here, while the registry is a pure
 * visibility-scoped data source. The load-bearing rule: a token is refreshed,
 * revoked, and re-consented ONLY with the config that minted it — resolved via the
 * connection's stamped `authConfigId` (or the provider's legacy default).
 */
import { z } from 'zod';
import { OAuthRefreshError } from '../auth/oauth2';
import { codeChallengeS256, generateCodeVerifier } from '../auth/pkce';
import { AuthConfigRequiredError, ConnectorError, NeedsReauthError } from './errors';
import { assertAuthConfigValidForProvider } from './auth-config-validate';
import { actionVersion, inputDigest } from './digest';
import { connectionMetadata, defaultApprovalPolicy, noopLogger, systemClock, uniqueScopes } from './defaults';
import { createAuthedHttp } from './http';
import { createRedactor } from './redactor';
import { newAttemptId, newId, randomUrlToken } from './ids';
import { inProcessLock } from '../lock/in-process';
import type { Registry } from './registry';
import type {
  AccountChoice,
  ActionOutcome,
  ActionRunEvent,
  ActionRunStatus,
  ApprovalPolicy,
  AuthConfig,
  AuthConfigChoice,
  AuthConfigRegistry,
  AuthConfigStatus,
  AuthRequest,
  AuthRequestStore,
  BeginAuthOptions,
  BeginAuthResult,
  Caller,
  Clock,
  Connection,
  ConnectDirectOptions,
  ConnectorRuntime,
  Credentials,
  DisconnectOptions,
  Lock,
  Logger,
  OnActionRun,
  Provider,
  Redactor,
  ResolutionContext,
  RetryPolicy,
  RiskLevel,
  RunActionOptions,
  SecretBox,
  ConnectionStore,
  ConnectionTestResult,
  TokenSet,
} from './types';

const DEFAULT_OWNER = 'local';
const DEFAULT_AUTH_TTL_MS = 10 * 60_000;
const DEFAULT_REFRESH_SKEW_MS = 60_000;

export interface ConnectorRuntimeOptions {
  registry: Registry;
  store: ConnectionStore;
  authRequests: AuthRequestStore;
  secretBox: SecretBox;
  /** Multi-client auth-config data source (authconfig spec §4). */
  authConfigs?: AuthConfigRegistry;
  /** @deprecated Back-compat alias for {@link authConfigs} (`staticOAuthApps` returns one). */
  oauthApps?: AuthConfigRegistry;
  approval?: ApprovalPolicy;
  lock?: Lock;
  redactor?: Redactor;
  clock?: Clock;
  logger?: Logger;
  onActionRun?: OnActionRun;
  fetch?: typeof fetch;
  /** Transient-failure retry policy for provider calls (idempotency-aware). Engine default applies when omitted. */
  retry?: RetryPolicy;
  defaultOwnerId?: string;
  authRequestTtlMs?: number;
  refreshSkewMs?: number;
}

/** The flow purposes the §8 status table gates. */
type Purpose = 'connect' | 'reconnect' | 'consent' | 'refresh' | 'revoke';

/** §8 status×purpose table: new-connection flows are gated; maintenance keeps working. */
function statusAllowsPurpose(status: AuthConfigStatus, purpose: Purpose): boolean {
  switch (purpose) {
    case 'connect':
      return status === 'active';
    case 'reconnect':
    case 'consent':
      return status === 'active' || status === 'disabled';
    case 'refresh':
    case 'revoke':
      return true; // active | disabled | archived — never strand live tokens
  }
}

/** Does a granted scope set satisfy a required scope — honoring the provider's hierarchy (§7)? */
function scopeHeld(provider: Provider, granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;
  return provider.scopeSatisfies?.(granted, required) ?? false;
}

/** Are all `requested` scopes within `allowedScopes` (direct or via Provider.scopeSatisfies)? */
function scopeCovers(provider: Provider, allowedScopes: string[] | undefined, requested: string[]): boolean {
  if (!allowedScopes) return true; // no boundary configured
  return requested.every((s) => scopeHeld(provider, allowedScopes, s));
}

/**
 * Pick the default among >1 candidate at the most specific present level: owner → tenant →
 * global (§4a step 2). Candidates are already visibility-filtered, so an owner candidate already
 * matches the caller. Two defaults at one level → `'ambiguous'` (operator misconfig, §4a step 3).
 */
function pickDefault(candidates: AuthConfig[]): AuthConfig | 'ambiguous' | null {
  for (const level of ['owner', 'tenant', 'global'] as const) {
    const atLevel = candidates.filter((c) => c.scope === level && c.isDefault);
    if (atLevel.length === 1) return atLevel[0] as AuthConfig;
    if (atLevel.length > 1) return 'ambiguous';
  }
  return null;
}

function errorOutcome(code: ConnectorError['code'], message: string, indeterminate?: boolean): ActionOutcome<never> {
  return { ok: false, reason: 'error', code, message, ...(indeterminate ? { indeterminate: true } : {}) };
}

export function createConnectorRuntime(opts: ConnectorRuntimeOptions): ConnectorRuntime {
  const { registry, store, authRequests, secretBox } = opts;
  const authConfigs = opts.authConfigs ?? opts.oauthApps;
  if (!authConfigs) {
    throw new ConnectorError('internal_error', 'createConnectorRuntime requires `authConfigs` (or the deprecated `oauthApps`)');
  }
  const approval = opts.approval ?? defaultApprovalPolicy();
  const redactor = opts.redactor ?? createRedactor();
  const clock = opts.clock ?? systemClock;
  const logger = opts.logger ?? noopLogger;
  const onActionRun: OnActionRun = opts.onActionRun ?? (() => {});
  const fetchImpl = opts.fetch ?? fetch;
  const retry = opts.retry;
  const defaultOwnerId = opts.defaultOwnerId ?? DEFAULT_OWNER;
  const authTtlMs = opts.authRequestTtlMs ?? DEFAULT_AUTH_TTL_MS;
  const skewMs = opts.refreshSkewMs ?? DEFAULT_REFRESH_SKEW_MS;
  const lock: Lock = opts.lock ?? inProcessLock();

  // Provider-dependent registration invariants (§3a) — enforced lazily on first resolution,
  // memoized by config id, since the registry is intentionally provider-agnostic. For static
  // (operator) configs this fires effectively at startup; for a future BYO store it fires when a
  // config is first used. The self-contained invariants are checked by the registry itself.
  const validatedConfigIds = new Set<string>();
  function ensureConfigValid(config: AuthConfig, provider: Provider): void {
    if (validatedConfigIds.has(config.id)) return;
    // Same check the admin runs eagerly at add-time; here it's the lazy first-use backstop.
    assertAuthConfigValidForProvider(config, provider, 'internal_error');
    validatedConfigIds.add(config.id);
  }

  // Every error outcome's message is redacted here (§8) — confinement is enforced at the
  // runtime boundary, not left to each projection to remember (P2-a). A thrown provider/SDK
  // error can carry a token in its message; this is the one place it can't escape.
  function fail(code: ConnectorError['code'], message: string, indeterminate?: boolean): ActionOutcome<never> {
    return errorOutcome(code, redactor.redact(message), indeterminate);
  }

  function registerSecrets(creds: Credentials): void {
    switch (creds.type) {
      case 'oauth2':
        redactor.register(creds.accessToken, 'access_token');
        if (creds.refreshToken) redactor.register(creds.refreshToken, 'refresh_token');
        break;
      case 'api_key':
        redactor.register(creds.apiKey, 'api_key');
        break;
      case 'bearer':
        redactor.register(creds.token, 'bearer');
        break;
      case 'basic':
        redactor.register(creds.password, 'password');
        break;
      case 'custom':
        for (const v of Object.values(creds.values)) redactor.register(v, 'custom');
        break;
      case 'oauth1':
        redactor.register(creds.consumerSecret, 'oauth1_consumer_secret');
        if (creds.tokenSecret) redactor.register(creds.tokenSecret, 'oauth1_token_secret');
        break;
      case 'aws_sigv4':
        redactor.register(creds.secretAccessKey, 'aws_secret');
        if (creds.sessionToken) redactor.register(creds.sessionToken, 'aws_session');
        break;
      case 'jwt':
        redactor.register(creds.key, 'jwt_key');
        break;
    }
  }

  function requireProvider(id: string): Provider {
    const p = registry.getProvider(id);
    if (!p) throw new ConnectorError('unknown_provider', `unknown provider "${id}"`);
    return p;
  }

  function isFresh(creds: Extract<Credentials, { type: 'oauth2' }>): boolean {
    return creds.expiresAt == null || clock.now() < creds.expiresAt - skewMs;
  }

  // ── §4a default resolution (connect / new-connection only) ─────────────────
  type ConnectResolution =
    | { kind: 'resolved'; config: AuthConfig; authConfigId: string }
    | { kind: 'picker'; choices: AuthConfigChoice[] }
    | { kind: 'ambiguous' } // → auth_config_ambiguous_default
    | { kind: 'unavailable' } // → auth_config_unavailable
    | { kind: 'scope_not_allowed' }
    | { kind: 'none' }; // → provider_not_configured

  async function resolveConnectConfig(
    provider: Provider,
    ctx: ResolutionContext,
    sel: { authConfigId?: string; explicitScopes?: string[] },
  ): Promise<ConnectResolution> {
    const visible = await authConfigs!.listForConnect(provider.id, ctx);
    for (const c of visible) ensureConfigValid(c, provider);
    const identity = provider.identityScopes ?? [];
    const requestedWith = (explicit: string[]): string[] => uniqueScopes(identity, explicit);

    // EXPLICIT id — resolve in stages so each failure stays distinct (§4a).
    if (sel.authConfigId != null) {
      const chosen = visible.find((c) => c.id === sel.authConfigId);
      if (!chosen) return { kind: 'none' }; // not visible (wrong owner/tenant or removed)
      if (!statusAllowsPurpose(chosen.status, 'connect')) return { kind: 'unavailable' };
      const requested = requestedWith(sel.explicitScopes ?? chosen.defaultScopes ?? []);
      if (!scopeCovers(provider, chosen.allowedScopes, requested)) return { kind: 'scope_not_allowed' };
      return { kind: 'resolved', config: chosen, authConfigId: chosen.id };
    }

    // IMPLICIT — candidate set = visible ∩ connect-eligible (active), then scope-filter (only when
    // explicit scopes were passed, so an unsatisfiable default doesn't dead-end a satisfiable sibling).
    const active = visible.filter((c) => statusAllowsPurpose(c.status, 'connect'));
    let candidates = active;
    if (sel.explicitScopes != null) {
      const requested = requestedWith(sel.explicitScopes);
      candidates = active.filter((c) => scopeCovers(provider, c.allowedScopes, requested));
    }

    if (candidates.length === 1) {
      const only = candidates[0] as AuthConfig;
      return { kind: 'resolved', config: only, authConfigId: only.id };
    }
    if (candidates.length > 1) {
      const def = pickDefault(candidates);
      if (def === 'ambiguous') return { kind: 'ambiguous' };
      if (def) return { kind: 'resolved', config: def, authConfigId: def.id };
      return {
        kind: 'picker',
        choices: candidates.map((c) => ({ authConfigId: c.id, label: c.label ?? c.id })),
      };
    }

    // candidates empty — distinguish the three reasons (§4a steps 5–7).
    if (sel.explicitScopes != null && active.length > 0) return { kind: 'scope_not_allowed' };
    if (visible.length > 0) return { kind: 'unavailable' }; // visible but none connect-eligible
    return { kind: 'none' };
  }

  // ── The refresh algorithm / getToken seam (§9) ────────────────────────────
  async function getValidCredentials(connectionId: string, force = false): Promise<Credentials> {
    const stored = await store.get(connectionId);
    if (!stored) throw new ConnectorError('connection_not_found', `connection "${connectionId}" not found`);
    const creds = await secretBox.open<Credentials>(stored.sealed);
    registerSecrets(creds);
    if (creds.type !== 'oauth2') return creds; // direct strategies never expire
    if (!force && isFresh(creds)) return creds; // proactive window

    const staleToken = creds.accessToken;
    return lock.withLock(connectionId, async () => {
      const s2 = await store.get(connectionId);
      if (!s2) throw new ConnectorError('connection_not_found', `connection "${connectionId}" not found`);
      const c2 = await secretBox.open<Credentials>(s2.sealed);
      registerSecrets(c2);
      if (c2.type !== 'oauth2') return c2;
      // Someone refreshed while we waited → use theirs; never double-refresh (single-flight).
      if (c2.accessToken !== staleToken && isFresh(c2)) return c2;
      if (!force && isFresh(c2)) return c2;
      if (!c2.refreshToken) {
        await store.setStatus(connectionId, 'needs_reauth', 'no refresh token');
        throw new NeedsReauthError(connectionId);
      }

      const provider = requireProvider(s2.connection.providerId);
      const flow = provider.auth.oauth;
      if (!flow) throw new ConnectorError('internal_error', `provider "${provider.id}" has no oauth flow to refresh`);
      // LOAD-BEARING: refresh with the client that MINTED this connection (its stamped config),
      // never "the provider's client" — else refresh breaks the moment a second client exists.
      const resolved = await authConfigs!.openConfigForConnection(provider.id, s2.connection.authConfigId);
      if (!resolved) throw new ConnectorError('provider_not_configured', `no auth client configured for "${provider.id}"`);
      ensureConfigValid(resolved.config, provider);
      const clientId = resolved.config.oauth?.clientId;
      if (!clientId) throw new ConnectorError('provider_not_configured', `auth client for "${provider.id}" has no client id`);
      if (resolved.clientSecret) redactor.register(resolved.clientSecret, 'client_secret');

      let ts: TokenSet;
      try {
        ts = await flow.refresh({
          clientId,
          ...(resolved.clientSecret !== undefined ? { clientSecret: resolved.clientSecret } : {}),
          refreshToken: c2.refreshToken,
        });
      } catch (e) {
        if (e instanceof OAuthRefreshError && e.revoked) {
          await store.setStatus(connectionId, 'needs_reauth', 'refresh revoked');
          throw new NeedsReauthError(connectionId);
        }
        throw new ConnectorError('provider_unavailable', 'token refresh failed', { cause: e });
      }

      const next: Credentials = {
        type: 'oauth2',
        accessToken: ts.accessToken,
        refreshToken: ts.refreshToken ?? c2.refreshToken, // ROTATE if present, else PRESERVE
        ...(ts.expiresInMs != null ? { expiresAt: clock.now() + ts.expiresInMs } : {}),
        ...(ts.raw !== undefined ? { raw: ts.raw } : {}),
      };
      registerSecrets(next);
      const updated: Connection = { ...s2.connection, updatedAt: new Date(clock.now()).toISOString() };
      await store.save(updated, await secretBox.seal(next)); // persist-before-return
      return next;
    });
  }

  // ── Authorization-URL construction (shared by beginAuth + auth_required) ───
  async function buildAuthorization(input: {
    provider: Provider;
    config: AuthConfig; // resolved, secret-free — the minting client for this request
    authConfigId: string | undefined; // stamped onto the AuthRequest → the Connection
    ownerId: string;
    scopes: string[];
    redirectUri: string;
    intent: AuthRequest['intent'];
    existingConnectionId?: string;
    label?: string;
  }): Promise<BeginAuthResult> {
    const { provider, config } = input;
    const flow = provider.auth.oauth;
    if (!flow) throw new ConnectorError('internal_error', `provider "${provider.id}" is not an OAuth provider`);
    const clientId = config.oauth?.clientId;
    if (!clientId) throw new ConnectorError('provider_not_configured', `auth client for "${provider.id}" has no client id`);

    const state = randomUrlToken(24);
    let codeChallenge: string | undefined;
    let sealedVerifier: string | undefined;
    if (flow.usePkce) {
      const verifier = generateCodeVerifier();
      redactor.register(verifier, 'pkce_verifier');
      codeChallenge = codeChallengeS256(verifier);
      sealedVerifier = await secretBox.seal(verifier);
    }

    const req: AuthRequest = {
      state,
      ownerId: input.ownerId,
      providerId: provider.id,
      scopes: input.scopes,
      redirectUri: input.redirectUri,
      intent: input.intent,
      ...(input.existingConnectionId ? { existingConnectionId: input.existingConnectionId } : {}),
      ...(input.authConfigId !== undefined ? { authConfigId: input.authConfigId } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(sealedVerifier ? { sealedVerifier } : {}),
      expiresAt: clock.now() + authTtlMs,
      createdAt: clock.now(),
    };
    await authRequests.put(req);

    const authorizationUrl = flow.buildAuthorizationUrl({
      clientId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      state,
      ...(codeChallenge ? { codeChallenge } : {}),
    });
    return { authorizationUrl, requestId: state };
  }

  function resolveRedirect(config: AuthConfig, override?: string): string {
    const uri = override ?? config.oauth?.redirectUri;
    if (!uri) {
      throw new ConnectorError(
        'provider_not_configured',
        `no redirectUri (pass one or configure the auth client for "${config.providerId}")`,
      );
    }
    return uri;
  }

  // ── Public: beginAuth / completeAuth ──────────────────────────────────────
  async function beginAuth(providerId: string, options: BeginAuthOptions): Promise<BeginAuthResult> {
    const provider = requireProvider(providerId);
    const ownerId = options.ownerId ?? defaultOwnerId;

    // add_scopes / reconnect: bind to the EXISTING connection's minting client (secret-free),
    // not §4a connect resolution — the client must stay constant for refresh to keep working (§6).
    if (options.existingConnectionId) {
      const existing = await store.get(options.existingConnectionId);
      if (!existing || existing.connection.ownerId !== ownerId || existing.connection.providerId !== providerId) {
        throw new ConnectorError('connection_not_found', 'connection to upgrade not found');
      }
      const config = await authConfigs!.getConfigForConnection(providerId, existing.connection.authConfigId);
      if (!config) throw new ConnectorError('provider_not_configured', `no auth client configured for "${providerId}"`);
      ensureConfigValid(config, provider);
      if (!statusAllowsPurpose(config.status, 'consent')) {
        throw new ConnectorError('auth_config_unavailable', `auth client "${config.id}" cannot be used to add scopes (status ${config.status})`);
      }
      const requested = uniqueScopes(provider.identityScopes, options.scopes ?? existing.connection.scopes);
      if (!scopeCovers(provider, config.allowedScopes, requested)) {
        throw new ConnectorError('scope_not_allowed', `auth client "${config.id}" cannot grant the requested scopes`);
      }
      return buildAuthorization({
        provider,
        config,
        authConfigId: existing.connection.authConfigId,
        ownerId,
        scopes: requested,
        redirectUri: resolveRedirect(config, options.redirectUri),
        intent: 'add_scopes',
        existingConnectionId: options.existingConnectionId,
        ...(options.label ? { label: options.label } : {}),
      });
    }

    // new_connection: §4a default resolution over the visible configs.
    const ctx: ResolutionContext = {
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
    };
    const resolution = await resolveConnectConfig(provider, ctx, {
      ...(options.authConfigId !== undefined ? { authConfigId: options.authConfigId } : {}),
      ...(options.scopes !== undefined ? { explicitScopes: options.scopes } : {}),
    });
    // beginAuth is host-driven: it THROWS the picker/diagnostic states (the host resolves the
    // config first via listForProvider). runAction returns them instead (§6/§6a).
    switch (resolution.kind) {
      case 'picker':
        throw new AuthConfigRequiredError(
          providerId,
          resolution.choices,
        );
      case 'ambiguous':
        throw new ConnectorError('auth_config_ambiguous_default', `provider "${providerId}" has more than one default auth client at the same visibility level`);
      case 'unavailable':
        throw new ConnectorError('auth_config_unavailable', `the selected auth client for "${providerId}" cannot be used to connect`);
      case 'scope_not_allowed':
        throw new ConnectorError('scope_not_allowed', `no auth client for "${providerId}" can grant the requested scopes`);
      case 'none':
        throw new ConnectorError('provider_not_configured', `no auth client configured for "${providerId}"`);
      case 'resolved':
        break;
    }
    const { config, authConfigId } = resolution;
    const base = options.scopes ?? config.defaultScopes ?? [];
    return buildAuthorization({
      provider,
      config,
      authConfigId,
      ownerId,
      scopes: uniqueScopes(provider.identityScopes, base),
      redirectUri: resolveRedirect(config, options.redirectUri),
      intent: 'new_connection',
      ...(options.label ? { label: options.label } : {}),
    });
  }

  async function completeAuth(p: { code: string; state: string; params?: Record<string, string> }): Promise<Connection> {
    const req = await authRequests.take(p.state);
    if (!req) throw new ConnectorError('invalid_input', 'unknown or expired auth state');
    if (req.expiresAt < clock.now()) throw new ConnectorError('invalid_input', 'auth request expired');

    const provider = requireProvider(req.providerId);
    const flow = provider.auth.oauth;
    if (!flow) throw new ConnectorError('internal_error', `provider "${provider.id}" has no oauth flow`);

    // The shared callback for every flow: open the MINTING client's secret (the first and only
    // secret open) bound to the stamped authConfigId — never the default unless that's what minted it.
    const resolved = await authConfigs!.openConfigForConnection(provider.id, req.authConfigId);
    if (!resolved || !resolved.config.oauth) {
      throw new ConnectorError('provider_not_configured', `no auth client configured for "${provider.id}"`);
    }
    ensureConfigValid(resolved.config, provider);
    if (resolved.clientSecret) redactor.register(resolved.clientSecret, 'client_secret');

    const codeVerifier = req.sealedVerifier ? await secretBox.open<string>(req.sealedVerifier) : undefined;
    if (codeVerifier) redactor.register(codeVerifier, 'pkce_verifier');

    const ts = await flow.exchangeCode({
      clientId: resolved.config.oauth.clientId,
      ...(resolved.clientSecret !== undefined ? { clientSecret: resolved.clientSecret } : {}),
      redirectUri: req.redirectUri,
      code: p.code,
      ...(codeVerifier !== undefined ? { codeVerifier } : {}),
    });

    const creds: Credentials = {
      type: 'oauth2',
      accessToken: ts.accessToken,
      ...(ts.refreshToken !== undefined ? { refreshToken: ts.refreshToken } : {}),
      ...(ts.expiresInMs != null ? { expiresAt: clock.now() + ts.expiresInMs } : {}),
      ...(ts.raw !== undefined ? { raw: ts.raw } : {}),
    };
    registerSecrets(creds);

    // A provider may derive a per-CONNECTION API base from the token exchange (Salesforce's
    // instance_url) — used for identify() AND every later call. Precedence: per-connection >
    // per-config (authConfig.baseUrl) > provider default.
    const idCtx: { tokenResponse: unknown; params: Record<string, string> } = {
      tokenResponse: ts.raw,
      params: p.params ?? {},
    };
    const derivedBaseUrl = provider.resolveBaseUrl?.(idCtx);
    const baseUrl = derivedBaseUrl ?? resolved.config.baseUrl ?? provider.baseUrl;
    const identifyHttp = createAuthedHttp({
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      strategy: provider.auth,
      connectionId: '(pending)',
      getCredentials: async () => creds,
      redactor,
      fetch: fetchImpl,
      ...(retry ? { retry } : {}),
    });
    const identity = provider.identify
      ? await provider.identify(identifyHttp, idCtx)
      : { accountId: `${provider.id}:default` };

    // Per-connection context captured at connect — stored on the connection, read by actions
    // (ctx.config / httpAction request config; ctx.http uses connBaseUrl). Keeps site ids OFF the
    // action input schema (out of the agent's hands).
    const connConfig = identity.config;
    const connBaseUrl = derivedBaseUrl ?? identity.baseUrl;

    const grantedScopes = grantedFrom(ts, req.scopes);
    const now = new Date(clock.now()).toISOString();

    if (req.intent === 'add_scopes') {
      if (!req.existingConnectionId) throw new ConnectorError('internal_error', 'add_scopes without existingConnectionId');
      const existing = await store.get(req.existingConnectionId);
      if (!existing || existing.connection.ownerId !== req.ownerId) {
        throw new ConnectorError('connection_not_found', 'connection to upgrade not found');
      }
      // BOUND re-consent/reconnect: refuse if the user authorized a *different* account OR the
      // re-auth resolved to a *different* client than the one being upgraded (§7, authconfig §6).
      if (identity.accountId !== existing.connection.accountId) {
        throw new ConnectorError(
          'consent_account_mismatch',
          'the authorized account does not match the connection being upgraded; connect it separately instead',
        );
      }
      if (req.authConfigId !== existing.connection.authConfigId) {
        throw new ConnectorError(
          'consent_account_mismatch',
          'the authorized connection method does not match the connection being upgraded',
        );
      }
      const updated: Connection = {
        ...existing.connection,
        scopes: uniqueScopes(existing.connection.scopes, grantedScopes),
        // Re-auth re-derives identity; refresh the non-secret per-connection context too (an
        // instance-bound provider's cloudId/instance_url could have moved). Parity with new_connection.
        ...(connConfig !== undefined ? { config: connConfig } : {}),
        ...(connBaseUrl !== undefined ? { baseUrl: connBaseUrl } : {}),
        status: 'active',
        updatedAt: now,
      };
      await store.save(updated, await secretBox.seal(creds));
      return updated;
    }

    // new_connection — re-connecting a known account+client upgrades it in place (idempotent).
    // The natural key extends to (ownerId, providerId, accountId, authConfigId): the same account
    // via two clients is two connections (§6).
    const siblings = await store.list({ ownerId: req.ownerId, providerId: provider.id });
    const match = siblings.find(
      (c) => c.accountId === identity.accountId && c.authConfigId === req.authConfigId,
    );
    const connection: Connection = match
      ? {
          ...match,
          scopes: uniqueScopes(match.scopes, grantedScopes),
          ...(identity.email !== undefined ? { email: identity.email } : {}),
          ...(req.label ?? identity.label ? { label: req.label ?? identity.label } : {}),
          ...(req.authConfigId !== undefined ? { authConfigId: req.authConfigId } : {}),
          ...(connConfig !== undefined ? { config: connConfig } : {}),
          ...(connBaseUrl !== undefined ? { baseUrl: connBaseUrl } : {}),
          status: 'active',
          updatedAt: now,
        }
      : {
          id: newId(),
          ownerId: req.ownerId,
          providerId: provider.id,
          accountId: identity.accountId,
          ...(identity.email !== undefined ? { email: identity.email } : {}),
          ...(req.label ?? identity.label ? { label: req.label ?? identity.label } : {}),
          ...(req.authConfigId !== undefined ? { authConfigId: req.authConfigId } : {}),
          ...(connConfig !== undefined ? { config: connConfig } : {}),
          ...(connBaseUrl !== undefined ? { baseUrl: connBaseUrl } : {}),
          scopes: grantedScopes,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
    await store.save(connection, await secretBox.seal(creds));
    return connection;
  }

  // ── connectDirect: non-OAuth credential connect (§ direct strategies) ──────
  async function connectDirect(providerId: string, opts: ConnectDirectOptions): Promise<Connection> {
    const provider = requireProvider(providerId);
    if (provider.auth.kind !== opts.credential.type) {
      throw new ConnectorError(
        'invalid_input',
        `credential type "${opts.credential.type}" does not match provider "${providerId}" strategy "${provider.auth.kind}"`,
      );
    }
    const ownerId = opts.ownerId ?? defaultOwnerId;
    const creds = opts.credential;
    registerSecrets(creds);

    // A non-OAuth config may carry a per-instance baseUrl (§3b); never an OAuth client here.
    const config = opts.authConfigId !== undefined
      ? await authConfigs!.getConfigForConnection(providerId, opts.authConfigId)
      : null;
    // Fail fast: an explicit authConfigId that resolves to nothing must NOT be silently stamped on
    // the connection (later refresh/resolve would fail with a confusing config error).
    if (opts.authConfigId !== undefined && !config) {
      throw new ConnectorError('invalid_input', `auth config "${opts.authConfigId}" not found for provider "${providerId}"`);
    }
    if (config) ensureConfigValid(config, provider);
    const baseUrl = config?.baseUrl ?? provider.baseUrl;

    let identity: { accountId: string; email?: string; label?: string; config?: Record<string, unknown>; baseUrl?: string };
    if (provider.identify) {
      const http = createAuthedHttp({
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        strategy: provider.auth,
        connectionId: '(pending)',
        getCredentials: async () => creds,
        redactor,
        fetch: fetchImpl,
        ...(retry ? { retry } : {}),
      });
      identity = await provider.identify(http, {});
    } else {
      identity = {
        accountId: opts.accountId ?? `${provider.id}:default`,
        ...(opts.email !== undefined ? { email: opts.email } : {}),
        ...(opts.label !== undefined ? { label: opts.label } : {}),
      };
    }
    const connConfig = identity.config;
    const connBaseUrl = identity.baseUrl;

    const now = new Date(clock.now()).toISOString();
    const siblings = await store.list({ ownerId, providerId });
    const match = siblings.find((c) => c.accountId === identity.accountId && c.authConfigId === opts.authConfigId);
    const label = opts.label ?? identity.label;
    const email = opts.email ?? identity.email;
    const connection: Connection = match
      ? {
          ...match,
          ...(email !== undefined ? { email } : {}),
          ...(label !== undefined ? { label } : {}),
          ...(opts.authConfigId !== undefined ? { authConfigId: opts.authConfigId } : {}),
          ...(connConfig !== undefined ? { config: connConfig } : {}),
          ...(connBaseUrl !== undefined ? { baseUrl: connBaseUrl } : {}),
          status: 'active',
          updatedAt: now,
        }
      : {
          id: newId(),
          ownerId,
          providerId,
          accountId: identity.accountId,
          ...(email !== undefined ? { email } : {}),
          ...(label !== undefined ? { label } : {}),
          ...(opts.authConfigId !== undefined ? { authConfigId: opts.authConfigId } : {}),
          ...(connConfig !== undefined ? { config: connConfig } : {}),
          ...(connBaseUrl !== undefined ? { baseUrl: connBaseUrl } : {}),
          scopes: [],
          status: 'active',
          createdAt: now,
          updatedAt: now,
        };
    await store.save(connection, await secretBox.seal(creds));
    return connection;
  }

  // ── Connection resolution (§6) ────────────────────────────────────────────
  type Resolution =
    | { kind: 'ok'; connection: Connection }
    | { kind: 'none' }
    | { kind: 'not_found' }
    | { kind: 'ambiguous'; choices: AccountChoice[] };

  async function accountChoices(providerId: string, conns: Connection[]): Promise<AccountChoice[]> {
    // Surface the minting config's label so a human can disambiguate "same email via two clients"
    // (§7). Only populated when the config carries a label (i.e. the multi-config case).
    return Promise.all(
      conns.map(async (c) => {
        const cfg = await authConfigs!.getConfigForConnection(providerId, c.authConfigId);
        return {
          connectionId: c.id,
          ...(c.email !== undefined ? { email: c.email } : {}),
          ...(c.label !== undefined ? { label: c.label } : {}),
          ...(cfg?.label ? { authConfigLabel: cfg.label } : {}),
        };
      }),
    );
  }

  async function resolveConnection(
    providerId: string,
    ownerId: string,
    connectionId?: string,
    account?: string,
  ): Promise<Resolution> {
    if (connectionId) {
      const stored = await store.get(connectionId);
      // Ownership is the boundary, not opacity: a foreign/foreign-provider id is "not found".
      if (!stored || stored.connection.ownerId !== ownerId || stored.connection.providerId !== providerId) {
        return { kind: 'not_found' };
      }
      return { kind: 'ok', connection: stored.connection };
    }
    const conns = await store.list({ ownerId, providerId });
    if (conns.length === 0) return { kind: 'none' };
    if (conns.length === 1) return { kind: 'ok', connection: conns[0] as Connection };
    if (account) {
      // The match must be UNIQUE. With >1 connection an `account` hint can match more than one
      // (the same email via two configs, or an email colliding with another connection's label).
      // We match against each candidate's full token set — email/label PLUS the auth-config-
      // disambiguated form ("me@gmail.com (Work)"), the exact string the model was shown — so a
      // duplicate email round-trips instead of looping. Never silently pick the first: 0 or >1
      // matches both fall through to needs_account.
      const labelled = await Promise.all(
        conns.map(async (c) => ({
          c,
          cfgLabel: (await authConfigs!.getConfigForConnection(providerId, c.authConfigId))?.label,
        })),
      );
      const matches = labelled.filter(({ c, cfgLabel }) => tokensFor(c, cfgLabel).includes(account));
      if (matches.length === 1) return { kind: 'ok', connection: (matches[0] as { c: Connection }).c };
    }
    return { kind: 'ambiguous', choices: await accountChoices(providerId, conns) };
  }

  /** Public: the disambiguated account choices for a provider (host/UI account pickers + tool hints). */
  async function listAccountChoices(providerId: string, opts: { ownerId?: string } = {}): Promise<AccountChoice[]> {
    const ownerId = opts.ownerId ?? defaultOwnerId;
    return accountChoices(providerId, await store.list({ ownerId, providerId }));
  }

  // ── runAction (§5) ────────────────────────────────────────────────────────
  async function runAction<O = unknown>(
    actionId: string,
    input: unknown,
    options: RunActionOptions = {},
  ): Promise<ActionOutcome<O>> {
    const ownerId = options.ownerId ?? defaultOwnerId;
    const caller: Caller = options.caller ?? { type: 'app' };

    // 1. Resolve action (pre-audit: an unknown action has no meaningful run).
    const resolved = registry.getAction(actionId);
    if (!resolved) return fail('unknown_action', `unknown action "${actionId}"`);
    const { action, provider } = resolved;
    const mutating = action.mutating ?? false;
    const risk: RiskLevel = action.risk ?? (mutating ? 'medium' : 'low');

    // 2. Validate input (still pre-audit — a malformed call learns nothing).
    const parsed = action.input.safeParse(input);
    if (!parsed.success) {
      return fail('invalid_input', formatZodError(parsed.error));
    }
    const cleanInput = parsed.data;

    // Audit start — from here, every terminal outcome emits a matching finish (§8).
    const attemptId = newAttemptId();
    const digest = inputDigest(cleanInput);
    const version = actionVersion({ inputSchema: action.input, risk, mutating });
    const inputPreview = redactor.redact(cleanInput);

    const baseEvent = {
      attemptId,
      actionId,
      caller,
      mutating,
      risk,
    } satisfies Partial<ActionRunEvent>;

    emit({ ...baseEvent, phase: 'start', status: 'ok', inputPreview });

    const finish = (status: ActionRunStatus, extra: Partial<ActionRunEvent> = {}): void => {
      emit({ ...baseEvent, phase: 'finish', status, inputPreview, ...extra });
    };

    try {
      // 3. Resolve connection (ownership-checked).
      const resolution = await resolveConnection(provider.id, ownerId, options.connectionId, options.account);
      if (resolution.kind === 'not_found') {
        finish('error', { status: 'error', errorCode: 'connection_not_found' });
        return fail('connection_not_found', 'connection not found');
      }
      if (resolution.kind === 'none') {
        // No connection yet → drive §4a connect with the scopes the ACTION needs (not config
        // defaults), so both config selection and the URL track the attempted action (§6).
        const ctx: ResolutionContext = {
          ...(ownerId !== undefined ? { ownerId } : {}),
          ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
        };
        const cr = await resolveConnectConfig(provider, ctx, { explicitScopes: action.scopes ?? [] });
        switch (cr.kind) {
          case 'resolved': {
            const scopes = uniqueScopes(provider.identityScopes, action.scopes);
            const { authorizationUrl } = await buildAuthorization({
              provider,
              config: cr.config,
              authConfigId: cr.authConfigId,
              ownerId,
              scopes,
              redirectUri: resolveRedirect(cr.config),
              intent: 'new_connection',
            });
            finish('auth_required');
            return { ok: false, reason: 'auth_required', providerId: provider.id, authorizationUrl };
          }
          case 'picker':
            finish('auth_config_required');
            return { ok: false, reason: 'auth_config_required', providerId: provider.id, choices: cr.choices };
          case 'ambiguous':
            finish('error', { status: 'error', errorCode: 'auth_config_ambiguous_default' });
            return fail('auth_config_ambiguous_default', `provider "${provider.id}" has more than one default auth client at the same visibility level`);
          case 'unavailable':
            finish('error', { status: 'error', errorCode: 'auth_config_unavailable' });
            return fail('auth_config_unavailable', `no usable auth client for "${provider.id}"`);
          case 'scope_not_allowed':
            finish('error', { status: 'error', errorCode: 'scope_not_allowed' });
            return fail('scope_not_allowed', `no auth client for "${provider.id}" can grant the required scopes`);
          case 'none':
            finish('error', { status: 'error', errorCode: 'provider_not_configured' });
            return fail('provider_not_configured', `no auth client configured for "${provider.id}"`);
        }
        // Exhaustive above; this keeps the block provably terminal so `resolution` narrows to `ok`.
        throw new ConnectorError('internal_error', 'unreachable connect resolution');
      }
      if (resolution.kind === 'ambiguous') {
        finish('needs_account', { connectionId: undefined });
        return { ok: false, reason: 'needs_account', providerId: provider.id, choices: resolution.choices };
      }
      const connection = resolution.connection;
      const meta = connectionMetadata(connection);

      // Resolve the connection's minting config once (secret-free): used for the consent/reconnect
      // URL (its clientId), the allowedScopes bound, and a per-instance base URL (§6).
      const connConfig = await authConfigs!.getConfigForConnection(provider.id, connection.authConfigId);
      if (connConfig) ensureConfigValid(connConfig, provider);
      // Per-connection base (Salesforce instance_url) > per-config base > provider default.
      const baseUrl = connection.baseUrl ?? connConfig?.baseUrl ?? provider.baseUrl;

      // 4. Scope check (action-level, least privilege) → needs_consent (§7). Honors the
      //    provider's scope hierarchy, so a broader granted scope satisfies a narrower one.
      //    Requires the ACTION's scopes only — NOT provider.identityScopes. Identity/OIDC scopes
      //    (openid, email, offline_access, profile) are requested at auth + granted at connect, but
      //    providers don't echo them verbatim (Google aliases email→userinfo.email; Microsoft omits
      //    the OIDC scopes from the token scope entirely), so gating per-call on them caused a
      //    permanent needs_consent loop. Identity is for identify()/auth, not per-call access.
      const required = action.scopes ?? [];
      const missing = required.filter((s) => !scopeHeld(provider, connection.scopes, s));
      if (missing.length > 0) {
        const requestScopes = uniqueScopes(connection.scopes, missing);
        // Bound by the minting client's allowedScopes — don't mint a doomed/over-asking URL (§6).
        if (connConfig && !scopeCovers(provider, connConfig.allowedScopes, requestScopes)) {
          finish('error', { connectionId: connection.id, status: 'error', errorCode: 'scope_not_allowed' });
          return fail('scope_not_allowed', `the connection's auth client cannot grant: ${missing.join(', ')}`);
        }
        if (!connConfig) {
          finish('error', { connectionId: connection.id, status: 'error', errorCode: 'provider_not_configured' });
          return fail('provider_not_configured', `no auth client configured for "${provider.id}"`);
        }
        const { authorizationUrl } = await buildAuthorization({
          provider,
          config: connConfig,
          authConfigId: connection.authConfigId,
          ownerId,
          scopes: requestScopes,
          redirectUri: resolveRedirect(connConfig),
          intent: 'add_scopes',
          existingConnectionId: connection.id,
        });
        finish('needs_consent', { connectionId: connection.id });
        return {
          ok: false,
          reason: 'needs_consent',
          providerId: provider.id,
          connectionId: connection.id,
          missingScopes: missing,
          authorizationUrl,
        };
      }

      // 5. Approval gate — enforced here, before any side effect or token fetch (§8).
      const decision = await approval.check({
        actionId,
        actionVersion: version,
        risk,
        mutating,
        connection: meta,
        inputDigest: digest,
        inputPreview,
        caller,
      });
      if (decision === 'deny') {
        finish('denied', { connectionId: connection.id, status: 'denied', errorCode: 'denied' });
        return fail('denied', 'action denied by policy');
      }
      if (decision === 'ask') {
        finish('approval_required', { connectionId: connection.id });
        return { ok: false, reason: 'approval_required', actionId, risk, preview: inputPreview };
      }

      // Build a bound re-auth (add_scopes) URL for the minting client — the reconnect path (§6).
      const reauth = async (): Promise<ActionOutcome<O>> => {
        if (!connConfig) {
          finish('auth_required', { connectionId: connection.id });
          // No client to rebuild the URL with — surface provider_not_configured instead of a dead URL.
          return fail('provider_not_configured', `no auth client configured for "${provider.id}"`);
        }
        const { authorizationUrl } = await buildAuthorization({
          provider,
          config: connConfig,
          authConfigId: connection.authConfigId,
          ownerId,
          scopes: uniqueScopes(connection.scopes, provider.identityScopes),
          redirectUri: resolveRedirect(connConfig),
          intent: 'add_scopes',
          existingConnectionId: connection.id,
        });
        finish('auth_required', { connectionId: connection.id });
        return { ok: false, reason: 'auth_required', providerId: provider.id, authorizationUrl };
      };

      // 6. Acquire token up front so revocation surfaces as auth_required pre-execute (§5/§9).
      try {
        await getValidCredentials(connection.id);
      } catch (e) {
        if (e instanceof NeedsReauthError) return reauth();
        throw e;
      }

      // 7. Build the authed context (honoring a per-instance base URL).
      const http = createAuthedHttp({
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        strategy: provider.auth,
        connectionId: connection.id,
        getCredentials: (force) => getValidCredentials(connection.id, force),
        redactor,
        fetch: fetchImpl,
        ...(retry ? { retry } : {}),
      });
      const ctx = {
        connection: meta,
        http,
        getToken: async () => provider.auth.tokenOf(await getValidCredentials(connection.id)),
        config: connection.config ?? {},
        clock,
        log: logger,
      };

      // 8. Execute.
      let result: O;
      try {
        result = (await action.execute(ctx, cleanInput)) as O;
      } catch (e) {
        if (e instanceof NeedsReauthError) return reauth();
        if (e instanceof ConnectorError) {
          const status: ActionRunStatus = e.indeterminate ? 'unknown' : 'error';
          finish(status, { connectionId: connection.id, status, errorCode: e.code, error: redactor.redact(e.message) });
          return fail(e.code, e.message, e.indeterminate);
        }
        const message = e instanceof Error ? e.message : String(e);
        finish('error', { connectionId: connection.id, status: 'error', errorCode: 'internal_error', error: redactor.redact(message) });
        return fail('internal_error', message);
      }

      // Output validation, if the action declared a schema.
      if (action.output) {
        const out = action.output.safeParse(result);
        if (!out.success) {
          finish('error', { connectionId: connection.id, status: 'error', errorCode: 'provider_error' });
          return fail('provider_error', 'provider returned an unexpected shape');
        }
        result = out.data as O;
      }

      // 9. Shape + redact + audit finish. The returned result is redacted too (not just the
      //    audit preview), so a secret an action surfaced can't reach a caller/projection/model.
      const safeResult = redactor.redact(result);
      finish('ok', { connectionId: connection.id, status: 'ok', outputPreview: safeResult });
      return { ok: true, result: safeResult };
    } catch (e) {
      // A taxonomy error thrown anywhere in the gated body (e.g. a transient refresh failure
      // surfaced during token acquisition) keeps its code — don't flatten it to internal_error.
      if (e instanceof ConnectorError) {
        const status: ActionRunStatus = e.indeterminate ? 'unknown' : 'error';
        finish(status, { status, errorCode: e.code, error: redactor.redact(e.message) });
        return fail(e.code, e.message, e.indeterminate);
      }
      // Genuinely unexpected failure.
      const message = e instanceof Error ? e.message : String(e);
      logger.error('runAction failed', { actionId, error: message });
      finish('error', { status: 'error', errorCode: 'internal_error', error: redactor.redact(message) });
      return fail('internal_error', message);
    }
  }

  function emit(event: ActionRunEvent): void {
    try {
      onActionRun(event);
    } catch (e) {
      logger.warn('onActionRun threw', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  // ── disconnect (§9) ───────────────────────────────────────────────────────
  async function disconnectConnection(id: string, options: DisconnectOptions = {}): Promise<void> {
    const ownerId = options.ownerId ?? defaultOwnerId;
    const revokeProvider = options.revokeProvider ?? true;
    const stored = await store.get(id);
    if (!stored) return; // idempotent
    if (stored.connection.ownerId !== ownerId) {
      throw new ConnectorError('connection_not_found', `connection "${id}" not found`);
    }
    if (revokeProvider) {
      try {
        const provider = requireProvider(stored.connection.providerId);
        const flow = provider.auth.oauth;
        if (provider.revokeUrl && flow?.revoke) {
          const creds = await secretBox.open<Credentials>(stored.sealed);
          registerSecrets(creds);
          // Revoke with the MINTING client (its stamped config), same binding rule as refresh (§6).
          const resolvedConfig = await authConfigs!.openConfigForConnection(provider.id, stored.connection.authConfigId);
          const clientId = resolvedConfig?.config.oauth?.clientId;
          const token = creds.type === 'oauth2' ? (creds.refreshToken ?? creds.accessToken) : undefined;
          if (token && clientId) {
            if (resolvedConfig?.clientSecret) redactor.register(resolvedConfig.clientSecret, 'client_secret');
            await flow.revoke({
              clientId,
              ...(resolvedConfig?.clientSecret !== undefined ? { clientSecret: resolvedConfig.clientSecret } : {}),
              token,
            });
          }
        }
      } catch (e) {
        logger.warn('provider revoke failed (continuing with local delete)', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    await store.delete(id);
  }

  // ── connection health probe (Ri `testRequest`) ─────────────────────────────
  // "Is this connection still good?" WITHOUT running a real action. Two signals, in order:
  //   (1) force a token refresh — for OAuth a successful refresh proves the grant is live; this also
  //       flips the stored status to needs_reauth on a definitive revocation;
  //   (2) a minimal authed read — provider.healthCheck (authoritative, runtime-safe) if declared,
  //       else provider.identify as a BEST-EFFORT fallback. identify is connect-semantics: it may
  //       need connect-time context (e.g. QuickBooks realmId) it can't have here, so for an OAuth
  //       connection a non-auth identify failure does NOT fail the probe — the refresh already
  //       proved liveness (we just mark the result unverified). Heals a stale status as a side effect.
  async function testConnection(
    connectionId: string,
    options: { ownerId?: string } = {},
  ): Promise<ConnectionTestResult> {
    const ownerId = options.ownerId ?? defaultOwnerId;
    const checkedAt = new Date(clock.now()).toISOString();
    const stored = await store.get(connectionId);
    if (!stored || stored.connection.ownerId !== ownerId) {
      throw new ConnectorError('connection_not_found', `connection "${connectionId}" not found`);
    }
    const connection = stored.connection;
    const provider = requireProvider(connection.providerId);

    // 1. Force a refresh (no-op for direct creds). Revocation → needs_reauth; transient → error
    //    (never tear down a healthy connection on a flaky probe).
    let creds: Credentials;
    try {
      creds = await getValidCredentials(connectionId, true);
    } catch (e) {
      if (e instanceof NeedsReauthError) return { connectionId, ok: false, status: 'needs_reauth', verified: true, checkedAt };
      const message = e instanceof Error ? e.message : String(e);
      return { connectionId, ok: false, status: 'error', verified: false, error: redactor.redact(message), checkedAt };
    }
    const isOAuth = creds.type === 'oauth2';

    // 2. Authoritative healthCheck, else best-effort identify, else just the refresh signal.
    const heal = async (): Promise<void> => {
      if (connection.status !== 'active') await store.setStatus(connectionId, 'active');
    };
    const reauth = async (): Promise<ConnectionTestResult> => {
      await store.setStatus(connectionId, 'needs_reauth', 'health probe: provider rejected credentials');
      return { connectionId, ok: false, status: 'needs_reauth', verified: true, checkedAt };
    };

    if (provider.healthCheck || provider.identify) {
      const connConfig = await authConfigs!.getConfigForConnection(provider.id, connection.authConfigId);
      const baseUrl = connection.baseUrl ?? connConfig?.baseUrl ?? provider.baseUrl;
      const http = createAuthedHttp({
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        strategy: provider.auth,
        connectionId,
        getCredentials: (force) => getValidCredentials(connectionId, force),
        redactor,
        fetch: fetchImpl,
        ...(retry ? { retry } : {}),
      });
      try {
        if (provider.healthCheck) await provider.healthCheck(http, { config: connection.config ?? {} });
        else await provider.identify!(http, {});
        await heal();
        return { connectionId, ok: true, status: 'active', verified: true, checkedAt };
      } catch (e) {
        if (e instanceof NeedsReauthError) return reauth();
        // An authoritative healthCheck failure is a real error. A best-effort identify failure for a
        // non-auth reason is only conclusive for non-OAuth (no refresh fallback); for OAuth the
        // refresh already proved liveness → active-but-unverified.
        if (provider.healthCheck || !isOAuth) {
          const message = e instanceof Error ? e.message : String(e);
          return { connectionId, ok: false, status: 'error', verified: false, error: redactor.redact(message), checkedAt };
        }
        await heal();
        return { connectionId, ok: true, status: 'active', verified: false, checkedAt };
      }
    }

    // 3. No probe declared. For OAuth the forced refresh confirmed liveness; for non-OAuth we only
    //    know the secret is present (unverified).
    await heal();
    return { connectionId, ok: true, status: 'active', verified: isOAuth, checkedAt };
  }

  return {
    beginAuth,
    completeAuth,
    connectDirect,
    listConnections: (filter) => store.list(filter),
    listAccountChoices,
    runAction,
    testConnection,
    disconnectConnection,
    getToolkits: () => registry.toolkits(),
    getProviders: () => registry.providers(),
  };
}

/**
 * The `account` strings that resolve to this connection: its email/label, plus the auth-config-
 * disambiguated forms ("email (Work)") when the minting config has a label. Mirrors
 * `accountDisplay` (projection-shared) so what the model is shown is exactly what resolves.
 */
function tokensFor(conn: Connection, cfgLabel?: string): string[] {
  const bases = [conn.email, conn.label].filter((s): s is string => !!s);
  const tokens = [...bases];
  if (cfgLabel) for (const b of bases) tokens.push(`${b} (${cfgLabel})`);
  return tokens;
}

function grantedFrom(ts: TokenSet, requested: string[]): string[] {
  // Prefer the strategy-normalized `scope` (set by a mapTokenResponse hook for providers that
  // nest/rename it), else the raw token-response scope.
  const rawScope = (ts.raw as { scope?: string } | undefined)?.scope;
  const scope = ts.scope ?? rawScope;
  // The OAuth2 spec delimits the granted `scope` with spaces, but some providers use commas
  // (Slack). Split on either — scope tokens (URLs / `provider:resource`) never contain a space or
  // comma — so a comma-delimited grant doesn't mash into one bogus scope and loop on needs_consent.
  if (scope && typeof scope === 'string') return scope.split(/[\s,]+/).filter(Boolean);
  return requested;
}

function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}
