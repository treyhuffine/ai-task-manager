import { listForSession } from '@/lib/executor/live-state';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Active permission/question requests for this chat_session that are
 * waiting on the user. The UI polls this to drive the floating overlay
 * above the composer; on resolve the entry disappears from the list.
 *
 * Process-local state — no DB read. If the server restarts mid-prompt
 * the agentex callback's awaiting promise is gone with it; the agent
 * sees no response and the next user message creates a fresh session.
 * That's the same recovery model as `runtime-status`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  return reply(listForSession(id));
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
