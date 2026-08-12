import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getStreamAutonomy, setStreamAutonomy } from '@/lib/db/queries';
import { previewGraduationOffers, describeGraduation } from '@/lib/stream-triage/autonomy';
import { getStreamAutomationMode, setStreamAutomationMode } from '@/lib/stream-triage/triggers';
import { triageErrorResponse } from '@/lib/stream-triage/http';
import { withCompression } from '@/lib/api/compression';

/** GET /api/stream/autonomy — current config plus any standing graduation
 *  offers (side-effect free: demotions only apply at sweep end). Offers
 *  carry their user-facing copy so the client never imports server code. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    return Response.json({
      autonomy: getStreamAutonomy(),
      mode: getStreamAutomationMode(),
      offers: previewGraduationOffers().map((o) => ({ ...o, line: describeGraduation(o) })),
    });
  } catch (err) {
    return triageErrorResponse('GET /api/stream/autonomy', err);
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
export async function PUT(request: NextRequest) {
  try {
    const body = updateSchema.parse(await request.json());
    if (body.mode) setStreamAutomationMode(body.mode);
    if (body.killSwitch !== undefined || body.levels) {
      setStreamAutonomy({ killSwitch: body.killSwitch, levels: body.levels });
    }
    return Response.json({ autonomy: getStreamAutonomy(), mode: getStreamAutomationMode() });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return Response.json({ error: err.issues.map((i) => i.message).join('; '), code: 'invalid_params' }, { status: 400 });
    }
    return triageErrorResponse('PUT /api/stream/autonomy', err);
  }
}
