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
  streamLinks as streamLinksTbl,
} from '@/lib/db/schema';
import { hydrateRow } from '@/lib/db/hydrate';
import { and, asc, eq } from 'drizzle-orm';
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
 *   - area → tasks and notes with matching areaId
 *   - task → tasks with matching parentId, notes with matching taskId,
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
      // A capture's derived entities render Sources sections from it.
      const links = db
        .select({ entityType: streamLinksTbl.entityType, entityId: streamLinksTbl.entityId })
        .from(streamLinksTbl)
        .where(eq(streamLinksTbl.streamId, id))
        .all();
      for (const l of links) out.add(l.entityType, l.entityId);
      continue;
    }

    if (type === 'area') {
      const refTasks = db.select({ id: tasksTbl.id }).from(tasksTbl).where(eq(tasksTbl.areaId, id)).all();
      out.addMany('task', refTasks.map((r) => r.id));
      const refNotes = db.select({ id: notesTbl.id }).from(notesTbl).where(eq(notesTbl.areaId, id)).all();
      out.addMany('note', refNotes.map((r) => r.id));
      continue;
    }

    if (type === 'task') {
      const childTasks = db.select({ id: tasksTbl.id }).from(tasksTbl).where(eq(tasksTbl.parentId, id)).all();
      out.addMany('task', childTasks.map((r) => r.id));
      const refNotes = db.select({ id: notesTbl.id }).from(notesTbl).where(eq(notesTbl.taskId, id)).all();
      out.addMany('note', refNotes.map((r) => r.id));
      out.addMany('stream', linkedStreamIds(db, 'task', id));
      continue;
    }

    if (type === 'note') {
      out.addMany('stream', linkedStreamIds(db, 'note', id));
      continue;
    }
  }
  return out;
}

/** Captures linked to an entity (its outcome links reference the entity's
 *  current slug, so a rename must rewrite them). */
function linkedStreamIds(db: ReturnType<typeof getDb>, entityType: 'task' | 'note', entityId: string): string[] {
  return db
    .select({ id: streamLinksTbl.streamId })
    .from(streamLinksTbl)
    .where(and(eq(streamLinksTbl.entityType, entityType), eq(streamLinksTbl.entityId, entityId)))
    .all()
    .map((r) => r.id);
}

async function syncOne(type: EntityType, id: string): Promise<void> {
  const db = getDb();

  if (type === 'task') {
    const row = hydrateRow(db.select().from(tasksTbl).where(eq(tasksTbl.id, id)).get());
    if (!row) {
      await deleteEntityFile('task', id);
      return;
    }
    await writeTask(row);
    return;
  }

  if (type === 'note') {
    const row = hydrateRow(db.select().from(notesTbl).where(eq(notesTbl.id, id)).get());
    if (!row) {
      await deleteEntityFile('note', id);
      return;
    }
    await writeNote(row);
    return;
  }

  if (type === 'area') {
    const row = hydrateRow(db.select().from(areasTbl).where(eq(areasTbl.id, id)).get());
    if (!row) {
      await deleteEntityFile('area', id);
      return;
    }
    await writeArea(row);
    return;
  }

  if (type === 'stream') {
    const row = hydrateRow(db.select().from(streamTbl).where(eq(streamTbl.id, id)).get());
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
 * Streams have no human title; we use their first rawText line as the slug,
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
        const firstLine = (row.rawText ?? '').split('\n')[0]?.trim().slice(0, 40) ?? '';
        return mirrorLinkPath('stream', firstLine, row.id);
      }
      return null;
    },
  };
}

// ─── Per-type writers (with denorm lookups) ─────────────────────

/**
 * Captures an entity derives from, via stream_links (the many-to-many
 * provenance source of truth). Queried directly — this module can't import
 * queries.ts (it would close an import cycle: queries → mirror → queries).
 */
function mirrorStreamSources(entityType: 'task' | 'note', entityId: string): StreamRecord[] {
  const db = getDb();
  const rows = db
    .select({ s: streamTbl })
    .from(streamLinksTbl)
    .innerJoin(streamTbl, eq(streamTbl.id, streamLinksTbl.streamId))
    .where(and(eq(streamLinksTbl.entityType, entityType), eq(streamLinksTbl.entityId, entityId)))
    .orderBy(asc(streamLinksTbl.createdAt))
    .all();
  const seen = new Set<string>();
  const out: StreamRecord[] = [];
  for (const r of rows) {
    if (seen.has(r.s.id)) continue;
    seen.add(r.s.id);
    out.push(hydrateRow(r.s));
  }
  return out;
}

export async function writeTask(task: TaskRecord): Promise<void> {
  const db = getDb();
  const area = task.areaId
    ? db.select().from(areasTbl).where(eq(areasTbl.id, task.areaId)).get()
    : undefined;
  const parent = task.parentId
    ? db.select().from(tasksTbl).where(eq(tasksTbl.id, task.parentId)).get()
    : undefined;

  const { filename, content } = renderTask(task, {
    areaName: area?.name ?? null,
    parentTitle: parent?.title ?? null,
    sources: mirrorStreamSources('task', task.id),
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
  const area = note.areaId
    ? db.select().from(areasTbl).where(eq(areasTbl.id, note.areaId)).get()
    : undefined;
  const task = note.taskId
    ? db.select().from(tasksTbl).where(eq(tasksTbl.id, note.taskId)).get()
    : undefined;

  const { filename, content } = renderNote(note, {
    areaName: area?.name ?? null,
    taskTitle: task?.title ?? null,
    // Captures merged/promoted into this note, via stream_links.
    sources: mirrorStreamSources('note', note.id),
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
  // Where this capture went (stream_links, many-to-many), with titles.
  const outcomes = db
    .select()
    .from(streamLinksTbl)
    .where(eq(streamLinksTbl.streamId, s.id))
    .all()
    .map((l) => {
      const title =
        l.entityType === 'task'
          ? db.select({ t: tasksTbl.title }).from(tasksTbl).where(eq(tasksTbl.id, l.entityId)).get()?.t ?? null
          : db.select({ t: notesTbl.title }).from(notesTbl).where(eq(notesTbl.id, l.entityId)).get()?.t ?? null;
      return { entityType: l.entityType, entityId: l.entityId, relation: l.relation, title };
    });

  const { filename, content } = renderStream(s, {
    outcomes,
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
