import type { NextRequest } from 'next/server';
import { getChatSession } from '@/lib/db/queries';
import { deliveriesForChat } from '@/lib/workers/delivery';

export const dynamic = 'force-dynamic';

/**
 * Where each message this chat sent to a computer elsewhere stands, by chat
 * event id (P3.2). Empty for a chat at home: its messages reach the harness
 * as they're sent. Live changes come on the session stream as `delivery`.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!getChatSession(id)) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json(deliveriesForChat(id));
}
