/**
 * Attachments garbage collection.
 *
 * The app's delete path is lazy: removing an entity does not touch the files
 * it referenced. This sweep is the cleanup side of that contract.
 *
 * Algorithm:
 *   1. Enumerate every `file_name` referenced by any entity's `attachments[]`
 *      column, across tasks, notes, areas, stream.
 *   2. Enumerate every file in `<brain>/attachments/`.
 *   3. Files in (2) \ (1) are orphans → move to `<brain>/.archive/attachments/`.
 *
 * Orphans are soft-deleted rather than hard-deleted so a bad reference-graph
 * query or a race between entity save + gc doesn't irreversibly lose user
 * data. Hard-delete-from-archive is deliberately out of scope for v1.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '@/lib/db';
import {
  tasks as tasksTbl,
  notes as notesTbl,
  areas as areasTbl,
  stream as streamTbl,
} from '@/lib/db/schema';
import { getAttachmentsDir, getBrainDir } from '@/lib/config/paths';
import type { Attachment } from '@/db/types';

export interface AttachmentsGcStats {
  referenced: number;
  onDisk: number;
  archived: number;
  elapsedMs: number;
}

/** Archive subdirectory for orphaned attachment files. Lives inside the brain
 *  dir so it moves with the rest of user content under BRAIN_PATH overrides. */
function archiveAttachmentsDir(): string {
  return path.join(getBrainDir(), '.archive', 'attachments');
}

function ensureAttachmentsDirsExist(): void {
  fs.mkdirSync(getAttachmentsDir(), { recursive: true });
  fs.mkdirSync(archiveAttachmentsDir(), { recursive: true });
}

/** Collect every file_name referenced by any entity. */
export function collectReferencedFileNames(): Set<string> {
  const db = getDb();
  const out = new Set<string>();

  const push = (rows: Array<{ attachments: Attachment[] | null }>) => {
    for (const r of rows) {
      for (const a of r.attachments ?? []) out.add(a.file_name);
    }
  };

  push(db.select({ attachments: tasksTbl.attachments }).from(tasksTbl).all());
  push(db.select({ attachments: notesTbl.attachments }).from(notesTbl).all());
  push(db.select({ attachments: areasTbl.attachments }).from(areasTbl).all());
  push(db.select({ attachments: streamTbl.attachments }).from(streamTbl).all());

  return out;
}

/** Sweep orphans. Safe to run concurrently with writes: a file freshly
 *  referenced after (1) but not yet reflected in (2) would already be on
 *  disk, and we archive (not delete) so the next sweep can restore it by
 *  reference. */
export async function sweepAttachments(): Promise<AttachmentsGcStats> {
  const start = Date.now();
  ensureAttachmentsDirsExist();

  const referenced = collectReferencedFileNames();
  const dir = getAttachmentsDir();
  let entries: string[];
  try {
    entries = await fsp.readdir(dir);
  } catch {
    return { referenced: referenced.size, onDisk: 0, archived: 0, elapsedMs: Date.now() - start };
  }

  let archived = 0;
  let onDisk = 0;
  for (const name of entries) {
    if (name.startsWith('.')) continue;
    onDisk++;
    if (referenced.has(name)) continue;
    const src = path.join(dir, name);
    const dest = path.join(archiveAttachmentsDir(), name);
    try {
      // Prefer rename for atomicity; fall back to copy+unlink across devices
      // (uncommon, but can happen when `.archive/` is on a separate mount).
      await fsp.rename(src, dest);
      archived++;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fsp.copyFile(src, dest);
        await fsp.unlink(src);
        archived++;
        continue;
      }
      console.warn(`[mirror] orphan attachment archive failed: ${name}`, err);
    }
  }

  return {
    referenced: referenced.size,
    onDisk,
    archived,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Restore an archived attachment (reverse of `sweepAttachments`'s move).
 * Used if the reconciler archives a file that's referenced via a late commit
 * and the next sync needs it back in the primary dir.
 */
export async function restoreArchivedAttachment(file_name: string): Promise<boolean> {
  const src = path.join(archiveAttachmentsDir(), file_name);
  const dest = path.join(getAttachmentsDir(), file_name);
  try {
    await fsp.rename(src, dest);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
