/**
 * A real MCP client over Streamable HTTP, adapted to `McpClientLike` for
 * `ingestMcpServer`. The `@modelcontextprotocol/sdk` import is **dynamic**, so this
 * module loads without the SDK present — a host that ingests with its own client
 * never pays for it. Typed loosely (the SDK is an optional peer) to avoid coupling
 * the build to a specific SDK version.
 */
import type { McpClientLike } from './ingest';

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
}

export interface ConnectedMcpClient extends McpClientLike {
  close(): Promise<void>;
}

export async function connectMcpClient(opts: ConnectMcpOptions): Promise<ConnectedMcpClient> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientMod = (await import('@modelcontextprotocol/sdk/client/index.js')) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const httpMod = (await import('@modelcontextprotocol/sdk/client/streamableHttp.js')) as any;

  const client = new clientMod.Client({ name: opts.name ?? 'connectors-engine', version: opts.version ?? '0.0.1' });
  const transport = new httpMod.StreamableHTTPClientTransport(new URL(opts.url), {
    ...(opts.authProvider ? { authProvider: opts.authProvider } : {}),
    ...(opts.headers ? { requestInit: { headers: opts.headers } } : {}),
  });
  await client.connect(transport);

  return {
    async listTools() {
      const res = await client.listTools();
      return {
        tools: (res.tools ?? []).map((t: { name: string; description?: string; inputSchema?: unknown }) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      };
    },
    async callTool(params) {
      // Long-running tools (§12): allow up to 10 min total, but reset the inactivity timer on each
      // progress notification so a working tool isn't killed — while a silent stall still caps at 2 min.
      const res = await client.callTool({ name: params.name, arguments: params.arguments ?? {} }, undefined, {
        timeout: 120_000,
        resetTimeoutOnProgress: true,
        maxTotalTimeout: 600_000,
      });
      return { content: res.content, isError: res.isError ?? false };
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
