/**
 * GET /api/sessions/:id/html?path=<as the viewer or reply named it>&theme=light|dark
 *
 * An HTML file from a chat, served as the document its preview iframe loads
 * (`src/lib/sessions/html-preview-response.ts`). It opens what the chat's
 * file viewer opens (`src/lib/sessions/session-file-target.ts`), HTML only:
 * the chat's folder here or on its device, and outside files its agent
 * shared in a reply or named with a file tool. With `&download=1` it saves
 * the file as written, under its own name, instead.
 *
 * Auth: bearer token or the session cookie (`src/proxy.ts`), which is what an
 * iframe sends.
 */

import path from 'node:path';
import { NextRequest } from 'next/server';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { readAnswerOnOwner } from '@/lib/executor/owner-files';
import {
  HTML_FILE,
  htmlAnswerPreviewResponse,
  htmlFilePreviewResponse,
  htmlPreviewErrorResponse,
  htmlPreviewTheme,
} from '@/lib/sessions/html-preview-response';
import { sessionFileTarget } from '@/lib/sessions/session-file-target';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const theme = htmlPreviewTheme(request.nextUrl.searchParams.get('theme'));
  // `download=1`: the file as written, under its own name, instead of the preview.
  const requestedPath = request.nextUrl.searchParams.get('path');
  const download = request.nextUrl.searchParams.get('download') === '1' && requestedPath ? path.basename(requestedPath) : undefined;
  try {
    const { id } = await params;
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return htmlPreviewErrorResponse(400, 'This preview needs a file path.', theme);
    if (!HTML_FILE.test(requested)) return htmlPreviewErrorResponse(415, 'Only HTML files open in this preview.', theme);

    const session = getChatSessionWithExecution(id);
    if (!session) return htmlPreviewErrorResponse(404, 'This chat no longer exists.', theme);

    const target = await sessionFileTarget(session, requested);
    if (target.kind === 'refused') return htmlPreviewErrorResponse(target.status, target.body.error, theme);
    if (target.kind === 'outside') return await htmlFilePreviewResponse(request, target.file, theme, download);

    // An execution on a connected device: its worker reads the file.
    const remote = await readAnswerOnOwner(id, { kind: 'file', path: target.path, base: false });
    if (remote) return htmlAnswerPreviewResponse(request, remote, theme, session.location?.name ?? 'its device', download);

    if (!session.worktreePath) return htmlPreviewErrorResponse(404, 'This chat has no folder to open files from.', theme);
    const relative = sanitizeRelPath(target.path);
    if (!relative) return htmlPreviewErrorResponse(400, `Invalid path: ${requested}`, theme);
    return await htmlFilePreviewResponse(request, path.join(session.worktreePath, relative), theme, download);
  } catch (err) {
    console.error('[GET /api/sessions/:id/html]', err);
    return htmlPreviewErrorResponse(500, 'This preview could not be loaded.', theme);
  }
}
