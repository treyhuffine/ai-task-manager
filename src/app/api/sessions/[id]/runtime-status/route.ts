import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';

/**
 * Whether this chat_session has an in-flight turn right now. The
 * adapter's runningSessions Set is the single source of truth — the
 * client polls this endpoint to drive the "● working" indicator in the
 * rail and the header status pill, and to disable the composer mid-turn.
 *
 * No DB read needed. Module state on the same server is authoritative.
 * If the process restarted, no turn can be running anyway (in-memory
 * AgentSession map is empty).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json({ running: executor.isRunning(id) });
}
