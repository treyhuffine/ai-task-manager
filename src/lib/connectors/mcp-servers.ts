/**
 * Host store for user-added remote MCP servers (docs/connectors-mcp-ingest-spec.md §4).
 *
 * Each entry is a server the user pointed us at; on boot the runtime re-ingests every
 * ENABLED one into the engine registry (`ingestMcpServer`), so its tools become gated
 * connector actions. This file is the durable source of truth for `url` + auth; the
 * engine `Connection` ingest writes is derived state, recreated from here each boot.
 *
 * `slug` is IMMUTABLE — it drives the engine provider id `mcp_<slug>` and action ids
 * `mcp.<slug>.<tool>`, so renaming would orphan ids. `displayName` is the editable UI
 * label. The auth secret (bearer token / header value) is sealed via the same
 * `SecretBox` as connection creds; non-secret fields live in plaintext JSON.
 *
 * Persistence mirrors the engine's file stores: a single JSON array under
 * `.config/connectors/mcp-servers.json`, atomic write at mode 0600, guarded by the
 * shared cross-process file lock so the CLI and dev server don't corrupt it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';

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
  /** Immutable; sanitized [A-Za-z0-9_]; drives `mcp_<slug>` + `mcp.<slug>.<tool>`. */
  slug: string;
  /** Editable UI label; never touches ids. */
  displayName: string;
  url: string;
  enabled: boolean;
  auth: McpServerAuth;
  /** Per-tool reclassification, keyed by remote tool name. */
  toolOverrides?: Record<string, McpToolOverride>;
  /** Last-known advertised tools, for rendering per-tool toggles without reconnecting. */
  tools?: McpToolInfo[];
  createdAt: string;
  updatedAt: string;
  // Best-effort health, refreshed on add + each boot ingest.
  lastStatus?: 'ok' | 'unreachable' | 'error';
  lastError?: string;
  lastToolCount?: number;
  lastCheckedAt?: string;
}

export interface McpServerCreate {
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
}

export class McpStoreError extends Error {
  constructor(
    public code: 'slug_taken' | 'not_found' | 'invalid',
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
  /** The unsealed auth secret for a server, or null (no secret / no entry). */
  openSecret(id: string): Promise<string | null>;
  /** Read the sealed OAuth state (client registration + tokens + PKCE verifier), or null. */
  getOAuthState(id: string): Promise<Record<string, unknown> | null>;
  /** Replace the sealed OAuth state for a server (no-op if the server is gone). */
  setOAuthState(id: string, state: Record<string, unknown>): Promise<void>;
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
          slug: input.slug,
          displayName: input.displayName || input.slug,
          url: input.url,
          enabled: input.enabled ?? true,
          auth: input.auth,
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

    async setOAuthState(id, state) {
      await deps.lock.withLock('mcp-servers', async () => {
        const rows = readAll();
        const row = rows.find((r) => r.entry.id === id);
        if (!row) return;
        row.sealedOAuth = await deps.secretBox.seal(state);
        row.entry.updatedAt = new Date().toISOString();
        writeAll(rows);
      });
    },
  };
}
