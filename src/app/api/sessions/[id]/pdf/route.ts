/**
 * GET /api/sessions/:id/pdf?path=<as the viewer or reply named it>
 *   [&download=1 | &thumbnail=1 | &page=N]
 *
 * A PDF from a chat: its bytes for the browser's viewer, a download, or page
 * images (`src/lib/attachments/pdf-delivery.ts`). It opens what the chat's
 * file viewer opens (`src/lib/sessions/session-file-target.ts`), PDFs only:
 * the chat's folder, and outside files its agent shared in a reply or named
 * with a file tool.
 *
 * Auth: bearer token or the session cookie (`src/proxy.ts`), which is what
 * the preview's iframe and a download link send.
 */

import path from 'node:path';
import { NextRequest } from 'next/server';
import { getChatSessionWithExecution } from '@/lib/db/queries';
import { PDF_FILE, pdfError, pdfResponse } from '@/lib/attachments/pdf-delivery';
import { sessionFileTarget } from '@/lib/sessions/session-file-target';
import { sanitizeRelPath } from '@/lib/workspaces/read-file';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return pdfError(400, 'Missing path parameter');
    if (!PDF_FILE.test(requested)) return pdfError(415, 'Only PDF files open here.');

    const session = getChatSessionWithExecution(id);
    if (!session) return pdfError(404, 'This chat no longer exists.');

    const target = await sessionFileTarget(session, requested);
    if (target.kind === 'refused') return pdfError(target.status, target.body.error);
    if (target.kind === 'outside') return await pdfResponse(request, target.file, path.basename(target.file));

    // A connected device sends the file viewer bounded text and images, not
    // a PDF's bytes or pages.
    if (target.elsewhere) {
      return pdfError(409, `This PDF is on ${target.elsewhere}. PDFs on another device don't preview here yet.`);
    }
    if (!target.root) return pdfError(404, 'This chat has no folder to open files from.');
    const relative = sanitizeRelPath(target.path);
    if (!relative) return pdfError(400, `Invalid path: ${requested}`);
    return await pdfResponse(request, path.join(/* turbopackIgnore: true */ target.root, relative), path.basename(relative));
  } catch (err) {
    console.error('[GET /api/sessions/:id/pdf]', err);
    return pdfError(500, 'This PDF could not be opened.');
  }
}
