import { UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { HarnessDisabledError } from '@/lib/harness/registry';
import { chatOverrideSchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { parseChatOverride, startNewMainChat } from '@/lib/sessions/main-chat';
import { archivedAgentResponse, resolveAgent } from "@/lib/workspaces/chat-agent";
import { z as rpcZ } from 'zod/v4';

/**
 * Start a fresh main chat for the agent: the current one is retired (its
 * harness process closed, a retrospective title derived) and a new one is
 * created. Optional body `{ providerId, model, variant, effort }` is the
 * composer's provider switch.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const agent = resolveAgent(id);
    if (!agent.ok) return failureResponse(agent.response);
    if (agent.ws.status === 'archived') return failureResponse(archivedAgentResponse());
    const body: unknown = rpcInput.body;
    return reply({ session: await startNewMainChat(id, parseChatOverride(body)) });
  } catch (err) {
    console.error('[POST /api/workspaces/:id/chat/new]', err);
    return reply({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: chatOverrideSchema.default({}) }).strict();
