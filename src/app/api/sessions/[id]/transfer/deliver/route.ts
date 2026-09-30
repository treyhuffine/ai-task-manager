import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { actorFromRequest } from '@/lib/auth/actor';
import { retryHeldDelivery, TransferError, viewOf } from '@/lib/transfer/continue';

/**
 * Send them again (P4 re-check): the delivery of what a move held stopped
 * short at a message nothing took. Pick it up from that message, in order.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getChatSessionWithExecution(id);
  if (!session?.executionId) return Response.json({ error: 'Session not found' }, { status: 404 });
  try {
    return Response.json({ transfer: viewOf(await retryHeldDelivery(session.executionId, actorFromRequest(request.headers))) });
  } catch (err) {
    if (err instanceof TransferError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}
