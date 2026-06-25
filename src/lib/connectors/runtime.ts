/**
 * App host wiring for the connector engine (`@connectors/engine`) — the reference "host".
 * It implements the engine's ports against local, precious storage (a file-backed
 * `ConnectionStore` under `.config/connectors`, an AES `SecretBox` keyed from a non-synced key
 * file) and registers ALL first-party providers. OAuth client credentials come from env, one
 * per provider; API-key / custom providers are connected by pasting a credential (connectDirect).
 * The engine core never imports any of this.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  createConnectorRuntime,
  createRegistry,
  createRedactor,
  fileLock,
  storeAuthConfigRegistry,
  createAuthConfigAdmin,
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
  type ProviderCatalogEntry,
} from '@connectors/engine/providers';
import { toToolSet } from '@connectors/engine/ai-sdk';
import { connectMcpClient, ingestMcpServer, type ConnectedMcpClient } from '@connectors/engine/mcp';
import type { ToolSet } from 'ai';
import { appApprovalPolicy } from './approval';
import { getConfigDir } from '@/lib/config/paths';
import { mcpServerStore, type McpServerStore, type McpServerAuth } from './mcp-servers';
import { makeMcpOAuthProvider, type McpOAuthState } from './mcp-oauth';
import { APP_NAME } from '@/constants/app';
import { getWorkspace } from '@/lib/db/queries';

const DEFAULT_REDIRECT = 'http://localhost:4224/api/connectors/callback';

/** Parse a comma-separated env var into a trimmed, non-empty list (or undefined). */
function parseEnvList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/** The shared OAuth callback every provider redirects back to. */
export function getConnectorRedirectUri(): string {
  return process.env.CONNECTORS_REDIRECT_URI ?? DEFAULT_REDIRECT;
}

/**
 * Read a provider's OAuth client from env: `CONNECTORS_<PROVIDER>_CLIENT_ID` / `_CLIENT_SECRET`
 * (+ optional `_REDIRECT_URI`). Google also accepts the legacy `GOOGLE_CLIENT_ID/SECRET`.
 */
function oauthClientFromEnv(providerId: string): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const up = providerId.toUpperCase();
  const clientId = process.env[`CONNECTORS_${up}_CLIENT_ID`] ?? (providerId === 'google' ? process.env.GOOGLE_CLIENT_ID : undefined);
  const clientSecret = process.env[`CONNECTORS_${up}_CLIENT_SECRET`] ?? (providerId === 'google' ? process.env.GOOGLE_CLIENT_SECRET : undefined);
  if (!clientId || !clientSecret) return null;
  const redirectUri =
    process.env[`CONNECTORS_${up}_REDIRECT_URI`] ??
    (providerId === 'google' ? process.env.CONNECTORS_GOOGLE_REDIRECT_URI : undefined) ??
    getConnectorRedirectUri();
  return { clientId, clientSecret, redirectUri };
}

/** Build the env-sourced OAuth configs (one global default per configured provider). */
function buildAuthConfigs(): AuthConfigInput[] {
  const configs: AuthConfigInput[] = [];
  for (const entry of PROVIDER_CATALOG) {
    if (entry.method !== 'oauth2') continue;
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

export interface ProviderStatus extends ProviderCatalogEntry {
  /** OAuth providers: client configured in env. API-key/custom: always true (paste at connect). */
  configured: boolean;
}

/**
 * Per-provider connect readiness + how each connects — drives the Connections UI. An OAuth
 * provider is "configured" if ANY usable client resolves: a bundled default, an operator env
 * client, or a user's BYO config in the home store. API-key/custom providers are always ready
 * (the key is pasted at connect).
 */
export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  const admin = await getConnectorAdmin();
  return Promise.all(
    PROVIDER_CATALOG.map(async (entry) => {
      let configured = entry.method !== 'oauth2';
      if (entry.method === 'oauth2') {
        const hasEnvOrBundled = oauthClientFromEnv(entry.id) !== null || DEFAULT_AUTH_CONFIGS.some((c) => c.providerId === entry.id);
        configured = hasEnvOrBundled || (await admin.list(entry.id)).length > 0;
      }
      return { ...entry, configured };
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

let mcpStoreCached: McpServerStore | null = null;
/**
 * The MCP-server store (user-added remote MCP servers), built standalone from the same
 * dir + key + lock as the runtime — so routes can manage servers without building the
 * whole connector runtime. A separate `SecretBox`/`fileLock` instance over the same key
 * and dir is interchangeable with the runtime's (key-derived seal, file-based lock).
 */
export function getMcpServerStore(): McpServerStore {
  if (mcpStoreCached) return mcpStoreCached;
  const dir = connectorsDir();
  const lock = fileLock({ dir: path.join(dir, 'locks') });
  const secretBox = aesGcmSecretBox({ key: getOrCreateKey(dir) });
  return (mcpStoreCached = mcpServerStore({ dir, secretBox, lock }));
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

/**
 * An `OAuthClientProvider` for an MCP server, backed by the sealed MCP-server store. Pass
 * `onRedirect` during an interactive add to capture the authorization URL; omit it at build time
 * (the SDK only redirects when interactive, and build can't).
 */
export function mcpOAuthProviderFor(entry: { id: string }, onRedirect?: (url: URL) => void) {
  const store = getMcpServerStore();
  return makeMcpOAuthProvider({
    redirectUrl: getMcpOAuthRedirectUrl(entry.id),
    clientName: APP_NAME,
    load: async () => ((await store.getOAuthState(entry.id)) ?? {}) as McpOAuthState,
    save: async (state) => store.setOAuthState(entry.id, state as unknown as Record<string, unknown>),
    ...(onRedirect ? { onRedirect } : {}),
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
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * The connector engine's single subject id. Single-user/local-first → `'local'`; the env override
 * is the seam for a future multi-tenant adapter (derive from the authenticated session, spec §20).
 */
export function getConnectorOwnerId(): string {
  return process.env.CONNECTORS_OWNER_ID ?? 'local';
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
}

let generation = 0;
let cachedBuilt: Built | null = null;
let inFlight: Promise<Built> | null = null;

// NOTE (hosted, deferred — Phase 3): every route operates on the runtime's default `local`
// owner. The hosted/multi-tenant adapter MUST derive `ownerId` from the authenticated
// session/API key and pass it to runAction/beginAuth/connectDirect/listConnections (and pair it
// with row-level tenant isolation, spec §20). Until then this is single-user local.
async function build(): Promise<Built> {
  const dir = connectorsDir();
  // CLI + dev server share one home, so the file store's read-modify-write and the runtime's
  // refresh single-flight need a CROSS-PROCESS lock, not an in-process mutex.
  const lock = fileLock({ dir: path.join(dir, 'locks') });
  const store = fileStore({ dir, lock });
  const secretBox = aesGcmSecretBox({ key: getOrCreateKey(dir) });
  const authConfigStore = authConfigFileStore({ dir, lock });
  const registry = createRegistry();
  // X's toolkit is the full OpenAPI surface (~130 actions); an operator can trim it the way XMCP's
  // X_API_TOOL_ALLOWLIST does. Env-reading stays here (the engine package is process.env-free).
  const twitterAllowlist = parseEnvList(process.env.CONNECTORS_TWITTER_TOOL_ALLOWLIST);
  const twitterDenylist = parseEnvList(process.env.CONNECTORS_TWITTER_TOOL_DENYLIST);
  const twitterTags = parseEnvList(process.env.CONNECTORS_TWITTER_TOOL_TAGS);
  registerAllProviders(registry, {
    twitter: {
      ...(twitterAllowlist ? { allowlist: twitterAllowlist } : {}),
      ...(twitterDenylist ? { denylist: twitterDenylist } : {}),
      ...(twitterTags ? { tags: twitterTags } : {}),
    },
  }); // all first-party providers (real global fetch)

  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox,
    lock,
    redactor: createRedactor(),
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
    // chat works end-to-end; production runs the real gate (resolve via /api/connectors/approve).
    approval: appApprovalPolicy({ autoApprove: process.env.NODE_ENV !== 'production' }),
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
    getProvider: (id) => registry.getProvider(id),
  });

  // Re-ingest every enabled MCP server into the (live) registry so its tools become gated
  // actions — BEFORE returning, so callers never see a dangling `mcp_<slug>` connection.
  // Each server is isolated: a slow/unreachable one is skipped (health recorded), never fatal.
  // Sequential because the registry's addBundle is not concurrency-safe.
  const mcpClients: ConnectedMcpClient[] = [];
  const mcpStore = getMcpServerStore();
  for (const entry of mcpStore.list()) {
    if (!entry.enabled) continue;
    try {
      let client: ConnectedMcpClient;
      let sessionToken = 'mcp-session';
      if (entry.auth.kind === 'oauth') {
        const state = await mcpStore.getOAuthState(entry.id);
        if (!state?.tokens) {
          // Not authorized yet — its tools appear after the OAuth callback completes. Not an error.
          await mcpStore.setHealth(entry.id, {
            lastStatus: 'unreachable',
            lastError: 'Awaiting authorization',
            lastCheckedAt: new Date().toISOString(),
          });
          continue;
        }
        // The SDK authProvider uses the stored tokens and refreshes them transparently on 401.
        client = await withTimeout(
          connectMcpClient({ url: entry.url, name: entry.slug, authProvider: mcpOAuthProviderFor(entry) }),
          MCP_TIMEOUT_MS,
          `connect MCP "${entry.slug}"`,
        );
      } else {
        const secret = await mcpStore.openSecret(entry.id);
        sessionToken = secret ?? 'mcp-session'; // real secret → redactor scrubs it (§7)
        client = await withTimeout(
          connectMcpClient({ url: entry.url, name: entry.slug, headers: mcpAuthHeaders(entry.auth, secret) }),
          MCP_TIMEOUT_MS,
          `connect MCP "${entry.slug}"`,
        );
      }
      const res = await withTimeout(
        ingestMcpServer(registry, store, secretBox, {
          name: entry.slug,
          client,
          connectionId: mcpConnectionId(entry.slug),
          sessionToken,
          ...(entry.toolOverrides ? { toolOverrides: entry.toolOverrides } : {}),
        }),
        MCP_TIMEOUT_MS,
        `ingest MCP "${entry.slug}"`,
      );
      mcpClients.push(client);
      await mcpStore.setHealth(entry.id, {
        lastStatus: 'ok',
        lastToolCount: res.toolCount,
        lastCheckedAt: new Date().toISOString(),
        tools: res.tools, // refresh the persisted tool list for the UI
      });
    } catch (e) {
      await mcpStore
        .setHealth(entry.id, {
          lastStatus: 'unreachable',
          lastError: e instanceof Error ? e.message : String(e),
          lastCheckedAt: new Date().toISOString(),
        })
        .catch(() => {});
      console.warn(`[connectors] MCP server "${entry.slug}" not ingested: ${e instanceof Error ? e.message : e}`);
    }
  }

  return { runtime, admin, mcpClients };
}

async function closeClients(b: Built): Promise<void> {
  await Promise.all(b.mcpClients.map((c) => c.close().catch(() => {})));
}

async function getBuilt(): Promise<Built> {
  if (cachedBuilt) return cachedBuilt;
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
  opts: { toolkits?: string[]; connectionPins?: Record<string, string> } = {},
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
 * (docs/connectors-workspace-scoping-spec.md §6b). Returns the toolkit ids to expose (scoped ∩
 * connected) and per-toolkit connection pins (a stored `account` accountId → its live connection
 * id). Fail-closed: a scope whose toolkit is unknown/disconnected, or whose pinned account doesn't
 * resolve to EXACTLY one owner connection of that toolkit's provider, is dropped (not exposed).
 */
export async function resolveWorkspaceConnectorFilter(
  workspaceId: string,
  ownerId: string = getConnectorOwnerId(),
): Promise<{ toolkits: string[]; connectionPins: Record<string, string> }> {
  const scopes = getWorkspace(workspaceId)?.connectorScopes ?? [];
  if (scopes.length === 0) return { toolkits: [], connectionPins: {} };

  const runtime = await getConnectorRuntime();
  const connections = await runtime.listConnections({ ownerId });
  const connectedProviders = new Set(connections.map((c) => c.providerId));
  const toolkitsById = new Map(runtime.getToolkits().map((t) => [t.id, t]));

  const toolkits: string[] = [];
  const connectionPins: Record<string, string> = {};
  for (const scope of scopes) {
    const toolkit = toolkitsById.get(scope.toolkitId);
    if (!toolkit) continue; // unknown / dormant (e.g. an MCP server not currently ingested)
    if (!connectedProviders.has(toolkit.providerId)) continue; // provider disconnected → dormant
    if (scope.account) {
      const matches = connections.filter(
        (c) =>
          c.providerId === toolkit.providerId &&
          c.accountId === scope.account!.accountId &&
          (c.authConfigId ?? undefined) === (scope.account!.authConfigId ?? undefined),
      );
      if (matches.length !== 1) continue; // unresolvable / ambiguous pin → fail closed
      connectionPins[scope.toolkitId] = matches[0]!.id;
    }
    toolkits.push(scope.toolkitId);
  }
  return { toolkits, connectionPins };
}
