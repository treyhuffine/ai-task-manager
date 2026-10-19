/**
 * Host store for user-added remote MCP servers (docs/integrations-mcp-ingest-spec.md §4).
 *
 * Each entry is a server the user pointed us at; on boot the runtime re-ingests every
 * ENABLED one into the engine registry (`ingestMcpServer`), so its tools become gated
 * integration actions. This file is the durable source of truth for `url` + auth; the
 * engine `Connection` ingest writes is derived state, recreated from here each boot.
 *
 * `slug` is IMMUTABLE — it drives the engine provider id `mcp_<slug>` and action ids
 * `mcp.<slug>.<tool>`, so renaming would orphan ids. `displayName` is the editable UI
 * label. The auth secret (bearer token / header value) is sealed via the same
 * `SecretBox` as connection creds; non-secret fields live in plaintext JSON.
 *
 * Persistence mirrors the engine's file stores: a JSON document (legacy arrays also read) under
 * `.config/integrations/mcp-servers.json`, atomic write at mode 0600, guarded by the
 * shared cross-process file lock so the CLI and dev server don't corrupt it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { createHash, timingSafeEqual } from 'node:crypto';
import { snapshotMcpCapabilities, diffMcpCapabilities, type McpCapabilityTool, type McpCapabilitySnapshot, type McpCapabilityChanges } from './mcp-capabilities';
import { clearMcpToolApprovals, patchMcpToolOverrides, DEFAULT_MCP_APPROVAL_POLICY, MCP_APPROVAL_POLICIES, type McpApprovalPolicy, type McpToolApprovalMode, type McpToolApprovalPatch } from './mcp-approval-policy';

export type McpServerAuth =
  | { kind: 'none' }
  | { kind: 'bearer' }
  | { kind: 'header'; header: string }
  // OAuth-protected server (MCP authorization spec). Tokens/client-registration/PKCE state are
  // managed by the SDK's OAuthClientProvider and persisted sealed via getOAuthState/setOAuthState.
  | { kind: 'oauth' };

export interface McpToolInfo {
  name: string;
  description?: string;
  readOnlyHint?: boolean;
}
export interface McpToolOverride {
  /** `false` → the tool is not ingested (hidden from the agent). Defaults to enabled. */
  enabled?: boolean;
  approvalMode?: McpToolApprovalMode;
  /** Legacy Ask first preference. Never a fact about the tool's side effects. */
  mutating?: boolean;
}

export interface McpServerEntry {
  id: string;
  /** Set only by the host's built-in integration flow, never by a custom server request. */
  providerId?: string;
  /** Preserve the existing integration identity when replacing a native provider. */
  connectionId?: string;
  accountId?: string;
  /** Immutable registered OAuth app binding, selected through the trusted built-in flow. */
  authConfigId?: string;
  /** Immutable; sanitized [A-Za-z0-9_]; drives `mcp_<slug>` + `mcp.<slug>.<tool>`. */
  slug: string;
  /** Editable UI label; never touches ids. */
  displayName: string;
  url: string;
  enabled: boolean;
  auth: McpServerAuth;
  /** Changes when a static credential changes or OAuth credentials are invalidated. */
  credentialRevision?: string;
  /** Per-tool enablement and permission exceptions, keyed by remote tool name. */
  toolOverrides?: Record<string, McpToolOverride>;
  /** Omitted means inherit the global MCP preference. */
  approvalPolicy?: McpApprovalPolicy;
  /** Last-known advertised tools, for rendering per-tool toggles without reconnecting. */
  tools?: McpToolInfo[];
  capabilityRevision?: string;
  capabilityChanges?: McpCapabilityChanges;
  createdAt: string;
  updatedAt: string;
  // Best-effort health, refreshed on add + each boot ingest.
  lastStatus?: 'ok' | 'unreachable' | 'error';
  lastError?: string;
  lastToolCount?: number;
  lastCheckedAt?: string;
  /** A typed auth rejection is distinct from a temporary transport/discovery outage. */
  lastFailure?: McpServerFailure;
  /** A failed individual request is not a connection health or credential failure. */
  lastRequestError?: McpRequestError;
  /** Bounded, redacted health transitions for diagnosing an outage after recovery. */
  healthHistory?: Omit<McpServerHealth, 'tools'>[];
  /** Hash identifying the last successfully completed interactive authorization. */
  lastAuthorizationId?: string;
  /** What the server reported about itself when Ri last connected. Self-reported, never authority. */
  protocol?: McpServerProtocol;
}

/** A server's self-description from the opening exchange (`initialize` or `server/discover`). */
export interface McpServerProtocol {
  /** The negotiated revision, such as `2026-07-28` or `2025-11-25`. */
  version?: string;
  era?: 'modern' | 'legacy';
  /**
   * `probe`: the server answered the 2026-07-28 probe. `fallback`: it did not, and a 2025
   * handshake worked, so Ri skips the probe until `checkedAt` is a day old.
   */
  negotiation?: 'probe' | 'fallback';
  checkedAt: string;
  /** Advertised extension capabilities (`extensions`, over legacy `experimental`), such as `openai/settings`. */
  extensions?: Record<string, Record<string, unknown>>;
  /** `serverInfo` for display: name, title, version, description, website and icons. */
  info?: { name?: string; title?: string; version?: string; description?: string; websiteUrl?: string; icons?: McpServerIcon[] };
}
export interface McpServerIcon { src: string; mimeType?: string; sizes?: string[]; theme?: 'light' | 'dark' }

/** A probe fallback is remembered this long before Ri tries 2026-07-28 again. */
export const MCP_PROBE_FALLBACK_TTL_MS = 24 * 60 * 60_000;
const MAX_EXTENSIONS_BYTES = 8 * 1024;
const MAX_ICON_SRC_BYTES = 64 * 1024;

/**
 * Reduce what a server said about itself to the bounded, display-only facts Ri keeps. Icons are
 * kept only as `https:` or image `data:` URLs. Unknown or oversized fields are dropped.
 */
export function mcpServerProtocol(facts: {
  protocolVersion?: string; era?: 'modern' | 'legacy'; negotiation?: 'probe' | 'fallback' | 'known-legacy';
  capabilities?: Record<string, unknown>; info?: Record<string, unknown>;
}, checkedAt: string): McpServerProtocol {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : undefined;
  const merged = { ...record(facts.capabilities?.experimental), ...record(facts.capabilities?.extensions) };
  const extensions = Object.fromEntries(Object.entries(merged).filter(([key, value]) => key.length <= 200 && value && typeof value === 'object' && !Array.isArray(value))) as Record<string, Record<string, unknown>>;
  const info = record(facts.info);
  const icons = (Array.isArray(info.icons) ? info.icons : []).slice(0, 4).flatMap((raw): McpServerIcon[] => {
    const icon = record(raw), src = text(icon.src, MAX_ICON_SRC_BYTES);
    if (!src || !(/^https:\/\//i.test(src) || /^data:image\//i.test(src))) return [];
    const sizes = Array.isArray(icon.sizes) ? icon.sizes.filter((size): size is string => typeof size === 'string').slice(0, 8) : undefined;
    return [{ src, ...(text(icon.mimeType, 100) ? { mimeType: icon.mimeType as string } : {}), ...(sizes?.length ? { sizes } : {}),
      ...(icon.theme === 'light' || icon.theme === 'dark' ? { theme: icon.theme } : {}) }];
  });
  const kept = {
    ...(text(info.name, 200) ? { name: info.name as string } : {}), ...(text(info.title, 200) ? { title: info.title as string } : {}),
    ...(text(info.version, 100) ? { version: info.version as string } : {}), ...(text(info.description, 1000) ? { description: info.description as string } : {}),
    ...(text(info.websiteUrl, 2048) && /^https:\/\//i.test(info.websiteUrl as string) ? { websiteUrl: info.websiteUrl as string } : {}),
    ...(icons.length ? { icons } : {}),
  };
  return {
    ...(facts.protocolVersion ? { version: facts.protocolVersion } : {}),
    ...(facts.era ? { era: facts.era } : {}),
    ...(facts.negotiation === 'probe' || facts.negotiation === 'fallback' ? { negotiation: facts.negotiation } : {}),
    checkedAt,
    ...(Object.keys(extensions).length && Buffer.byteLength(JSON.stringify(extensions)) <= MAX_EXTENSIONS_BYTES ? { extensions } : {}),
    ...(Object.keys(kept).length ? { info: kept } : {}),
  };
}

/** Whether to skip the 2026-07-28 probe: the server needed the 2025 fallback within the last day. */
export function mcpKnownLegacy(entry: Pick<McpServerEntry, 'protocol'>, now = Date.now()): boolean {
  return entry.protocol?.negotiation === 'fallback' && now - Date.parse(entry.protocol.checkedAt) < MCP_PROBE_FALLBACK_TTL_MS;
}

export interface McpServerCreate {
  providerId?: string;
  connectionId?: string;
  accountId?: string;
  authConfigId?: string;
  slug: string;
  displayName: string;
  url: string;
  auth: McpServerAuth;
  enabled?: boolean;
  tools?: McpToolInfo[];
}

export interface McpServerPatch {
  displayName?: string;
  url?: string;
  enabled?: boolean;
  auth?: McpServerAuth;
  toolOverrides?: Record<string, McpToolApprovalPatch>;
  approvalPolicy?: McpApprovalPolicy | null;
  resetToolApprovals?: boolean;
  /** `undefined` keeps the current secret, `null` clears it, a string replaces it. */
  secret?: string | null;
}

export interface McpServerFailure {
  kind: 'auth' | 'unavailable';
  phase: 'connect' | 'discover' | 'publish' | 'call' | 'resource';
  status?: number;
}

export interface McpRequestError {
  code: 'provider_timeout';
  message: string;
  at: string;
}

export interface McpServerHealth {
  lastStatus: McpServerEntry['lastStatus'];
  lastError?: string | null;
  lastToolCount?: number;
  lastCheckedAt: string;
  lastFailure?: McpServerFailure;
  lastRequestError?: McpRequestError;
  /** When present, refreshes the persisted tool list (from a successful ingest). */
  tools?: McpToolInfo[];
}

/** Structural deps so this module stays decoupled from engine type exports. */
interface SecretBoxLike {
  seal(value: unknown): Promise<unknown>;
  open<T>(sealed: unknown): Promise<T>;
}
interface LockLike {
  withLock<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

interface StoredRow {
  entry: McpServerEntry;
  sealed?: unknown; // sealed { secret: string } (static bearer/header auth)
  sealedOAuth?: unknown; // sealed OAuth state (client registration + tokens + PKCE verifier)
  capabilities?: { current: McpCapabilitySnapshot; reviewed: McpCapabilitySnapshot };
}

interface StoredDocument {
  servers: StoredRow[];
  defaultApprovalPolicy?: McpApprovalPolicy;
}

function parseDocument(parsed: StoredRow[] | StoredDocument): StoredDocument {
  return Array.isArray(parsed) ? { servers: parsed } : parsed;
}

export function mcpToolInfo(tool: McpCapabilityTool): McpToolInfo {
  const annotations = tool.annotations as { readOnlyHint?: boolean } | undefined;
  return { name: tool.name, ...(tool.description !== undefined ? { description: tool.description } : {}),
    ...(typeof annotations?.readOnlyHint === 'boolean' ? { readOnlyHint: annotations.readOnlyHint } : {}) };
}

export class McpStoreError extends Error {
  constructor(
    public code: 'slug_taken' | 'not_found' | 'invalid' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'McpStoreError';
  }
}

export interface McpServerStore {
  list(): McpServerEntry[];
  get(id: string): McpServerEntry | null;
  getBySlug(slug: string): McpServerEntry | null;
  create(input: McpServerCreate, secret?: string): Promise<McpServerEntry>;
  update(id: string, patch: McpServerPatch): Promise<McpServerEntry | null>;
  remove(id: string): Promise<boolean>;
  getApprovalSettings(): { defaultPolicy: McpApprovalPolicy; override: McpApprovalPolicy | null };
  /** One atomic read keeps bulk changes coherent at the execution boundary. */
  getApprovalSnapshot(): { servers: McpServerEntry[]; approvalSettings: ReturnType<McpServerStore['getApprovalSettings']> };
  setDefaultApprovalPolicy(policy: McpApprovalPolicy | null, applyToAll?: boolean): Promise<void>;
  setHealth(id: string, health: McpServerHealth): Promise<void>;
  recordCapabilities(id: string, tools: readonly McpCapabilityTool[]): Promise<McpServerEntry | null>;
  /**
   * Keep what the server reported at connect. A connection that skipped the probe keeps the
   * recorded fallback and its time, so the probe is retried once that expires.
   */
  recordProtocol(id: string, protocol: McpServerProtocol, skippedProbe?: boolean): Promise<void>;
  acknowledgeCapabilities(id: string, revision: string): Promise<McpServerEntry | null>;
  /** The unsealed auth secret for a server, or null (no secret / no entry). */
  openSecret(id: string): Promise<string | null>;
  /** Read the sealed OAuth state (client registration + tokens + PKCE verifier), or null. */
  getOAuthState(id: string): Promise<Record<string, unknown> | null>;
  /** Replace the sealed OAuth state for a server (no-op if the server is gone). */
  setOAuthState(id: string, state: Record<string, unknown>): Promise<void>;
  /** Replace only the OAuth revision that the caller observed, under the shared file lock. */
  compareAndSetOAuthState(id: string, expectedRevision: string | undefined, state: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  /** Atomically consume one unexpired browser authorization state. */
  consumeOAuthState(id: string, state: string, now?: number): Promise<boolean>;
  /** Publish completion only for the exact consumed consent that is still current. */
  completeAuthorization(id: string, authorizationId: string): Promise<boolean>;
}

/** Sanitize a free-text name into a valid, stable slug. */
export function toSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

export function mcpServerStore(deps: { dir: string; secretBox: SecretBoxLike; lock: LockLike }): McpServerStore {
  const file = path.join(deps.dir, 'mcp-servers.json');

  const readDocument = (): StoredDocument => {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      const document = parseDocument(parsed);
      if (!document || !Array.isArray(document.servers)) throw new McpStoreError('invalid', 'Invalid MCP server configuration.');
      if (document.defaultApprovalPolicy !== undefined && !MCP_APPROVAL_POLICIES.includes(document.defaultApprovalPolicy)) {
        throw new McpStoreError('invalid', 'Invalid MCP approval policy.');
      }
      return document;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { servers: [] };
      throw error;
    }
  };
  const readAll = (): StoredRow[] => readDocument().servers;

  const writeDocument = (document: StoredDocument): void => {
    fs.mkdirSync(deps.dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(document, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best-effort */
    }
  };
  const writeAll = (rows: StoredRow[]): void => writeDocument({ ...readDocument(), servers: rows });

  const sealSecret = async (secret: string): Promise<unknown> => deps.secretBox.seal({ secret });
  const approvalSnapshot = () => {
    const document = readDocument();
    const override = document.defaultApprovalPolicy;
    return { servers: document.servers.map(row => row.entry), approvalSettings: {
      defaultPolicy: override ?? DEFAULT_MCP_APPROVAL_POLICY, override: override ?? null,
    } };
  };

  return {
    getApprovalSettings() {
      return approvalSnapshot().approvalSettings;
    },
    getApprovalSnapshot: approvalSnapshot,
    async setDefaultApprovalPolicy(policy, applyToAll = false) {
      if (policy !== null && !MCP_APPROVAL_POLICIES.includes(policy)) throw new McpStoreError('invalid', 'Invalid MCP approval policy.');
      await deps.lock.withLock('mcp-servers', async () => {
        const document = readDocument();
        if (policy === null) delete document.defaultApprovalPolicy;
        else document.defaultApprovalPolicy = policy;
        if (applyToAll) for (const row of document.servers) {
          // Built-in providers retain their own established write policy.
          if (row.entry.providerId) continue;
          delete row.entry.approvalPolicy;
          row.entry.toolOverrides = clearMcpToolApprovals(row.entry.toolOverrides);
          row.entry.updatedAt = new Date().toISOString();
        }
        writeDocument(document);
      });
    },
    list() {
      return readAll().map((r) => r.entry);
    },
    get(id) {
      return readAll().find((r) => r.entry.id === id)?.entry ?? null;
    },
    getBySlug(slug) {
      return readAll().find((r) => r.entry.slug === slug)?.entry ?? null;
    },

    async create(input, secret) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        if (!input.slug) throw new McpStoreError('invalid', 'slug is required');
        if (rows.some((r) => r.entry.slug === input.slug)) {
          throw new McpStoreError('slug_taken', `an MCP server named "${input.slug}" already exists`);
        }
        const now = new Date().toISOString();
        const entry: McpServerEntry = {
          id: uuidv7(),
          ...(input.providerId ? { providerId: input.providerId } : {}),
          ...(input.connectionId ? { connectionId: input.connectionId } : {}),
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.authConfigId ? { authConfigId: input.authConfigId } : {}),
          slug: input.slug,
          displayName: input.displayName || input.slug,
          url: input.url,
          enabled: input.enabled ?? true,
          auth: input.auth,
          ...(secret ? { credentialRevision: uuidv7() } : {}),
          ...(input.tools ? { tools: input.tools } : {}),
          createdAt: now,
          updatedAt: now,
        };
        const row: StoredRow = { entry };
        if (secret && input.auth.kind !== 'none') row.sealed = await sealSecret(secret);
        rows.push(row);
        writeAll(rows);
        return entry;
      });
    },

    async update(id, patch) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find((r) => r.entry.id === id);
        if (!row) return null;
        if (patch.displayName !== undefined) row.entry.displayName = patch.displayName;
        if (patch.url !== undefined) row.entry.url = patch.url;
        if (patch.enabled !== undefined) row.entry.enabled = patch.enabled;
        if (patch.auth !== undefined) row.entry.auth = patch.auth;
        if (patch.toolOverrides !== undefined) row.entry.toolOverrides = patchMcpToolOverrides(row.entry.toolOverrides, patch.toolOverrides);
        if (patch.approvalPolicy === null) delete row.entry.approvalPolicy;
        else if (patch.approvalPolicy !== undefined) row.entry.approvalPolicy = patch.approvalPolicy;
        if (patch.resetToolApprovals) row.entry.toolOverrides = clearMcpToolApprovals(row.entry.toolOverrides);
        if (patch.secret !== undefined) {
          row.sealed = patch.secret === null ? undefined : await sealSecret(patch.secret);
          row.entry.credentialRevision = uuidv7();
          delete row.entry.lastFailure;
        }
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
        return row.entry;
      });
    },

    async remove(id) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const next = rows.filter((r) => r.entry.id !== id);
        if (next.length === rows.length) return false;
        writeAll(next);
        return true;
      });
    },

    async setHealth(id, health) {
      await deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find((r) => r.entry.id === id);
        if (!row) return;
        if (row.entry.lastStatus !== health.lastStatus || row.entry.lastError !== (health.lastError ?? undefined) ||
          row.entry.lastToolCount !== (health.lastToolCount ?? row.entry.lastToolCount) ||
          JSON.stringify(row.entry.lastFailure) !== JSON.stringify(health.lastFailure) ||
          (health.lastRequestError !== undefined && JSON.stringify(row.entry.lastRequestError) !== JSON.stringify(health.lastRequestError))) {
          const transition: Omit<McpServerHealth, 'tools'> = {
            lastStatus: health.lastStatus, lastError: health.lastError, lastToolCount: health.lastToolCount,
            lastCheckedAt: health.lastCheckedAt, lastFailure: health.lastFailure, lastRequestError: health.lastRequestError,
          };
          row.entry.healthHistory = [...(row.entry.healthHistory ?? []), transition].slice(-20);
        }
        row.entry.lastStatus = health.lastStatus;
        row.entry.lastError = health.lastError ?? undefined;
        if (health.lastToolCount !== undefined) row.entry.lastToolCount = health.lastToolCount;
        row.entry.lastCheckedAt = health.lastCheckedAt;
        row.entry.lastFailure = health.lastFailure;
        if (health.lastRequestError !== undefined) row.entry.lastRequestError = health.lastRequestError;
        if (health.tools !== undefined) row.entry.tools = health.tools;
        writeAll(rows);
      });
    },

    async recordCapabilities(id, tools) {
      const current = snapshotMcpCapabilities(tools);
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find(candidate => candidate.entry.id === id);
        if (!row) return null;
        if (row.capabilities?.current.revision === current.revision) return row.entry;
        const reviewed = row.capabilities?.reviewed ?? current;
        row.capabilities = { current, reviewed };
        row.entry.capabilityRevision = current.revision;
        row.entry.capabilityChanges = diffMcpCapabilities(reviewed, current);
        row.entry.tools = current.tools.map(mcpToolInfo);
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
        return row.entry;
      });
    },

    async recordProtocol(id, protocol, skippedProbe) {
      await deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find(candidate => candidate.entry.id === id);
        if (!row) return;
        const previous = row.entry.protocol;
        const next: McpServerProtocol = skippedProbe && previous?.negotiation === 'fallback'
          ? { ...protocol, negotiation: 'fallback', checkedAt: previous.checkedAt }
          : protocol;
        // A fallback is always stamped: its time decides when the probe runs again.
        const same = (a?: McpServerProtocol, b?: McpServerProtocol) => JSON.stringify({ ...a, checkedAt: undefined }) === JSON.stringify({ ...b, checkedAt: undefined });
        if (same(previous, next) && !(next.negotiation === 'fallback' && next.checkedAt !== previous?.checkedAt)) return;
        row.entry.protocol = next;
        writeAll(rows);
      });
    },

    async acknowledgeCapabilities(id, revision) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find(candidate => candidate.entry.id === id);
        if (!row) return null;
        if (!row.capabilities || row.capabilities.current.revision !== revision) {
          throw new McpStoreError('conflict', 'The tools changed again. Review the latest changes before marking them reviewed.');
        }
        row.capabilities.reviewed = row.capabilities.current;
        row.entry.capabilityChanges = undefined;
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
        return row.entry;
      });

    },

    async openSecret(id) {
      const row = readAll().find((r) => r.entry.id === id);
      if (!row?.sealed) return null;
      try {
        const opened = await deps.secretBox.open<{ secret: string }>(row.sealed);
        return opened.secret;
      } catch {
        return null;
      }
    },

    async getOAuthState(id) {
      const row = readAll().find((r) => r.entry.id === id);
      if (!row?.sealedOAuth) return null;
      try {
        return await deps.secretBox.open<Record<string, unknown>>(row.sealedOAuth);
      } catch {
        return null;
      }
    },

    async consumeOAuthState(id, state, now = Date.now()) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find((r) => r.entry.id === id);
        if (!row?.sealedOAuth || !state || state.length > 4096) return false;
        const saved = await deps.secretBox.open<Record<string, unknown>>(row.sealedOAuth);
        if (typeof saved.authorizationState !== 'string' || typeof saved.authorizationExpiresAt !== 'number' || saved.authorizationExpiresAt <= now) return false;
        const expected = Buffer.from(saved.authorizationState);
        const actual = Buffer.from(state);
        if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return false;
        delete saved.authorizationState;
        delete saved.authorizationExpiresAt;
        saved.consumedAuthorizationId = createHash('sha256').update(state).digest('hex');
        saved.revision = uuidv7();
        row.sealedOAuth = await deps.secretBox.seal(saved);
        writeAll(rows);
        return true;
      });
    },

    async completeAuthorization(id, authorizationId) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find(candidate => candidate.entry.id === id);
        if (!row?.entry.enabled || row.entry.auth.kind !== 'oauth' || row.entry.lastStatus !== 'ok' || !row.sealedOAuth) return false;
        const saved = await deps.secretBox.open<Record<string, unknown>>(row.sealedOAuth);
        if (!authorizationId || saved.consumedAuthorizationId !== authorizationId || saved.authorizationState || !saved.tokens) return false;
        row.entry.lastAuthorizationId = authorizationId;
        writeAll(rows);
        return true;
      });
    },

    async setOAuthState(id, state) {
      await deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find((r) => r.entry.id === id);
        if (!row) return;
        if (state.tokens) delete row.entry.lastFailure;
        row.sealedOAuth = await deps.secretBox.seal({ ...state, revision: uuidv7() });
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
      });
    },

    async compareAndSetOAuthState(id, expectedRevision, state) {
      return deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find((r) => r.entry.id === id);
        if (!row || row.entry.auth.kind !== 'oauth') return null;
        const current = row.sealedOAuth ? await deps.secretBox.open<Record<string, unknown>>(row.sealedOAuth) : {};
        if (current.revision !== expectedRevision) return null;
        const next: Record<string, unknown> = { ...state, revision: uuidv7() };
        const oldToken = (current.tokens as { access_token?: string } | undefined)?.access_token;
        const newToken = (next.tokens as { access_token?: string } | undefined)?.access_token;
        if (newToken && newToken !== oldToken) delete row.entry.lastFailure;
        if (current.tokens && !next.tokens) row.entry.credentialRevision = uuidv7();
        row.sealedOAuth = await deps.secretBox.seal(next);
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
        return next;
      });
    },
  };
}

/** Safe inert catalog read. No credential key creation, unsealing or network discovery. */
export function readMcpMetadata(dir: string): { entry: McpServerEntry; capabilities: McpCapabilitySnapshot | null }[] {
  try {
    const document = parseDocument(JSON.parse(fs.readFileSync(path.join(dir, 'mcp-servers.json'), 'utf8')));
    return document.servers.map(row => ({ entry: row.entry, capabilities: row.capabilities?.current ?? null }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
