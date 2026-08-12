import { NextRequest, NextResponse } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getConnectorAdmin, getConnectorOwnerId } from '@/lib/connectors/runtime';
import { withCompression } from '@/lib/api/compression';

/**
 * Manage BYO ("use your own OAuth app") auth configs for a provider. These persist in the home
 * store (`.config/connectors/auth-configs.json`, client secret sealed) — never repo env. The
 * admin service seals the secret and enforces the cross-store invariants (no delete while
 * connections use it; no default repoint while legacy connections exist).
 *
 *   GET    ?providerId=slack            → list this provider's BYO configs (secret-free summaries)
 *   POST   { providerId, label, oauth, clientSecret?, ... } → add one
 *   DELETE ?id=slack-xxxx               → remove (blocked while in use)
 *
 * SCOPE: local single-user only — `admin.list`/`removeConfig` are NOT owner/tenant-filtered, so a
 * hosted multi-user deployment MUST add owner-scoped listing + per-mutation ownership checks (the
 * §20 isolation contract) before exposing this. Today every config is owner `'local'`.
 */
function errorResponse(e: unknown): NextResponse {
  const code = isConnectorError(e) ? e.code : undefined;
  const status = code === 'conflict' ? 409 : code === 'invalid_input' ? 400 : 400;
  return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status });
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  const providerId = new URL(request.url).searchParams.get('providerId');
  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 });
  return NextResponse.json({ configs: await (await getConnectorAdmin()).list(providerId) });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    providerId?: string;
    scheme?: 'oauth2';
    label?: string;
    oauth?: { clientId: string; redirectUri: string };
    clientSecret?: string;
    defaultScopes?: string[];
    allowedScopes?: string[];
    baseUrl?: string;
  };
  if (!body.providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 });
  try {
    const summary = await (await getConnectorAdmin()).addConfig({
      providerId: body.providerId,
      scheme: body.scheme ?? 'oauth2',
      label: body.label ?? '',
      scope: 'owner',
      ownerId: getConnectorOwnerId(),
      ...(body.oauth ? { oauth: body.oauth } : {}),
      ...(body.clientSecret ? { clientSecret: body.clientSecret } : {}),
      ...(body.defaultScopes ? { defaultScopes: body.defaultScopes } : {}),
      ...(body.allowedScopes ? { allowedScopes: body.allowedScopes } : {}),
      ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}),
    });
    return NextResponse.json({ config: summary });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  try {
    await (await getConnectorAdmin()).removeConfig(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
