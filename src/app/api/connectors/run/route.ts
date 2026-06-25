import { NextRequest, NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    actionId?: unknown;
    input?: unknown;
    account?: unknown;
    connectionId?: unknown;
  };
  if (typeof body.actionId !== 'string' || !body.actionId) {
    return NextResponse.json({ error: 'actionId required' }, { status: 400 });
  }
  const outcome = await (await getConnectorRuntime()).runAction(body.actionId, body.input ?? {}, {
    account: typeof body.account === 'string' && body.account ? body.account : undefined,
    connectionId: typeof body.connectionId === 'string' && body.connectionId ? body.connectionId : undefined,
    caller: { type: 'app' },
  });
  return NextResponse.json({ outcome });
}
