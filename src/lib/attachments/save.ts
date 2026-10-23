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
 *
 * A HEIC photo is stored as a JPEG, the form every browser and agent can
 * open (`heic.ts`). Its record says so: `image/jpeg`, `.jpg` in both names.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { processState } from '@/lib/process-state';
import { atomicWriteFileAsync } from '@/lib/config/atomic-write';
import { uuidv7 } from 'uuidv7';
import { ensureAttachmentsDir, getAttachmentsDir, getWorkDir } from '@/lib/config/paths';
import type { Attachment } from '@/db/types';
import { heicToJpeg, isHeic } from './heic';
import { extForFile, resolveMime } from './mime';

export interface SaveAttachmentInput {
  /** Raw bytes. Any `Blob`-like (Blob, File, Buffer-wrapping Blob). */
  data: Blob | Buffer | Uint8Array;
  /** Display name preserved in the `Attachment` record. */
  originalName: string;
  /** Optional mime hint from the upload (e.g. `file.type`). */
  mimeType?: string | null;
  /** Authenticated caller and request identity. Retries complete the same reserved file. */
  idempotencyKey?: string;
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
  const buffer = await toBuffer(input.data);
  const stored = await storedForm(buffer, originalName, mimeType);
  const ext = extForFile(stored.mimeType, stored.originalName);
  const dir = ensureAttachmentsDir();
  const allocate = (): Attachment => ({ fileName: `${uuidv7()}.${ext}`, originalName: stored.originalName, mimeType: stored.mimeType, size: stored.bytes.byteLength, uploadedAt: new Date().toISOString() });
  if (!input.idempotencyKey) {
    const attachment = allocate();
    await atomicWriteFileAsync(path.join(/* turbopackIgnore: true */ dir, attachment.fileName), stored.bytes);
    return attachment;
  }
  const key = createHash('sha256').update(input.idempotencyKey).digest('hex');
  const receipt = path.join(/* turbopackIgnore: true */ getWorkDir(), 'attachment-receipts', key + '.json');
  // What was sent, not what is stored: a retry is the same request even when only one attempt could convert it.
  const digest = createHash('sha256').update(JSON.stringify([originalName, mimeType])).update(buffer).digest('hex');
  const locks = processState('attachments:uploads', () => new Map<string, Promise<unknown>>());
  const work = (locks.get(receipt) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let record: { digest: string; attachment: Attachment; converted?: boolean };
    try { record = JSON.parse(await fs.readFile(receipt, 'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      record = { digest, attachment: allocate(), converted: stored.converted };
      // Reserve before writing bytes. A crash resumes this exact UUID on retry.
      await atomicWriteFileAsync(receipt, JSON.stringify(record));
    }
    if (record.digest !== digest) throw Object.assign(new Error('That upload request already names different file content.'), { status: 409 });
    if (!/^[a-f0-9-]+\.[A-Za-z0-9]+$/.test(record.attachment.fileName)) throw new Error('Invalid upload receipt.');
    // The bytes the reserved record describes: the photo as sent, or its JPEG.
    const converted = record.converted ?? false;
    if (converted && !stored.converted) throw Object.assign(new Error(`${originalName} could not be converted to JPEG this time. Try the upload again.`), { status: 503 });
    await atomicWriteFileAsync(path.join(/* turbopackIgnore: true */ dir, record.attachment.fileName), converted ? stored.bytes : buffer);
    return record.attachment;
  });
  locks.set(receipt, work);
  try { return await work; }
  finally { if (locks.get(receipt) === work) locks.delete(receipt); }
}

const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

interface StoredForm { bytes: Buffer; originalName: string; mimeType: string; converted: boolean }

/** What gets stored. A HEIC photo is known by its bytes, whatever it was
 * called or labeled: a browser that doesn't know the format sends it as
 * `application/octet-stream`, or with no type at all. */
async function storedForm(bytes: Buffer, originalName: string, mimeType: string): Promise<StoredForm> {
  if (!isHeic(bytes)) return { bytes, originalName, mimeType, converted: false };
  try {
    return { bytes: await heicToJpeg(bytes), originalName: originalName.replace(/\.hei[cf]$/i, '.jpg'), mimeType: 'image/jpeg', converted: true };
  } catch (error) {
    // Keep the photo as it came rather than lose it. Agents can still convert it themselves.
    console.warn(`[saveAttachment] kept ${originalName} as HEIC, converting it failed:`, error);
    return { bytes, originalName, mimeType: HEIC_MIMES.has(mimeType) ? mimeType : 'image/heic', converted: false };
  }
}

/** Resolve the absolute on-disk path for a stored fileName. */
export function attachmentPath(fileName: string): string {
  return path.join(/* turbopackIgnore: true */ getAttachmentsDir(), fileName);
}

async function toBuffer(data: Blob | Buffer | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}
