import { NextRequest, NextResponse } from 'next/server';
import {
  getMcpServerStore,
  getConnectorConnectionStore,
  getConnectorOwnerId,
  invalidateConnectorRuntime,
} from '@/lib/connectors/runtime';
import type { McpServerAuth } from '@/lib/connectors/mcp-servers';
import { validateMcpUrl, validateHeaderName } from '@/lib/connectors/mcp-validate';
import { beginMcpAuthorization } from '@/lib/connectors/mcp-authorization';
import { removeMcpServer, updateMcpServerConfiguration } from '@/lib/connectors/mcp-lifecycle';

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
  reviewedRevision?: string;
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const entry = getMcpServerStore().get(id);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (body.reviewedRevision !== undefined) {
    if (typeof body.reviewedRevision !== 'string' || Object.keys(body).some(key => key !== 'reviewedRevision')) {
      return NextResponse.json({ error: 'Review tool changes separately from connection settings.' }, { status: 400 });
    }
    try {
      const reviewed = await getMcpServerStore().acknowledgeCapabilities(id, body.reviewedRevision);
      return reviewed ? NextResponse.json({ entry: reviewed }) : NextResponse.json({ error: 'not_found' }, { status: 404 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Tool changes could not be reviewed.' }, { status: 409 });
    }
  }
  if (entry?.providerId && (body.url !== undefined || body.auth !== undefined || body.secret !== undefined)) {
    return NextResponse.json({ error: 'Built-in connector services are managed by the app. Use Connect to sign in.' }, { status: 400 });
  }

  if (body.url !== undefined) {
    const check = validateMcpUrl(body.url);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    body.url = check.url;
  }
  if (body.auth?.kind === 'header' && !validateHeaderName(body.auth.header)) {
    return NextResponse.json({ error: 'That header name is not valid.' }, { status: 400 });
  }

  const updated = await updateMcpServerConfiguration(entry, getMcpServerStore(), getConnectorConnectionStore(), getConnectorOwnerId(), {
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
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getMcpServerStore().get(id);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (entry.auth.kind !== 'oauth') {
    return NextResponse.json({ error: 'not an OAuth server' }, { status: 400 });
  }
  try {
    return NextResponse.json(await beginMcpAuthorization(entry, request));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start authorization.' }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = getMcpServerStore();
  const entry = store.get(id);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  if (!await removeMcpServer(entry, store, getConnectorConnectionStore(), getConnectorOwnerId())) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  invalidateConnectorRuntime();
  return NextResponse.json({ ok: true });
}
