/**
 * Attachments garbage collection + reference healing.
 *
 * The app's delete path is lazy: removing an entity does not touch the files
 * it referenced. This sweep is the cleanup side of that contract.
 *
 * Algorithm:
 *   1. Enumerate every `fileName` referenced by any entity's `attachments[]`
 *      column across all six tables (tasks, notes, areas, stream, workspaces,
 *      chat_events). Missing a table here causes the GC to see referenced
 *      files as orphans and silently break the user's images.
 *   2. Heal any reference whose file is only in `<brain>/.archive/attachments/`
 *      by moving it back to `<brain>/attachments/`. Always runs.
 *   3. If GC is enabled (`<APP>_ATTACHMENT_GC=1`), files on disk not in (1)
 *      are orphans → move to `<brain>/.archive/attachments/`. Off by default
 *      because orphans are hidden from the user and disk-cheap, while a bad
 *      reference graph would visibly break images.
 *
 * Orphans are soft-deleted (moved to archive), never hard-deleted. The same
 * archive dir is the source for healing in step (2).
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getDb } from '@/lib/db';
import { hydrateRow } from '@/lib/db/hydrate';
import {
  tasks as tasksTbl,
  notes as notesTbl,
  areas as areasTbl,
  stream as streamTbl,
  workspaces as workspacesTbl,
  chatEvents as chatEventsTbl,
} from '@/lib/db/schema';
import { getAttachmentsDir, getBrainDir } from '@/lib/config/paths';
import { isAttachmentGcEnabled } from './config';
import type { Attachment } from '@/db/types';

export interface AttachmentsGcStats {
  referenced: number;
  onDisk: number;
  archived: number;
  restored: number;
  gcEnabled: boolean;
  elapsedMs: number;
}

function archiveAttachmentsDir(): string {
  return path.join(getBrainDir(), '.archive', 'attachments');
}

function ensureAttachmentsDirsExist(): void {
  fs.mkdirSync(getAttachmentsDir(), { recursive: true });
  fs.mkdirSync(archiveAttachmentsDir(), { recursive: true });
}

/** Collect every fileName referenced by any entity. Must cover every table
 *  that has an `attachments` column in the schema — see schema.ts. */
export function collectReferencedFileNames(): Set<string> {
  const db = getDb();
  const out = new Set<string>();

  const push = (rows: Array<{ attachments: Attachment[] | null }>) => {
    for (const r of rows) {
      for (const a of r.attachments ?? []) out.add(a.fileName);
    }
  };

  push(db.select({ attachments: tasksTbl.attachments }).from(tasksTbl).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: notesTbl.attachments }).from(notesTbl).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: areasTbl.attachments }).from(areasTbl).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: streamTbl.attachments }).from(streamTbl).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: workspacesTbl.attachments }).from(workspacesTbl).all().map((r) => hydrateRow(r)));
  push(db.select({ attachments: chatEventsTbl.attachments }).from(chatEventsTbl).all().map((r) => hydrateRow(r)));

  return out;
}

/** Sweep orphans and heal stranded references. */
export async function sweepAttachments(): Promise<AttachmentsGcStats> {
  const start = Date.now();
  ensureAttachmentsDirsExist();

  const referenced = collectReferencedFileNames();
  const liveDir = getAttachmentsDir();
  const archiveDir = archiveAttachmentsDir();

  let liveEntries: string[];
  try {
    liveEntries = await fsp.readdir(liveDir);
  } catch {
    return {
      referenced: referenced.size,
      onDisk: 0,
      archived: 0,
      restored: 0,
      gcEnabled: isAttachmentGcEnabled(),
      elapsedMs: Date.now() - start,
    };
  }
  const live = new Set(liveEntries.filter((n) => !n.startsWith('.')));

  // Heal: anything referenced but only in archive → move back to live.
  let restored = 0;
  for (const name of referenced) {
    if (live.has(name)) continue;
    const src = path.join(archiveDir, name);
    const dest = path.join(liveDir, name);
    try {
      await fsp.rename(src, dest);
      live.add(name);
      restored++;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') continue; // not in archive either — truly missing
      console.warn(`[mirror] reference heal failed: ${name}`, err);
    }
  }

  const gcEnabled = isAttachmentGcEnabled();
  let archived = 0;
  if (gcEnabled) {
    for (const name of live) {
      if (referenced.has(name)) continue;
      const src = path.join(liveDir, name);
      const dest = path.join(archiveDir, name);
      try {
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
  }

  return {
    referenced: referenced.size,
    onDisk: live.size,
    archived,
    restored,
    gcEnabled,
    elapsedMs: Date.now() - start,
  };
}

/**
 * Restore a single archived attachment by name. Retained as a public helper
 * for callers that know they need a specific file back (e.g. after a manual
 * DB edit). The sweep does the bulk-heal automatically.
 */
export async function restoreArchivedAttachment(fileName: string): Promise<boolean> {
  const src = path.join(archiveAttachmentsDir(), fileName);
  const dest = path.join(getAttachmentsDir(), fileName);
  try {
    await fsp.rename(src, dest);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
