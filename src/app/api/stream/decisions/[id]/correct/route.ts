import { NextRequest } from 'next/server';
import { z } from 'zod';
import { correctTriageDecision } from '@/lib/db/queries';
import { triageDispositionSchema, triageDraftSchema } from '@/lib/stream-triage/schema';
import { triageErrorResponse } from '@/lib/stream-triage/http';

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
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = correctionSchema.parse(await request.json());
    return Response.json(correctTriageDecision(id, body));
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.issues.map((i) => i.message).join('; '), code: 'invalid_params' }, { status: 400 });
    }
    return triageErrorResponse('POST /api/stream/decisions/:id/correct', err);
  }
}
