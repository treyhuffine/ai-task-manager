/**
 * Every MCP server Ri hosts over HTTP goes through here (docs/connected-mcp-apps.md, "Protocol").
 *
 * One handler serves both protocol eras from the same factory: 2026-07-28 natively (stateless, a
 * `_meta` envelope on every request, `server/discover`) and 2025-era clients such as current Claude
 * Code and Codex builds through the SDK's stateless Streamable HTTP fallback. A fresh server is built
 * per request, as before, so newly connected accounts and tool changes appear on the next call.
 *
 * Ri's tools describe their parameters as zod 3 shapes, and the v2 SDK needs Standard Schema with a
 * JSON Schema converter. `zodStandardSchema` adapts them with the same `zod-to-json-schema` options
 * SDK 1.x used, so `tools/list` publishes the same schemas it always did and zod still validates
 * (with its defaults and transforms) before a handler runs.
 */
import {
  createMcpHandler,
  McpServer,
  type CallToolResult,
  type ServerContext,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

/** A tool result. Structural, so registrars elsewhere (the integration engine's serveMcp) need no SDK types. */
export interface RiMcpToolResult {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/** What a tool handler learns about its request, the same on both eras. */
export interface RiMcpToolContext {
  /** Aborts when the client cancels or disconnects. */
  signal: AbortSignal;
  /** The HTTP request headers the proxy validated, or undefined off HTTP. */
  headers: Headers | undefined;
  /** `modern` for 2026-07-28, `legacy` for 2025-era clients. */
  era: 'legacy' | 'modern';
}

export interface RiMcpToolConfig {
  title?: string;
  description?: string;
  /** A zod 3 raw shape or object schema. Omitted means no parameters. */
  inputSchema?: z.ZodRawShape | z.ZodTypeAny;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

export type RiMcpToolHandler = (args: Record<string, unknown>, context: RiMcpToolContext) => RiMcpToolResult | Promise<RiMcpToolResult>;

/** The registrar every Ri MCP route builds its tools on. */
export interface RiMcpServer {
  readonly era: 'legacy' | 'modern';
  registerTool(name: string, config: RiMcpToolConfig, handler: RiMcpToolHandler): void;
}

export interface RiMcpServerOptions {
  name: string;
  version: string;
  title?: string;
  instructions?: string;
  /** Bytes a POST body may hold. Defaults to the SDK's 4 MiB. */
  maxRequestBodySize?: number;
}

const isZodType = (value: unknown): value is z.ZodTypeAny =>
  !!value && typeof value === 'object' && typeof (value as { safeParse?: unknown }).safeParse === 'function' && '_def' in value;

/**
 * A zod 3 schema as Standard Schema with JSON Schema conversion. The JSON Schema is the draft-07
 * document SDK 1.x published (`strictUnions`, input/output pipe strategy), whatever target the SDK
 * asks for, so the tool definitions clients cache do not change with the upgrade.
 */
export function zodStandardSchema(schema: z.ZodRawShape | z.ZodTypeAny): StandardSchemaWithJSON<Record<string, unknown>> {
  const object = isZodType(schema) ? schema : z.object(schema as z.ZodRawShape);
  const convert = (pipeStrategy: 'input' | 'output') => zodToJsonSchema(object, { strictUnions: true, pipeStrategy }) as Record<string, unknown>;
  return {
    '~standard': {
      version: 1,
      vendor: 'ri-zod3',
      validate: (value: unknown) => {
        const parsed = object.safeParse(value);
        if (parsed.success) return { value: parsed.data as Record<string, unknown> };
        return { issues: parsed.error.issues.map(issue => ({ message: issue.message, path: issue.path })) };
      },
      jsonSchema: { input: () => convert('input'), output: () => convert('output') },
    },
  };
}

function registrar(server: McpServer, era: 'legacy' | 'modern'): RiMcpServer {
  return {
    era,
    registerTool(name, config, handler) {
      const { inputSchema, ...rest } = config;
      const call = async (args: Record<string, unknown>, ctx: ServerContext) =>
        await handler(args, { signal: ctx.mcpReq.signal, headers: ctx.http?.req?.headers, era }) as CallToolResult;
      if (inputSchema) {
        server.registerTool(name, { ...rest, inputSchema: zodStandardSchema(inputSchema) }, (args, ctx) => call(args, ctx));
      } else {
        server.registerTool(name, rest, ctx => call({}, ctx));
      }
    },
  };
}

/**
 * A web-standard `(Request) => Response` MCP endpoint serving 2026-07-28 and 2025-era clients.
 * `build` registers the tools for one request. It runs per request, after any auth the route did.
 */
export function riMcpHandler(build: (server: RiMcpServer) => void | Promise<void>, options: RiMcpServerOptions): (request: Request) => Promise<Response> {
  const handler = createMcpHandler(async ({ era }) => {
    const server = new McpServer(
      { name: options.name, version: options.version, ...(options.title ? { title: options.title } : {}) },
      { capabilities: { tools: {} }, ...(options.instructions ? { instructions: options.instructions } : {}) },
    );
    await build(registrar(server, era));
    return server;
  }, {
    legacy: 'stateless',
    ...(options.maxRequestBodySize ? { maxRequestBodySize: options.maxRequestBodySize } : {}),
    onerror: error => { if (process.env.NODE_ENV !== 'production') console.warn(`[mcp:${options.name}]`, error.message); },
  });
  return request => handler.fetch(request);
}

/**
 * The `[transport]` segment of a route that used to serve both `mcp` and the retired HTTP+SSE
 * transport. Only `mcp` is an endpoint now. Anything else is not found rather than silently
 * answering MCP on an arbitrary path under the route.
 */
export function isMcpTransport(transport: string | undefined): boolean {
  return transport === 'mcp';
}

export function mcpNotFound(): Response {
  return Response.json({ jsonrpc: '2.0', error: { code: -32601, message: 'Not found. This MCP endpoint is served at …/mcp.' }, id: null }, { status: 404 });
}
