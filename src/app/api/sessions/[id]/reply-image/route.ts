/**
 * GET /api/sessions/:id/reply-image?path=<as the agent wrote it>
 *
 * The bytes of an image an agent showed in a reply by local path. What it will
 * serve is decided in `src/lib/sessions/reply-images.ts`. Served like an
 * uploaded attachment: sandboxed, never sniffed, private to this browser.
 *
 * Auth: bearer token or the session cookie (`src/proxy.ts`), which is what an
 * `<img>` in the transcript sends.
 */

import fs from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { agentReplyMentions, getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { findReplyImage } from '@/lib/sessions/reply-images';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return Response.json({ error: 'Missing path parameter' }, { status: 400 });

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
    const elsewhere = session.location && !session.location.isHome ? session.location.name : null;

    const image = await findReplyImage(
      { folder: session.worktreePath ?? workspace?.cwd ?? null, elsewhere },
      requested,
      (text) => agentReplyMentions(id, text),
    );
    if (!image.ok) return Response.json({ error: image.error }, { status: image.status });

    const bytes = await fs.readFile(image.file);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': image.mime,
        'Content-Length': String(bytes.byteLength),
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        // A screenshot can be retaken under the same name.
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/reply-image]', err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
