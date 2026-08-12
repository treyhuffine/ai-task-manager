import { NextRequest } from 'next/server';
import { z } from 'zod';
import { listTriageDecisions, recordTriageDecisionAndApply } from '@/lib/db/queries';
import { triageDispositionSchema, triageDraftSchema } from '@/lib/stream-triage/schema';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { serializeDecision } from '@/lib/stream-triage/serialize';
import type { TriageDecisionState } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

/** GET /api/stream/decisions?state=proposed — review-surface data. Each
 *  decision carries preview text for its source captures. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const state = params.get('state');
    const passId = params.get('passId');
    const decisions = listTriageDecisions({
      ...(state ? { state: state.split(',') as TriageDecisionState[] } : {}),
      ...(passId ? { passId } : {}),
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : 200,
    });
    return Response.json(decisions.map(serializeDecision));
  } catch (err) {
    return triageErrorResponse('GET /api/stream/decisions', err);
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
export async function POST(request: NextRequest) {
  try {
    const body = manualDecisionSchema.parse(await request.json());
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
    return Response.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.issues.map((i) => i.message).join('; '), code: 'invalid_params' }, { status: 400 });
    }
    return triageErrorResponse('POST /api/stream/decisions', err);
  }
}
