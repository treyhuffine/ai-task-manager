/**
 * Shared database query functions.
 * Used by both API route handlers and AI chat tools.
 */

import { getDb, getRawDb } from '@/lib/db';
import { tasks, notes, areas, stream, taskCompletions, decks, userState, apiKeys } from '@/lib/db/schema';
import { eq, and, desc, asc, sql, inArray, isNull, isNotNull, gte, lte, getTableColumns, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';
import type {
  TaskRecord, TaskListRecord, CreateTaskInput, UpdateTaskInput, TaskFilter,
  NoteRecord, CreateNoteInput, UpdateNoteInput, NoteFilter,
  AreaRecord, CreateAreaInput, UpdateAreaInput, AreaFilter,
  StreamRecord, CreateStreamInput,
  DeckRecord, UpdateDeckInput,
  UpdateUserStateInput,
  ApiKeyRecord, CreateApiKeyInput, UpdateApiKeyInput,
} from '@/db/types';
import { generateToken, type GeneratedToken } from '@/lib/auth/tokens';

// ─── Tasks ────────────────────────────────────────────────────

export function listTasks(filter: TaskFilter = {}): TaskListRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (statuses.length === 1) {
      conditions.push(eq(tasks.status, statuses[0]));
    } else {
      conditions.push(inArray(tasks.status, statuses));
    }
  }

  if (filter.area_id) conditions.push(eq(tasks.area_id, filter.area_id));
  if (filter.parent_id) conditions.push(eq(tasks.parent_id, filter.parent_id));
  if (filter.energy) conditions.push(eq(tasks.energy, filter.energy));
  if (filter.q) conditions.push(sql`${tasks.title} LIKE ${'%' + filter.q + '%'}`);

  const limit = filter.limit ?? 10000;
  const offset = filter.offset ?? 0;

  const orderClauses = (() => {
    switch (filter.order_by) {
      case 'last_viewed_at': return [sql`last_viewed_at DESC NULLS LAST`, desc(tasks.created_at)];
      case 'hard_deadline':  return [sql`hard_deadline ASC NULLS LAST`, desc(tasks.created_at)];
      case 'created_at':     return [desc(tasks.created_at)];
      case 'updated_at':     return [desc(tasks.updated_at)];
      default:               return [sql`sort_key ASC NULLS LAST`, desc(tasks.created_at)];
    }
  })();

  return db
    .select({
      ...getTableColumns(tasks),
      subtask_count: sql<number>`(SELECT COUNT(*) FROM tasks t2 WHERE t2.parent_id = ${sql.raw('"tasks"."id"')})`.as('subtask_count'),
      subtask_preview: sql<string | null>`(SELECT GROUP_CONCAT(t3.title, '|||') FROM (SELECT title FROM tasks t3 WHERE t3.parent_id = ${sql.raw('"tasks"."id"')} LIMIT 4) t3)`.as('subtask_preview'),
    })
    .from(tasks)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderClauses)
    .limit(limit)
    .offset(offset)
    .all();
}

export function getTask(id: string): TaskRecord | undefined {
  const db = getDb();
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export function createTask(input: Omit<CreateTaskInput, 'raw_input'> & { raw_input?: string }): TaskRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const row = db
    .insert(tasks)
    .values({
      ...input,
      raw_input: input.raw_input ?? input.title,
      id: uuidv7(),
      status: input.status ?? 'active',
      context_tags: input.context_tags ?? [],
      attachments: input.attachments ?? [],
      times_deferred: 0,
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();

  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  return row;
}

export function updateTask(id: string, input: UpdateTaskInput): TaskRecord | null {
  const db = getDb();

  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;

  const row = db
    .update(tasks)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .returning()
    .get();

  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  return row;
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes === 0) return false;
  deleteEmbedding('task', id);
  return true;
}

export function completeTask(id: string, note?: string): { task: TaskRecord; recurring: boolean; next_recurrence_at?: string } | null {
  const db = getDb();

  const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!task) return null;

  const now = new Date().toISOString();

  if (task.recurrence) {
    db.insert(taskCompletions).values({
      id: uuidv7(),
      task_id: id,
      completed_at: now,
      note: note ?? null,
    }).run();

    const nextDate = computeNextRecurrence(task.recurrence, now);

    const updated = db
      .update(tasks)
      .set({ next_recurrence_at: nextDate, last_progress_at: now, updated_at: now })
      .where(eq(tasks.id, id))
      .returning()
      .get();

    return { task: updated, recurring: true, next_recurrence_at: nextDate };
  } else {
    const updated = db
      .update(tasks)
      .set({ status: 'done', completed_at: now, updated_at: now })
      .where(eq(tasks.id, id))
      .returning()
      .get();

    db.insert(taskCompletions).values({
      id: uuidv7(),
      task_id: id,
      completed_at: now,
      note: note ?? null,
    }).run();

    return { task: updated, recurring: false };
  }
}

function computeNextRecurrence(recurrence: string, fromDate: string): string {
  const date = new Date(fromDate);
  const lower = recurrence.toLowerCase();

  if (lower.includes('daily') || lower === '1d') {
    date.setDate(date.getDate() + 1);
  } else if (lower.includes('weekly') || lower === '1w') {
    date.setDate(date.getDate() + 7);
  } else if (lower.includes('monthly') || lower === '1m') {
    date.setMonth(date.getMonth() + 1);
  } else if (lower.includes('yearly') || lower === '1y') {
    date.setFullYear(date.getFullYear() + 1);
  } else {
    const match = lower.match(/^(\d+)d$/);
    if (match) {
      date.setDate(date.getDate() + parseInt(match[1], 10));
    } else {
      date.setDate(date.getDate() + 7);
    }
  }

  return date.toISOString();
}

// ─── Notes ────────────────────────────────────────────────────

export function listNotes(filter: NoteFilter = {}): NoteRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filter.area_id) conditions.push(eq(notes.area_id, filter.area_id));
  if (filter.task_id) conditions.push(eq(notes.task_id, filter.task_id));
  if (filter.status) conditions.push(eq(notes.status, filter.status));

  const limit = filter.limit ?? 10000;
  const offset = filter.offset ?? 0;

  const orderClauses = (() => {
    switch (filter.order_by) {
      case 'created_at':     return [desc(notes.created_at)];
      case 'updated_at':     return [desc(notes.updated_at)];
      default:               return [sql`last_viewed_at DESC NULLS LAST`, desc(notes.created_at)];
    }
  })();

  return db
    .select()
    .from(notes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderClauses)
    .limit(limit)
    .offset(offset)
    .all();
}

export function getNote(id: string): NoteRecord | undefined {
  const db = getDb();
  return db.select().from(notes).where(eq(notes.id, id)).get();
}

export function createNote(input: CreateNoteInput): NoteRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const row = db
    .insert(notes)
    .values({
      ...input,
      id: uuidv7(),
      status: input.status ?? 'active',
      context_tags: input.context_tags ?? [],
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();

  void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
  return row;
}

export function updateNote(id: string, input: UpdateNoteInput): NoteRecord | null {
  const db = getDb();

  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!existing) return null;

  const row = db
    .update(notes)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(notes.id, id))
    .returning()
    .get();

  void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
  return row;
}

export function deleteNote(id: string): boolean {
  const db = getDb();
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  if (result.changes === 0) return false;
  deleteEmbedding('note', id);
  return true;
}

// ─── Areas ────────────────────────────────────────────────────

export function listAreas(filter: AreaFilter = {}): AreaRecord[] {
  const db = getDb();
  const status = filter.status ?? 'active';

  return db
    .select()
    .from(areas)
    .where(status !== 'all' ? eq(areas.status, status as 'active' | 'inactive' | 'archived') : undefined)
    .orderBy(asc(areas.sort_order))
    .all();
}

export function getArea(id: string): AreaRecord | undefined {
  const db = getDb();
  return db.select().from(areas).where(eq(areas.id, id)).get();
}

export function createArea(input: CreateAreaInput): AreaRecord {
  const db = getDb();
  const now = new Date().toISOString();

  return db
    .insert(areas)
    .values({
      ...input,
      id: uuidv7(),
      status: input.status ?? 'active',
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
}

export function updateArea(id: string, input: UpdateAreaInput): AreaRecord | null {
  const db = getDb();

  const existing = db.select().from(areas).where(eq(areas.id, id)).get();
  if (!existing) return null;

  return db
    .update(areas)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(areas.id, id))
    .returning()
    .get();
}

// ─── Deck ─────────────────────────────────────────────────────

export function getLatestDeck(): DeckRecord | null {
  const db = getDb();
  return db
    .select()
    .from(decks)
    .orderBy(desc(decks.created_at))
    .limit(1)
    .all()[0] ?? null;
}

export function getDeck(id: string): DeckRecord | undefined {
  const db = getDb();
  return db.select().from(decks).where(eq(decks.id, id)).get();
}

export function updateDeck(id: string, input: UpdateDeckInput): DeckRecord | null {
  const db = getDb();

  const deck = db
    .update(decks)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(decks.id, id))
    .returning()
    .get();

  return deck ?? null;
}

// ─── User State ───────────────────────────────────────────────

export function getUserState() {
  const db = getDb();
  return db.select().from(userState).where(eq(userState.id, 1)).get();
}

export function updateUserState(input: UpdateUserStateInput) {
  const db = getDb();
  return db
    .update(userState)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(userState.id, 1))
    .returning()
    .get();
}

// ─── API Keys ─────────────────────────────────────────────────

export function createApiKey(
  input: CreateApiKeyInput,
): { key: ApiKeyRecord; token: GeneratedToken } {
  const db = getDb();
  const now = new Date().toISOString();
  const token = generateToken(input.env ?? 'live');

  const key = db
    .insert(apiKeys)
    .values({
      ...input,
      id: uuidv7(),
      prefix: token.prefix,
      suffix: token.suffix,
      hash: token.hash,
      env: token.env,
      device_type: input.device_type ?? 'other',
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();

  return { key, token };
}

export function listApiKeys(options: { includeRevoked?: boolean } = {}): ApiKeyRecord[] {
  const db = getDb();
  const q = db.select().from(apiKeys);
  const rows = options.includeRevoked
    ? q.orderBy(desc(apiKeys.created_at)).all()
    : q.where(isNull(apiKeys.revoked_at)).orderBy(desc(apiKeys.created_at)).all();
  return rows;
}

export function findApiKeyByHash(hash: string): ApiKeyRecord | undefined {
  const db = getDb();
  return db.select().from(apiKeys).where(eq(apiKeys.hash, hash)).get();
}

export function updateApiKey(id: string, input: UpdateApiKeyInput): ApiKeyRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(apiKeys)
    .set({ ...input, updated_at: now })
    .where(eq(apiKeys.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function revokeApiKey(id: string, reason?: string): ApiKeyRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(apiKeys)
    .set({ revoked_at: now, revoked_reason: reason ?? null, updated_at: now })
    .where(eq(apiKeys.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function touchApiKey(
  id: string,
  meta: { ip?: string | null; user_agent?: string | null } = {},
): void {
  const db = getDb();
  db.update(apiKeys)
    .set({
      last_used_at: new Date().toISOString(),
      last_used_ip: meta.ip ?? null,
      last_used_user_agent: meta.user_agent ?? null,
    })
    .where(eq(apiKeys.id, id))
    .run();
}
