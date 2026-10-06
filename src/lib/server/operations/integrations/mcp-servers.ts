import { INTEGRATION_LABELS } from '@/constants/integrations';
import { beginMcpAuthorization } from '@/lib/integrations/mcp-authorization';
import { toSlug, type McpServerAuth } from '@/lib/integrations/mcp-servers';
import { MCP_LIMITS, validateHeaderName, validateMcpUrl } from '@/lib/integrations/mcp-validate';
import {
  getMcpServerStore,
  invalidateIntegrationRuntime,
  MCP_TIMEOUT_MS,
  mcpAuthHeaders,
  withTimeout,
} from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { connectMcpClient } from '@integrations/engine/mcp';
import { z as rpcZ } from 'zod/v4';

/**
 * Manage user-added remote MCP servers (docs/integrations-mcp-ingest-spec.md §9).
 *
 *   GET  → list servers (+ cached health)
 *   POST → add one. Validates by actually connecting + listing tools (the identity-on-connect
 *          pattern) before persisting; the auth secret is sealed; then the runtime is invalidated
 *          so the next access ingests it. Returns the discovered tool count/names for a confident
 *          confirmation in the UI.
 */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply({ servers: getMcpServerStore().list() });
}

interface AddBody {
  name?: string;
  url?: string;
  auth?: McpServerAuth;
  secret?: string;
  enabled?: boolean;
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const body = (rpcInput.body) as AddBody;

  const name = (body.name ?? '').trim();
  if (!name) return reply({ error: 'A name is required.' }, { status: 400 });
  if (name.length > MCP_LIMITS.maxNameLength) {
    return reply({ error: 'That name is too long.' }, { status: 400 });
  }
  const slug = toSlug(name);
  if (!slug) return reply({ error: 'Use letters or numbers in the name.' }, { status: 400 });
  if (slug.startsWith('builtin_')) return reply({ error: `That name is reserved for a built-in ${INTEGRATION_LABELS.singular.toLowerCase()}.` }, { status: 400 });

  const urlCheck = validateMcpUrl(body.url ?? '');
  if (!urlCheck.ok) return reply({ error: urlCheck.error }, { status: 400 });

  const auth: McpServerAuth = body.auth ?? { kind: 'none' };
  if (auth.kind === 'header' && !validateHeaderName(auth.header)) {
    return reply({ error: 'That header name is not valid.' }, { status: 400 });
  }
  if ((auth.kind === 'bearer' || auth.kind === 'header') && !body.secret) {
    return reply({ error: 'A token is required for this auth type.' }, { status: 400 });
  }

  const store = getMcpServerStore();
  if (store.getBySlug(slug)) {
    return reply({ error: `A server named "${slug}" already exists.` }, { status: 409 });
  }
  if (store.list().length >= MCP_LIMITS.maxServers) {
    return reply({ error: `You can add at most ${MCP_LIMITS.maxServers} MCP servers.` }, { status: 409 });
  }

  // OAuth: create the entry first (so the SDK provider can persist DCR + PKCE state keyed by its id),
  // then attempt to connect — which discovers metadata, dynamically registers a client, and calls
  // redirectToAuthorization (captured below) before throwing. Return the authorization URL for the
  // browser to follow; tools are ingested after the callback completes.
  if (auth.kind === 'oauth') {
    const entry = await store.create({ slug, displayName: name, url: urlCheck.url, auth, enabled: body.enabled ?? true });
    try {
      const result = await beginMcpAuthorization(entry, request);
      return reply({ entry, ...result }, { status: 201 });
    } catch (e) {
      await store.remove(entry.id);
      return reply({ error: e instanceof Error ? e.message : 'Could not start authorization.' }, { status: 400 });
    }
  }

  // Validate by connecting + listing tools. Don't persist a server we can't reach.
  let toolInfos: { name: string; description?: string }[] = [];
  try {
    const headers = mcpAuthHeaders(auth, body.secret ?? null);
    const client = await withTimeout(
      connectMcpClient({ url: urlCheck.url, name: slug, headers }),
      MCP_TIMEOUT_MS,
      'connect',
    );
    try {
      const { tools } = await withTimeout(client.listTools(), MCP_TIMEOUT_MS, 'list tools');
      toolInfos = tools.map((t) => ({ name: t.name, ...(t.description ? { description: t.description } : {}) }));
    } finally {
      await client.close().catch(() => { });
    }
  } catch (e) {
    return reply({ error: e instanceof Error ? e.message : 'Could not connect to that server.' }, { status: 400 });
  }
  if (toolInfos.length > MCP_LIMITS.maxTools) {
    return reply({ error: `That server exposes too many tools (max ${MCP_LIMITS.maxTools}).` }, { status: 400 });
  }

  const entry = await store.create(
    { slug, displayName: name, url: urlCheck.url, auth, enabled: body.enabled ?? true, tools: toolInfos },
    body.secret,
  );
  invalidateIntegrationRuntime(); // next runtime access ingests it

  return reply(
    { entry, toolCount: toolInfos.length, toolNames: toolInfos.map((t) => t.name) },
    { status: 201 },
  );
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({ body: rpcZ.object({ "name": rpcZ.string().optional(), "url": rpcZ.string().optional(), "auth": rpcZ.union([rpcZ.object({ "kind": rpcZ.literal("none") }).strict(), rpcZ.object({ "kind": rpcZ.literal("bearer") }).strict(), rpcZ.object({ "kind": rpcZ.literal("header"), "header": rpcZ.string() }).strict(), rpcZ.object({ "kind": rpcZ.literal("oauth") }).strict()]).optional(), "secret": rpcZ.string().optional(), "enabled": rpcZ.boolean().optional() }).strict().default({}) }).strict();
