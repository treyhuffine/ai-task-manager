import type { NextRequest } from 'next/server';
import * as executor from '@/lib/executor/adapter';
import { withCompression } from '@/lib/api/compression';

/**
 * Whether this chat_session has an in-flight root turn or detached background
 * work right now. Adapter module state is the single source of truth for the
 * header status and composer behavior.
 *
 * No DB read needed. Module state on the same server is authoritative.
 * If the process restarted, no turn can be running anyway (in-memory
 * AgentSession map is empty).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
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
