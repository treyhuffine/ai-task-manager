import { NextRequest } from 'next/server';
import { previewFile } from '@/lib/files/source';
import { fileBytes } from '@/lib/files/byte-delivery';
import { filePreviewMime } from '@/lib/files/preview-types';
import { isOperationError } from '@/lib/server/operation';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const path = request.nextUrl.searchParams.get('path');
    if (!path) return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    const { id: sessionId } = await params;
    const file = await previewFile({ kind: 'session', sessionId, path });
    const mime = filePreviewMime(file.name);
    if (mime === 'application/octet-stream') return Response.json({ error: 'Only audio and video play here.' }, { status: 415 });
    return await fileBytes(request, file.file, file.name, mime, false);
  } catch (error) {
    if (isOperationError(error)) return Response.json(error.body, { status: error.status });
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Response.json({ error: 'This file is no longer there.' }, { status: 404 });
    console.error('[GET /api/sessions/:id/media]', error);
    return Response.json({ error: 'This file could not be played.' }, { status: 500 });
  }
}
export const HEAD = GET;
