import { undoTriageDecision } from '@/lib/db/queries';
import { triageErrorResponse } from '@/lib/stream-triage/http';

/** POST /api/stream/decisions/:id/undo — reverse a decision per the spec's
 *  undo table. Captures go back to pending; never deletes a stream item. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(undoTriageDecision(id));
  } catch (err) {
    return triageErrorResponse('POST /api/stream/decisions/:id/undo', err);
  }
}
