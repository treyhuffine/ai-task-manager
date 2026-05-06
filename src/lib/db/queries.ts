/**
 * Shared database query functions.
 * Used by both API route handlers and AI chat tools.
 */

import { getDb, getRawDb } from '@/lib/db';
import {
  tasks, notes, areas, stream, taskCompletions, decks, userState, apiKeys,
  workspaces, agents, chatSessions, chatEvents,
} from '@/lib/db/schema';
import { eq, and, desc, asc, sql, inArray, isNull, isNotNull, gte, lte, getTableColumns, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import slugify from '@sindresorhus/slugify';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';
import { syncEntity, syncDeletion } from '@/lib/export/mirror';
import type {
  TaskRecord, TaskListRecord, CreateTaskInput, UpdateTaskInput, TaskFilter,
  NoteRecord, CreateNoteInput, UpdateNoteInput, NoteFilter,
  AreaRecord, CreateAreaInput, UpdateAreaInput, AreaFilter,
  StreamRecord, CreateStreamInput, UpdateStreamInput,
  DeckRecord, UpdateDeckInput,
  UpdateUserStateInput,
  ApiKeyRecord, CreateApiKeyInput, UpdateApiKeyInput,
  Attachment,
  WorkspaceRecord, CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceWithCounts, WorkspaceStatus,
  AgentRecord, CreateAgentInput,
  ChatSessionRecord, CreateChatSessionInput, UpdateChatSessionInput,
  ChatEventRecord, CreateChatEventInput, ChatEventSource,
} from '@/db/types';
import { OUTCOME_SOURCES } from '@/db/types';
import { generateToken, type GeneratedToken } from '@/lib/auth/tokens';
import { deriveAttachments } from '@/lib/attachments/derive';

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

/** Tasks carry free-form markdown in both `description` and `body`. The
 *  quick-create modal writes to description only; the full editor writes to
 *  body. Scanning both means attachments dropped into either surface are
 *  captured consistently. */
function taskAttachmentText(
  description: string | null | undefined,
  body: string | null | undefined,
): string {
  return `${description ?? ''}\n${body ?? ''}`;
}

export function createTask(input: Omit<CreateTaskInput, 'raw_input'> & { raw_input?: string }): TaskRecord {
  const db = getDb();
  const now = new Date().toISOString();

  // Body + description are the surfaces; attachments[] is a derived manifest.
  // Anything the client sent in `attachments` is treated as newly-uploaded
  // metadata and filtered through the body's references.
  const attachments = deriveAttachments({
    body: taskAttachmentText(input.description, input.body),
    prior: [],
    newUploads: input.attachments ?? [],
  });

  const row = db
    .insert(tasks)
    .values({
      ...input,
      raw_input: input.raw_input ?? input.title,
      id: uuidv7(),
      status: input.status ?? 'active',
      context_tags: input.context_tags ?? [],
      attachments,
      times_deferred: 0,
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();

  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  void syncEntity('task', row.id);
  return row;
}

export function updateTask(id: string, input: UpdateTaskInput): TaskRecord | null {
  const db = getDb();

  const existing = db.select().from(tasks).where(eq(tasks.id, id)).get();
  if (!existing) return null;

  // Re-derive the manifest if body or description changed, or if the client
  // explicitly sent new attachment metadata. Otherwise preserve what's on disk.
  const bodyChanged = Object.prototype.hasOwnProperty.call(input, 'body');
  const descriptionChanged = Object.prototype.hasOwnProperty.call(input, 'description');
  const attachmentsHint = input.attachments;
  const attachments =
    bodyChanged || descriptionChanged || attachmentsHint !== undefined
      ? deriveAttachments({
          body: taskAttachmentText(
            descriptionChanged ? input.description : existing.description,
            bodyChanged ? input.body : existing.body,
          ),
          prior: existing.attachments ?? [],
          newUploads: attachmentsHint ?? [],
        })
      : undefined;

  const row = db
    .update(tasks)
    .set({
      ...input,
      ...(attachments !== undefined ? { attachments } : {}),
      updated_at: new Date().toISOString(),
    })
    .where(eq(tasks.id, id))
    .returning()
    .get();

  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  void syncEntity('task', row.id);
  return row;
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes === 0) return false;
  deleteEmbedding('task', id);
  void syncDeletion('task', id);
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

    void syncEntity('task', updated.id);
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

    void syncEntity('task', updated.id);
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

  const attachments = deriveAttachments({
    body: input.body ?? '',
    prior: [],
    newUploads: input.attachments ?? [],
  });

  const row = db
    .insert(notes)
    .values({
      ...input,
      id: uuidv7(),
      status: input.status ?? 'active',
      context_tags: input.context_tags ?? [],
      attachments,
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();

  void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
  void syncEntity('note', row.id);
  return row;
}

export function updateNote(id: string, input: UpdateNoteInput): NoteRecord | null {
  const db = getDb();

  const existing = db.select().from(notes).where(eq(notes.id, id)).get();
  if (!existing) return null;

  const bodyChanged = Object.prototype.hasOwnProperty.call(input, 'body');
  const attachmentsHint = input.attachments;
  const attachments =
    bodyChanged || attachmentsHint !== undefined
      ? deriveAttachments({
          body: bodyChanged ? input.body ?? '' : existing.body,
          prior: existing.attachments ?? [],
          newUploads: attachmentsHint ?? [],
        })
      : undefined;

  const row = db
    .update(notes)
    .set({
      ...input,
      ...(attachments !== undefined ? { attachments } : {}),
      updated_at: new Date().toISOString(),
    })
    .where(eq(notes.id, id))
    .returning()
    .get();

  void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
  void syncEntity('note', row.id);
  return row;
}

export function deleteNote(id: string): boolean {
  const db = getDb();
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  if (result.changes === 0) return false;
  deleteEmbedding('note', id);
  void syncDeletion('note', id);
  return true;
}

// ─── Stream ───────────────────────────────────────────────────

/** Lookup an existing stream item by upstream id (e.g. Pocket recording.id).
 *  Used to dedupe at-least-once webhook redeliveries. */
export function findStreamByExternalId(
  external_source: string,
  external_id: string,
): StreamRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(stream)
    .where(and(eq(stream.external_source, external_source), eq(stream.external_id, external_id)))
    .limit(1)
    .get();
}

export function createStream(input: CreateStreamInput): StreamRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const attachments = deriveAttachments({
    body: input.raw_text ?? '',
    prior: [],
    newUploads: input.attachments ?? [],
  });

  const row = db
    .insert(stream)
    .values({
      ...input,
      id: uuidv7(),
      source: input.source ?? 'capture',
      status: input.status ?? 'pending',
      attachments,
      created_at: input.created_at ?? now,
    })
    .returning()
    .get();

  void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
  void syncEntity('stream', row.id);
  return row;
}

export function updateStream(id: string, input: UpdateStreamInput): StreamRecord | null {
  const db = getDb();

  const existing = db.select().from(stream).where(eq(stream.id, id)).get();
  if (!existing) return null;

  const bodyChanged = Object.prototype.hasOwnProperty.call(input, 'raw_text');
  const attachmentsHint = input.attachments;
  const attachments =
    bodyChanged || attachmentsHint !== undefined
      ? deriveAttachments({
          body: bodyChanged ? input.raw_text ?? '' : existing.raw_text,
          prior: existing.attachments ?? [],
          newUploads: attachmentsHint ?? [],
        })
      : undefined;

  const row = db
    .update(stream)
    .set({
      ...input,
      ...(attachments !== undefined ? { attachments } : {}),
    })
    .where(eq(stream.id, id))
    .returning()
    .get();

  void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
  void syncEntity('stream', row.id);
  return row;
}

export function dismissStream(id: string): StreamRecord | null {
  return updateStream(id, { status: 'dismissed', dismissed_by: 'user' });
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

  // Areas have no body — attachments are the cover image(s) the UI passes
  // directly. Any other attachments in the payload are accepted as-is.
  const row = db
    .insert(areas)
    .values({
      ...input,
      id: uuidv7(),
      status: input.status ?? 'active',
      attachments: input.attachments ?? [],
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();

  void syncEntity('area', row.id);
  return row;
}

export function updateArea(id: string, input: UpdateAreaInput): AreaRecord | null {
  const db = getDb();

  const existing = db.select().from(areas).where(eq(areas.id, id)).get();
  if (!existing) return null;

  const row = db
    .update(areas)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(areas.id, id))
    .returning()
    .get();

  if (row) void syncEntity('area', row.id);
  return row;
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

// ─── Workspaces ───────────────────────────────────────────────

/**
 * Derive a unique slug from `name`, appending `-2`, `-3`, ... until free.
 * Slug is used in branch names and worktree paths so we want it kebab-cased
 * and DB-unique. Empty input falls back to `workspace`.
 */
function deriveUniqueWorkspaceSlug(name: string): string {
  const db = getDb();
  const base = slugify(name) || 'workspace';
  let candidate = base;
  let suffix = 2;
  while (db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, candidate)).get()) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

/**
 * Workspaces with aggregated session counts. Single SQL avoids N+1 over the
 * left-nav render path. `needs_review_candidate_count` is the candidate set
 * before runtime streaming filtering — the client subtracts streaming
 * sessions to get the rendered count.
 */
export function listWorkspaces(filter: { status?: WorkspaceStatus } = {}): WorkspaceWithCounts[] {
  const db = getDb();
  const status = filter.status ?? 'active';

  const rows = db
    .select({
      ...getTableColumns(workspaces),
      session_count: sql<number>`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql.raw('"workspaces"."id"')} AND cs.status = 'active'
      )`.as('session_count'),
      needs_review_candidate_count: sql<number>`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql.raw('"workspaces"."id"')}
          AND cs.status = 'active'
          AND cs.last_outcome_event_at IS NOT NULL
          AND cs.last_outcome_event_at > COALESCE(cs.last_viewed_at, '1970-01-01')
      )`.as('needs_review_candidate_count'),
      active_session_count: sql<number>`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql.raw('"workspaces"."id"')} AND cs.status = 'active'
      )`.as('active_session_count'),
    })
    .from(workspaces)
    .where(eq(workspaces.status, status))
    .orderBy(asc(workspaces.position), asc(workspaces.created_at))
    .all();

  return rows;
}

export function getWorkspace(id: string): WorkspaceRecord | undefined {
  const db = getDb();
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get();
}

/**
 * Create a workspace. Caller is responsible for filesystem detection
 * (`is_git`, `base_branch`) — we don't shell out from the query layer.
 * If `slug` is omitted we derive a unique one from `name`.
 * `position` defaults to MAX(position)+1 so new workspaces appear at the end.
 */
export function createWorkspace(input: Omit<CreateWorkspaceInput, 'slug'> & { slug?: string }): WorkspaceRecord {
  const db = getDb();
  const now = new Date().toISOString();
  const slug = input.slug ?? deriveUniqueWorkspaceSlug(input.name);

  const maxPosition = db
    .select({ max: sql<number | null>`MAX(${workspaces.position})` })
    .from(workspaces)
    .get();
  const position = input.position ?? ((maxPosition?.max ?? -1) + 1);

  const row = db
    .insert(workspaces)
    .values({
      ...input,
      id: uuidv7(),
      slug,
      position,
      status: input.status ?? 'active',
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
  return row;
}

export function updateWorkspace(id: string, input: UpdateWorkspaceInput): WorkspaceRecord | null {
  const db = getDb();
  const row = db
    .update(workspaces)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(workspaces.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function archiveWorkspace(id: string): WorkspaceRecord | null {
  const now = new Date().toISOString();
  const db = getDb();
  const row = db
    .update(workspaces)
    .set({ status: 'archived', archived_at: now, updated_at: now })
    .where(eq(workspaces.id, id))
    .returning()
    .get();
  return row ?? null;
}

/**
 * Reorder by replaying the requested order — simple integer reassignment
 * is fine at this scale. Wrapped in a transaction so a partial write can't
 * leave the list with duplicate positions.
 */
export function reorderWorkspaces(orderedIds: string[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction((tx) => {
    orderedIds.forEach((id, index) => {
      tx.update(workspaces)
        .set({ position: index, updated_at: now })
        .where(eq(workspaces.id, id))
        .run();
    });
  });
}

// ─── Agents ───────────────────────────────────────────────────

export function getAgent(id: string): AgentRecord | undefined {
  const db = getDb();
  return db.select().from(agents).where(eq(agents.id, id)).get();
}

export function createAgent(input: CreateAgentInput): AgentRecord {
  const db = getDb();
  const row = db
    .insert(agents)
    .values({
      ...input,
      id: uuidv7(),
      status: input.status ?? 'active',
    })
    .returning()
    .get();
  return row;
}

/**
 * Find or create the default executor agent for a harness. Sessions point
 * at an agent_id; until per-workspace agents are a real product surface we
 * collapse all executor sessions onto a single shared agent per harness.
 */
export function getOrCreateDefaultExecutor(harness: string): AgentRecord {
  const db = getDb();
  const existing = db
    .select()
    .from(agents)
    .where(and(eq(agents.kind, 'executor'), eq(agents.harness, harness), eq(agents.status, 'active')))
    .orderBy(asc(agents.created_at))
    .limit(1)
    .get();
  if (existing) return existing;
  return createAgent({
    kind: 'executor',
    harness,
    name: harness === 'claude_code' ? 'Claude Code' : harness,
    config: {},
  });
}

// ─── Chat Sessions ────────────────────────────────────────────

export function listChatSessions(filter: {
  workspace_id?: string;
  status?: 'active' | 'archived';
  type?: 'orchestration' | 'content' | 'execution';
} = {}): ChatSessionRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.workspace_id) conditions.push(eq(chatSessions.workspace_id, filter.workspace_id));
  if (filter.status) conditions.push(eq(chatSessions.status, filter.status));
  if (filter.type) conditions.push(eq(chatSessions.type, filter.type));
  return db
    .select()
    .from(chatSessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at}) DESC`)
    .all();
}

export function getChatSession(id: string): ChatSessionRecord | undefined {
  const db = getDb();
  return db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
}

export function createChatSession(input: CreateChatSessionInput & { id?: string }): ChatSessionRecord {
  const db = getDb();
  const row = db
    .insert(chatSessions)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      status: input.status ?? 'active',
      refs: input.refs ?? {},
    })
    .returning()
    .get();
  return row;
}

export function updateChatSession(id: string, input: UpdateChatSessionInput): ChatSessionRecord | null {
  const db = getDb();
  const row = db
    .update(chatSessions)
    .set(input)
    .where(eq(chatSessions.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function archiveChatSession(id: string): ChatSessionRecord | null {
  return updateChatSession(id, { status: 'archived', archived_at: new Date().toISOString() });
}

/**
 * Create a new execution session in a workspace. Auto-resolves the default
 * executor agent (currently Claude Code) so callers don't have to pass an
 * agent_id. Worktree creation is deferred to the actual dispatch path —
 * this just lands the row so the rail surfaces it.
 *
 * Label is optional; null/empty means "derive from first message."
 */
export function createExecutionSession(args: {
  workspace_id: string;
  label?: string | null;
  harness?: string;
}): ChatSessionRecord {
  const agent = getOrCreateDefaultExecutor(args.harness ?? 'claude_code');
  return createChatSession({
    agent_id: agent.id,
    type: 'execution',
    workspace_id: args.workspace_id,
    label: args.label?.trim() || null,
    refs: {},
  });
}

/** Set last_viewed_at = now(). Opening the session is the read receipt. */
export function markSessionViewed(id: string): ChatSessionRecord | null {
  return updateChatSession(id, { last_viewed_at: new Date().toISOString() });
}

/** Advance the outcome timestamp. Called when an `agent`/`result` event lands. */
export function bumpSessionOutcome(id: string, at: string = new Date().toISOString()): void {
  const db = getDb();
  db.update(chatSessions)
    .set({ last_outcome_event_at: at })
    .where(eq(chatSessions.id, id))
    .run();
}

/**
 * Sessions where the user owes the agent attention. Streaming filtering is
 * the caller's job — we return candidates so the client can subtract any
 * sessions currently piping live stdio.
 */
export function listNeedsReviewSessionCandidates(): ChatSessionRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.status, 'active'),
        isNotNull(chatSessions.last_outcome_event_at),
        sql`${chatSessions.last_outcome_event_at} > COALESCE(${chatSessions.last_viewed_at}, '1970-01-01')`,
      ),
    )
    .orderBy(desc(chatSessions.last_outcome_event_at))
    .all();
}

// ─── Chat Events ──────────────────────────────────────────────

/**
 * Idempotent insert for CLI-backed events (executor sessions). Replays of
 * the same wire event produce the same row values; the partial unique
 * index turns retries into no-ops. Bumps the session's outcome timestamp
 * when the event is user-visible (agent text, result).
 *
 * Returns null when the row was a duplicate. Returns the row id otherwise.
 */
export function insertChatEvent(input: CreateChatEventInput): string | null {
  const db = getDb();
  const id = uuidv7();
  const result = db
    .insert(chatEvents)
    .values({ ...input, id })
    .onConflictDoNothing()
    .run();
  if (result.changes === 0) return null;

  if (OUTCOME_SOURCES.has(input.source as ChatEventSource)) {
    bumpSessionOutcome(input.session_id, input.created_at ?? new Date().toISOString());
  }
  return id;
}

export function listChatEvents(sessionId: string, opts: { limit?: number; offset?: number } = {}): ChatEventRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatEvents)
    .where(eq(chatEvents.session_id, sessionId))
    .orderBy(asc(chatEvents.created_at), asc(chatEvents.id))
    .limit(opts.limit ?? 1000)
    .offset(opts.offset ?? 0)
    .all();
}
