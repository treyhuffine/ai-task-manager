import { reopenStream } from '@/lib/db/queries';
import { triageErrorResponse } from '@/lib/stream-triage/http';

/** POST /api/stream/:id/reopen — return a settled capture to pending.
 *  Detaches provenance for single-item outcomes; combined outcomes must be
 *  unwound through their decision. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = reopenStream(id);
    if (!row) return Response.json({ error: 'Stream item not found' }, { status: 404 });
    return Response.json(row);
  } catch (err) {
    return triageErrorResponse('POST /api/stream/:id/reopen', err);
  }
}
