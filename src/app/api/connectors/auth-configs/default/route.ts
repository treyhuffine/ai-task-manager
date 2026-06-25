import { NextRequest, NextResponse } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getConnectorAdmin } from '@/lib/connectors/runtime';

/** Set which auth config is the default for a provider (blocked while legacy connections exist). */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { providerId?: string; id?: string };
  if (!body.providerId || !body.id) {
    return NextResponse.json({ error: 'providerId and id required' }, { status: 400 });
  }
  try {
    await (await getConnectorAdmin()).setDefault(body.providerId, body.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: code === 'conflict' ? 409 : 400 });
  }
}
