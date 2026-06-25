/**
 * AuthConfig admin/management service (authconfig spec §9 Case B). The host's "use your own OAuth
 * app" surface calls this. It is the ONE place a plaintext `clientSecret` enters — it seals it via
 * `SecretBox` before the raw `AuthConfigStore` ever sees it — and the place that enforces the
 * **cross-store invariants** a raw store can't (it holds BOTH the `AuthConfigStore` and the
 * `ConnectionStore`):
 *
 *   - **delete is blocked while live connections reference the config** (§8) — orphaning tokens
 *     leaves un-refreshable, un-revocable connections; archive or disconnect first;
 *   - **the default can't be repointed while legacy (unstamped) connections exist** (§5) — that
 *     would silently change which client refreshes their tokens.
 */
import { newId } from './ids';
import { ConnectorError } from './errors';
import { assertAuthConfigValidForProvider } from './auth-config-validate';
import type {
  AuthConfig,
  AuthConfigStatus,
  AuthConfigStore,
  AuthConfigSummary,
  AuthScheme,
  ConnectionStore,
  Provider,
  SecretBox,
} from './types';

export interface AddAuthConfigInput {
  providerId: string;
  scheme: AuthScheme;
  /** Required for a BYO config (it always coexists with the bundled default → a picker is possible). */
  label: string;
  scope?: 'owner' | 'tenant'; // default 'owner'; BYO is never 'global'
  ownerId?: string;
  tenantId?: string;
  oauth?: { clientId: string; redirectUri: string };
  /** Plaintext — sealed here, never handed to the store. */
  clientSecret?: string;
  defaultScopes?: string[];
  allowedScopes?: string[];
  baseUrl?: string;
  /** Optional explicit id; defaults to a generated, provider-prefixed id. */
  id?: string;
}

export interface AuthConfigAdmin {
  addConfig(input: AddAuthConfigInput): Promise<AuthConfigSummary>;
  removeConfig(id: string): Promise<void>;
  setDefault(providerId: string, id: string): Promise<void>;
  setStatus(id: string, status: AuthConfigStatus): Promise<void>;
  list(providerId: string): Promise<AuthConfigSummary[]>;
}

export interface AuthConfigAdminDeps {
  store: AuthConfigStore;
  connections: ConnectionStore;
  secretBox: SecretBox;
  /**
   * Optional provider lookup — when supplied, a new config is checked for scheme/scope
   * compatibility BEFORE it's persisted (else the only check is the runtime's lazy one at first
   * connect, which would have written a bad config).
   */
  getProvider?: (providerId: string) => Provider | undefined;
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

export function createAuthConfigAdmin(deps: AuthConfigAdminDeps): AuthConfigAdmin {
  return {
    async addConfig(input) {
      const scope = input.scope ?? 'owner';
      if (!input.label) throw new ConnectorError('invalid_input', 'a BYO auth config requires a label');
      if (scope === 'owner' && !input.ownerId) throw new ConnectorError('invalid_input', "scope 'owner' requires ownerId");
      if (scope === 'tenant' && !input.tenantId) throw new ConnectorError('invalid_input', "scope 'tenant' requires tenantId");
      if (input.scheme === 'oauth2' && !input.oauth) {
        throw new ConnectorError('invalid_input', 'an oauth2 config requires oauth { clientId, redirectUri }');
      }

      const id = input.id ?? `${input.providerId}-${newId()}`;
      if (await deps.store.get(id)) throw new ConnectorError('conflict', `auth config "${id}" already exists`);

      const config: AuthConfig = {
        id,
        providerId: input.providerId,
        scheme: input.scheme,
        label: input.label,
        scope,
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.tenantId !== undefined ? { tenantId: input.tenantId } : {}),
        ...(input.oauth !== undefined ? { oauth: input.oauth } : {}),
        ...(input.defaultScopes !== undefined ? { defaultScopes: input.defaultScopes } : {}),
        ...(input.allowedScopes !== undefined ? { allowedScopes: input.allowedScopes } : {}),
        ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
        status: 'active',
      };

      // Reject an incompatible config (wrong scheme, over-broad scopes) BEFORE persisting it.
      const provider = deps.getProvider?.(input.providerId);
      if (provider) assertAuthConfigValidForProvider(config, provider, 'invalid_input');

      const sealed = input.clientSecret !== undefined ? await deps.secretBox.seal(input.clientSecret) : undefined;
      await deps.store.create(config, sealed);
      return summarize(config);
    },

    async removeConfig(id) {
      const entry = await deps.store.get(id);
      if (!entry) return; // idempotent
      const refs = await deps.connections.list({ providerId: entry.config.providerId });
      if (refs.some((c) => c.authConfigId === id)) {
        throw new ConnectorError(
          'conflict',
          `cannot delete auth config "${id}" while connections use it — archive it, or disconnect those connections first`,
        );
      }
      await deps.store.delete(id);
    },

    async setDefault(providerId, id) {
      // The store no-ops on an unknown id, so reject up front (else the route reports a false success).
      const entry = await deps.store.get(id);
      if (!entry || entry.config.providerId !== providerId) {
        throw new ConnectorError('invalid_input', `no auth config "${id}" for provider "${providerId}"`);
      }
      const conns = await deps.connections.list({ providerId });
      if (conns.some((c) => c.authConfigId == null)) {
        throw new ConnectorError(
          'conflict',
          `cannot repoint the default for "${providerId}" while legacy (unstamped) connections exist — backfill them first (§5)`,
        );
      }
      await deps.store.setDefault(providerId, id);
    },

    async setStatus(id, status) {
      await deps.store.setStatus(id, status);
    },

    async list(providerId) {
      return (await deps.store.listForProvider(providerId)).map(summarize);
    },
  };
}
