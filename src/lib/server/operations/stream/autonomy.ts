import { getStreamAutonomy, setStreamAutonomy } from '@/lib/db/queries';
import { legacySchema } from '@/lib/server/inputs';
import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { describeGraduation, previewGraduationOffers } from '@/lib/stream-triage/autonomy';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { getStreamAutomationMode, setStreamAutomationMode } from '@/lib/stream-triage/triggers';
import { z } from 'zod';
import { z as rpcZ } from 'zod/v4';

/** GET /api/stream/autonomy — current config plus any standing graduation
 *  offers (side-effect free: demotions only apply at sweep end). Offers
 *  carry their user-facing copy so the client never imports server code. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    return reply({
      autonomy: getStreamAutonomy(),
      mode: getStreamAutomationMode(),
      offers: previewGraduationOffers().map((o) => ({ ...o, line: describeGraduation(o) })),
    });
  } catch (err) {
    return failureResponse(triageErrorResponse('GET /api/stream/autonomy', err));
  }
}

const levelSchema = z.enum(['suggest', 'auto_digest', 'silent']);
const updateSchema = z
  .object({
    /** The single settings control: maps onto kill switch + cadence. */
    mode: z.enum(['handle_obvious', 'review_everything', 'manual_only']).optional(),
    killSwitch: z.boolean().optional(),
    levels: z
      .record(
        z.enum([
          'promote_task', 'promote_note', 'merge_task', 'merge_note',
          'combine_task', 'combine_note', 'journal', 'dismiss', 'incubate',
        ]),
        levelSchema,
      )
      .optional(),
  })
  .strict();

/** PUT /api/stream/autonomy — accept a graduation offer or move the single
 *  automation-level control. The ONLY way autonomy goes up. */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const body = updateSchema.parse(rpcInput.body);
    if (body.mode) setStreamAutomationMode(body.mode);
    if (body.killSwitch !== undefined || body.levels) {
      setStreamAutonomy({ killSwitch: body.killSwitch, levels: body.levels });
    }
    return reply({ autonomy: getStreamAutonomy(), mode: getStreamAutomationMode() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return reply({ error: err.issues.map((i) => i.message).join('; '), code: 'invalid_params' }, { status: 400 });
    }
    return failureResponse(triageErrorResponse('PUT /api/stream/autonomy', err));
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PUTInput = rpcZ.object({ body: legacySchema(updateSchema) }).strict();
