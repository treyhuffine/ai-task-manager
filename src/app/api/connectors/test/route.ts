import { NextRequest, NextResponse } from 'next/server';
import { isConnectorError } from '@connectors/engine';
import { getConnectorRuntime, getConnectorOwnerId } from '@/lib/connectors/runtime';

/**
 * Health-probe a connection: forces a token refresh and (if the provider can) an identify call,
 * returning { ok, status, error?, checkedAt } without running a real action. Heals a stale status.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  try {
    const result = await (await getConnectorRuntime()).testConnection(body.id, { ownerId: getConnectorOwnerId() });
    return NextResponse.json(result);
  } catch (e) {
    const code = isConnectorError(e) ? e.code : 'test_failed';
    const status = code === 'connection_not_found' ? 404 : 500;
    return NextResponse.json({ error: code }, { status });
  }
}
