/**
 * Ri's own typed client for Composio's REST API v3.1 (docs/connector-service-spec.md §8). No
 * vendor SDK: Ri is open source and local-first, and the SDK would ship telemetry, version checks
 * and retry and default behavior this adapter has to override anyway.
 *
 * Every response is validated with a schema that keeps only the fields Ri uses. Connected-account
 * payloads can carry token state, and parsing drops it before anything else sees the object. The
 * project key is sent only in `x-api-key`, and scrubbed from every error message.
 *
 * Reads retry a bounded number of times on transport failures, 429 and 5xx. Writes never retry:
 * a write that failed after it was sent may have reached the provider, and only the caller can
 * decide what to do about that (`ComposioApiError.maybeApplied`).
 */
import { z } from 'zod/v4';

export const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v3.1';
const DEFAULT_TIMEOUT_MS = 30_000;
const EXECUTE_TIMEOUT_MS = 90_000;
const READ_RETRIES = 2;
const MAX_RETRY_AFTER_MS = 10_000;

export type ComposioErrorKind =
  | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'invalid' | 'payment_required'
  | 'rate_limited' | 'unavailable' | 'timeout' | 'cancelled' | 'unexpected_response';

export class ComposioApiError extends Error {
  readonly kind: ComposioErrorKind;
  readonly status?: number;
  readonly requestId?: string;
  readonly retryAfterMs?: number;
  /** A write whose outcome is unknown: the request may have reached Composio and the provider. */
  readonly maybeApplied: boolean;
  constructor(kind: ComposioErrorKind, message: string, opts: { status?: number; requestId?: string; retryAfterMs?: number; maybeApplied?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ComposioApiError';
    this.kind = kind;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryAfterMs = opts.retryAfterMs;
    this.maybeApplied = opts.maybeApplied ?? false;
  }
}

export function isComposioApiError(error: unknown): error is ComposioApiError {
  return error instanceof ComposioApiError;
}

// ─── Response schemas (only the fields Ri reads) ──────────────────────────────

const accountStatus = z.enum(['INITIALIZING', 'INITIATED', 'ACTIVE', 'FAILED', 'EXPIRED', 'INACTIVE', 'REVOKED']);
export type RemoteAccountStatus = z.infer<typeof accountStatus>;

const remoteAccountSchema = z.object({
  id: z.string().min(1),
  user_id: z.string(),
  status: accountStatus,
  toolkit: z.object({ slug: z.string() }),
  auth_config: z.object({ id: z.string(), is_composio_managed: z.boolean().optional(), is_disabled: z.boolean().optional() }),
  alias: z.string().nullable().optional(),
  status_reason: z.string().nullable().optional(),
  is_disabled: z.boolean().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
}).transform(value => ({
  id: value.id,
  userId: value.user_id,
  status: value.status,
  toolkitSlug: value.toolkit.slug,
  authConfigId: value.auth_config.id,
  managedAuth: value.auth_config.is_composio_managed ?? false,
  alias: value.alias ?? undefined,
  statusReason: value.status_reason ?? undefined,
  disabled: value.is_disabled ?? false,
  createdAt: value.created_at,
}));
export type RemoteAccount = z.infer<typeof remoteAccountSchema>;

const authConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  toolkit: z.object({ slug: z.string() }),
  is_composio_managed: z.boolean().optional(),
  status: z.enum(['ENABLED', 'DISABLED']).optional(),
}).transform(value => ({
  id: value.id, name: value.name, toolkitSlug: value.toolkit.slug,
  managed: value.is_composio_managed ?? false, enabled: value.status !== 'DISABLED',
}));
export type RemoteAuthConfig = z.infer<typeof authConfigSchema>;

const toolSchema = z.object({
  slug: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  toolkit: z.object({ slug: z.string() }).optional(),
  input_parameters: z.record(z.string(), z.unknown()).optional(),
  version: z.string().optional(),
  available_versions: z.array(z.string()).optional(),
  is_deprecated: z.boolean().optional(),
  no_auth: z.boolean().optional(),
}).transform(value => ({
  slug: value.slug,
  name: value.name ?? value.slug,
  description: value.description ?? '',
  toolkitSlug: value.toolkit?.slug,
  inputParameters: value.input_parameters ?? { type: 'object', properties: {} },
  version: value.version,
  availableVersions: value.available_versions ?? [],
  deprecated: value.is_deprecated ?? false,
  noAuth: value.no_auth ?? false,
}));
export type RemoteTool = z.infer<typeof toolSchema>;

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), next_cursor: z.string().nullable().optional() });

const toolkitPolicy = z.union([
  z.object({ enabled: z.array(z.string()), require_approval: z.array(z.string()).optional() }),
  z.object({ disabled: z.array(z.string()), require_approval: z.array(z.string()).optional() }),
  z.object({ require_approval: z.array(z.string()) }),
]);

const sessionSchema = z.object({
  session_id: z.string().min(1),
  tool_router_tools: z.array(z.string()).optional(),
  config_version: z.number().optional(),
  config: z.object({
    user_id: z.string(),
    toolkits: toolkitPolicy.optional(),
    tools: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
    tags: z.unknown().optional(),
    connected_accounts: z.record(z.string(), z.array(z.string())).optional(),
    instant: z.union([z.literal(false), z.record(z.string(), z.unknown())]).optional(),
    manage_connections: z.object({
      enabled: z.boolean().optional(),
      enable_wait_for_connections: z.boolean().optional(),
      enable_connection_removal: z.boolean().optional(),
    }).optional(),
    workbench: z.object({ enable: z.boolean().optional(), proxy_execution_enabled: z.boolean().optional() }).optional(),
    proxy_execute: z.object({ enable: z.boolean() }).optional(),
    multi_account: z.object({ enable: z.boolean().optional() }).optional(),
    preload: z.object({ tools: z.union([z.array(z.string()), z.string()]) }).optional(),
    search: z.object({ enable: z.boolean().optional() }).optional(),
    execute: z.object({ enable_multi_execute: z.boolean().optional() }).optional(),
  }),
});
export type RemoteSession = z.infer<typeof sessionSchema>;

const executeSchema = z.discriminatedUnion('result_type', [
  z.object({ result_type: z.literal('completed'), data: z.record(z.string(), z.unknown()).nullable().optional(), error: z.string().nullable().optional(), log_id: z.string().optional() }),
  z.object({ result_type: z.literal('failed'), data: z.record(z.string(), z.unknown()).nullable().optional(), error: z.string().nullable().optional(), log_id: z.string().optional() }),
  z.object({ result_type: z.literal('input_required') }),
]);
export type SessionExecuteResult = z.infer<typeof executeSchema>;

const legacyExecuteSchema = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  successful: z.boolean(),
  log_id: z.string().optional(),
});

const linkSchema = z.object({
  redirect_url: z.string().url(),
  expires_at: z.string().min(1),
  connected_account_id: z.string().min(1),
});

const sessionInfoSchema = z.object({
  project: z.object({ id: z.string().min(1), nano_id: z.string().optional(), name: z.string().optional() }),
});

// ─── Requests ────────────────────────────────────────────────────────────────

export interface SessionConfig {
  userId: string;
  toolkitSlug: string;
  toolSlugs: string[];
  connectedAccountId: string;
}

/** The session body: every restriction explicit, nothing left to a vendor default. */
export function sessionCreateBody(config: SessionConfig): Record<string, unknown> {
  const tools = [...config.toolSlugs].sort();
  return {
    user_id: config.userId,
    toolkits: { enable: [config.toolkitSlug] },
    tools: { [config.toolkitSlug]: { enable: tools } },
    connected_accounts: { [config.toolkitSlug]: [config.connectedAccountId] },
    preload: { tools },
    multi_account: { enable: false },
    workbench: { enable: false },
    proxy_execute: { enable: false },
    manage_connections: { enable: false, enable_wait_for_connections: false, enable_connection_removal: false },
    search: { enable: false },
    execute: { enable_multi_execute: false },
    instant: false,
  };
}

interface RequestOptions<T> {
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  body?: unknown;
  schema: z.ZodType<T>;
  /** Side-effecting: never retried, and an unknown outcome is reported as `maybeApplied`. */
  write: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ComposioClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export type ComposioClient = ReturnType<typeof createComposioClient>;

export function createComposioClient(options: ComposioClientOptions) {
  const base = (options.baseUrl ?? COMPOSIO_API_BASE).replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const scrub = (text: string) => options.apiKey ? text.split(options.apiKey).join('[redacted]') : text;

  function url(path: string, query?: RequestOptions<unknown>['query']): string {
    const target = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      // Composio reads repeated values as one comma-joined parameter.
      target.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
    return target.href;
  }

  async function errorFrom(response: Response, write: boolean): Promise<ComposioApiError> {
    let message = `Composio returned HTTP ${response.status}.`;
    let requestId: string | undefined;
    try {
      const body = await response.json() as { error?: { message?: unknown; request_id?: unknown; suggested_fix?: unknown } | string; message?: unknown };
      const detail = typeof body.error === 'object' ? body.error?.message : typeof body.error === 'string' ? body.error : body.message;
      if (typeof detail === 'string' && detail.trim()) message = detail.trim().slice(0, 500);
      if (typeof body.error === 'object' && typeof body.error?.request_id === 'string') requestId = body.error.request_id;
    } catch { /* non-JSON error body */ }
    const retryHeader = response.headers.get('retry-after');
    const retryAfterMs = retryHeader && /^\d+$/.test(retryHeader) ? Number(retryHeader) * 1000 : undefined;
    const status = response.status;
    const kind: ComposioErrorKind = status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : status === 404 ? 'not_found'
      : status === 409 ? 'conflict' : status === 402 ? 'payment_required' : status === 429 ? 'rate_limited'
        : status >= 500 ? 'unavailable' : 'invalid';
    // A 5xx after a write was accepted may hide a completed side effect. 4xx was refused.
    return new ComposioApiError(kind, scrub(message), { status, requestId, retryAfterMs, maybeApplied: write && status >= 500 });
  }

  async function request<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, opts: RequestOptions<T>): Promise<T> {
    const attempts = opts.write ? 1 : READ_RETRIES + 1;
    let lastError: ComposioApiError | undefined;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(Math.min(lastError?.retryAfterMs ?? 400 * 2 ** (attempt - 1), MAX_RETRY_AFTER_MS));
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('timeout')), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const onAbort = () => controller.abort(opts.signal?.reason);
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      // The deadline and the caller's cancel cover the whole exchange, body included.
      const release = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };
      let response: Response;
      try {
        if (opts.signal?.aborted) throw new ComposioApiError('cancelled', 'The request was cancelled.');
        response = await doFetch(url(path, opts.query), {
          method,
          headers: { 'x-api-key': options.apiKey, accept: 'application/json', ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
          ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
          signal: controller.signal,
          redirect: 'error',
        });
      } catch (error) {
        release();
        if (error instanceof ComposioApiError) throw error;
        const cancelled = opts.signal?.aborted === true;
        const timedOut = !cancelled && controller.signal.aborted;
        // Once a write's bytes may have left, its outcome is unknown, cancelled or not.
        lastError = new ComposioApiError(cancelled ? 'cancelled' : timedOut ? 'timeout' : 'unavailable',
          cancelled ? 'The request was cancelled.' : timedOut ? 'Composio did not answer in time.' : 'Composio could not be reached.',
          { maybeApplied: opts.write, cause: error });
        if (cancelled || opts.write) throw lastError;
        continue;
      }
      let raw: unknown;
      try {
        if (!response.ok) {
          lastError = await errorFrom(response, opts.write);
          if (!opts.write && (lastError.kind === 'rate_limited' || lastError.kind === 'unavailable')) continue;
          throw lastError;
        }
        let text: string;
        try {
          text = await response.text();
        } catch (error) {
          // The answer started arriving, so a write was accepted: how it ended is unknown.
          const cancelled = opts.signal?.aborted === true;
          const timedOut = !cancelled && controller.signal.aborted;
          throw new ComposioApiError(cancelled ? 'cancelled' : timedOut ? 'timeout' : 'unexpected_response',
            cancelled ? 'The request was cancelled.' : timedOut ? 'Composio did not finish answering in time.' : 'Composio sent a response Ri could not read.',
            { status: response.status, maybeApplied: opts.write, cause: error });
        }
        try {
          raw = text.trim() ? JSON.parse(text) : {};
        } catch (error) {
          throw new ComposioApiError('unexpected_response', 'Composio sent a response Ri could not read.', { status: response.status, maybeApplied: opts.write, cause: error });
        }
      } finally {
        release();
      }
      const parsed = opts.schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ComposioApiError('unexpected_response',
          `Composio sent an unexpected response${issue ? ` (${issue.path.join('.') || 'root'}: ${issue.message})` : ''}.`,
          { status: response.status, maybeApplied: opts.write });
      }
      return parsed.data;
    }
    throw lastError ?? new ComposioApiError('unavailable', 'Composio could not be reached.');
  }

  async function allPages<T>(path: string, query: RequestOptions<unknown>['query'], item: z.ZodType<T>, limit = 500): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | undefined;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const result = await request('GET', path, { query: { ...query, limit: 100, ...(cursor ? { cursor } : {}) }, schema: page(item), write: false });
      out.push(...result.items);
      cursor = result.next_cursor ?? undefined;
      if (!cursor || out.length >= limit) break;
    }
    return out.slice(0, limit);
  }

  return {
    /** The project this key reaches, or null when the key can't read it (a scoped key). */
    async projectInfo(): Promise<{ id: string; name?: string } | null> {
      try {
        const info = await request('GET', '/auth/session/info', { schema: sessionInfoSchema, write: false });
        return { id: info.project.nano_id ?? info.project.id, ...(info.project.name ? { name: info.project.name } : {}) };
      } catch (error) {
        if (isComposioApiError(error) && (error.kind === 'forbidden' || error.kind === 'not_found')) return null;
        throw error;
      }
    },
    listAuthConfigs(toolkitSlug: string): Promise<RemoteAuthConfig[]> {
      return allPages('/auth_configs', { toolkit_slug: toolkitSlug }, authConfigSchema);
    },
    async createManagedAuthConfig(toolkitSlug: string, name: string): Promise<{ id: string }> {
      const created = await request('POST', '/auth_configs', {
        body: { toolkit: { slug: toolkitSlug }, auth_config: { type: 'use_composio_managed_auth', name } },
        schema: z.object({ auth_config: z.object({ id: z.string().min(1) }) }), write: true,
      });
      return { id: created.auth_config.id };
    },
    async createLink(input: { authConfigId: string; userId: string; callbackUrl: string; alias?: string }): Promise<{ redirectUrl: string; expiresAt: string; connectedAccountId: string }> {
      const link = await request('POST', '/connected_accounts/link', {
        body: { auth_config_id: input.authConfigId, user_id: input.userId, callback_url: input.callbackUrl, ...(input.alias ? { alias: input.alias } : {}) },
        schema: linkSchema, write: true,
      });
      return { redirectUrl: link.redirect_url, expiresAt: link.expires_at, connectedAccountId: link.connected_account_id };
    },
    getConnectedAccount(id: string): Promise<RemoteAccount> {
      return request('GET', `/connected_accounts/${encodeURIComponent(id)}`, { schema: remoteAccountSchema, write: false });
    },
    listConnectedAccounts(filter: { userIds?: string[]; toolkitSlugs?: string[]; statuses?: RemoteAccountStatus[]; ids?: string[] }): Promise<RemoteAccount[]> {
      return allPages('/connected_accounts', {
        ...(filter.userIds ? { user_ids: filter.userIds } : {}),
        ...(filter.toolkitSlugs ? { toolkit_slugs: filter.toolkitSlugs } : {}),
        ...(filter.statuses ? { statuses: filter.statuses } : {}),
        ...(filter.ids ? { connected_account_ids: filter.ids } : {}),
      }, remoteAccountSchema);
    },
    async refreshConnectedAccount(id: string, redirectUrl: string): Promise<{ status: RemoteAccountStatus; redirectUrl?: string }> {
      const result = await request('POST', `/connected_accounts/${encodeURIComponent(id)}/refresh`, {
        body: { redirect_url: redirectUrl },
        schema: z.object({ status: accountStatus, redirect_url: z.string().nullable().optional() }), write: true,
      });
      return { status: result.status, ...(result.redirect_url ? { redirectUrl: result.redirect_url } : {}) };
    },
    async setConnectedAccountEnabled(id: string, enabled: boolean): Promise<void> {
      await request('PATCH', `/connected_accounts/${encodeURIComponent(id)}/status`, { body: { enabled }, schema: z.unknown(), write: true });
    },
    async revokeConnectedAccount(id: string): Promise<{ revokedTokens: string[]; status?: RemoteAccountStatus }> {
      const result = await request('POST', `/connected_accounts/${encodeURIComponent(id)}/revoke`, {
        schema: z.object({ revoked_tokens: z.array(z.string()).optional(), connected_account: z.object({ status: accountStatus }).optional() }), write: true,
      });
      return { revokedTokens: result.revoked_tokens ?? [], ...(result.connected_account ? { status: result.connected_account.status } : {}) };
    },
    async deleteConnectedAccount(id: string): Promise<void> {
      await request('DELETE', `/connected_accounts/${encodeURIComponent(id)}`, { schema: z.unknown(), write: true });
    },
    /** Latest definitions for the named tools of one toolkit. */
    listTools(toolkitSlug: string, toolSlugs: string[]): Promise<RemoteTool[]> {
      return allPages('/tools', { toolkit_slug: toolkitSlug, tool_slugs: toolSlugs, toolkit_versions: 'latest' }, toolSchema);
    },
    /** One tool at an exact dated version. */
    getTool(slug: string, version: string): Promise<RemoteTool> {
      return request('GET', `/tools/${encodeURIComponent(slug)}`, { query: { version }, schema: toolSchema, write: false });
    },
    createSession(config: SessionConfig): Promise<RemoteSession> {
      return request('POST', '/tool_router/session', { body: sessionCreateBody(config), schema: sessionSchema, write: true });
    },
    getSession(id: string): Promise<RemoteSession> {
      return request('GET', `/tool_router/session/${encodeURIComponent(id)}`, { schema: sessionSchema, write: false });
    },
    listSessionTools(id: string): Promise<RemoteTool[]> {
      return allPages(`/tool_router/session/${encodeURIComponent(id)}/tools`, {}, toolSchema, 100);
    },
    async deleteSession(id: string): Promise<void> {
      await request('DELETE', `/tool_router/session/${encodeURIComponent(id)}`, { schema: z.unknown(), write: true });
    },
    /** Execute one concrete tool through a constrained session. Never retried. */
    executeInSession(sessionId: string, toolSlug: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<SessionExecuteResult> {
      return request('POST', `/tool_router/session/${encodeURIComponent(sessionId)}/execute`, {
        body: { tool_slug: toolSlug, arguments: args, enable_auto_workbench_offload: false },
        schema: executeSchema, write: true, timeoutMs: EXECUTE_TIMEOUT_MS, ...(signal ? { signal } : {}),
      });
    },
    /**
     * Execute one tool at an exact dated version for one account (the legacy direct-execution
     * API). Only for Ri's typed reads, which need version-pinned output. `read` lets a read retry.
     */
    async executePinned(input: { toolSlug: string; version: string; userId: string; connectedAccountId: string; arguments: Record<string, unknown>; read: boolean; signal?: AbortSignal }): Promise<{ successful: boolean; data: Record<string, unknown>; error?: string; logId?: string }> {
      const result = await request('POST', `/tools/execute/${encodeURIComponent(input.toolSlug)}`, {
        body: { connected_account_id: input.connectedAccountId, user_id: input.userId, version: input.version, arguments: input.arguments },
        schema: legacyExecuteSchema, write: !input.read, timeoutMs: EXECUTE_TIMEOUT_MS, ...(input.signal ? { signal: input.signal } : {}),
      });
      return { successful: result.successful, data: result.data ?? {}, ...(result.error ? { error: scrub(result.error) } : {}), ...(result.log_id ? { logId: result.log_id } : {}) };
    },
  };
}
