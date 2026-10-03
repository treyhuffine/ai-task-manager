import { getChatSession } from '@/lib/db/queries';
import { HarnessDisabledError } from '@/lib/harness/registry';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { currentMainChat, ensureMainChat } from '@/lib/sessions/main-chat';
import { followAgentUntilRun } from '@/lib/sessions/main-chat-device';
import { archivedAgentResponse, resolveAgent } from "@/lib/workspaces/chat-agent";
import { z as rpcZ } from 'zod/v4';

/**
 * The agent's main chat: an orchestration chat scoped to this workspace,
 * running in the agent's folder (docs/agents-view-spec.md §4). GET returns
 * the current one, creating it if the agent has none ("ensure" semantics,
 * like `/api/orchestrator-chat`). An archived agent still returns its
 * current chat but never gets a new one.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const agent = resolveAgent(id);
    if (!agent.ok) return failureResponse(agent.response);
    const existing = currentMainChat(id);
    if (existing) {
      // Not run anywhere yet: it goes where the agent lives now (P3.4).
      if (followAgentUntilRun(existing.id).moved) return reply({ session: getChatSession(existing.id) ?? existing });
      return reply({ session: existing });
    }
    if (agent.ws.status === 'archived') return failureResponse(archivedAgentResponse());
    return reply({ session: await ensureMainChat(id) });
  } catch (err) {
    console.error('[GET /api/workspaces/:id/chat]', err);
    return reply({ error: String(err) }, { status: err instanceof HarnessDisabledError ? 409 : 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
