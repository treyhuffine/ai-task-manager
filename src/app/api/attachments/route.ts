/**
 * POST /api/attachments
 *
 * Unified upload endpoint for every attachment surface in the app (note
 * bodies, task bodies, area cover images, stream audio captures). Accepts a
 * multipart `file` field, writes the bytes to `<brain>/attachments/`,
 * and returns the full `Attachment` record so the client can:
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
import { isAllowedMime, resolveMime } from '@/lib/attachments/mime';
import { readLimitedFormData, RequestBodyTooLargeError } from '@/lib/api/limited-body';

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

    const formData = await readLimitedFormData(request);
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

    // Name can come either from a File.name or a separate `originalName` field
    // (useful when callers construct a Blob manually, e.g. the capture route).
    const originalNameRaw =
      typeof (file as File).name === 'string' && (file as File).name
        ? (file as File).name
        : (formData.get('originalName') as string | null) ?? '';
    const originalName = originalNameRaw.trim() || 'file';

    // A file chosen for an MCP server's form goes to that server by its path, never to a model
    // or a page, so it may be of any type: OpenAI's spec has implicit selection take any file.
    // Its type comes from its name, not the browser's label, and a type Ri has no name for is
    // stored and served as a download (`application/octet-stream`, in the sandbox every
    // attachment is served in). Any other upload keeps to the allowlist.
    const formFile = formData.get('purpose') === 'form-file';
    let mime = resolveMime(file.type, originalName);
    if (formFile && !isAllowedMime(mime)) mime = resolveMime(null, originalName);
    if (!isAllowedMime(mime) && !(formFile && mime === 'application/octet-stream')) {
      return Response.json(
        { error: `Disallowed mime type: ${mime}` },
        { status: 415 },
      );
    }

    const attachment = await saveAttachment({
      data: file,
      originalName,
      mimeType: mime,
      idempotencyKey: request.headers.get('x-ri-upload-id') && getRequestKey(request.headers) ? JSON.stringify([getRequestKey(request.headers)!.memberId ?? getRequestKey(request.headers)!.apiKeyId, request.headers.get('x-ri-upload-id')]) : undefined,
    });

    return Response.json(attachment, { status: 201 });
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) return Response.json({ error: err.message }, { status: 413 });
    console.error('[POST /api/attachments]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: apiErrorStatus(err) ?? 500 });
  }
}
