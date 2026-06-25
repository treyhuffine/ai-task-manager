import { NextRequest, NextResponse } from 'next/server';
import { getConnectorRuntime, getConnectorOwnerId } from '@/lib/connectors/runtime';

/** Bot identity (username) for a Telegram connection — used to build the `t.me/<bot>?start=…` link. */
export async function GET(request: NextRequest) {
  const connectionId = new URL(request.url).searchParams.get('connectionId');
  if (!connectionId) return NextResponse.json({ error: 'connectionId required' }, { status: 400 });

  const outcome = await (await getConnectorRuntime()).runAction<{ id?: number; username?: string; first_name?: string }>(
    'telegram.get_me',
    {},
    { ownerId: getConnectorOwnerId(), connectionId, caller: { type: 'app', id: 'notifier' } },
  );
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.reason === 'error' ? outcome.message : outcome.reason }, { status: 400 });
  }
  return NextResponse.json({ id: outcome.result.id, username: outcome.result.username });
}
