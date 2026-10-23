import { getTaskContinueTargets } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { executionCatalogFilter, executionOperationFailure } from '@/lib/workspaces/access';

/**
 * Continue-with-agent targets for a task: its non-archived associated executions
 * that have a live session to resume ({ executionId, sessionId, label }). Zero
 * means launch a new execution, one means resume it, several means offer a
 * chooser. Archived executions are excluded (history, not Continue targets).
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const visible = executionCatalogFilter(getRequestKey(request.headers));
    return reply(getTaskContinueTargets(id).filter(target => visible({ id: target.sessionId })));
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[GET /api/tasks/:id/continue-targets]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
