/**
 * A real MCP client over Streamable HTTP or local stdio, adapted to `McpClientLike` for
 * `ingestMcpServer`. The `@modelcontextprotocol/sdk` import is **dynamic**, so this
 * module loads without the SDK present — a host that ingests with its own client
 * never pays for it. Typed loosely (the SDK is an optional peer) to avoid coupling
 * the build to a specific SDK version.
 */
import type { McpClientLike, McpToolDef } from './ingest';
import { IntegrationError, NeedsReauthError } from '../core/errors';
import { MCP_CONNECT_TIMEOUT_MS, MCP_DISCOVERY_TIMEOUT_MS, MCP_RESOURCE_TIMEOUT_MS, MCP_TOOL_TIMEOUT_MS, MCP_TOOL_TOTAL_TIMEOUT_MS } from './timeouts';
import { mcpHttpFetch } from './http-fetch';

interface CommonMcpOptions {
  name?: string;
  version?: string;
  /** Advisory server notification. The host should refresh discovery and invalidate cached tool policy. */
  onToolsChanged?: () => void | Promise<void>;
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
} | {
  /** Trusted host configuration only. Never take a command from model or remote tool input. */
  command: string;
  args?: string[];
  url?: never;
  headers?: never;
  authProvider?: never;
});

export interface ConnectedMcpClient extends McpClientLike {
  readResource(params: { uri: string }): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string; _meta?: Record<string, unknown> }> }>;
  close(): Promise<void>;
}

/** Only typed SDK rejection or the host's credential signal proves authorization failed. */
export async function isMcpAuthenticationError(error: unknown): Promise<boolean> {
  if (error instanceof NeedsReauthError) return true;
  const [authMod, httpMod] = await Promise.all([
    import('@modelcontextprotocol/sdk/client/auth.js'),
    import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
  ]);
  return error instanceof authMod.UnauthorizedError ||
    (error instanceof httpMod.StreamableHTTPError && error.code === 401);
}

/** A request timeout does not prove the shared transport or its credentials failed. */
export async function isMcpRequestTimeout(error: unknown): Promise<boolean> {
  if (error instanceof IntegrationError && error.code === 'provider_timeout') return true;
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;
  const { McpError, ErrorCode } = await import('@modelcontextprotocol/sdk/types.js');
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

/**
 * Start OAuth explicitly for a trusted host profile with specific consent scopes
 * or a gateway that does not issue an unauthenticated MCP challenge. This does not
 * open a transport or reinterpret HTTP errors. The provider owns registration,
 * consent, and token storage. Scope must come from trusted host configuration.
 */
export async function beginMcpOAuth(opts: { url: string; authProvider: unknown; scope?: string }): Promise<'AUTHORIZED' | 'REDIRECT'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authMod = (await import('@modelcontextprotocol/sdk/client/auth.js')) as any;
  return authMod.auth(opts.authProvider, { serverUrl: opts.url, ...(opts.scope ? { scope: opts.scope } : {}) });
}

export async function connectMcpClient(opts: ConnectMcpOptions): Promise<ConnectedMcpClient> {
  const url = opts.command === undefined ? new URL(opts.url) : undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientMod = (await import('@modelcontextprotocol/sdk/client/index.js')) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const httpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp.js')) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authMod = (await import('@modelcontextprotocol/sdk/client/auth.js')) as any;

  const client = new clientMod.Client({ name: opts.name ?? 'integrations-engine', version: opts.version ?? '0.0.1' }, {
    capabilities: { extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } },
  });
  const http = opts.command === undefined ? await mcpHttpFetch() : undefined;
  if (opts.onToolsChanged) {
    const { ToolListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    // Install before connect so an early change cannot be lost between discovery
    // and publication. This does not trust new tools or bypass host lifecycle checks.
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { await opts.onToolsChanged?.(); });
  }
  const transport = opts.command !== undefined
    ? new (await import('@modelcontextprotocol/sdk/client/stdio.js')).StdioClientTransport({
      command: opts.command, args: opts.args ?? [], stderr: 'pipe',
    })
    : new httpMod.StreamableHTTPClientTransport(url!, {
      fetch: http!.fetch,
      ...(opts.authProvider ? { authProvider: opts.authProvider } : {}),
      ...(opts.headers ? { requestInit: { headers: opts.headers } } : {}),
    });
  // Drain diagnostics without putting subprocess output into Ri's logs or blocking a full pipe.
  if (opts.command !== undefined) transport.stderr?.resume();
  try {
    await client.connect(transport, { timeout: MCP_CONNECT_TIMEOUT_MS });
  } catch (error) {
    // The host cannot close a client that never returned from this function.
    // Release the partially started transport without hiding the auth/network error.
    try { await client.close(); } catch { /* best-effort cleanup */ }
    await http?.close().catch(() => {});
    throw error;
  }

  return {
    async readResource(params) {
      return client.readResource(params, { timeout: MCP_RESOURCE_TIMEOUT_MS });
    },
    async listTools() {
      const tools: McpToolDef[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const res = await client.listTools(cursor === undefined ? undefined : { cursor }, { timeout: MCP_DISCOVERY_TIMEOUT_MS });
        tools.push(...(res.tools ?? []).map((t: McpToolDef) => structuredClone(t)));
        cursor = res.nextCursor;
        if (cursor !== undefined) {
          if (seenCursors.has(cursor)) {
            throw new IntegrationError('provider_error', 'MCP server returned a repeated tool-list cursor.');
          }
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
      return { tools };
    },
    async callTool(params, options) {
      if (options?.signal?.aborted) throw new IntegrationError('denied', 'The request was cancelled before dispatch. No request was sent.');
      // Request progress explicitly. The SDK only sends a progressToken when
      // onprogress is present, even with resetTimeoutOnProgress enabled.
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new DOMException('Ri MCP total deadline exceeded', 'TimeoutError')), MCP_TOOL_TOTAL_TIMEOUT_MS);
      try {
        const res = await client.callTool({ name: params.name, arguments: params.arguments ?? {} }, undefined, {
          timeout: MCP_TOOL_TIMEOUT_MS,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: MCP_TOOL_TOTAL_TIMEOUT_MS,
          signal: options?.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal,
          onprogress: () => {},
        });
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
        if ((typeof authMod.UnauthorizedError === 'function' && error instanceof authMod.UnauthorizedError)
          || (typeof httpMod.StreamableHTTPError === 'function' && error instanceof httpMod.StreamableHTTPError
            && (error as { code: number }).code === 401)) {
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
    },
    async close() {
      try { await client.close(); } finally { await http?.close(); }
    },
  };
}

/**
 * Complete an OAuth handshake after the user is redirected back with an authorization code. Builds a
 * transport with the same `authProvider` (which persisted the client registration + PKCE verifier
 * during the initial attempt) and calls `finishAuth(code)`, which exchanges the code and saves the
 * tokens via the provider. Pure handshake — no client/connection is opened.
 */
export async function finishMcpOAuth(opts: { url: string; authProvider: unknown; authorizationCode: string }): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const httpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp.js')) as any;
  const transport = new httpMod.StreamableHTTPClientTransport(new URL(opts.url), { authProvider: opts.authProvider });
  try {
    await transport.finishAuth(opts.authorizationCode);
  } finally {
    await transport.close?.().catch(() => {});
  }
}
