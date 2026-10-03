import { getTaskContinueTargets } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Continue-with-agent targets for a task: its non-archived associated executions
 * that have a live session to resume ({ executionId, sessionId, label }). Zero
 * means launch a new execution, one means resume it, several means offer a
 * chooser. Archived executions are excluded (history, not Continue targets).
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return reply(getTaskContinueTargets(id));
  } catch (err) {
    console.error('[GET /api/tasks/:id/continue-targets]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
