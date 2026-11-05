/**
 * POST /api/attachments
 *
 * Unified upload endpoint for every attachment surface in the app (note
 * bodies, task bodies, area cover images, stream audio captures). Accepts a
 * multipart `file` field of any type (`uploadMime` decides what it is stored
 * as), writes the bytes to `<brain>/attachments/`, and returns the full
 * `Attachment` record so the client can:
 *
 *   1. Insert the returned `fileName` into the Tiptap body as an image src:
 *      `/api/attachments/<fileName>`
 *   2. Include the full record in the entity save payload so the server can
 *      attach metadata (originalName, mimeType, size) to the manifest.
 *
 * Auth: bearer token (middleware handles it).
 */

import { getRequestKey } from '@/lib/auth/request-key';
import { apiErrorStatus } from '@/lib/api/error-status';
import { NextRequest } from 'next/server';
import { saveAttachment } from '@/lib/attachments/save';
import { uploadMime } from '@/lib/attachments/mime';
import { readLimitedFormData, RequestBodyTooLargeError } from '@/lib/api/limited-body';

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('multipart/form-data')) {
      return Response.json(
        { error: 'Content-Type must be multipart/form-data' },
        { status: 400 },
      );
    }

    const formData = await readLimitedFormData(request);
    const file = formData.get('file');
    if (!(file instanceof Blob) || file.size === 0) {
      return Response.json({ error: 'Missing or empty file field' }, { status: 400 });
    }

    // Name can come either from a File.name or a separate `originalName` field
    // (useful when callers construct a Blob manually, e.g. the capture route).
    const originalNameRaw =
      typeof (file as File).name === 'string' && (file as File).name
        ? (file as File).name
        : (formData.get('originalName') as string | null) ?? '';
    const originalName = originalNameRaw.trim() || 'file';

    const attachment = await saveAttachment({
      data: file,
      originalName,
      mimeType: uploadMime(file.type, originalName),
      idempotencyKey: request.headers.get('x-ri-upload-id') && getRequestKey(request.headers) ? JSON.stringify([getRequestKey(request.headers)!.memberId ?? getRequestKey(request.headers)!.apiKeyId, request.headers.get('x-ri-upload-id')]) : undefined,
    });

    return Response.json(attachment, { status: 201 });
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) return Response.json({ error: 'This file is larger than the 50 MiB limit.' }, { status: 413 });
    console.error('[POST /api/attachments]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: apiErrorStatus(err) ?? 500 });
  }
}
