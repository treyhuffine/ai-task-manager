/**
 * Session scratchpad. One blob of markdown per session — see the
 * `scratchPad` column on `chat_sessions` (schema.ts).
 *
 * GET returns the current text. PUT replaces it. The agent reads the
 * latest version at hydration time (expandEntityMarkers), so write
 * order doesn't matter for the model's view — last write wins.
 */
import { NextRequest } from 'next/server';
import { getChatSession, setSessionScratchPad } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    return Response.json({ scratchPad: session.scratchPad });
  } catch (err) {
    console.error('[GET /api/sessions/:id/scratchpad]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PutBody {
  scratchPad?: string | null;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PutBody = await request.json();
    const next = body.scratchPad ?? null;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    const updated = setSessionScratchPad(id, next === '' ? null : next);
    return Response.json({ scratchPad: updated?.scratchPad ?? null });
  } catch (err) {
    console.error('[PUT /api/sessions/:id/scratchpad]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
