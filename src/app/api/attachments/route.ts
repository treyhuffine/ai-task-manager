/**
 * POST /api/attachments
 *
 * Unified upload endpoint for every attachment surface in the app (note
 * bodies, task bodies, area cover images, stream audio captures). Accepts a
 * multipart `file` field, writes the bytes to `<brain>/attachments/`,
 * and returns the full `Attachment` record so the client can:
 *
 *   1. Insert the returned `file_name` into the Tiptap body as an image src:
 *      `/api/attachments/<file_name>`
 *   2. Include the full record in the entity save payload so the server can
 *      attach metadata (original_name, mime_type, size) to the manifest.
 *
 * Auth: bearer token (middleware handles it).
 */

import { NextRequest } from 'next/server';
import { saveAttachment } from '@/lib/attachments/save';
import { isAllowedMime, resolveMime } from '@/lib/attachments/mime';

/** Hard cap per upload. Generous for screenshots + short audio, stops a
 *  browser bug from pushing 2GB through us. */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MiB

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return Response.json(
        { error: 'Content-Type must be multipart/form-data' },
        { status: 400 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return Response.json({ error: 'Missing or empty file field' }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES} bytes` },
        { status: 413 },
      );
    }

    // Name can come either from a File.name or a separate `original_name` field
    // (useful when callers construct a Blob manually, e.g. the capture route).
    const originalNameRaw =
      typeof (file as File).name === 'string' && (file as File).name
        ? (file as File).name
        : (formData.get('original_name') as string | null) ?? '';
    const original_name = originalNameRaw.trim() || 'file';

    const mime = resolveMime(file.type, original_name);
    if (!isAllowedMime(mime)) {
      return Response.json(
        { error: `Disallowed mime type: ${mime}` },
        { status: 415 },
      );
    }

    const attachment = await saveAttachment({
      data: file,
      original_name,
      mime_type: mime,
    });

    return Response.json(attachment, { status: 201 });
  } catch (err) {
    console.error('[POST /api/attachments]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
