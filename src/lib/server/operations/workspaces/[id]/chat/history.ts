import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { mainChatHistory } from '@/lib/sessions/main-chat';
import { resolveAgent } from "@/lib/workspaces/chat-agent";
import { z as rpcZ } from 'zod/v4';

/**
 * The agent's past and current main chats, newest activity first. Same
 * shape as `/api/orchestrator-chat/history`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const agent = resolveAgent(id);
    if (!agent.ok) return failureResponse(agent.response);
    return reply({ sessions: mainChatHistory(id) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/chat/history]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
