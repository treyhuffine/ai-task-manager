import { NextRequest, NextResponse } from 'next/server';
import { getConnectorRuntime } from '@/lib/connectors/runtime';
import { deleteChannelsForConnection } from '@/lib/db/queries';

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }
  await (await getConnectorRuntime()).disconnectConnection(body.id);
  // Notifier cascade (spec §2.13): drop any notification channels that delivered through it.
  deleteChannelsForConnection(body.id);
  return NextResponse.json({ ok: true });
}
