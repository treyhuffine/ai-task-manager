/**
 * App host wiring for the connector engine (`@connectors/engine`) — the reference "host".
 * It implements the engine's ports against local, precious storage (a file-backed
 * `ConnectionStore` under `.config/connectors`, an AES `SecretBox` keyed from a non-synced key
 * file) and registers ALL first-party providers. OAuth client credentials come from env, one
 * per provider; API-key / custom providers are connected by pasting a credential (connectDirect).
 * The engine core never imports any of this.
 */
import { desktopEnabled, desktopRelayFor } from './desktop-oauth';
import fs from 'node:fs';
import path from 'node:path';
import {
  createConnectorRuntime,
  createRegistry,
  createRedactor,
  fileLock,
  storeAuthConfigRegistry,
  createAuthConfigAdmin,
  ConnectorError,
  type AuthConfigAdmin,
  type AuthConfigInput,
  type ConnectorRuntime,
  type Credentials,
  type CredentialType,
} from '@connectors/engine';
import { aesGcmSecretBox, generateSecretKey } from '@connectors/engine/crypto';
import { fileStore, authConfigFileStore } from '@connectors/engine/store';
import {
  registerAllProviders,
  PROVIDER_CATALOG,
  DEFAULT_AUTH_CONFIGS,
  HOSTED_MCP_PROVIDERS,
  getHostedMcpProvider,
  type ProviderCatalogEntry,
  type HostedMcpEndpointSetup,
} from '@connectors/engine/providers';
import { toToolSet } from '@connectors/engine/ai-sdk';
import { connectMcpClient, ingestMcpServers, type ConnectedMcpClient, type McpToolDef } from '@connectors/engine/mcp';
import type { ToolSet } from 'ai';
import { appApprovalPolicy } from './approval';
import { getConfigDir } from '@/lib/config/paths';
import { getRemoteBaseUrl, getLocalBaseUrl } from '@/lib/auth/bootstrap';
import { mcpServerStore, type McpServerStore, type McpServerAuth, type McpServerEntry } from './mcp-servers';
import { makeMcpOAuthProvider, type McpOAuthState } from './mcp-oauth';
import { registerMcpSecrets } from './mcp-secrets';
import { APP_NAME } from '@/constants/app';
import { getWorkspace } from '@/lib/db/queries';
import { resolveConnectorFilter, type WorkspaceConnectorFilter } from './workspace-filter';
import { withLiveCallback } from './live-callback';
import { hostedMcpConnectionId, hostedMcpDefinition, hostedMcpRequiresAuth, markHostedMcpReconnectRequired, hostedMcpEndpointSetup, trustHostedMcpAnnotations } from './hosted-mcp';
import { finalizeMcpServer, finalizeMcpServers, isCurrentMcpTransport } from './mcp-lifecycle';
import { resolveHostedOAuthConfig, usesRegisteredOAuth } from './hosted-oauth-config';

const CONNECTOR_CALLBACK_PATH = '/api/connectors/callback';

/**
 * The shared OAuth callback every provider redirects back to. Must be an
 * absolute, externally-reachable URL the user has registered with the provider.
 * Resolution (first hit wins):
 *   1. `CONNECTORS_REDIRECT_URI` — explicit full-URI override (operator pins it)
 *   2. the tunnel URL — how external/remote devices reach this host
 *   3. the stable portless hostname (e.g. `https://ri.localhost`)
 *   4. loopback on the running port — local-only fallback
 *
 * Previously this hardcoded `localhost:4224`, so a user accessing the app via a
 * device/tunnel URL saw (and registered) the wrong callback. Because the URL is
 * baked into the cached runtime's auth configs, base-URL changes call
 * `invalidateConnectorRuntime()` so the redirect updates without a restart.
 */
export function getConnectorRedirectUri(): string {
  const explicit = process.env.CONNECTORS_REDIRECT_URI;
  if (explicit) return explicit;
  // A configured remote tunnel wins (external providers must reach the callback);
  // otherwise the canonical public origin. `getLocalBaseUrl()` resolves the
  // public HTTPS origin under `--http2` (via the launcher override / runtime
  // record) instead of the private Next port that `PORT` now points at.
  const base = getRemoteBaseUrl() ?? getLocalBaseUrl();
  return `${base.replace(/\/+$/, '')}${CONNECTOR_CALLBACK_PATH}`;
}

/**
 * Read a provider's OAuth client from env: `CONNECTORS_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET`
 * (+ optional `_REDIRECT_URI`). Google also accepts the legacy `GOOGLE_CLIENT_ID/SECRET`.
 */
function oauthClientFromEnv(providerId: string): { clientId: string; clientSecret?: string; redirectUri: string } | null {
  const up = providerId.toUpperCase();
  const clientId = process.env[`CONNECTORS_${up}_CLIENT_ID`] ?? (providerId === 'google' ? process.env.GOOGLE_CLIENT_ID : undefined);
  const clientSecret = process.env[`CONNECTORS_${up}_CLIENT_SECRET`] ?? (providerId === 'google' ? process.env.GOOGLE_CLIENT_SECRET : undefined);
  if (!clientId) return null;
  const redirectUri =
    process.env[`CONNECTORS_${up}_REDIRECT_URI`] ??
    (providerId === 'google' ? process.env.CONNECTORS_GOOGLE_REDIRECT_URI : undefined) ??
    (usesRegisteredOAuth(getHostedMcpProvider(providerId)) ? getRegisteredMcpRedirectUrl(providerId) : getConnectorRedirectUri());
  return { clientId, clientSecret, redirectUri };
}

/** Build the env-sourced OAuth configs (one global default per configured provider). */
function buildAuthConfigs(): AuthConfigInput[] {
  const configs: AuthConfigInput[] = [];
  for (const entry of PROVIDER_CATALOG) {
    if (entry.method !== 'oauth2' && !usesRegisteredOAuth(getHostedMcpProvider(entry.id))) continue;
    const c = oauthClientFromEnv(entry.id);
    if (!c) continue;
    configs.push({
      id: entry.id,
      providerId: entry.id,
      scheme: 'oauth2',
      isDefault: true,
      scope: 'global',
      oauth: { clientId: c.clientId, redirectUri: c.redirectUri },
      clientSecret: c.clientSecret,
      status: 'active',
    });
  }
  return configs;
}

export interface HostedAccountStatus {
  serverId: string;
  connectionId: string;
  accountId: string;
  label: string;
  enabled: boolean;
  authKind?: Exclude<McpServerEntry['auth']['kind'], 'header'>;
  configured: boolean;
  requiresAuth: boolean;
  authConfigId?: string;
  endpointConfig?: HostedMcpEndpointSetup;
  status?: McpServerEntry['lastStatus'];
  error?: string;
  toolCount?: number;
  lastCheckedAt?: string;
  lastAuthorizationId?: string;
  capabilityRevision?: string;
  capabilityChanges?: McpServerEntry['capabilityChanges'];
}

export interface ProviderStatus extends ProviderCatalogEntry {
  /** OAuth providers: client configured in env. API-key/custom: always true (paste at connect). */
  configured: boolean;
  desktopCallback?: { kind: 'loopback' | 'relay'; redirectUri?: string };
  mcp?: { serverId?: string; status?: 'ok' | 'unreachable' | 'error'; error?: string; requiresAuth: boolean; authKind?: 'oauth' | 'bearer' | 'none'; tokenAuth?: { label: string; helpUrl: string }; credentialLabel?: string; helpUrl?: string; endpointConfig?: HostedMcpEndpointSetup; oauthRegistration?: 'dynamic' | 'registered'; authConfigId?: string; redirectUri?: string; accounts: HostedAccountStatus[] };
}

/**
 * Per-provider connect readiness + how each connects — drives the Connections UI. An OAuth
 * provider is "configured" if ANY usable client resolves: a bundled default, an operator env
 * client, or a user's BYO config in the home store. API-key/custom providers are always ready
 * (the key is pasted at connect).
 */
export async function getProviderStatuses(nativeDesktop = false): Promise<ProviderStatus[]> {
  const admin = await getConnectorAdmin();
  const providers = nativeDesktop && desktopEnabled() ? (await getConnectorRuntime()).getProviders() : [];
  return Promise.all(
    PROVIDER_CATALOG.map(async (entry) => {
      if (entry.method === 'mcp') {
        const servers = getMcpServerStore();
        const entries = servers.list().filter((s) => s.providerId === entry.id);
        const definition = getHostedMcpProvider(entry.id)!;
        const auth = definition.auth ?? { kind: 'oauth' as const };
        const registered = usesRegisteredOAuth(definition);
        let configured = true;
        if (registered) {
          const registry = getConnectorAuthConfigRegistry();
          const configs = await registry.listForConnect(entry.id, { ownerId: getConnectorOwnerId() });
          configured = false;
          for (const config of configs) {
            try {
              await resolveHostedOAuthConfig(definition, registry, getConnectorOwnerId(), getRegisteredMcpRedirectUrl(entry.id), config.id);
              configured = true;
              break;
            } catch { /* Unusable clients are shown under setup, without exposing secret values. */ }
          }
        }
        const accounts = await Promise.all(entries.map(async (server): Promise<HostedAccountStatus> => {
          let accountConfigured = true;
          if (registered) {
            try {
              if (!server.authConfigId) throw new Error('Missing registered app');
              const state = await servers.getOAuthState(server.id);
              const redirectUri = state?.tokens && typeof state.redirectUri === 'string' ? state.redirectUri : getRegisteredMcpRedirectUrl(entry.id);
              await resolveHostedOAuthConfig(definition, getConnectorAuthConfigRegistry(), getConnectorOwnerId(), redirectUri, server.authConfigId);
            } catch { accountConfigured = false; }
          }
          return {
            serverId: server.id, connectionId: hostedMcpConnectionId(server), accountId: server.accountId ?? `${entry.id}:default`,
            label: server.displayName, enabled: server.enabled, ...(server.auth.kind !== 'header' ? { authKind: server.auth.kind } : {}), configured: accountConfigured,
            requiresAuth: !accountConfigured || await hostedMcpRequiresAuth(server, servers),
            authConfigId: server.authConfigId, endpointConfig: hostedMcpEndpointSetup(definition, server),
            status: server.lastStatus, error: server.lastError, toolCount: server.lastToolCount, lastCheckedAt: server.lastCheckedAt,
            lastAuthorizationId: server.lastAuthorizationId,
            capabilityRevision: server.capabilityRevision, capabilityChanges: server.capabilityChanges,
          };
        }));
        const single = accounts.length === 1 ? accounts[0] : undefined;
        const unhealthy = accounts.find(account => account.status && account.status !== 'ok');
        return { ...entry, configured, ...(auth.kind === 'bearer' ? { credentialFields: ['token'] } : {}), mcp: {
          accounts,
          ...(single ? { serverId: single.serverId } : {}),
          ...(accounts.length ? { status: unhealthy?.status ?? 'ok', error: unhealthy?.error } : {}),
          authKind: auth.kind,
          ...(definition.tokenAuth ? { tokenAuth: definition.tokenAuth } : {}),
          ...(registered ? { oauthRegistration: 'registered' as const, redirectUri: getRegisteredMcpRedirectUrl(entry.id), authConfigId: single?.authConfigId } : {}),
          ...(auth.kind === 'bearer' ? { credentialLabel: auth.label, helpUrl: auth.helpUrl } : {}),
          requiresAuth: accounts.length === 0 || accounts.every(account => account.requiresAuth),
          endpointConfig: hostedMcpEndpointSetup(definition),
        } };
      }
      let configured = entry.method !== 'oauth2';
      if (entry.method === 'oauth2') {
        const hasEnvOrBundled = oauthClientFromEnv(entry.id) !== null || DEFAULT_AUTH_CONFIGS.some((c) => c.providerId === entry.id);
        configured = hasEnvOrBundled || (await admin.list(entry.id)).length > 0;
      }
      const provider = providers.find((p) => p.id === entry.id);
      let desktopCallback: ProviderStatus['desktopCallback'];
      if (provider?.auth.oauth) {
        try {
          const relay = desktopRelayFor(entry.id, provider.auth.oauth.usePkce ?? false);
          desktopCallback = relay ? { kind: 'relay', redirectUri: relay } : { kind: 'loopback' };
        } catch { desktopCallback = { kind: 'relay' }; }
      }
      return { ...entry, configured, ...(desktopCallback ? { desktopCallback } : {}) };
    }),
  );
}

/**
 * Map a provider's posted credential fields to the engine `Credentials` shape its strategy
 * expects (the catalog's `method` is a UI grouping; the real shape follows the provider's
 * `auth.kind`). A single-secret strategy takes the first field value.
 */
export function buildCredential(kind: CredentialType, fields: Record<string, string>): Credentials {
  const first = (): string => Object.values(fields)[0] ?? '';
  switch (kind) {
    case 'api_key':
      return { type: 'api_key', apiKey: fields.apiKey ?? fields.token ?? fields.key ?? first() };
    case 'bearer':
      return { type: 'bearer', token: fields.token ?? fields.apiKey ?? fields.key ?? first() };
    case 'basic':
      return { type: 'basic', username: fields.username ?? '', password: fields.password ?? '' };
    case 'custom':
      return { type: 'custom', values: fields };
    case 'oauth1':
      return {
        type: 'oauth1',
        consumerKey: fields.consumerKey ?? '',
        consumerSecret: fields.consumerSecret ?? '',
        ...(fields.token ? { token: fields.token } : {}),
        ...(fields.tokenSecret ? { tokenSecret: fields.tokenSecret } : {}),
      };
    case 'aws_sigv4':
      return {
        type: 'aws_sigv4',
        accessKeyId: fields.accessKeyId ?? '',
        secretAccessKey: fields.secretAccessKey ?? '',
        ...(fields.sessionToken ? { sessionToken: fields.sessionToken } : {}),
        ...(fields.region ? { region: fields.region } : {}),
        ...(fields.service ? { service: fields.service } : {}),
      };
    case 'jwt':
      return { type: 'jwt', key: fields.key ?? first() };
    case 'oauth2':
      throw new Error('oauth2 providers connect via the redirect flow, not connectDirect');
  }
}

function connectorsDir(): string {
  return path.join(getConfigDir(), 'connectors');
}

/** Shared metadata store, also used before a hosted connector has discovered any tools. */
export function getConnectorConnectionStore() {
  const dir = connectorsDir();
  return fileStore({ dir, lock: fileLock({ dir: path.join(dir, 'locks') }) });
}

/** Best-effort tighten a path's mode (no-op on filesystems/platforms that reject chmod). */
function hardenMode(target: string, mode: number): void {
  try {
    fs.chmodSync(target, mode);
  } catch {
    /* best-effort: some filesystems (e.g. mounted volumes) reject chmod */
  }
}

/** Read (or lazily create) the at-rest encryption key. Mode 0600, never synced. */
function getOrCreateKey(dir: string): string {
  const keyPath = path.join(dir, 'key');
  try {
    const existing = fs.readFileSync(keyPath, 'utf8').trim();
    if (existing) {
      // Re-harden on every boot: a key file restored from backup or pre-created could be too open.
      hardenMode(dir, 0o700);
      hardenMode(keyPath, 0o600);
      return existing;
    }
  } catch {
    /* fall through to create */
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  hardenMode(dir, 0o700); // mkdir mode is umask-masked; enforce it
  const key = generateSecretKey();
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  hardenMode(keyPath, 0o600);
  return key;
}

let mcpStoreCached: { dir: string; store: McpServerStore } | null = null;
/**
 * The MCP-server store (user-added remote MCP servers), built standalone from the same
 * dir + key + lock as the runtime — so routes can manage servers without building the
 * whole connector runtime. A separate `SecretBox`/`fileLock` instance over the same key
 * and dir is interchangeable with the runtime's (key-derived seal, file-based lock).
 */
export function getMcpServerStore(): McpServerStore {
  const dir = connectorsDir();
  if (mcpStoreCached?.dir === dir) return mcpStoreCached.store;
  const lock = fileLock({ dir: path.join(dir, 'locks') });
  const secretBox = aesGcmSecretBox({ key: getOrCreateKey(dir) });
  const store = mcpServerStore({ dir, secretBox, lock });
  mcpStoreCached = { dir, store };
  return store;
}

/** Deterministic engine connection id for an ingested MCP server (stable across boots). */
export function mcpConnectionId(slug: string): string {
  return `mcp-${slug}`;
}

/** The browser-reachable redirect URL for an MCP server's OAuth flow (DCR-registered, per-server). */
export function getMcpOAuthRedirectUrl(serverId: string): string {
  const origin = new URL(getConnectorRedirectUri()).origin;
  return `${origin}/api/connectors/mcp-oauth/${serverId}`;
}

/** Stable callback that can be registered before a saved server exists. */
export function getRegisteredMcpRedirectUrl(providerId: string): string {
  return getMcpOAuthRedirectUrl(`builtin_${providerId}`);
}

/** Read independently of runtime construction, which itself consumes these clients. */
export function getConnectorAuthConfigRegistry() {
  const dir = connectorsDir();
  const lock = fileLock({ dir: path.join(dir, 'locks') });
  return storeAuthConfigRegistry({
    bundled: dedupeById([...DEFAULT_AUTH_CONFIGS, ...buildAuthConfigs()]),
    store: savedAuthConfigStore(dir, lock),
    secretBox: aesGcmSecretBox({ key: getOrCreateKey(dir) }),
  });
}

/**
 * Saved OAuth apps, read with Ri's callback paths moved onto its current
 * address, never the one stored when the app was added (`live-callback.ts`).
 */
function savedAuthConfigStore(dir: string, lock: ReturnType<typeof fileLock>) {
  return withLiveCallback(authConfigFileStore({ dir, lock }), () => new URL(getConnectorRedirectUri()).origin);
}

export async function selectHostedOAuthConfig(providerId: string, selectedId?: string) {
  const definition = getHostedMcpProvider(providerId);
  if (!definition || !usesRegisteredOAuth(definition)) throw new Error('This connector does not use a registered OAuth app.');
  return resolveHostedOAuthConfig(definition, getConnectorAuthConfigRegistry(), getConnectorOwnerId(), getRegisteredMcpRedirectUrl(providerId), selectedId);
}

/** Serialize pending connection creation against deleting its registered app. */
export function withHostedOAuthConfigLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
  return fileLock({ dir: path.join(connectorsDir(), 'locks') }).withLock(`mcp-auth-config:${id}`, operation);
}

/**
 * An `OAuthClientProvider` for an MCP server, backed by the sealed MCP-server store. Pass
 * `onRedirect` during an interactive add to capture the authorization URL; omit it at build time
 * (the SDK only redirects when interactive, and build can't).
 */
export function mcpOAuthProviderFor(entry: { id: string }, onRedirect?: (url: URL) => void, options?: {
  redirectUri?: string;
  interactive?: boolean;
  callbackChannel?: 'web' | 'desktop';
  onState?: (state: McpOAuthState) => void;
}) {
  const store = getMcpServerStore();
  const server = store.get(entry.id);
  const hosted = server ? hostedMcpDefinition(server) : undefined;
  const profile = hosted?.auth?.kind === 'oauth' ? hosted.auth : undefined;
  const registered = usesRegisteredOAuth(hosted);
  return makeMcpOAuthProvider({
    redirectUrl: registered ? getRegisteredMcpRedirectUrl(hosted!.id) : options?.redirectUri ?? getMcpOAuthRedirectUrl(entry.id),
    clientName: APP_NAME,
    grantTypes: profile?.grantTypes,
    tokenEndpointAuthMethod: profile?.tokenEndpointAuthMethod,
    scopes: profile?.scopes,
    requireInteractiveAuthorization: profile?.authorizeBeforeConnect,
    authorizationParams: profile?.authorizationParams,
    ...(registered ? { registeredClient: async () => {
      const current = store.get(entry.id);
      // Token invalidation legitimately changes credentialRevision during SDK
      // recovery. OAuth authority is the server/client binding, while captured
      // tool transports separately enforce the credential revision on execution.
      if (!current?.enabled || !server || !current.authConfigId || current.authConfigId !== server.authConfigId ||
          current.url !== server.url || current.slug !== server.slug || current.providerId !== server.providerId ||
          current.accountId !== server.accountId || current.auth.kind !== 'oauth') {
        throw new Error('The connector OAuth app changed or was disconnected. Reconnect from Settings.');
      }
      const saved = await store.getOAuthState(entry.id);
      const redirectUri = !options?.interactive && typeof saved?.redirectUri === 'string' ? saved.redirectUri : getRegisteredMcpRedirectUrl(hosted!.id);
      const opened = await resolveHostedOAuthConfig(hosted!, getConnectorAuthConfigRegistry(), getConnectorOwnerId(), redirectUri, current.authConfigId);
      return { clientId: opened.config.oauth!.clientId, clientSecret: opened.clientSecret };
    } } : {}),
    load: async () => ((await store.getOAuthState(entry.id)) ?? {}) as McpOAuthState,
    compareAndSave: async (revision, state) => store.compareAndSetOAuthState(entry.id, revision,
      state as unknown as Record<string, unknown>) as Promise<McpOAuthState | null>,
    ...(onRedirect ? { onRedirect } : {}),
    interactive: options?.interactive,
    callbackChannel: options?.callbackChannel,
    onState: options?.onState,
  });
}

/** Build the auth header for `connectMcpClient` from the server's auth + unsealed secret. */
export function mcpAuthHeaders(auth: McpServerAuth, secret: string | null): Record<string, string> | undefined {
  if (!secret) return undefined;
  if (auth.kind === 'bearer') return { Authorization: `Bearer ${secret}` };
  if (auth.kind === 'header') return { [auth.header]: secret };
  return undefined;
}

export const MCP_TIMEOUT_MS = 10_000;
export function withTimeout<T>(p: Promise<T>, ms: number, label: string, onLateResolve?: (value: T) => void | Promise<unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then((value) => {
      clearTimeout(timer);
      if (expired) {
        void Promise.resolve().then(() => onLateResolve?.(value)).catch(() => {});
      } else resolve(value);
    }, (error) => {
      clearTimeout(timer);
      if (!expired) reject(error);
    });
  });
}

/**
 * The connector engine's single subject id. Single-user/local-first → `'local'`; the env override
 * is the seam for a future multi-tenant adapter (derive from the authenticated session, spec §20).
 */
export function getConnectorOwnerId(): string {
  return process.env.CONNECTORS_OWNER_ID ?? 'local';
}

/**
 * Whether the approval gate auto-allows everything: on in dev, never in production.
 * `CONNECTORS_AUTO_APPROVE=0` turns the real gate on in dev (to exercise approval cards). There is
 * deliberately no switch that turns the gate off in production.
 */
export function devAutoApprove(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV === 'production') return false;
  return env.CONNECTORS_AUTO_APPROVE !== '0';
}

/** De-dupe auth configs by id (operator env wins over a same-id bundled default). */
function dedupeById(configs: AuthConfigInput[]): AuthConfigInput[] {
  const byId = new Map<string, AuthConfigInput>();
  for (const c of configs) byId.set(c.id, c);
  return [...byId.values()];
}

interface Built {
  runtime: ConnectorRuntime;
  admin: AuthConfigAdmin;
  mcpClients: ConnectedMcpClient[];
  mcpViews: Map<string, McpViewConnection>;
  builtAt: number;
  configuration: string;
}

export interface McpViewConnection {
  snapshot: McpServerEntry;
  tools: McpToolDef[];
  readResource: ConnectedMcpClient['readResource'];
}

let generation = 0;
let cachedBuilt: Built | null = null;
let inFlight: Promise<Built> | null = null;

// NOTE (hosted, deferred — Phase 3): every route operates on the runtime's default `local`
// owner. The hosted/multi-tenant adapter MUST derive `ownerId` from the authenticated
// session/API key and pass it to runAction/beginAuth/connectDirect/listConnections (and pair it
// with row-level tenant isolation, spec §20). Until then this is single-user local.
async function build(): Promise<Built> {
  const buildGeneration = generation;
  const mcpViews = new Map<string, McpViewConnection>();
  const dir = connectorsDir();
  // CLI + dev server share one home, so the file store's read-modify-write and the runtime's
  // refresh single-flight need a CROSS-PROCESS lock, not an in-process mutex.
  const lock = fileLock({ dir: path.join(dir, 'locks') });
  const store = fileStore({ dir, lock });
  const secretBox = aesGcmSecretBox({ key: getOrCreateKey(dir) });
  const authConfigStore = savedAuthConfigStore(dir, lock);
  const registry = createRegistry();
  const quickbooksEnvironment = process.env.CONNECTORS_QUICKBOOKS_ENVIRONMENT;
  if (quickbooksEnvironment !== undefined && quickbooksEnvironment !== 'production' && quickbooksEnvironment !== 'sandbox') {
    throw new Error('CONNECTORS_QUICKBOOKS_ENVIRONMENT must be production or sandbox.');
  }
  registerAllProviders(registry, {
    quickbooks: {
      // Existing connections retain their stored environment. This selects new authorizations.
      environment: quickbooksEnvironment ?? 'production',
    },
  }); // all first-party providers (real global fetch)

  const redactor = createRedactor();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    authorizationRequired: request => {
      const url = new URL('/connect', getRemoteBaseUrl() ?? getLocalBaseUrl());
      url.searchParams.set('provider', request.providerId);
      url.searchParams.set('scopes', JSON.stringify(request.scopes));
      if (request.authConfigId) url.searchParams.set('client', request.authConfigId);
      if (request.existingConnectionId) url.searchParams.set('connection', request.existingConnectionId);
      return url.href;
    },
    secretBox,
    lock,
    redactor,
    // The production registry: bundled default public clients ∪ operator env clients (in-process)
    // ∪ the persisted BYO store (`.config/connectors/auth-configs.json`, secrets sealed). The home
    // store — managed via the admin/UI — is the durable, syncs-with-your-home path; env is a
    // bootstrap layer.
    authConfigs: storeAuthConfigRegistry({
      bundled: dedupeById([...DEFAULT_AUTH_CONFIGS, ...buildAuthConfigs()]),
      store: authConfigStore,
      secretBox,
    }),
    // Real grant-remembering gate (reads allow, mutating → grant-or-ask). Dev auto-allows so the
    // chat works end-to-end; production runs the real gate (resolved from the approval card in
    // chat, via /api/connectors/approve). `CONNECTORS_AUTO_APPROVE=0` runs the real gate in dev.
    approval: appApprovalPolicy({ autoApprove: devAutoApprove() }),
    onActionRun: (e) => {
      if (e.phase === 'finish') {
        // Redacted previews; safe to log. Helps eyeball the flow during testing.
        console.log(`[connectors] ${e.actionId} → ${e.status}`);
      }
    },
  });

  // Manages BYO auth configs (seals secrets, enforces cross-store invariants) for the admin UI.
  // `getProvider` lets it reject a scheme/scope-incompatible config before persisting it.
  const admin = createAuthConfigAdmin({
    store: authConfigStore,
    connections: store,
    secretBox,
    getProvider: (id) => usesRegisteredOAuth(getHostedMcpProvider(id)) ? undefined : registry.getProvider(id),
  });
  const removeConfig = admin.removeConfig.bind(admin);
  admin.removeConfig = async (id) => withHostedOAuthConfigLock(id, async () => {
    if (getMcpServerStore().list().some(server => server.authConfigId === id)) {
      throw new ConnectorError('conflict', 'Disconnect the connector or cancel its pending setup before removing its OAuth app.');
    }
    await removeConfig(id);
  });

  // Discover accounts independently, then publish each provider once. Its canonical
  // tools dispatch through the selected connection rather than the last client loaded.
  const mcpClients: ConnectedMcpClient[] = [];
  const mcpStore = getMcpServerStore();
  const entries = mcpStore.list();
  for (const definition of HOSTED_MCP_PROVIDERS) {
    const accounts = entries.filter(entry => entry.providerId === definition.id);
    for (const connection of await store.list({ ownerId: getConnectorOwnerId(), providerId: definition.id })) {
      const account = accounts.find(entry => hostedMcpConnectionId(entry) === connection.id);
      if (await hostedMcpRequiresAuth(account, mcpStore)) {
        await markHostedMcpReconnectRequired(definition.id, store, getConnectorOwnerId(), connection.id);
      }
    }
  }
  interface PreparedAccount {
    entry: McpServerEntry;
    client: ConnectedMcpClient;
    tools: McpToolDef[];
    sessionToken: string;
    changed: boolean;
    discoveryStarted: boolean;
    ready: boolean;
  }
  const prepared: PreparedAccount[] = [];
  const recordFailure = async (entry: McpServerEntry, error: unknown) => {
    const message = redactor.redact(error instanceof Error ? error.message : String(error));
    await finalizeMcpServer(entry, mcpStore, async current => {
      if (current.providerId && await hostedMcpRequiresAuth(current, mcpStore)) {
        await markHostedMcpReconnectRequired(current.providerId, store, getConnectorOwnerId(), hostedMcpConnectionId(current));
      }
      await mcpStore.setHealth(current.id, { lastStatus: 'unreachable', lastError: message, lastCheckedAt: new Date().toISOString() });
    }).catch(() => {});
    console.warn(`[connectors] MCP server "${entry.slug}" not ingested: ${message}`);
  };
  for (const entry of entries) {
    if (!entry.enabled) continue;
    let client: ConnectedMcpClient | undefined;
    const candidate = { entry, changed: false, discoveryStarted: false, ready: false } as PreparedAccount;
    const onToolsChanged = () => {
      // An initial notification before discovery is covered by the first read.
      // During pagination it can invalidate pages already read, so restart.
      if (!candidate.discoveryStarted || candidate.changed) return;
      candidate.changed = true;
      if (candidate.ready) invalidateConnectorRuntime();
    };
    try {
      hostedMcpDefinition(entry);
      let sessionToken = 'mcp-session';
      if (entry.auth.kind === 'oauth') {
        const state = await mcpStore.getOAuthState(entry.id);
        if (state) registerMcpSecrets(redactor, state as McpOAuthState);
        if (!state?.tokens) {
          await mcpStore.setHealth(entry.id, { lastStatus: 'unreachable', lastError: 'Awaiting authorization', lastCheckedAt: new Date().toISOString() });
          continue;
        }
        client = await withTimeout(
          connectMcpClient({ url: entry.url, name: entry.slug, onToolsChanged, authProvider: mcpOAuthProviderFor(entry, undefined, { onState: state => registerMcpSecrets(redactor, state) }) }),
          MCP_TIMEOUT_MS, `connect MCP "${entry.slug}"`, lateClient => lateClient.close(),
        );
        const tokens = (await mcpStore.getOAuthState(entry.id))?.tokens as { access_token?: string } | undefined;
        sessionToken = tokens?.access_token ?? 'mcp-session';
      } else {
        const secret = await mcpStore.openSecret(entry.id);
        if (entry.providerId && entry.auth.kind === 'bearer' && !secret) {
          await mcpStore.setHealth(entry.id, { lastStatus: 'unreachable', lastError: 'A connection token is required.', lastCheckedAt: new Date().toISOString() });
          continue;
        }
        if (secret) redactor.register(secret, 'mcp_secret');
        sessionToken = secret ?? 'mcp-session';
        client = await withTimeout(
          connectMcpClient({ url: entry.url, name: entry.slug, headers: mcpAuthHeaders(entry.auth, secret), onToolsChanged }),
          MCP_TIMEOUT_MS, `connect MCP "${entry.slug}"`, lateClient => lateClient.close(),
        );
      }
      candidate.discoveryStarted = true;
      let discovered: { tools: McpToolDef[] } | undefined;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        candidate.changed = false;
        const result = await withTimeout(client.listTools(), MCP_TIMEOUT_MS, `discover MCP "${entry.slug}"`);
        if (!candidate.changed) { discovered = result; break; }
      }
      if (!discovered) throw new ConnectorError('provider_unavailable', 'The provider kept changing its tools during discovery. Test the connection again.');
      Object.assign(candidate, { client, tools: redactor.redact(discovered.tools), sessionToken, ready: true });
      prepared.push(candidate);
    } catch (error) {
      await client?.close().catch(() => {});
      await recordFailure(entry, error);
    }
  }

  const groups = new Map<string, PreparedAccount[]>();
  for (const candidate of prepared) {
    const key = candidate.entry.providerId ?? `custom:${candidate.entry.id}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  for (const accounts of groups.values()) {
    const accepted = new Set<string>();
    try {
      await finalizeMcpServers(accounts.map(account => account.entry), mcpStore, async currentAccounts => {
        const valid = currentAccounts.flatMap(current => {
          const account = accounts.find(candidate => candidate.entry.id === current.id)!;
          return account.changed ? [] : [{ account, current }];
        });
        if (!valid.length) return;
        const definitions = [];
        for (const { account, current } of valid) {
          // Another account may have loaded later. Scrub against every secret
          // known by this build before persisting or projecting any definition.
          account.tools = redactor.redact(account.tools);
          const snapshot = await mcpStore.recordCapabilities(current.id, account.tools);
          if (!snapshot) throw new Error('The connector was removed during discovery.');
          account.entry = snapshot;
          const hosted = hostedMcpDefinition(snapshot);
          definitions.push({
            name: snapshot.slug,
            client: { listTools: async () => ({ tools: account.tools }), callTool: async (params: { name: string; arguments?: Record<string, unknown> }) => redactor.redact(await account.client.callTool(params)) },
            ownerId: getConnectorOwnerId(), connectionId: hostedMcpConnectionId(snapshot), sessionToken: account.sessionToken,
            isCurrentTransport: () => {
              if (generation !== buildGeneration || account.changed || mcpStore.get(snapshot.id)?.capabilityRevision !== snapshot.capabilityRevision) {
                throw new ConnectorError('tools_changed', 'The connector tools changed. Refresh the available tools before trying again.');
              }
              return isCurrentMcpTransport(snapshot, mcpStore);
            },
            ...(hosted ? {
              identity: { providerId: hosted.id, displayName: hosted.displayName, label: snapshot.displayName, accountId: snapshot.accountId, authConfigId: snapshot.authConfigId },
              trustToolAnnotations: trustHostedMcpAnnotations(hosted),
              ...(hosted.defaultMutationRisk ? { defaultRisk: hosted.defaultMutationRisk } : {}),
            } : {}),
            ...(snapshot.toolOverrides ? { toolOverrides: snapshot.toolOverrides } : {}),
          });
        }
        const results = await ingestMcpServers(registry, store, secretBox, definitions);
        for (const result of results) {
          const { account } = valid.find(item => hostedMcpConnectionId(item.current) === result.connectionId)!;
          await mcpStore.setHealth(account.entry.id, {
            lastStatus: 'ok', lastToolCount: result.toolCount, lastCheckedAt: new Date().toISOString(),
            tools: result.tools.map(tool => ({ name: tool.name, description: tool.description })),
          });
          accepted.add(account.entry.id);
          mcpClients.push(account.client);
          mcpViews.set(account.entry.id, {
            snapshot: account.entry, tools: account.tools,
            readResource: async params => redactor.redact(await account.client.readResource(params)),
          });
        }
      });
    } catch (error) {
      for (const account of accounts) await recordFailure(account.entry, error);
    } finally {
      await Promise.all(accounts.filter(account => !accepted.has(account.entry.id)).map(account => account.client.close().catch(() => {})));
    }
  }

  const configuration = mcpConfigurationSignature(entries.map(entry => prepared.find(candidate => candidate.entry.id === entry.id)?.entry ?? entry));
  if (configuration !== mcpConfigurationSignature(mcpStore)) invalidateConnectorRuntime();
  return { runtime, admin, mcpClients, mcpViews, builtAt: Date.now(), configuration };
}

/** Changes made by another process must also refresh the tool projection. */
function mcpConfigurationSignature(source: McpServerStore | readonly McpServerEntry[]): string {
  const entries = 'list' in source ? source.list() : source;
  return JSON.stringify(entries.map(entry => ({
    id: entry.id, slug: entry.slug, providerId: entry.providerId, connectionId: entry.connectionId,
    accountId: entry.accountId, authConfigId: entry.authConfigId, displayName: entry.displayName,
    url: entry.url, enabled: entry.enabled, auth: entry.auth, credentialRevision: entry.credentialRevision,
    capabilityRevision: entry.capabilityRevision, toolOverrides: entry.toolOverrides,
  })).sort((a, b) => a.id.localeCompare(b.id)));
}

/** Servers without list-change notifications are rechecked on use after five minutes. */
export const MCP_DISCOVERY_MAX_AGE_MS = 5 * 60_000;

async function closeClients(b: Built): Promise<void> {
  await Promise.all(b.mcpClients.map((c) => c.close().catch(() => {})));
}

async function getBuilt(): Promise<Built> {
  if (cachedBuilt) {
    if (Date.now() - cachedBuilt.builtAt < MCP_DISCOVERY_MAX_AGE_MS &&
      cachedBuilt.configuration === mcpConfigurationSignature(getMcpServerStore())) return cachedBuilt;
    invalidateConnectorRuntime();
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    // Loop so a config change that lands mid-build (a `generation` bump from
    // invalidateConnectorRuntime) rebuilds with the latest config instead of caching stale state.
    for (;;) {
      const myGen = generation;
      const built = await build();
      if (myGen === generation) {
        cachedBuilt = built;
        return built;
      }
      await closeClients(built).catch(() => {});
    }
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

export async function getConnectorRuntime(): Promise<ConnectorRuntime> {
  return (await getBuilt()).runtime;
}

/** Per-account UI definitions and resource access from the existing transport. */
export async function getMcpViewConnection(serverId: string): Promise<McpViewConnection | null> {
  const built = await getBuilt();
  const view = built.mcpViews.get(serverId);
  if (!view || !isCurrentMcpTransport(view.snapshot, getMcpServerStore())) return null;
  const connection = (await built.runtime.listConnections({ ownerId: getConnectorOwnerId() }))
    .find(value => value.id === hostedMcpConnectionId(view.snapshot) && value.status === 'active');
  return connection ? view : null;
}

/** The BYO auth-config admin service (add/remove/setDefault your own OAuth clients). */
export async function getConnectorAdmin(): Promise<AuthConfigAdmin> {
  return (await getBuilt()).admin;
}

/**
 * Drop the cached runtime so the next access rebuilds (re-ingesting MCP servers). Call after any
 * change to the MCP-server store. Bumps a generation counter so an in-flight build can't cache
 * stale state, and best-effort closes the old MCP client sockets.
 */
export function invalidateConnectorRuntime(): void {
  generation += 1;
  const old = cachedBuilt;
  cachedBuilt = null;
  if (old) void closeClients(old).catch(() => {});
}

/**
 * The connector actions to expose to the in-app AI SDK chat, as a Vercel AI SDK `ToolSet` over the
 * gated `runAction`. Scoped to the toolkits of providers the owner has actually CONNECTED — so the
 * model isn't flooded with ~150 tools for unconnected services (and there's nothing to expose
 * until you connect something). Tool results are already redacted inside `runAction`; structured
 * pauses (auth/approval) come back to the model as model-safe next steps.
 */
export async function getConnectorTools(
  ownerId: string = getConnectorOwnerId(),
  opts: Partial<WorkspaceConnectorFilter> = {},
): Promise<ToolSet> {
  const runtime = await getConnectorRuntime();
  const connections = await runtime.listConnections({ ownerId });
  if (connections.length === 0) return {};
  const connectedProviders = new Set(connections.map((c) => c.providerId));
  let toolkitIds = runtime
    .getToolkits()
    .filter((t) => connectedProviders.has(t.providerId))
    .map((t) => t.id);
  // Optional workspace allowlist intersection (SDK parity with the harness path, §6d).
  if (opts.toolkits) toolkitIds = toolkitIds.filter((id) => opts.toolkits!.includes(id));
  if (toolkitIds.length === 0) return {};
  return toToolSet(runtime, {
    ownerId,
    toolkits: toolkitIds,
    ...(opts.connectionPins ? { connectionPins: opts.connectionPins } : {}),
    ...(opts.allowedAccounts ? { allowedAccounts: opts.allowedAccounts } : {}),
    caller: { type: 'agent' },
    onPause: (actionId, outcome) => {
      // The approval pending is registered inside ApprovalPolicy.check (it has the grant key);
      // this is just a server-side trace of auth/approval pauses the model hit.
      if (!outcome.ok) console.log(`[connectors] ${actionId} paused → ${outcome.reason}`);
    },
  });
}

/**
 * Resolve a workspace's connector allowlist into the engine projection filters
 * (docs/connectors-workspace-scoping-spec.md §6b): toolkits to expose, hard pins, and allowed
 * account sets, all derived server-side and fail-closed. See `resolveConnectorFilter`.
 */
export async function resolveWorkspaceConnectorFilter(
  workspaceId: string,
  ownerId: string = getConnectorOwnerId(),
): Promise<WorkspaceConnectorFilter> {
  const scopes = getWorkspace(workspaceId)?.connectorScopes ?? [];
  if (scopes.length === 0) return { toolkits: [], connectionPins: {}, allowedAccounts: {} };
  return resolveConnectorFilter(scopes, await getConnectorRuntime(), ownerId);
}
