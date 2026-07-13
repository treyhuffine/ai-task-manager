import { getStream, recordTriageDecisionAndApply } from '@/lib/db/queries';
import { triageErrorResponse } from '@/lib/stream-triage/http';

/** POST /api/stream/:id/dismiss — set a capture aside. Recorded as the
 *  user's own triage decision (telemetry baseline + undo). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const item = getStream(id);
    if (!item) return Response.json({ error: 'Stream item not found' }, { status: 404 });
    const result = recordTriageDecisionAndApply(
      { disposition: 'dismiss', streamItemIds: [id], actor: 'user' },
      'accepted',
    );
    return Response.json(result);
  } catch (err) {
    return triageErrorResponse('POST /api/stream/:id/dismiss', err);
  }
}
