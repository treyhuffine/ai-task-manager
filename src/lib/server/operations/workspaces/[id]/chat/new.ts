import { mainChatReplacementRefusal } from '@/lib/sessions/home-policy';
import { executionOperationFailure } from '@/lib/workspaces/access';
import { actorFromRequest } from '@/lib/auth/actor';
import { UnsupportedPermissionModeError } from '@/lib/executor/permission-map';
import { HarnessDisabledError } from '@/lib/harness/registry';
import { newMainChatSchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { MainChatInUseError, parseChatOverride, startNewMainChat } from '@/lib/sessions/main-chat';
import { archivedAgentResponse, resolveAgent } from "@/lib/workspaces/chat-agent";
import { z as rpcZ } from 'zod/v4';

/**
 * Start a fresh main chat for the agent: the current one is retired (its
 * harness process closed, a retrospective title derived) and a new one is
 * created. Optional body `{ providerId, model, variant, effort }` is the
 * composer's provider switch.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const refusal = mainChatReplacementRefusal(actorFromRequest(_request.headers));
  if (refusal) return reply({ error: refusal }, { status: 403 });
  try {
    const { id } = rpcInput.params;
    const agent = resolveAgent(id);
    if (!agent.ok) return failureResponse(agent.response);
    if (agent.ws.status === 'archived') return failureResponse(archivedAgentResponse());
    const body: unknown = rpcInput.body;
    return reply({ session: await startNewMainChat(id, parseChatOverride(body), { forApp: rpcInput.body.forApp === true, sourceChatId: rpcInput.body.sourceChatId }) });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    if (err instanceof MainChatInUseError) return reply({ error: err.message, code: err.code }, { status: 409 });
    console.error('[POST /api/workspaces/:id/chat/new]', err);
    return reply({ error: String(err) }, { status: err instanceof HarnessDisabledError || err instanceof UnsupportedPermissionModeError ? 409 : 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: newMainChatSchema.default({}) }).strict();
