import { actorFromRequest } from '@/lib/auth/actor';
import { reply, type OperationContext } from '@/lib/server/operation';
import { stopExecutionAgent } from '@/lib/sessions/workstream-runtime';
import { z as rpcZ } from 'zod/v4';

/**
 * Stop the running agent turns for an execution, in the server process that
 * owns the live handles. Preserves the durable execution, worktree, chats, and
 * associations — this is a runtime stop, not an archive. Used by the CLI/MCP
 * orchestrator (which cannot touch the in-memory handles) via the server
 * control path, and reports failure honestly so the caller never claims the
 * agent stopped when it did not.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const result = await stopExecutionAgent(id, actorFromRequest(request.headers));
    return reply(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    console.error('[POST /api/executions/:id/stop-agent]', err);
    return reply({ ok: false, failures: [String(err)] }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
