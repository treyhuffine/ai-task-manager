import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { actorFromRequest } from '@/lib/auth/actor';
import { resumeOnSource, TransferError, viewOf } from '@/lib/transfer/continue';

/**
 * A move stopped before the destination took the work: keep it where it was
 * (P4.4). The messages the move held go there, once.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getChatSessionWithExecution(id);
  if (!session?.executionId) return Response.json({ error: 'Session not found' }, { status: 404 });
  try {
    return Response.json({ transfer: viewOf(await resumeOnSource(session.executionId, actorFromRequest(request.headers))) });
  } catch (err) {
    if (err instanceof TransferError) return Response.json({ error: err.code, message: err.message }, { status: err.status });
    throw err;
  }
}
