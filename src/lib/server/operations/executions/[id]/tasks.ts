import { getExecutionTasks } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * The tasks associated with an execution (its workstream), newest association
 * first. Used to show what a workstream is working — one task or several. Returns
 * a compact shape (id / title / status); an empty array for taskless quick work.
 */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const tasks = getExecutionTasks(id).map((t) => ({ id: t.id, title: t.title, status: t.status }));
    return reply(tasks);
  } catch (err) {
    console.error('[GET /api/executions/:id/tasks]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
