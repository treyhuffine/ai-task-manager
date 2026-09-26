import type { NextRequest } from 'next/server';
import { createTerminalAt, listTerminalsAt, sessionTerminalPlace } from '@/lib/terminal/place';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * An execution's terminals, on the computer it runs on, in its working folder
 * (`src/lib/terminal/place.ts`). Owned by the execution, so every chat on it
 * shares them.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await listTerminalsAt(sessionTerminalPlace(id));
  } catch (err) {
    console.error('[GET /api/sessions/:id/terminals]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await createTerminalAt(request, sessionTerminalPlace(id), '[POST /api/sessions/:id/terminals]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/sessions/:id/terminals]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
