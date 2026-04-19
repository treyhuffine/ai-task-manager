/**
 * Reconciler: iterates every entity in the DB and makes sure its mirror
 * file is current. Safety net for missed inline syncs and crash recovery.
 */

import { getDb } from '@/lib/db';
import {
  tasks as tasksTbl,
  notes as notesTbl,
  areas as areasTbl,
  stream as streamTbl,
} from '@/lib/db/schema';
import { ensureDirs, listIdsInType, readUpdatedAt, findByIdInType } from './fs';
import { writeTask, writeNote, writeArea, writeStream } from './sync';
import { isMirrorEnabled, type EntityType } from './config';
import { ensureReadme } from './readme';

export interface ReconcileStats {
  synced: number;
  skipped: number;
  orphaned: number;
  elapsedMs: number;
}

/**
 * Reconcile the entire mirror against the DB.
 *
 * For each entity in the DB: if file is missing or out of date, rewrite.
 * For each file in the mirror: if its ID isn't in the DB, log as orphan
 * (don't move — see storage-architecture.md for rationale).
 */
export async function reconcileAll(): Promise<ReconcileStats> {
  if (!isMirrorEnabled()) {
    return { synced: 0, skipped: 0, orphaned: 0, elapsedMs: 0 };
  }

  const start = Date.now();
  ensureDirs();
  await ensureReadme();

  const db = getDb();
  let synced = 0;
  let skipped = 0;

  // Tasks
  const dbTasks = db.select().from(tasksTbl).all();
  const dbTaskIds = new Set<string>();
  for (const t of dbTasks) {
    dbTaskIds.add(t.id);
    const current = await findByIdInType('task', t.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= t.updated_at) {
        skipped++;
        continue;
      }
    }
    await writeTask(t);
    synced++;
  }

  // Notes
  const dbNotes = db.select().from(notesTbl).all();
  const dbNoteIds = new Set<string>();
  for (const n of dbNotes) {
    dbNoteIds.add(n.id);
    const current = await findByIdInType('note', n.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= n.updated_at) {
        skipped++;
        continue;
      }
    }
    await writeNote(n);
    synced++;
  }

  // Areas
  const dbAreas = db.select().from(areasTbl).all();
  const dbAreaIds = new Set<string>();
  for (const a of dbAreas) {
    dbAreaIds.add(a.id);
    const current = await findByIdInType('area', a.id);
    if (current.length === 1) {
      const fileTs = await readUpdatedAt(current[0]);
      if (fileTs && fileTs >= a.updated_at) {
        skipped++;
        continue;
      }
    }
    await writeArea(a);
    synced++;
  }

  // Streams — no updated_at on stream, so always rewrite. Cheap at typical sizes.
  const dbStreams = db.select().from(streamTbl).all();
  const dbStreamIds = new Set<string>();
  for (const s of dbStreams) {
    dbStreamIds.add(s.id);
    await writeStream(s);
    synced++;
  }

  // Orphan check — files present on disk with no matching DB row
  let orphaned = 0;
  const checks: Array<[EntityType, Set<string>]> = [
    ['task', dbTaskIds],
    ['note', dbNoteIds],
    ['area', dbAreaIds],
    ['stream', dbStreamIds],
  ];
  for (const [type, knownIds] of checks) {
    const fileIds = await listIdsInType(type);
    for (const id of fileIds) {
      if (!knownIds.has(id)) {
        orphaned++;
        console.warn(`[mirror] orphaned file (no DB row): ${type}:${id}`);
      }
    }
  }

  const elapsedMs = Date.now() - start;
  return { synced, skipped, orphaned, elapsedMs };
}
