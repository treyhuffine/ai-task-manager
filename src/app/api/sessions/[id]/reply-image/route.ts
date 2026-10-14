/**
 * GET /api/sessions/:id/reply-image?path=<as the agent wrote it>
 *
 * The bytes of an image an agent showed in a reply: a local path, decided
 * in `src/lib/sessions/reply-images.ts`, or a file in a GitHub repository,
 * fetched by the home with the user's GitHub credential
 * (`src/lib/github/repo-image.ts`) when the agent wrote that exact address
 * in a reply in this chat. Served like an uploaded attachment: sandboxed,
 * never sniffed, private to this browser.
 *
 * Auth: bearer token or the session cookie (`src/proxy.ts`), which is what an
 * `<img>` in the transcript sends.
 */

import fs from 'node:fs/promises';
import { NextRequest } from 'next/server';
import { agentReplyMentions, getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { cachedGithubTokens } from '@/lib/github/credentials';
import { githubImageSource } from '@/lib/github/image-urls';
import { fetchGithubImage } from '@/lib/github/repo-image';
import { findReplyImage, REPLY_IMAGE_MAX_BYTES, type ReplyImage } from '@/lib/sessions/reply-images';
import { imageThumbnail, imageVersion } from '@/lib/attachments/image-thumbnail';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return Response.json({ error: 'Missing path parameter' }, { status: 400 });

    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    let image: ReplyImage;
    const github = githubImageSource(requested);
    if (github) {
      // The home's credential reads only what this chat's agent already showed.
      image = agentReplyMentions(id, requested)
        ? await fetchGithubImage(github, { tokens: await cachedGithubTokens(), maxBytes: REPLY_IMAGE_MAX_BYTES })
        : { ok: false, status: 403, error: "Only GitHub images this chat's agent showed in a reply are shown." };
    } else {
      const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
      const elsewhere = session.location && !session.location.isHome ? session.location.name : null;
      image = await findReplyImage(
        { folder: session.worktreePath ?? workspace?.cwd ?? null, elsewhere },
        requested,
        (text) => agentReplyMentions(id, text),
      );
    }
    if (!image.ok) return Response.json({ error: image.error }, { status: image.status });

    const thumbnail = request.nextUrl.searchParams.get('thumbnail') === '1';
    const etag = `"${await imageVersion(image.file, thumbnail)}"`;
    const cacheHeaders = { ETag: etag, 'Cache-Control': 'private, no-cache' };
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: cacheHeaders });
    const bytes = thumbnail ? await imageThumbnail(image.file, etag.slice(1, -1)) : await fs.readFile(image.file);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': thumbnail ? 'image/webp' : image.mime,
        'Content-Length': String(bytes.byteLength),
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cross-Origin-Resource-Policy': 'same-origin',
        // A screenshot can be retaken under the same name.
        ...cacheHeaders,
      },
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/reply-image]', err);
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
