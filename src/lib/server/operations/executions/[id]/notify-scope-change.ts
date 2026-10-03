import { reply, type OperationContext } from '@/lib/server/operation';
import type { ScopeChange } from '@/lib/sessions/workstream';
import { notifyExecutionScopeChange } from '@/lib/sessions/workstream-runtime';
import { z as rpcZ } from 'zod/v4';

const ACTIONS = new Set(['completed', 'archived', 'returned to Todo']);

/**
 * Tell a kept-running workstream that one of its associated tasks changed
 * lifecycle, so the agent stops pursuing that outcome. Server-side so the CLI/MCP
 * orchestrator can deliver it through the same control path REST uses. Body is a
 * {@link ScopeChange}.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as Partial<ScopeChange>;
    if (typeof body.taskId !== 'string' || typeof body.taskTitle !== 'string' || !ACTIONS.has(String(body.action))) {
      return reply({ error: 'Invalid scope change payload.' }, { status: 422 });
    }
    notifyExecutionScopeChange(id, body as ScopeChange);
    return reply({ ok: true });
  } catch (err) {
    console.error('[POST /api/executions/:id/notify-scope-change]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "taskId": rpcZ.string().optional(), "taskTitle": rpcZ.string().optional(), "action": rpcZ.enum(["archived", "completed", "returned to Todo"]).optional() }).strict().default({}) }).strict();
