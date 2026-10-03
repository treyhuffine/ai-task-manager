import { getExecutionReviewContext } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** What the review affordance needs for an execution (latest output event to
 * disposition, current disposition, the single owning task if any). */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return reply(getExecutionReviewContext(id));
  } catch (err) {
    console.error('[GET /api/executions/:id/review-context]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
