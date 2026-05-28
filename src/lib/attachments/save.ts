/**
 * Attachment write path.
 *
 * Every file that lives under `<brain>/attachments/` is written
 * through `saveAttachment`. The caller provides bytes and a display name;
 * this module resolves the mime, picks a stable extension, assigns a
 * UUIDv7-based filename, and returns a complete `Attachment` record ready
 * to be stored in any entity's `attachments[]` JSON column.
 *
 * UUIDv7 is intentional: lexicographic sort == chronological order, which
 * makes directory listings useful on their own.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { uuidv7 } from 'uuidv7';
import { ensureAttachmentsDir, getAttachmentsDir } from '@/lib/config/paths';
import type { Attachment } from '@/db/types';
import { extForFile, resolveMime } from './mime';

export interface SaveAttachmentInput {
  /** Raw bytes. Any `Blob`-like (Blob, File, Buffer-wrapping Blob). */
  data: Blob | Buffer | Uint8Array;
  /** Display name preserved in the `Attachment` record. */
  originalName: string;
  /** Optional mime hint from the upload (e.g. `file.type`). */
  mimeType?: string | null;
}

/**
 * Write a file to the attachments dir and return its metadata record.
 *
 * The returned `fileName` is `<uuidv7>.<ext>` where the extension is
 * derived from the mime (primary) or original filename (fallback).
 */
export async function saveAttachment(input: SaveAttachmentInput): Promise<Attachment> {
  const originalName = input.originalName.trim() || 'file';
  const mimeType = resolveMime(input.mimeType, originalName);
  const ext = extForFile(mimeType, originalName);
  const fileName = `${uuidv7()}.${ext}`;

  const buffer = await toBuffer(input.data);
  const dir = ensureAttachmentsDir();
  await fs.writeFile(path.join(dir, fileName), buffer);

  return {
    fileName,
    originalName,
    mimeType,
    size: buffer.byteLength,
    uploadedAt: new Date().toISOString(),
  };
}

/** Resolve the absolute on-disk path for a stored fileName. */
export function attachmentPath(fileName: string): string {
  return path.join(getAttachmentsDir(), fileName);
}

async function toBuffer(data: Blob | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}
