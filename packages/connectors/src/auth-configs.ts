/**
 * The in-memory `AuthConfigRegistry` (authconfig spec §4/§5/§9 Case A).
 *
 * A visibility-scoped data source over a fixed set of auth configs — the multi-client
 * successor to `staticOAuthApps`. The runtime owns selection (§4a); this module only answers
 * "which configs exist, by id, with or without the secret." Two key invariants live here:
 *
 *  1. **The secret never rides on safe metadata.** The inline `clientSecret` on the input is
 *     split into an in-process map at construction; `AuthConfig` (and every read method except
 *     `openConfigForConnection`) is secret-free. Mirrors how `ConnectionStore` holds opaque
 *     sealed bytes while the runtime owns plaintext.
 *  2. **Self-contained registration invariants** (globally-unique id, label-when->1,
 *     ≤1 default per visibility key, scope-field presence) are checked synchronously at
 *     construction. The *provider-dependent* invariants (scheme match, defaultScopes ⊆
 *     allowedScopes — §3a) need the provider and are enforced by the runtime at first
 *     resolution, since this registry is intentionally provider-agnostic.
 */
import { ConnectorError } from './core/errors';
import type {
  AuthConfig,
  AuthConfigRegistry,
  AuthConfigStore,
  AuthConfigSummary,
  OAuthAppConfig,
  ResolutionContext,
  ResolvedAuthConfig,
  SecretBox,
} from './core/types';

/** An {@link AuthConfig} plus the inline `clientSecret` that gets split out before storage. */
export type AuthConfigInput = AuthConfig & { clientSecret?: string };

/**
 * Either the legacy single-client-per-provider record (becomes one `global` `oauth2` default
 * per provider) or an explicit list of configs. Operator/env configs are conventionally
 * `global`; owner/tenant (BYO) clients carry sealed secrets and belong in the Case B
 * `AuthConfigStore` (deferred) — though the array form accepts any scope so tests and adapters
 * can build arbitrary registries.
 */
export type StaticAuthConfigsInput = Record<string, OAuthAppConfig> | AuthConfigInput[];

function visibilityKey(c: AuthConfig): string {
  switch (c.scope) {
    case 'global':
      return 'global';
    case 'tenant':
      return `tenant:${c.tenantId}`;
    case 'owner':
      return `owner:${c.ownerId}`;
  }
}

function visibleIn(c: AuthConfig, ctx: ResolutionContext): boolean {
  switch (c.scope) {
    case 'global':
      return true;
    case 'tenant':
      return ctx.tenantId != null && c.tenantId === ctx.tenantId;
    case 'owner':
      return ctx.ownerId != null && c.ownerId === ctx.ownerId;
  }
}

function summarize(c: AuthConfig): AuthConfigSummary {
  return {
    id: c.id,
    providerId: c.providerId,
    scheme: c.scheme,
    ...(c.label !== undefined ? { label: c.label } : {}),
    isDefault: c.isDefault ?? false,
    status: c.status,
  };
}

/** Self-contained registration invariants (those that need no provider) — §3/§4a. */
function validateStaticConfigs(configs: AuthConfig[]): void {
  const ids = new Set<string>();
  const byProvider = new Map<string, AuthConfig[]>();
  const defaultKeys = new Set<string>();

  for (const c of configs) {
    if (ids.has(c.id)) {
      throw new ConnectorError('internal_error', `duplicate AuthConfig id "${c.id}" (ids are globally unique)`);
    }
    ids.add(c.id);

    if (c.scope === 'tenant' && c.tenantId == null) {
      throw new ConnectorError('internal_error', `AuthConfig "${c.id}" has scope 'tenant' but no tenantId`);
    }
    if (c.scope === 'owner' && c.ownerId == null) {
      throw new ConnectorError('internal_error', `AuthConfig "${c.id}" has scope 'owner' but no ownerId`);
    }
    if (c.scheme === 'oauth2' && !c.oauth) {
      throw new ConnectorError('internal_error', `AuthConfig "${c.id}" is scheme 'oauth2' but has no oauth client identity`);
    }

    const list = byProvider.get(c.providerId) ?? [];
    list.push(c);
    byProvider.set(c.providerId, list);

    if (c.isDefault) {
      const key = `${c.providerId}|${visibilityKey(c)}`;
      if (defaultKeys.has(key)) {
        // Two defaults at one EXACT visibility level is an operator misconfig that would make
        // implicit resolution nondeterministic (§4a step 3). Caught loudly at construction.
        throw new ConnectorError(
          'auth_config_ambiguous_default',
          `provider "${c.providerId}" has more than one default AuthConfig at the same visibility level`,
        );
      }
      defaultKeys.add(key);
    }
  }

  // Every pickable config must be nameable: with >1 config for a provider, each needs a label
  // (the model-safe picker never falls back to an opaque id).
  for (const [providerId, list] of byProvider) {
    if (list.length > 1) {
      const unnamed = list.find((c) => c.label == null || c.label === '');
      if (unnamed) {
        throw new ConnectorError(
          'internal_error',
          `provider "${providerId}" has >1 AuthConfig, so each needs a label; "${unnamed.id}" has none`,
        );
      }
    }
  }
}

/** Build a visibility-scoped, secret-splitting `AuthConfigRegistry` over a fixed config set. */
function makeRegistry(configs: AuthConfig[], secrets: Map<string, string>): AuthConfigRegistry {
  const forProvider = (providerId: string): AuthConfig[] => configs.filter((c) => c.providerId === providerId);

  // `undefined` authConfigId ⇒ the provider's legacy default: the marked default, or — when a
  // provider has exactly one config — that one. With >1 config and no marked default, `undefined`
  // is unresolvable here (it needs ctx/precedence, which connection-bound resolution lacks by
  // design); §5 freezes the default while undefined connections exist, so this stays well-defined.
  const legacyDefault = (providerId: string): AuthConfig | null => {
    const list = forProvider(providerId);
    const marked = list.find((c) => c.isDefault);
    if (marked) return marked;
    return list.length === 1 ? (list[0] as AuthConfig) : null;
  };

  const byId = (providerId: string, authConfigId: string | undefined): AuthConfig | null => {
    if (authConfigId == null) return legacyDefault(providerId);
    return forProvider(providerId).find((c) => c.id === authConfigId) ?? null;
  };

  return {
    async listForConnect(providerId, ctx) {
      return forProvider(providerId).filter((c) => visibleIn(c, ctx));
    },
    async getConfigForConnection(providerId, authConfigId) {
      return byId(providerId, authConfigId);
    },
    async openConfigForConnection(providerId, authConfigId) {
      const config = byId(providerId, authConfigId);
      if (!config) return null;
      const clientSecret = secrets.get(config.id);
      return { config, ...(clientSecret !== undefined ? { clientSecret } : {}) } satisfies ResolvedAuthConfig;
    },
    async listForProvider(providerId, ctx) {
      return forProvider(providerId)
        .filter((c) => visibleIn(c, ctx))
        .map(summarize);
    },
  };
}

/**
 * The common-case `AuthConfigRegistry`. Accepts the legacy single-client record (each provider
 * → one `global` `oauth2` default) or an explicit `AuthConfig[]`. Inline `clientSecret`s are
 * split into an in-process map so the safe `AuthConfig` records — and every read method except
 * `openConfigForConnection` — never carry a secret.
 */
export function staticAuthConfigs(input: StaticAuthConfigsInput): AuthConfigRegistry {
  const configs: AuthConfig[] = [];
  const secrets = new Map<string, string>();

  if (Array.isArray(input)) {
    for (const item of input) {
      const { clientSecret, ...config } = item;
      configs.push(config);
      if (clientSecret) secrets.set(config.id, clientSecret);
    }
  } else {
    for (const [providerId, app] of Object.entries(input)) {
      const config: AuthConfig = {
        id: providerId,
        providerId,
        scheme: 'oauth2',
        isDefault: true,
        scope: 'global',
        oauth: { clientId: app.clientId, redirectUri: app.redirectUri },
        status: 'active',
      };
      configs.push(config);
      if (app.clientSecret) secrets.set(config.id, app.clientSecret);
    }
  }

  validateStaticConfigs(configs);
  return makeRegistry(configs, secrets);
}

export interface StoreAuthConfigRegistryOptions {
  /**
   * Code/operator-shipped configs (bundled default PUBLIC clients, or env-derived operator
   * clients). Inline `clientSecret`s are held in-process (never persisted) — same as
   * `staticAuthConfigs`. Conventionally `global`.
   */
  bundled?: AuthConfigInput[];
  /** Persisted user/tenant (BYO) configs — secrets sealed (authconfig §9 Case B). */
  store: AuthConfigStore;
  /** Opens a BYO config's sealed `clientSecret` (only on `openConfigForConnection`). */
  secretBox: SecretBox;
}

/**
 * An `AuthConfigRegistry` composing **bundled** configs (in-process, code/env) with a persisted
 * **BYO store** (sealed). This is the production shape (authconfig §9): most users ride the
 * bundled default; power users add their own client through the admin service, which lands in the
 * store. Visibility-filters both sources; only `openConfigForConnection` opens a secret — bundled
 * from the in-process map, BYO from the sealed store via `SecretBox`. URL-building stays secret-free.
 */
export function storeAuthConfigRegistry(opts: StoreAuthConfigRegistryOptions): AuthConfigRegistry {
  const bundledConfigs: AuthConfig[] = [];
  const bundledSecrets = new Map<string, string>();
  for (const item of opts.bundled ?? []) {
    const { clientSecret, ...config } = item;
    bundledConfigs.push(config);
    if (clientSecret) bundledSecrets.set(config.id, clientSecret);
  }
  validateStaticConfigs(bundledConfigs);

  const bundledFor = (providerId: string) => bundledConfigs.filter((c) => c.providerId === providerId);
  const combinedFor = async (providerId: string): Promise<AuthConfig[]> => [
    ...bundledFor(providerId),
    ...(await opts.store.listForProvider(providerId)),
  ];

  // `undefined` authConfigId ⇒ the provider's default across bundled ∪ store (§5 keeps it stable).
  const legacyDefaultId = async (providerId: string): Promise<string | null> => {
    const list = await combinedFor(providerId);
    const marked = list.find((c) => c.isDefault);
    if (marked) return marked.id;
    return list.length === 1 ? (list[0] as AuthConfig).id : null;
  };

  const configById = async (providerId: string, id: string): Promise<AuthConfig | null> => {
    const b = bundledFor(providerId).find((c) => c.id === id);
    if (b) return b;
    const s = await opts.store.get(id);
    return s && s.config.providerId === providerId ? s.config : null;
  };

  const open = async (providerId: string, id: string): Promise<ResolvedAuthConfig | null> => {
    const b = bundledFor(providerId).find((c) => c.id === id);
    if (b) {
      const sec = bundledSecrets.get(b.id);
      return { config: b, ...(sec !== undefined ? { clientSecret: sec } : {}) };
    }
    const s = await opts.store.get(id);
    if (!s || s.config.providerId !== providerId) return null;
    const clientSecret = s.sealedSecret !== undefined ? await opts.secretBox.open<string>(s.sealedSecret) : undefined;
    return { config: s.config, ...(clientSecret !== undefined ? { clientSecret } : {}) };
  };

  return {
    async listForConnect(providerId, ctx) {
      return (await combinedFor(providerId)).filter((c) => visibleIn(c, ctx));
    },
    async getConfigForConnection(providerId, authConfigId) {
      if (authConfigId == null) {
        const id = await legacyDefaultId(providerId);
        return id ? configById(providerId, id) : null;
      }
      return configById(providerId, authConfigId);
    },
    async openConfigForConnection(providerId, authConfigId) {
      const id = authConfigId == null ? await legacyDefaultId(providerId) : authConfigId;
      return id ? open(providerId, id) : null;
    },
    async listForProvider(providerId, ctx) {
      return (await combinedFor(providerId)).filter((c) => visibleIn(c, ctx)).map(summarize);
    },
  };
}
