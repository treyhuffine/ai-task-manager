import { NextRequest, NextResponse } from 'next/server';
import {
  getMcpServerStore,
  getConnectorRuntime,
  invalidateConnectorRuntime,
  mcpConnectionId,
} from '@/lib/connectors/runtime';
import type { McpServerAuth } from '@/lib/connectors/mcp-servers';
import { validateMcpUrl, validateHeaderName } from '@/lib/connectors/mcp-validate';
import { beginMcpAuthorization } from '@/lib/connectors/mcp-authorization';

/**
 * Edit (enable/disable, rename, change url/auth) or remove one MCP server. `slug` is immutable, so
 * it is never patchable. Any change invalidates the runtime so the next access re-ingests (or drops)
 * the server. Remove also deletes the derived engine connection so no `mcp_<slug>` row dangles.
 */
interface PatchBody {
  displayName?: string;
  url?: string;
  enabled?: boolean;
  auth?: McpServerAuth;
  toolOverrides?: Record<string, { enabled?: boolean; mutating?: boolean }>;
  secret?: string | null;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;

  if (body.url !== undefined) {
    const check = validateMcpUrl(body.url);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    body.url = check.url;
  }
  if (body.auth?.kind === 'header' && !validateHeaderName(body.auth.header)) {
    return NextResponse.json({ error: 'That header name is not valid.' }, { status: 400 });
  }

  const updated = await getMcpServerStore().update(id, {
    ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
    ...(body.url !== undefined ? { url: body.url } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(body.auth !== undefined ? { auth: body.auth } : {}),
    ...(body.toolOverrides !== undefined ? { toolOverrides: body.toolOverrides } : {}),
    ...(body.secret !== undefined ? { secret: body.secret } : {}),
  });
  if (!updated) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  invalidateConnectorRuntime();
  return NextResponse.json({ entry: updated });
}

/**
 * (Re)start the OAuth flow for an existing OAuth server — used when a first attempt was abandoned,
 * or refresh failed and the user must re-consent. Returns the authorization URL for the browser.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getMcpServerStore().get(id);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (entry.auth.kind !== 'oauth') {
    return NextResponse.json({ error: 'not an OAuth server' }, { status: 400 });
  }
  try {
    return NextResponse.json(await beginMcpAuthorization(entry));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start authorization.' }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getMcpServerStore();
  const entry = store.get(id);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Drop the derived engine connection first (best-effort), then the store row, then rebuild.
  try {
    const runtime = await getConnectorRuntime();
    await runtime.disconnectConnection(mcpConnectionId(entry.slug));
  } catch {
    /* connection may not exist (server was disabled/unreachable) — fine */
  }
  await store.remove(id);
  invalidateConnectorRuntime();
  return NextResponse.json({ ok: true });
}
