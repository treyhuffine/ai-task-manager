/**
 * A real MCP client over Streamable HTTP, adapted to `McpClientLike` for
 * `ingestMcpServer`. The `@modelcontextprotocol/sdk` import is **dynamic**, so this
 * module loads without the SDK present — a host that ingests with its own client
 * never pays for it. Typed loosely (the SDK is an optional peer) to avoid coupling
 * the build to a specific SDK version.
 */
import type { McpClientLike, McpToolDef } from './ingest';
import { ConnectorError, NeedsReauthError } from '../core/errors';

export interface ConnectMcpOptions {
  url: string;
  name?: string;
  version?: string;
  headers?: Record<string, string>;
  /**
   * The SDK's `OAuthClientProvider` for an OAuth-protected server. When set, the transport uses any
   * stored access token, refreshes it if expired, and on a missing/failed token calls the provider's
   * `redirectToAuthorization` and throws `UnauthorizedError` from `connect`. Typed loosely (the SDK
   * is an optional peer); the host supplies a typed implementation.
   */
  authProvider?: unknown;
  /** Advisory server notification. The host should refresh discovery and invalidate cached tool policy. */
  onToolsChanged?: () => void | Promise<void>;
}

export interface ConnectedMcpClient extends McpClientLike {
  close(): Promise<void>;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientMod = (await import('@modelcontextprotocol/sdk/client/index.js')) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const httpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp.js')) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authMod = (await import('@modelcontextprotocol/sdk/client/auth.js')) as any;

  const client = new clientMod.Client({ name: opts.name ?? 'connectors-engine', version: opts.version ?? '0.0.1' });
  if (opts.onToolsChanged) {
    const { ToolListChangedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    // Install before connect so an early change cannot be lost between discovery
    // and publication. This does not trust new tools or bypass host lifecycle checks.
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => { await opts.onToolsChanged?.(); });
  }
  const transport = new httpMod.StreamableHTTPClientTransport(new URL(opts.url), {
    ...(opts.authProvider ? { authProvider: opts.authProvider } : {}),
    ...(opts.headers ? { requestInit: { headers: opts.headers } } : {}),
  });
  try {
    await client.connect(transport);
  } catch (error) {
    // The host cannot close a client that never returned from this function.
    // Release the partially started transport without hiding the auth/network error.
    try { await client.close(); } catch { /* best-effort cleanup */ }
    throw error;
  }

  return {
    async listTools() {
      const tools: McpToolDef[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const res = await client.listTools(cursor === undefined ? undefined : { cursor });
        tools.push(...(res.tools ?? []).map((t: McpToolDef) => structuredClone(t)));
        cursor = res.nextCursor;
        if (cursor !== undefined) {
          if (seenCursors.has(cursor)) {
            throw new ConnectorError('provider_error', 'MCP server returned a repeated tool-list cursor.');
          }
          seenCursors.add(cursor);
        }
      } while (cursor !== undefined);
      return { tools };
    },
    async callTool(params) {
      // Long-running tools (§12): allow up to 10 min total, but reset the inactivity timer on each
      // progress notification so a working tool isn't killed — while a silent stall still caps at 2 min.
      try {
        const res = await client.callTool({ name: params.name, arguments: params.arguments ?? {} }, undefined, {
          timeout: 120_000,
          resetTimeoutOnProgress: true,
          maxTotalTimeout: 600_000,
        });
        return {
          content: res.content,
          ...(res.structuredContent !== undefined ? { structuredContent: res.structuredContent } : {}),
          isError: res.isError ?? false,
        };
      } catch (error) {
        // Only the SDK's typed authentication rejection proves this request was
        // rejected before execution. Network failures and lookalike messages do
        // not, so leave those intact for the mutation's indeterminate handling.
        if ((typeof authMod.UnauthorizedError === 'function' && error instanceof authMod.UnauthorizedError)
          || (typeof httpMod.StreamableHTTPError === 'function' && error instanceof httpMod.StreamableHTTPError
            && (error as { code: number }).code === 401)) {
          throw new NeedsReauthError(undefined, 'MCP transport requires authorization');
        }
        throw error;
      }
    },
    async close() {
      await client.close();
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
