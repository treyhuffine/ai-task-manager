/**
 * Helpers for translating `ai-sdk` `FileUIPart`s into `Attachment`
 * records the chat renderers know how to display.
 *
 * Our editor emits `FileUIPart`s whose `url` is the standard attachments
 * serve route (`/api/attachments/<fileName>`). On render, we pull the
 * `fileName` out of the URL so the receiving chip can use the same
 * `Attachment` shape that everything else does.
 */

import type { FileUIPart } from 'ai';
import type { Attachment } from '@/db/types';

const ATTACHMENT_URL_RE = /\/api\/attachments\/([A-Za-z0-9_.-]+)$/;

/**
 * Extract `fileName` from an attachment URL. Returns null when the
 * URL doesn't match our standard serve route (e.g. data URLs from
 * legacy clients, or external URLs the model produced).
 */
export function fileNameFromUrl(url: string): string | null {
  const m = ATTACHMENT_URL_RE.exec(url);
  return m ? m[1]! : null;
}

/**
 * Build an `Attachment`-shaped object from a `FileUIPart` so it can
 * flow into `MessageFileChip`. Returns null for parts that don't
 * resolve to a brain-stored file (data URLs, external URLs).
 *
 * `size` and `uploadedAt` are unknown at this layer (the file lives
 * on disk; nothing in the part carries size). We zero them — the chip
 * tolerates missing values.
 */
export function fileUIPartToAttachment(part: FileUIPart): Attachment | null {
  const fileName = fileNameFromUrl(part.url);
  if (!fileName) return null;
  return {
    fileName,
    originalName: part.filename ?? fileName,
    mimeType: part.mediaType ?? 'application/octet-stream',
    size: 0,
    uploadedAt: '',
  };
}
