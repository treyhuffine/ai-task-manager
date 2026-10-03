import * as executor from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

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

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  return reply({
    running: executor.isRunning(id),
    backgroundTasks: executor.hasBackgroundTasks(id),
    backgroundTaskIds: executor.listBackgroundTaskIds(id),
  });
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
