import { NextRequest, NextResponse } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getConnectorRuntime, buildCredential } from '@/lib/connectors/runtime';

/**
 * Connect a non-OAuth provider (API key / custom) from pasted credential fields. The route maps
 * the posted `fields` to the engine credential shape the provider's strategy expects, then runs
 * `connectDirect` (which validates the shape, runs identify() if any, seals, and stores).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    providerId?: unknown;
    fields?: unknown;
    label?: unknown;
  };
  const providerId = typeof body.providerId === 'string' ? body.providerId : '';
  if (!providerId) return NextResponse.json({ error: 'providerId required' }, { status: 400 });
  const fields =
    body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, string>) : {};

  const runtime = await getConnectorRuntime();
  const provider = runtime.getProviders().find((p) => p.id === providerId);
  if (!provider) return NextResponse.json({ error: 'unknown_provider' }, { status: 400 });

  try {
    const credential = buildCredential(provider.auth.kind, fields);
    const connection = await runtime.connectDirect(providerId, {
      credential,
      label: typeof body.label === 'string' ? body.label : undefined,
    });
    return NextResponse.json({ connection });
  } catch (e) {
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}
