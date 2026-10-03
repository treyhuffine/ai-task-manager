import { correctTriageDecision } from '@/lib/db/queries';
import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { triageDispositionSchema, triageDraftSchema } from '@/lib/stream-triage/schema';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

const correctionSchema = z
  .object({
    disposition: triageDispositionSchema,
    targetType: z.enum(['task', 'note']).nullable().optional(),
    targetId: z.string().nullable().optional(),
    draft: triageDraftSchema.nullable().optional(),
  })
  .strict();

/** POST /api/stream/decisions/:id/correct — the re-route affordance: mark
 *  the original corrected (reversing it if applied) and run the user's
 *  version instead. Rich telemetry signal. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = correctionSchema.parse(rpcInput.body);
    return reply(correctTriageDecision(id, body));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return reply({ error: err.issues.map((i) => i.message).join('; '), code: 'invalid_params' }, { status: 400 });
    }
    return failureResponse(triageErrorResponse('POST /api/stream/decisions/:id/correct', err));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: legacySchema(correctionSchema) }).strict();
