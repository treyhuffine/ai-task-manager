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
  mirrorLinkPath,
  renderArea,
  renderNote,
  renderStream,
  renderTask,
  type LinkResolver,
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
 * Expand a mutation context to include every entity whose mirror file
 * references a touched entity. Needed because wiki links embed the target's
 * current slug — if a task or area is renamed, every dependent file's
 * wiki-link target changes too.
 *
 * Cascade edges:
 *   - stream → its promoted-to note (Sources section stays current)
 *   - area → tasks and notes with matching area_id
 *   - task → tasks with matching parent_id, notes with matching task_id,
 *            streams promoted into this task
 *   - note → streams promoted into this note
 *
 * We always cascade (rather than only on rename) because detecting a rename
 * requires comparing against the prior written file. Rewriting a handful of
 * dependents per mutation is cheap; the reconciler is the backstop.
 */
function expandCascades(ctx: MutationContext): MutationContext {
  const out = new MutationContext();
  for (const [type, id] of ctx.entries()) {
    out.add(type, id);
  }
  const db = getDb();

  for (const [type, id] of ctx.entries()) {
    if (type === 'stream') {
      const row = db.select().from(streamTbl).where(eq(streamTbl.id, id)).get();
      if (row?.promoted_to_type === 'note' && row.promoted_to_id) {
        out.add('note', row.promoted_to_id);
      }
      continue;
    }

    if (type === 'area') {
      const refTasks = db.select({ id: tasksTbl.id }).from(tasksTbl).where(eq(tasksTbl.area_id, id)).all();
      out.addMany('task', refTasks.map((r) => r.id));
      const refNotes = db.select({ id: notesTbl.id }).from(notesTbl).where(eq(notesTbl.area_id, id)).all();
      out.addMany('note', refNotes.map((r) => r.id));
      continue;
    }

    if (type === 'task') {
      const childTasks = db.select({ id: tasksTbl.id }).from(tasksTbl).where(eq(tasksTbl.parent_id, id)).all();
      out.addMany('task', childTasks.map((r) => r.id));
      const refNotes = db.select({ id: notesTbl.id }).from(notesTbl).where(eq(notesTbl.task_id, id)).all();
      out.addMany('note', refNotes.map((r) => r.id));
      const refStreams = db
        .select({ id: streamTbl.id })
        .from(streamTbl)
        .where(and(eq(streamTbl.promoted_to_id, id), eq(streamTbl.promoted_to_type, 'task')))
        .all();
      out.addMany('stream', refStreams.map((r) => r.id));
      continue;
    }

    if (type === 'note') {
      const refStreams = db
        .select({ id: streamTbl.id })
        .from(streamTbl)
        .where(and(eq(streamTbl.promoted_to_id, id), eq(streamTbl.promoted_to_type, 'note')))
        .all();
      out.addMany('stream', refStreams.map((r) => r.id));
      continue;
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

// ─── Link resolver (current DB state → wiki-link target) ─────

/**
 * Build a resolver backed by primary-key lookups. Cheap: each `linkFor` call
 * is one indexed lookup. Returns null when the referenced row doesn't exist
 * (dangling FK) — caller falls back to the denormalized name field.
 *
 * Streams have no human title; we use their first raw_text line as the slug,
 * matching writeStream's filename logic.
 */
function createLinkResolver(): LinkResolver {
  const db = getDb();
  return {
    linkFor(type, id) {
      if (type === 'task') {
        const row = db.select().from(tasksTbl).where(eq(tasksTbl.id, id)).get();
        return row ? mirrorLinkPath('task', row.title, row.id) : null;
      }
      if (type === 'note') {
        const row = db.select().from(notesTbl).where(eq(notesTbl.id, id)).get();
        return row ? mirrorLinkPath('note', row.title, row.id) : null;
      }
      if (type === 'area') {
        const row = db.select().from(areasTbl).where(eq(areasTbl.id, id)).get();
        return row ? mirrorLinkPath('area', row.name, row.id) : null;
      }
      if (type === 'stream') {
        const row = db.select().from(streamTbl).where(eq(streamTbl.id, id)).get();
        if (!row) return null;
        const firstLine = (row.raw_text ?? '').split('\n')[0]?.trim().slice(0, 40) ?? '';
        return mirrorLinkPath('stream', firstLine, row.id);
      }
      return null;
    },
  };
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
    links: createLinkResolver(),
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
    links: createLinkResolver(),
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

  const { filename, content } = renderStream(s, {
    promotedToTitle,
    links: createLinkResolver(),
  });

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
