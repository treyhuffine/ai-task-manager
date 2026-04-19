/**
 * Mirror sync: public API for the live export.
 *
 * Callers (queries.ts, API routes, AI tools) notify the mirror of mutations
 * by invoking `syncEntity` / `syncBatch` / `syncDeletion`. These run after
 * the DB transaction commits. All operations are best-effort: a failure is
 * logged but never propagates to the DB write path — the periodic reconciler
 * catches any drift.
 */

import { getDb } from '@/lib/db';
import {
  tasks as tasksTbl,
  notes as notesTbl,
  areas as areasTbl,
  stream as streamTbl,
} from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type {
  TaskRecord,
  NoteRecord,
  AreaRecord,
  StreamRecord,
} from '@/db/types';
import {
  isMirrorEnabled,
  type EntityType,
  ENTITY_TYPES,
} from './config';
import {
  archiveEntityFile,
  deleteEntityFile,
  writeEntityFile,
} from './fs';
import {
  renderArea,
  renderNote,
  renderStream,
  renderTask,
} from './render';

// ─── Mutation context ─────────────────────────────────────────

export type EntityRef = `${EntityType}:${string}`;

/** Accumulates entity references touched during a transaction. */
export class MutationContext {
  private refs = new Set<EntityRef>();

  add(type: EntityType, id: string): void {
    this.refs.add(`${type}:${id}`);
  }

  addMany(type: EntityType, ids: string[]): void {
    for (const id of ids) this.refs.add(`${type}:${id}`);
  }

  entries(): Array<[EntityType, string]> {
    return Array.from(this.refs).map((ref) => {
      const sep = ref.indexOf(':');
      return [ref.slice(0, sep) as EntityType, ref.slice(sep + 1)];
    });
  }

  get size(): number {
    return this.refs.size;
  }
}

// ─── Single entry points ─────────────────────────────────────

/** Convenience for one-off single-entity sync. */
export function syncEntity(type: EntityType, id: string): Promise<void> {
  if (!isMirrorEnabled()) return Promise.resolve();
  const ctx = new MutationContext();
  ctx.add(type, id);
  return syncBatch(ctx);
}

/** Convenience for one-off single-entity deletion. */
export async function syncDeletion(type: EntityType, id: string): Promise<void> {
  if (!isMirrorEnabled()) return;
  try {
    await deleteEntityFile(type, id);
  } catch (err) {
    console.warn(`[mirror] delete failed: ${type}:${id}`, err);
  }
}

/**
 * Sync every entity in the mutation context. Runs fetches + writes in
 * parallel. Expands cascades: stream → note promotion also re-renders the
 * target note so its Sources section stays current.
 */
export async function syncBatch(ctx: MutationContext): Promise<void> {
  if (!isMirrorEnabled()) return;
  if (ctx.size === 0) return;

  try {
    const expanded = expandCascades(ctx);
    await Promise.all(
      expanded.entries().map(async ([type, id]) => {
        try {
          await syncOne(type, id);
        } catch (err) {
          console.warn(`[mirror] sync failed: ${type}:${id}`, err);
        }
      }),
    );
  } catch (err) {
    console.warn('[mirror] syncBatch failed', err);
  }
}

/**
 * For every stream in the batch with `promoted_to_type='note'`, also mark
 * the target note as dirty so its source list stays current.
 */
function expandCascades(ctx: MutationContext): MutationContext {
  const out = new MutationContext();
  for (const [type, id] of ctx.entries()) {
    out.add(type, id);
  }
  const db = getDb();
  for (const [type, id] of ctx.entries()) {
    if (type !== 'stream') continue;
    const row = db.select().from(streamTbl).where(eq(streamTbl.id, id)).get();
    if (row?.promoted_to_type === 'note' && row.promoted_to_id) {
      out.add('note', row.promoted_to_id);
    }
  }
  return out;
}

async function syncOne(type: EntityType, id: string): Promise<void> {
  const db = getDb();

  if (type === 'task') {
    const row = db.select().from(tasksTbl).where(eq(tasksTbl.id, id)).get();
    if (!row) {
      await deleteEntityFile('task', id);
      return;
    }
    await writeTask(row);
    return;
  }

  if (type === 'note') {
    const row = db.select().from(notesTbl).where(eq(notesTbl.id, id)).get();
    if (!row) {
      await deleteEntityFile('note', id);
      return;
    }
    await writeNote(row);
    return;
  }

  if (type === 'area') {
    const row = db.select().from(areasTbl).where(eq(areasTbl.id, id)).get();
    if (!row) {
      await deleteEntityFile('area', id);
      return;
    }
    await writeArea(row);
    return;
  }

  if (type === 'stream') {
    const row = db.select().from(streamTbl).where(eq(streamTbl.id, id)).get();
    if (!row) {
      await deleteEntityFile('stream', id);
      return;
    }
    await writeStream(row);
    return;
  }
}

// ─── Per-type writers (with denorm lookups) ─────────────────────

export async function writeTask(task: TaskRecord): Promise<void> {
  const db = getDb();
  const area = task.area_id
    ? db.select().from(areasTbl).where(eq(areasTbl.id, task.area_id)).get()
    : undefined;
  const parent = task.parent_id
    ? db.select().from(tasksTbl).where(eq(tasksTbl.id, task.parent_id)).get()
    : undefined;

  const { filename, content } = renderTask(task, {
    areaName: area?.name ?? null,
    parentTitle: parent?.title ?? null,
  });

  if (task.status === 'archived') {
    await archiveEntityFile('task', task.id, filename, content);
  } else {
    await writeEntityFile('task', task.id, filename, content);
  }
}

export async function writeNote(note: NoteRecord): Promise<void> {
  const db = getDb();
  const area = note.area_id
    ? db.select().from(areasTbl).where(eq(areasTbl.id, note.area_id)).get()
    : undefined;
  const task = note.task_id
    ? db.select().from(tasksTbl).where(eq(tasksTbl.id, note.task_id)).get()
    : undefined;

  // Streams promoted into this note — their raw_text becomes the Sources section.
  // Only `promoted` streams count; later-dismissed ones would be misleading to show.
  const sources = db
    .select()
    .from(streamTbl)
    .where(
      and(
        eq(streamTbl.promoted_to_id, note.id),
        eq(streamTbl.promoted_to_type, 'note'),
        eq(streamTbl.status, 'promoted'),
      ),
    )
    .all();

  const { filename, content } = renderNote(note, {
    areaName: area?.name ?? null,
    taskTitle: task?.title ?? null,
    sources,
  });

  if (note.status === 'archived') {
    await archiveEntityFile('note', note.id, filename, content);
  } else {
    await writeEntityFile('note', note.id, filename, content);
  }
}

export async function writeArea(area: AreaRecord): Promise<void> {
  const { filename, content } = renderArea(area);

  if (area.status === 'archived') {
    await archiveEntityFile('area', area.id, filename, content);
  } else {
    await writeEntityFile('area', area.id, filename, content);
  }
}

export async function writeStream(s: StreamRecord): Promise<void> {
  const db = getDb();
  let promotedToTitle: string | null = null;
  if (s.promoted_to_id && s.promoted_to_type) {
    if (s.promoted_to_type === 'note') {
      const n = db.select().from(notesTbl).where(eq(notesTbl.id, s.promoted_to_id)).get();
      promotedToTitle = n?.title ?? null;
    } else if (s.promoted_to_type === 'task') {
      const t = db.select().from(tasksTbl).where(eq(tasksTbl.id, s.promoted_to_id)).get();
      promotedToTitle = t?.title ?? null;
    }
  }

  const { filename, content } = renderStream(s, { promotedToTitle });

  // Stream items use status to signal lifecycle: 'dismissed' goes to archive;
  // 'promoted' and 'pending' stay in the primary folder.
  if (s.status === 'dismissed') {
    await archiveEntityFile('stream', s.id, filename, content);
  } else {
    await writeEntityFile('stream', s.id, filename, content);
  }
}

// ─── Exports for reconcile ────────────────────────────────────

export { ENTITY_TYPES };
