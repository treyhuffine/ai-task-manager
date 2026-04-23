/**
 * Client-side attachment upload helper.
 *
 * Sends a file to `POST /api/attachments` with auth, returns the full
 * `Attachment` record. Kept separate from React so non-editor callers
 * (e.g. the area create modal) can reuse the same upload path.
 */

import { authFetch, ApiError } from '@/lib/api/client';
import type { Attachment } from '@/db/types';

/** Upload a single file. Throws `ApiError` on non-2xx responses. */
export async function uploadAttachment(file: File | Blob, name?: string): Promise<Attachment> {
  const formData = new FormData();
  if (file instanceof File) {
    formData.append('file', file);
  } else {
    // Blobs don't carry a filename; provide one so multipart parsing is happy
    // and the server can derive an extension.
    formData.append('file', file, name ?? 'upload');
  }
  if (name) formData.append('original_name', name);

  const res = await authFetch('/api/attachments', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    throw new ApiError(res.status, body);
  }

  return (await res.json()) as Attachment;
}

/** Upload many files in parallel. Preserves input order. Rejects on the first
 *  failure — the editor can surface a single toast rather than a per-file UI. */
export function uploadAttachments(files: (File | Blob)[]): Promise<Attachment[]> {
  return Promise.all(files.map((f) => uploadAttachment(f)));
}
