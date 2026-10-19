/**
 * A real MCP client over Streamable HTTP or local stdio, adapted to `McpClientLike` for
 * `ingestMcpServer`. The `@modelcontextprotocol/client` import is **dynamic**, so this module loads
 * without the SDK present — a host that ingests with its own client never pays for it. Typed loosely
 * (the SDK is an optional peer) to avoid coupling the build to a specific SDK version.
 *
 * Protocol: every connection probes for MCP 2026-07-28 (`server/discover`) and falls back to the
 * 2025-era `initialize` handshake for servers that predate it. A probe the SDK cannot classify (an
 * unusable reply, a server error, or no answer within `MCP_HTTP_PROBE_TIMEOUT_MS`) is retried once
 * as a plain 2025 connection, so a legacy server that mishandles the unknown probe keeps working.
 * `server.negotiation` says which happened, so a host can skip the probe for such a server for a
 * while. Authorization failures are never treated as era evidence: they surface unchanged.
 *
 * A local (stdio) server keeps the 2025 handshake unless the host asks to negotiate: the SDK probes
 * a stdio server on a second, short-lived copy of its process, so every connection would start the
 * local program twice, and the stdio channel already carries forms and change notifications.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { McpClientLike, McpToolDef } from './ingest';
import { IntegrationError, NeedsReauthError } from '../core/errors';
import { MCP_CONNECT_TIMEOUT_MS, MCP_DISCOVERY_TIMEOUT_MS, MCP_RESOURCE_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS, MCP_TOOL_TOTAL_TIMEOUT_MS } from './timeouts';
import { mcpHttpFetch } from './http-fetch';

/** The protocol revision Ri prefers. Older servers negotiate 2025-era revisions. */
export const MCP_PREFERRED_PROTOCOL_VERSION = '2026-07-28';
/** A stdio server that ignores the unknown probe is a legacy server. Do not wait the full connect budget. */
export const MCP_STDIO_PROBE_TIMEOUT_MS = 10_000;
/** An HTTP server silent on the probe gets one plain 2025 attempt after this, within the connect budget. */
export const MCP_HTTP_PROBE_TIMEOUT_MS = 10_000;
/** Messages larger than this close a stdio connection. CAD and media apps send multi-megabyte blobs. */
export const MCP_STDIO_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

/** What Ri advertises to every server: MCP Apps views, plus whatever the host adds (elicitation). */
export const MCP_APPS_EXTENSION = { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } as const;
/** Form rounds one tool call may ask for before Ri stops answering (the SDK's own default). */
export const MCP_INPUT_ROUNDS = 10;
/** A 2026-07-28 round that carries only `requestState` is retried after this pause, as the SDK paces it. */
const STATE_ONLY_PACING_MS = 250;

/**
 * A form Ri cannot show, or cannot place. `unsupported` is a form with an input type Ri does not
 * render (OpenAI's spec: reported as unsupported, never partly shown). `unrouted` is a form whose
 * asker Ri cannot tell apart, which it refuses rather than show to the wrong person. `unavailable`
 * is anything else that ends the form without an answer. A 2025-era server receives it as a
 * JSON-RPC error. A 2026-07-28 call fails with it.
 */
export class McpFormError extends Error {
  constructor(message: string, readonly reason: 'unsupported' | 'unrouted' | 'unavailable') {
    super(message);
    this.name = 'McpFormError';
  }
}

/**
 * The run a tool call belongs to (`callTool`'s `origin`), while that call is in flight. A 2025-era
 * server's request on the call's own HTTP response stream is handled inside it, so its form finds
 * the run that caused it. Proven per transport in mcp-client.test.ts.
 */
const formOrigin = new AsyncLocalStorage<{ origin: unknown }>();

interface CommonMcpOptions {
  name?: string;
  version?: string;
  /** Advisory server notification. The host should refresh discovery and invalidate cached tool policy. */
  onToolsChanged?: () => void | Promise<void>;
  /**
   * Extra client capabilities, merged over the MCP Apps extension. A host advertises elicitation
   * here only together with `onElicit`, since a server may rely on what is advertised.
   */
  capabilities?: Record<string, unknown>;
  /**
   * Answers a server's form request: standard `elicitation/create`, OpenAI's legacy
   * `openai/elicitation/create`, and 2026-07-28 multi-round-trip `input_required` rounds, which
   * `callTool` answers itself (`round` set). `method` names which one arrived.
   *
   * `origin` is the `origin` the asking `callTool` was given: exact for a 2026-07-28 round and for a
   * 2025-era request on that call's HTTP response stream. A local (stdio) server's request has no
   * tie to a call on the wire, so it gets the origin only while exactly one request is in flight on
   * the connection. Otherwise `origin` is undefined, and the host should refuse with `McpFormError`.
   */
  onElicit?: (request: { method: 'elicitation/create' | 'openai/elicitation/create'; params: Record<string, unknown>; round?: boolean }, signal: AbortSignal, origin?: unknown) => Promise<Record<string, unknown>>;
  /** Skip the 2026-07-28 probe for a server known to be legacy. Freshness is the host's job. */
  knownLegacy?: boolean;
  /** Whether to probe for 2026-07-28. Defaults to `auto` over HTTP and `legacy` for a local process. */
  negotiate?: 'auto' | 'legacy';
}

export type ConnectMcpOptions = CommonMcpOptions & ({
  url: string;
  command?: never;
  headers?: Record<string, string>;
  /**
   * The SDK's `OAuthClientProvider` for an OAuth-protected server. When set, the transport uses any
   * stored access token, refreshes it if expired, and on a missing/failed token calls the provider's
   * `redirectToAuthorization` and throws `UnauthorizedError` from `connect`. Typed loosely (the SDK
   * is an optional peer); the host supplies a typed implementation.
   */
  authProvider?: unknown;
  /** Only for an `authProvider` that applies RFC 8414's issuer rule itself, with trusted exceptions. */
  skipIssuerMetadataValidation?: boolean;
} | {
  /** Trusted host configuration only. Never take a command from model or remote tool input. */
  command: string;
  args?: string[];
  /** Trusted host configuration only. The working directory a local server starts in. */
  cwd?: string;
  url?: never;
  headers?: never;
  authProvider?: never;
  skipIssuerMetadataValidation?: never;
});

/** What the server told Ri about itself when the connection opened. Self-reported, for display and feature discovery only. */
export interface McpServerFacts {
  /** The negotiated revision, such as `2026-07-28` or `2025-11-25`. */
  protocolVersion?: string;
  /** `modern` for 2026-07-28 and later, `legacy` for the 2025-era handshake. */
  era?: 'modern' | 'legacy';
  /** Advertised server capabilities, including `extensions` and legacy `experimental`. */
  capabilities?: Record<string, unknown>;
  /** `serverInfo`: name, title, version, icons and website. */
  info?: Record<string, unknown>;
  instructions?: string;
  /**
   * How the era was settled: `probe` (the server answered `server/discover`, either way),
   * `fallback` (the probe failed or went unanswered, and a plain 2025 handshake worked), or
   * `known-legacy` (the host skipped the probe).
   */
  negotiation?: 'probe' | 'fallback' | 'known-legacy';
}

export interface McpResourceContent { uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> }

export interface ConnectedMcpClient extends McpClientLike {
  readResource(params: { uri: string; _meta?: Record<string, unknown> }): Promise<{ contents: McpResourceContent[]; _meta?: Record<string, unknown> }>;
  /** Facts from the opening exchange. Empty for a test double. */
  readonly server?: McpServerFacts;
  close(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sdk = any;
const sdk = (): Promise<Sdk> => import('@modelcontextprotocol/client');

/** Only typed SDK rejection or the host's credential signal proves authorization failed. */
export async function isMcpAuthenticationError(error: unknown): Promise<boolean> {
  if (error instanceof NeedsReauthError) return true;
  const { UnauthorizedError, SdkHttpError, SdkErrorCode } = await sdk();
  if (error instanceof UnauthorizedError) return true;
  // A 401 the auth flow could not recover. A 403 is a permission answer, not proof the credential failed.
  return error instanceof SdkHttpError && ((error as { status?: number }).status === 401 || (error as { code?: string }).code === SdkErrorCode.ClientHttpAuthentication);
}

/** A request timeout does not prove the shared transport or its credentials failed. */
export async function isMcpRequestTimeout(error: unknown): Promise<boolean> {
  if (error instanceof IntegrationError && error.code === 'provider_timeout') return true;
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;
  const { SdkError, SdkErrorCode } = await sdk();
  return error instanceof SdkError && (error as { code?: string }).code === SdkErrorCode.RequestTimeout;
}

/**
 * Start OAuth explicitly for a trusted host profile with specific consent scopes
 * or a gateway that does not issue an unauthenticated MCP challenge. This does not
 * open a transport or reinterpret HTTP errors. The provider owns registration,
 * consent, and token storage. Scope must come from trusted host configuration.
 */
export async function beginMcpOAuth(opts: { url: string; authProvider: unknown; scope?: string; skipIssuerMetadataValidation?: boolean }): Promise<'AUTHORIZED' | 'REDIRECT'> {
  const { auth } = await sdk();
  return auth(opts.authProvider, { serverUrl: opts.url, ...(opts.scope ? { scope: opts.scope } : {}), ...(opts.skipIssuerMetadataValidation ? { skipIssuerMetadataValidation: true } : {}) });
}

const ERA_CLASSIFICATION_FAILURES = new Set(['ERA_NEGOTIATION_FAILED', 'EraNegotiationFailed']);

export async function connectMcpClient(opts: ConnectMcpOptions): Promise<ConnectedMcpClient> {
  const mod = await sdk();
  const http = opts.command === undefined ? await mcpHttpFetch() : undefined;
  const url = opts.command === undefined ? new URL(opts.url) : undefined;

  // Requests in flight on this connection, for a local server's form, which has no tie to a call on the wire.
  const inFlight = new Map<symbol, { origin: unknown } | null>();
  const tracked = async <T>(origin: { origin: unknown } | null, run: () => Promise<T>): Promise<T> => {
    const key = Symbol('request');
    inFlight.set(key, origin);
    try { return await run(); } finally { inFlight.delete(key); }
  };
  const legacyOrigin = (): unknown => {
    const scoped = formOrigin.getStore();
    if (scoped) return scoped.origin;
    if (opts.command === undefined || inFlight.size !== 1) return undefined;
    return [...inFlight.values()][0]?.origin;
  };

  const open = async (mode: 'auto' | 'legacy') => {
    const capabilities = {
      ...(opts.capabilities ?? {}),
      extensions: { ...MCP_APPS_EXTENSION, ...((opts.capabilities?.extensions as Record<string, unknown> | undefined) ?? {}) },
    };
    const notify = () => { void Promise.resolve(opts.onToolsChanged?.()).catch(() => {}); };
    const client = new mod.Client({ name: opts.name ?? 'integrations-engine', version: opts.version ?? '0.0.1' }, {
      capabilities,
      versionNegotiation: { mode, ...(mode === 'auto' ? { probe: { timeoutMs: opts.command !== undefined ? MCP_STDIO_PROBE_TIMEOUT_MS : MCP_HTTP_PROBE_TIMEOUT_MS } } : {}) },
      // `callTool` answers 2026-07-28 input rounds itself, where it knows exactly which run asked.
      inputRequired: { autoFulfill: false },
      // 2026-07-28 delivers list changes on a `subscriptions/listen` stream the client opens.
      ...(opts.onToolsChanged ? { listChanged: { tools: { autoRefresh: false, debounceMs: 0, onChanged: notify } } } : {}),
    });
    if (opts.onToolsChanged) {
      // 2025-era servers push the notification unsolicited, sometimes without advertising
      // `tools.listChanged`. Install before connect so an early change cannot be lost between
      // discovery and publication. This does not trust new tools or bypass host lifecycle checks.
      client.setNotificationHandler('notifications/tools/list_changed', notify);
    }
    if (opts.onElicit) {
      const elicit = (method: 'elicitation/create' | 'openai/elicitation/create') =>
        async (request: { params?: Record<string, unknown> } | Record<string, unknown>, ctx: { mcpReq?: { signal?: AbortSignal }; signal?: AbortSignal }) => {
          const params = (method === 'elicitation/create' ? (request as { params?: Record<string, unknown> }).params : request) ?? {};
          try {
            return await opts.onElicit!({ method, params: params as Record<string, unknown> }, ctx?.mcpReq?.signal ?? ctx?.signal ?? new AbortController().signal, legacyOrigin());
          } catch (error) {
            // The server learns why its form went unanswered, as a typed JSON-RPC error.
            if (error instanceof McpFormError) {
              throw new mod.ProtocolError(error.reason === 'unsupported' ? mod.ProtocolErrorCode.InvalidParams : mod.ProtocolErrorCode.InternalError, error.message);
            }
            throw error;
          }
        };
      client.setRequestHandler('elicitation/create', elicit('elicitation/create'));
      // OpenAI's superset for 2025-era connections. A custom method: the SDK validates neither side.
      client.setRequestHandler('openai/elicitation/create', { params: passthrough(), result: passthrough() }, elicit('openai/elicitation/create'));
    }
    const transport = opts.command !== undefined
      ? new (await import('@modelcontextprotocol/client/stdio')).StdioClientTransport({
        command: opts.command, args: opts.args ?? [], stderr: 'pipe', maxBufferSize: MCP_STDIO_MAX_BUFFER_BYTES,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
      })
      : new mod.StreamableHTTPClientTransport(url!, {
        fetch: http!.fetch,
        // SDK 1.x followed redirects. Keep that: some servers and authorization servers move
        // across origins, and fetch drops Authorization on a cross-origin redirect.
        redirectPolicy: 'follow',
        ...(opts.authProvider ? { authProvider: opts.authProvider } : {}),
        ...(opts.skipIssuerMetadataValidation ? { skipIssuerMetadataValidation: true } : {}),
        ...(opts.headers ? { requestInit: { headers: opts.headers } } : {}),
      });
    // Drain diagnostics without putting subprocess output into Ri's logs or blocking a full pipe.
    if (opts.command !== undefined) transport.stderr?.resume();
    try {
      await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS });
      return client;
    } catch (error) {
      // The host cannot close a client that never returned from this function.
      // Release the partially started transport without hiding the auth/network error.
      try { await client.close(); } catch { /* best-effort cleanup */ }
      throw error;
    }
  };

  let client: Sdk;
  const probe = !opts.knownLegacy && (opts.negotiate ?? (opts.command === undefined ? 'auto' : 'legacy')) === 'auto';
  let negotiation: McpServerFacts['negotiation'] = probe ? 'probe' : 'known-legacy';
  try {
    try {
      client = await open(probe ? 'auto' : 'legacy');
    } catch (error) {
      // The probe got an answer the SDK cannot read as either era (an unusable reply, a 5xx to the
      // unknown method), or none in time. Authorization and network outages are not this case: a
      // refused connection or a 401/403 fails the same way on the 2025 handshake.
      const code = String((error as { code?: unknown }).code);
      const unclassified = error instanceof mod.SdkError && (ERA_CLASSIFICATION_FAILURES.has(code) || code === mod.SdkErrorCode.RequestTimeout);
      if (!probe || !unclassified) throw error;
      if (error instanceof mod.SdkHttpError && [401, 403].includes((error as { status?: number }).status ?? 0)) throw error;
      client = await open('legacy');
      negotiation = 'fallback';
    }
  } catch (error) {
    await http?.close().catch(() => {});
    throw error;
  }

  const capabilities = client.getServerCapabilities?.() as Record<string, unknown> | undefined;
  const info = client.getServerVersion?.() as Record<string, unknown> | undefined;
  const server: McpServerFacts = {
    protocolVersion: client.getNegotiatedProtocolVersion?.(),
    era: client.getProtocolEra?.(),
    ...(capabilities ? { capabilities: structuredClone(capabilities) } : {}),
    ...(info ? { info: structuredClone(info) } : {}),
    ...(client.getInstructions?.() ? { instructions: client.getInstructions() } : {}),
    negotiation,
  };

  return {
    server,
    async readResource(params) {
      return tracked(null, () => client.readResource(params, { timeout: MCP_RESOURCE_TIMEOUT_MS }));
    },
    async listTools() {
      return tracked(null, () => listTools());
    },
    async callTool(params, options) {
      if (options?.signal?.aborted) throw new IntegrationError('denied', 'The request was cancelled before dispatch. No request was sent.');
      const scope = { origin: options?.origin };
      return tracked(scope, () => formOrigin.run(scope, () => callTool(params, options)));
    },
    async close() {
      try { await client.close(); } finally { await http?.close(); }
    },
  };

  async function listTools() {
    try {
      // No cursor: the SDK walks every page (bounded, so a cursor cycle fails rather than hangs).
      // Always fetch: discovery is the moment Ri checks what the server offers now.
      const res = await client.listTools(undefined, { timeout: MCP_DISCOVERY_TIMEOUT_MS, cacheMode: 'refresh' });
      return { tools: (res.tools ?? []).map((t: McpToolDef) => structuredClone(t)) };
    } catch (error) {
      if (error instanceof mod.SdkError && (error as { code?: string }).code === mod.SdkErrorCode.ListPaginationExceeded) {
        throw new IntegrationError('provider_error', 'MCP server returned a repeated tool-list cursor.', { cause: error });
      }
      throw error;
    }
  }

  async function callTool(params: Parameters<ConnectedMcpClient['callTool']>[0], options: Parameters<ConnectedMcpClient['callTool']>[1]) {
    // Request progress explicitly. The SDK only sends a progressToken when
    // onprogress is present, even with resetTimeoutOnProgress enabled.
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new DOMException('Ri MCP total deadline exceeded', 'TimeoutError')), MCP_TOOL_TOTAL_TIMEOUT_MS);
    const started = Date.now();
    try {
      const meta = (params as { _meta?: Record<string, unknown> })._meta;
      const signal = options?.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;
      const base = { name: params.name, arguments: params.arguments ?? {}, ...(meta ? { _meta: meta } : {}) };
      let request: Record<string, unknown> = base;
      let res: Sdk;
      // A 2026-07-28 server asks for input by answering `input_required`. Each round is answered
      // here, with this call's origin, and the call retried with the answers and the server's
      // opaque state. A 2025-era server asks with its own request instead (`elicit` above).
      for (let round = 1; ; round++) {
        res = await client.callTool(request, {
          timeout: MCP_TOOL_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          // Later rounds get what remains of the call's total budget.
          maxTotalTimeout: round === 1 ? MCP_TOOL_TOTAL_TIMEOUT_MS : Math.max(1, MCP_TOOL_TOTAL_TIMEOUT_MS - (Date.now() - started)),
          signal,
          onprogress: () => {},
          allowInputRequired: true,
        });
        if (res?.resultType !== 'input_required') break;
        if (round > MCP_INPUT_ROUNDS) {
          throw new IntegrationError('provider_error', `MCP tool "${params.name}" still asked for input after ${MCP_INPUT_ROUNDS} rounds.`);
        }
        const entries = Object.entries((res.inputRequests ?? {}) as Record<string, { method?: unknown; params?: Record<string, unknown> }>);
        const inputResponses: Record<string, unknown> = {};
        // One at a time: each is a form a person answers.
        for (const [key, entry] of entries) {
          if (entry?.method !== 'elicitation/create') {
            throw new IntegrationError('provider_error', `MCP tool "${params.name}" asked for ${typeof entry?.method === 'string' ? entry.method : 'unknown'} input, which Ri does not provide.`);
          }
          if (!opts.onElicit) throw new IntegrationError('provider_error', `MCP tool "${params.name}" asked for a form, which this connection cannot show.`);
          try {
            inputResponses[key] = await opts.onElicit({ method: 'elicitation/create', params: entry.params ?? {}, round: true }, signal, options?.origin);
          } catch (error) {
            if (error instanceof McpFormError) throw new IntegrationError('provider_error', error.message, { cause: error });
            throw error;
          }
        }
        if (!entries.length) await new Promise(resolve => setTimeout(resolve, STATE_ONLY_PACING_MS));
        request = { ...base, ...(entries.length ? { inputResponses } : {}), ...(res.requestState !== undefined ? { requestState: res.requestState } : {}) };
      }
      return {
        content: res.content,
        ...(res.structuredContent !== undefined ? { structuredContent: res.structuredContent } : {}),
        isError: res.isError ?? false,
        ...(res._meta !== undefined ? { _meta: res._meta } : {}),
      };
    } catch (error) {
      if (options?.signal?.aborted) {
        throw new DOMException('The MCP request was cancelled after dispatch and may have completed upstream.', 'AbortError');
      }
      // Only the SDK's typed authentication rejection proves this request was
      // rejected before execution. Network failures and lookalike messages do
      // not, so leave those intact for the mutation's indeterminate handling.
      if (await isMcpAuthenticationError(error)) {
        throw new NeedsReauthError(undefined, 'MCP transport requires authorization');
      }
      if (await isMcpRequestTimeout(error)) {
        const data = (error as { data?: { maxTotalTimeout?: number; timeout?: number } }).data;
        const total = deadline.signal.aborted || data?.maxTotalTimeout === MCP_TOOL_TOTAL_TIMEOUT_MS;
        const reason = total ? "The request exceeded Ri's 30-minute total limit."
          : data?.timeout === MCP_TOOL_TIMEOUT_MS ? "The request exceeded Ri's 10-minute inactivity limit."
            : 'The upstream MCP request reported a timeout.';
        throw new IntegrationError('provider_timeout',
          `${reason} It may have completed upstream. Check the service before repeating a paid or mutating request.`,
          { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** An accept-anything Standard Schema for a custom method whose payload Ri validates itself. */
function passthrough() {
  return { '~standard': { version: 1, vendor: 'ri', validate: (value: unknown) => ({ value }) } };
}

/**
 * Complete an OAuth handshake after the user is redirected back with an authorization code. Builds a
 * transport with the same `authProvider` (which persisted the client registration + PKCE verifier
 * during the initial attempt) and calls `finishAuth`, which exchanges the code and saves the tokens
 * via the provider. Pass `iss` from the callback when present: the SDK checks it against the issuer
 * the redirect targeted (RFC 9207). Pure handshake — no client/connection is opened.
 */
export async function finishMcpOAuth(opts: { url: string; authProvider: unknown; authorizationCode: string; iss?: string | null; skipIssuerMetadataValidation?: boolean }): Promise<void> {
  const mod = await sdk();
  const transport = new mod.StreamableHTTPClientTransport(new URL(opts.url), {
    authProvider: opts.authProvider, redirectPolicy: 'follow', ...(opts.skipIssuerMetadataValidation ? { skipIssuerMetadataValidation: true } : {}),
  });
  try {
    await transport.finishAuth(opts.authorizationCode, ...(opts.iss ? [opts.iss] : []));
  } finally {
    await transport.close?.().catch(() => {});
  }
}
