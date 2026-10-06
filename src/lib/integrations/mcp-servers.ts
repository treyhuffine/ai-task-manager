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
 * Persistence mirrors the engine's file stores: a single JSON array under
 * `.config/integrations/mcp-servers.json`, atomic write at mode 0600, guarded by the
 * shared cross-process file lock so the CLI and dev server don't corrupt it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { createHash, timingSafeEqual } from 'node:crypto';
import { snapshotMcpCapabilities, diffMcpCapabilities, type McpCapabilityTool, type McpCapabilitySnapshot, type McpCapabilityChanges } from './mcp-capabilities';

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
}
export interface McpToolOverride {
  /** `false` → the tool is not ingested (hidden from the agent). Defaults to enabled. */
  enabled?: boolean;
  /** `false` → the tool reads through the approval gate (trusted read tool). Defaults to gated. */
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
  /** Per-tool reclassification, keyed by remote tool name. */
  toolOverrides?: Record<string, McpToolOverride>;
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
  /** Hash identifying the last successfully completed interactive authorization. */
  lastAuthorizationId?: string;
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
  toolOverrides?: Record<string, McpToolOverride>;
  /** `undefined` keeps the current secret, `null` clears it, a string replaces it. */
  secret?: string | null;
}

export interface McpServerHealth {
  lastStatus: McpServerEntry['lastStatus'];
  lastError?: string | null;
  lastToolCount?: number;
  lastCheckedAt: string;
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
  setHealth(id: string, health: McpServerHealth): Promise<void>;
  recordCapabilities(id: string, tools: readonly McpCapabilityTool[]): Promise<McpServerEntry | null>;
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

  const readAll = (): StoredRow[] => {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as StoredRow[]) : [];
    } catch {
      return [];
    }
  };

  const writeAll = (rows: StoredRow[]): void => {
    fs.mkdirSync(deps.dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rows, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      /* best-effort */
    }
  };

  const sealSecret = async (secret: string): Promise<unknown> => deps.secretBox.seal({ secret });

  return {
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
        if (patch.toolOverrides !== undefined) row.entry.toolOverrides = patch.toolOverrides;
        if (patch.secret !== undefined) {
          row.sealed = patch.secret === null ? undefined : await sealSecret(patch.secret);
          row.entry.credentialRevision = uuidv7();
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
        row.entry.lastStatus = health.lastStatus;
        row.entry.lastError = health.lastError ?? undefined;
        row.entry.lastToolCount = health.lastToolCount;
        row.entry.lastCheckedAt = health.lastCheckedAt;
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
        row.entry.tools = current.tools.map(({ name, description }) => ({ name, ...(description !== undefined ? { description } : {}) }));
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
        return row.entry;
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
        if (current.tokens && !next.tokens) row.entry.credentialRevision = uuidv7();
        row.sealedOAuth = await deps.secretBox.seal(next);
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
        return next;
      });
    },
  };
}
