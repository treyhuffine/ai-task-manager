import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { startManualSweep } from '@/lib/stream-triage/sweep';
import { z as rpcZ } from 'zod/v4';

/** POST /api/stream/triage — the Triage button: dispatch a sweep session
 *  immediately instead of waiting for the scheduler tick. */
export async function POST(_rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const result = await startManualSweep();
    if (!result.started) {
      const status = result.reason === 'already_running' ? 409 : result.reason === 'empty' ? 200 : 500;
      return reply(result, { status });
    }
    return reply(result, { status: 202 });
  } catch (err) {
    return failureResponse(triageErrorResponse('POST /api/stream/triage', err));
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({}).strict().default({}) }).strict();
