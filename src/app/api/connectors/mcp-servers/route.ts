import { NextRequest, NextResponse } from 'next/server';
import { connectMcpClient } from '@connectors/engine/mcp';
import {
  getMcpServerStore,
  invalidateConnectorRuntime,
  mcpAuthHeaders,
  mcpOAuthProviderFor,
  withTimeout,
  MCP_TIMEOUT_MS,
} from '@/lib/connectors/runtime';
import { toSlug, type McpServerAuth } from '@/lib/connectors/mcp-servers';
import { validateMcpUrl, validateHeaderName, MCP_LIMITS } from '@/lib/connectors/mcp-validate';

/**
 * Manage user-added remote MCP servers (docs/connectors-mcp-ingest-spec.md §9).
 *
 *   GET  → list servers (+ cached health)
 *   POST → add one. Validates by actually connecting + listing tools (the identity-on-connect
 *          pattern) before persisting; the auth secret is sealed; then the runtime is invalidated
 *          so the next access ingests it. Returns the discovered tool count/names for a confident
 *          confirmation in the UI.
 */
export function GET() {
  return NextResponse.json({ servers: getMcpServerStore().list() });
}

interface AddBody {
  name?: string;
  url?: string;
  auth?: McpServerAuth;
  secret?: string;
  enabled?: boolean;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as AddBody;

  const name = (body.name ?? '').trim();
  if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });
  if (name.length > MCP_LIMITS.maxNameLength) {
    return NextResponse.json({ error: 'That name is too long.' }, { status: 400 });
  }
  const slug = toSlug(name);
  if (!slug) return NextResponse.json({ error: 'Use letters or numbers in the name.' }, { status: 400 });

  const urlCheck = validateMcpUrl(body.url ?? '');
  if (!urlCheck.ok) return NextResponse.json({ error: urlCheck.error }, { status: 400 });

  const auth: McpServerAuth = body.auth ?? { kind: 'none' };
  if (auth.kind === 'header' && !validateHeaderName(auth.header)) {
    return NextResponse.json({ error: 'That header name is not valid.' }, { status: 400 });
  }
  if ((auth.kind === 'bearer' || auth.kind === 'header') && !body.secret) {
    return NextResponse.json({ error: 'A token is required for this auth type.' }, { status: 400 });
  }

  const store = getMcpServerStore();
  if (store.getBySlug(slug)) {
    return NextResponse.json({ error: `A server named "${slug}" already exists.` }, { status: 409 });
  }
  if (store.list().length >= MCP_LIMITS.maxServers) {
    return NextResponse.json({ error: `You can add at most ${MCP_LIMITS.maxServers} MCP servers.` }, { status: 409 });
  }

  // OAuth: create the entry first (so the SDK provider can persist DCR + PKCE state keyed by its id),
  // then attempt to connect — which discovers metadata, dynamically registers a client, and calls
  // redirectToAuthorization (captured below) before throwing. Return the authorization URL for the
  // browser to follow; tools are ingested after the callback completes.
  if (auth.kind === 'oauth') {
    const entry = await store.create({ slug, displayName: name, url: urlCheck.url, auth, enabled: body.enabled ?? true });
    let authUrl: string | undefined;
    const provider = mcpOAuthProviderFor(entry, (u) => {
      authUrl = u.toString();
    });
    try {
      const client = await withTimeout(
        connectMcpClient({ url: urlCheck.url, name: slug, authProvider: provider }),
        MCP_TIMEOUT_MS,
        'authorize',
      );
      await client.close().catch(() => {}); // connected without auth (not actually OAuth-protected)
    } catch (e) {
      if (!authUrl) {
        await store.remove(entry.id); // genuine failure → don't leave a dangling entry
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Could not start authorization.' },
          { status: 400 },
        );
      }
    }
    if (authUrl) return NextResponse.json({ entry, requiresAuth: true, authUrl }, { status: 201 });
    invalidateConnectorRuntime(); // no auth needed after all → ingest on next access
    return NextResponse.json({ entry, requiresAuth: false }, { status: 201 });
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
      await client.close().catch(() => {});
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not connect to that server.' }, { status: 400 });
  }
  if (toolInfos.length > MCP_LIMITS.maxTools) {
    return NextResponse.json({ error: `That server exposes too many tools (max ${MCP_LIMITS.maxTools}).` }, { status: 400 });
  }

  const entry = await store.create(
    { slug, displayName: name, url: urlCheck.url, auth, enabled: body.enabled ?? true, tools: toolInfos },
    body.secret,
  );
  invalidateConnectorRuntime(); // next runtime access ingests it

  return NextResponse.json(
    { entry, toolCount: toolInfos.length, toolNames: toolInfos.map((t) => t.name) },
    { status: 201 },
  );
}
