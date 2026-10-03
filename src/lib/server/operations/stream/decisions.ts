import type { TriageDecisionState } from '@/db/types';
import { listTriageDecisions, recordTriageDecisionAndApply } from '@/lib/db/queries';
import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { triageDispositionSchema, triageDraftSchema } from '@/lib/stream-triage/schema';
import { serializeDecision } from '@/lib/stream-triage/serialize';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

/** GET /api/stream/decisions?state=proposed — review-surface data. Each
 *  decision carries preview text for its source captures. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const params = searchParams(rpcInput.query);
    const state = params.get('state');
    const passId = params.get('passId');
    const decisions = listTriageDecisions({
      ...(state ? { state: state.split(',') as TriageDecisionState[] } : {}),
      ...(passId ? { passId } : {}),
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : 200,
    });
    return reply(decisions.map(serializeDecision));
  } catch (err) {
    return failureResponse(triageErrorResponse('GET /api/stream/decisions', err));
  }
}

const manualDecisionSchema = z
  .object({
    disposition: triageDispositionSchema,
    streamItemIds: z.array(z.string().min(1)).min(1),
    targetType: z.enum(['task', 'note']).nullable().optional(),
    targetId: z.string().nullable().optional(),
    draft: triageDraftSchema.nullable().optional(),
  })
  .strict();

/** POST /api/stream/decisions — manual triage from the UI. Applied
 *  immediately as the user's own decision (actor 'user'), which both does
 *  the work and accumulates ground-truth telemetry. */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = manualDecisionSchema.parse(rpcInput.body);
    const result = recordTriageDecisionAndApply(
      {
        disposition: body.disposition,
        streamItemIds: body.streamItemIds,
        targetType: body.targetType ?? null,
        targetId: body.targetId ?? null,
        draft: body.draft ?? null,
        actor: 'user',
      },
      'accepted',
    );
    return reply(result, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return reply({ error: err.issues.map((i) => i.message).join('; '), code: 'invalid_params' }, { status: 400 });
    }
    return failureResponse(triageErrorResponse('POST /api/stream/decisions', err));
  }
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "state": rpcZ.string().optional(), "passId": rpcZ.string().optional(), "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: legacySchema(manualDecisionSchema) }).strict();
