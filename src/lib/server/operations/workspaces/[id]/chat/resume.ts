import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { resumeMainChat } from '@/lib/sessions/main-chat';
import { archivedAgentResponse, resolveAgent } from "@/lib/workspaces/chat-agent";
import { z as rpcZ } from 'zod/v4';

/**
 * Make one of the agent's past main chats current again. A chat from
 * another agent, or the app's main chat, is refused (404). See
 * `resumeMainChat`.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const agent = resolveAgent(id);
    if (!agent.ok) return failureResponse(agent.response);
    if (agent.ws.status === 'archived') return failureResponse(archivedAgentResponse());
    const { sessionId } = (rpcInput.body) as { sessionId?: unknown };
    if (typeof sessionId !== 'string' || !sessionId) {
      return reply({ error: 'sessionId is required' }, { status: 400 });
    }
    const result = await resumeMainChat(id, sessionId);
    if (!result.ok) return reply({ error: result.error }, { status: result.status });
    return reply({ session: result.session });
  } catch (err) {
    console.error('[POST /api/workspaces/:id/chat/resume]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "sessionId": rpcZ.string().optional() }).strict().default({}) }).strict();
