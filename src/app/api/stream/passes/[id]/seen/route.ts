import { markTriagePassDigestSeen } from '@/lib/db/queries';
import { triageErrorResponse } from '@/lib/stream-triage/http';

/** POST /api/stream/passes/:id/seen — calm unread handling for the digest. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const pass = markTriagePassDigestSeen(id);
    if (!pass) return Response.json({ error: 'Pass not found' }, { status: 404 });
    return Response.json(pass);
  } catch (err) {
    return triageErrorResponse('POST /api/stream/passes/:id/seen', err);
  }
}
