/**
 * Session scratchpad. One blob of markdown per session — see the
 * `scratch_pad` column on `chat_sessions` (schema.ts).
 *
 * GET returns the current text. PUT replaces it. The agent reads the
 * latest version at hydration time (expandEntityMarkers), so write
 * order doesn't matter for the model's view — last write wins.
 */
import { NextRequest } from 'next/server';
import { getChatSession, setSessionScratchPad } from '@/lib/db/queries';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json({ scratch_pad: session.scratch_pad });
  } catch (err) {
    console.error('[GET /api/sessions/:id/scratchpad]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PutBody {
  scratch_pad?: string | null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PutBody = await request.json();
    const next = body.scratch_pad ?? null;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    const updated = setSessionScratchPad(id, next === '' ? null : next);
    return Response.json({ scratch_pad: updated?.scratch_pad ?? null });
  } catch (err) {
    console.error('[PUT /api/sessions/:id/scratchpad]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
