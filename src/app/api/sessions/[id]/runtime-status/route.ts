import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';

/**
 * Whether this chat_session has an in-flight root turn or detached background
 * work right now. Adapter module state is the single source of truth for the
 * header status and composer behavior.
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
  return Response.json({
    running: executor.isRunning(id),
    backgroundTasks: executor.hasBackgroundTasks(id),
    backgroundTaskIds: executor.listBackgroundTaskIds(id),
  });
}
