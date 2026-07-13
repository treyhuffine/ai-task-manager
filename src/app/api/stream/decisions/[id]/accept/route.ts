import { applyTriageDecision } from '@/lib/db/queries';
import { triageErrorResponse } from '@/lib/stream-triage/http';

/** POST /api/stream/decisions/:id/accept — apply a proposed decision. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(applyTriageDecision(id, { decidedBy: 'user' }));
  } catch (err) {
    return triageErrorResponse('POST /api/stream/decisions/:id/accept', err);
  }
}
