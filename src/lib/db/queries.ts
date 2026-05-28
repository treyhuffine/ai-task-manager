/**
 * Shared database query functions.
 * Used by both API route handlers and AI chat tools.
 */

import { getDb, getRawDb } from '@/lib/db';
import {
  tasks, notes, areas, stream, taskCompletions, decks, userState, apiKeys,
  workspaces, agents, executions, chatSessions, chatEvents, chatRefs,
} from '@/lib/db/schema';
import { eq, and, desc, asc, sql, gt, inArray, isNull, isNotNull, gte, lte, getTableColumns, type SQL } from 'drizzle-orm';
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
  ExecutionRecord, CreateExecutionInput, UpdateExecutionInput, ChatSessionWithExecution,
  ChatSessionRecord, CreateChatSessionInput, UpdateChatSessionInput,
  ChatEventRecord, CreateChatEventInput, ChatEventSource,
  ChatRefRecord, CreateChatRefInput, ChatRefEntityType,
} from '@/db/types';
import { listEntityMarkers } from '@/lib/entity-refs/parse-markers';
import { OUTCOME_SOURCES } from '@/db/types';
import { generateToken, type GeneratedToken } from '@/lib/auth/tokens';
import { deriveAttachments } from '@/lib/attachments/derive';
import { publishChatEvent } from '@/lib/realtime/bus';
import { detectPortless, derivePortlessHostname, findRoute } from '@/lib/preview/portless';

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
  if (filter.workspace_id) conditions.push(eq(tasks.workspace_id, filter.workspace_id));
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
  if (filter.workspace_id) conditions.push(eq(notes.workspace_id, filter.workspace_id));
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

/**
 * Resolve the effective preview mode for a workspace.
 *
 *   1. Explicit `preview_mode` wins (user pinned a mode).
 *   2. If unset, prefer 'portless' when the daemon is running AND a route
 *      already exists for the workspace's derived hostname.
 *   3. Otherwise fall back to 'command'.
 *
 * Pure function — does no DB writes. The Portless detection is cached
 * inside the portless module, so calling this on every request is cheap.
 *
 * try/catch wraps the Portless lookups so that if the portless module
 * fails to load for any reason (e.g. permissions on `~/.portless`),
 * we degrade safely to command mode rather than 500ing the proxy.
 */
export function resolveWorkspacePreviewMode(
  ws: Pick<WorkspaceRecord, 'preview_mode' | 'portless_hostname' | 'slug'>,
): 'command' | 'portless' {
  if (ws.preview_mode === 'command' || ws.preview_mode === 'portless') {
    return ws.preview_mode;
  }
  try {
    if (!detectPortless().proxyRunning) return 'command';
    const hostname = ws.portless_hostname?.trim() ||
      derivePortlessHostname({ slug: ws.slug });
    return findRoute(hostname) ? 'portless' : 'command';
  } catch {
    return 'command';
  }
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

// ─── Executions ───────────────────────────────────────────────
// A durable work artifact (worktree + branch + PR + takeover state)
// anchored to a workspace. Chats point at it via execution_id. The
// git/worktree/PR/takeover columns were lifted off chat_sessions; reads
// flow through `getChatSessionWithExecution` (flattened) and writes go
// through the named helpers below. See docs/executions-spec.md.

export function getExecution(id: string): ExecutionRecord | undefined {
  const db = getDb();
  return db.select().from(executions).where(eq(executions.id, id)).get();
}

export function createExecution(input: CreateExecutionInput): ExecutionRecord {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(executions)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      status: input.status ?? 'active',
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
    })
    .returning()
    .get();
}

/** Low-level execution patch. Always bumps updated_at. Prefer the named
 *  helpers below at call sites so the mutation intent is explicit. */
export function updateExecution(id: string, input: UpdateExecutionInput): ExecutionRecord | null {
  const db = getDb();
  const row = db
    .update(executions)
    .set({ ...input, updated_at: new Date().toISOString() })
    .where(eq(executions.id, id))
    .returning()
    .get();
  return row ?? null;
}

// ── Setup / provisioning ──────────────────────────────────────

/** Mark the start of a worktree-provisioning attempt. Clears any prior
 *  setup_error so a retry flips the UI out of the failed chip immediately;
 *  the per-attempt timer (setup_started_at) re-anchors to now. */
export function markExecutionSetupStarted(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, {
    setup_started_at: new Date().toISOString(),
    setup_error: null,
  });
}

/** Record a successful worktree provision. */
export function markExecutionSetupComplete(
  executionId: string,
  params: { worktree_path: string; branch_name: string; base_sha: string },
): ExecutionRecord | null {
  return updateExecution(executionId, {
    worktree_path: params.worktree_path,
    branch_name: params.branch_name,
    base_sha: params.base_sha,
    setup_error: null,
  });
}

export function recordExecutionSetupError(executionId: string, error: string): ExecutionRecord | null {
  return updateExecution(executionId, { setup_error: error });
}

export function clearExecutionSetupError(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, { setup_error: null });
}

// ── PR linkage ────────────────────────────────────────────────

export function setExecutionPR(executionId: string, prNumber: number | null): ExecutionRecord | null {
  return updateExecution(executionId, { pr_number: prNumber });
}

// ── Takeover lifecycle (all five columns move together) ───────

export function startExecutionTakeover(
  executionId: string,
  params: { token: string; branch: string; base_sha: string; expires_at: string },
): ExecutionRecord | null {
  return updateExecution(executionId, {
    takeover_started_at: new Date().toISOString(),
    takeover_base_sha: params.base_sha,
    takeover_branch: params.branch,
    takeover_token: params.token,
    takeover_token_expires_at: params.expires_at,
  });
}

export function clearExecutionTakeover(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, {
    takeover_started_at: null,
    takeover_base_sha: null,
    takeover_branch: null,
    takeover_token: null,
    takeover_token_expires_at: null,
  });
}

/**
 * Token-based lookup for the takeover CLI/browser flow. The token lives
 * on the execution now; we return the execution's primary chat (most
 * recently active, non-archived) flattened with execution state so the
 * resume/cancel routes can dispatch a handoff message into it. Returns
 * undefined when the token is unknown or already cleared. Expiry is
 * enforced at the route layer so callers can distinguish "expired" from
 * "not found."
 */
export function findChatSessionByTakeoverToken(token: string): ChatSessionWithExecution | undefined {
  const db = getDb();
  const exec = db.select().from(executions).where(eq(executions.takeover_token, token)).get();
  if (!exec) return undefined;
  // V1 invariant: an execution has exactly one chat, so "most-recently-active"
  // IS the chat that initiated the takeover. When multi-chat-per-execution
  // lands (deferred, spec §9), the takeover should record which chat started
  // it (e.g. a takeover_chat_session_id on executions) so the resume handoff
  // lands in the right chat rather than whichever sorted first here.
  const chat = db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.execution_id, exec.id), eq(chatSessions.status, 'active')))
    .orderBy(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at}) DESC`)
    .get();
  if (!chat) return undefined;
  return flattenSessionExecution({ ...chat, execution: exec });
}

/**
 * Executions whose worktree provisioning began but never completed and
 * never failed cleanly — silent hangs the cold-start reaper marks with a
 * synthetic setup_error so the UI surfaces them as retryable. Mirrors the
 * old `listStuckBootstrapSessions`, but the provisioning state lives on
 * the execution now.
 */
export function listStuckBootstrapExecutions(maxAgeMinutes = 5): ExecutionRecord[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000).toISOString();
  return db
    .select()
    .from(executions)
    .where(
      and(
        eq(executions.status, 'active'),
        isNotNull(executions.setup_started_at),
        isNull(executions.worktree_path),
        isNull(executions.setup_error),
        lte(executions.setup_started_at, cutoff),
      ),
    )
    .all();
}

// ── Archive / unarchive ───────────────────────────────────────

/**
 * Archive an execution and cascade to its chats. Product code never
 * hard-deletes — this flips status='archived' (+ archived_at) on the
 * execution and every still-active chat that belongs to it, in one
 * transaction. The worktree teardown is the caller's responsibility
 * (filesystem op lives in `archiveExecutionSession`).
 */
export function archiveExecution(executionId: string): ExecutionRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const row = tx
      .update(executions)
      .set({ status: 'archived', archived_at: now, updated_at: now })
      .where(eq(executions.id, executionId))
      .returning()
      .get();
    if (!row) return null;
    tx.update(chatSessions)
      .set({ status: 'archived', archived_at: now })
      .where(and(eq(chatSessions.execution_id, executionId), eq(chatSessions.status, 'active')))
      .run();
    return row;
  });
}

/** Reactivate an archived execution. Does not touch its chats — they stay
 *  archived unless explicitly reopened (rare; v1 has no UI for it). */
export function unarchiveExecution(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, { status: 'active', archived_at: null });
}

// ── Read bridge (chat_session flattened with execution state) ──

/**
 * Normalize a chat row left-joined to executions into the flattened
 * `ChatSessionWithExecution` shape: the execution's durable git/worktree/
 * PR/takeover state hoisted to the top level under the field names the
 * columns used to have on chat_sessions. The execution is the sole source
 * of truth. Drizzle returns an all-null object (not null) for an unmatched
 * left join, so we coalesce on the execution's id to decide whether it's
 * real; a chat with no execution (orchestration/content) reports null.
 *
 * Generic over the row type so list queries (rail/history) keep their
 * extra joined columns.
 */
function flattenSessionExecution<T extends ChatSessionRecord>(
  row: T & { execution: ExecutionRecord | null },
): T & ChatSessionWithExecution {
  const e = row.execution && row.execution.id != null ? row.execution : null;
  return {
    ...row,
    execution: e,
    worktree_path: e?.worktree_path ?? null,
    branch_name: e?.branch_name ?? null,
    base_sha: e?.base_sha ?? null,
    pr_number: e?.pr_number ?? null,
    setup_error: e?.setup_error ?? null,
    setup_started_at: e?.setup_started_at ?? null,
    takeover_started_at: e?.takeover_started_at ?? null,
    takeover_base_sha: e?.takeover_base_sha ?? null,
    takeover_branch: e?.takeover_branch ?? null,
    takeover_token: e?.takeover_token ?? null,
    takeover_token_expires_at: e?.takeover_token_expires_at ?? null,
  } as T & ChatSessionWithExecution;
}

/**
 * Single chat session with its execution's git/worktree/PR/takeover state
 * flattened on top. Drop-in replacement for `getChatSession` at every
 * call site that reads worktree_path / branch_name / base_sha / pr_number
 * / setup_* / takeover_*. Returns null for unknown ids. Synchronous, like
 * the rest of this layer.
 */
export function getChatSessionWithExecution(id: string): ChatSessionWithExecution | null {
  const db = getDb();
  const row = db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
    })
    .from(chatSessions)
    .leftJoin(executions, eq(chatSessions.execution_id, executions.id))
    .where(eq(chatSessions.id, id))
    .get();
  if (!row) return null;
  return flattenSessionExecution(row as ChatSessionRecord & { execution: ExecutionRecord | null });
}

// ─── Chat Sessions ────────────────────────────────────────────

export function listChatSessions(filter: {
  workspace_id?: string;
  status?: 'active' | 'archived';
  type?: 'orchestration' | 'content' | 'execution';
} = {}): ChatSessionWithExecution[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.workspace_id) conditions.push(eq(chatSessions.workspace_id, filter.workspace_id));
  if (filter.status) conditions.push(eq(chatSessions.status, filter.status));
  if (filter.type) conditions.push(eq(chatSessions.type, filter.type));
  // LEFT JOIN + flatten so consumers (workspace session rows, the
  // orchestrator's list_workspace_sessions) see worktree/branch/PR/setup
  // state sourced from the execution, not the dead chat_sessions columns.
  const rows = db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
    })
    .from(chatSessions)
    .leftJoin(executions, eq(chatSessions.execution_id, executions.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at}) DESC`)
    .all();
  return rows.map((r) => flattenSessionExecution(r as ChatSessionRecord & { execution: ExecutionRecord | null }));
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

// Takeover lifecycle moved to the execution: see `startExecutionTakeover`,
// `clearExecutionTakeover`, and `findChatSessionByTakeoverToken` in the
// Executions section above. The token + branch + base_sha now live on the
// `executions` row, not chat_sessions.

/**
 * Atomically create an execution artifact and its first chat (the chat
 * points at the execution via execution_id). This is the single creation
 * chokepoint for execution chats — both the user-facing dispatch path and
 * the dev scratch route go through it — so the §2.2 invariant ("active
 * execution chats have execution_id NOT NULL") can never be violated by a
 * crash between two inserts.
 *
 * Initial execution state is optional: live-mode dispatches pass the
 * already-known worktree_path/branch_name/base_sha; git dispatches pass
 * `setup_started_at` and leave the worktree fields null for the background
 * provisioner to fill via `markExecutionSetupComplete`.
 */
export function createExecutionWithChat(params: {
  workspaceId: string;
  agentId: string;
  chatSessionId?: string;
  label: string | null;
  worktree_path?: string | null;
  branch_name?: string | null;
  base_sha?: string | null;
  pr_number?: number | null;
  setup_started_at?: string | null;
}): { execution: ExecutionRecord; session: ChatSessionRecord } {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const executionId = uuidv7();
    const execution = tx
      .insert(executions)
      .values({
        id: executionId,
        workspace_id: params.workspaceId,
        label: params.label,
        worktree_path: params.worktree_path ?? null,
        branch_name: params.branch_name ?? null,
        base_sha: params.base_sha ?? null,
        pr_number: params.pr_number ?? null,
        setup_started_at: params.setup_started_at ?? null,
        status: 'active',
        created_at: now,
        updated_at: now,
      })
      .returning()
      .get();
    const session = tx
      .insert(chatSessions)
      .values({
        id: params.chatSessionId ?? uuidv7(),
        agent_id: params.agentId,
        type: 'execution',
        workspace_id: params.workspaceId,
        execution_id: executionId,
        label: params.label,
        status: 'active',
      })
      .returning()
      .get();
    return { execution, session };
  });
}

/**
 * Create a new execution session in a workspace. Auto-resolves the default
 * executor agent (currently Claude Code) so callers don't have to pass an
 * agent_id.
 *
 * Creates the execution artifact eagerly, in the same transaction as the
 * chat, so the chat always has an `execution_id` (docs/executions-spec.md
 * §5: "created eagerly when a chat opens; worktree provisioned lazily at
 * first dispatch"). Worktree creation is deferred to the dispatch path —
 * the execution lands with null worktree fields and the rail surfaces a
 * "not started" state until provisioning runs.
 *
 * Label is optional; null/empty means "derive from first message." It's
 * copied to both the execution (for the artifact) and the chat.
 */
export function createExecutionSession(args: {
  workspace_id: string;
  label?: string | null;
  harness?: string;
}): ChatSessionRecord {
  const agent = getOrCreateDefaultExecutor(args.harness ?? 'claude_code');
  const { session } = createExecutionWithChat({
    workspaceId: args.workspace_id,
    agentId: agent.id,
    label: args.label?.trim() || null,
  });
  return session;
}

/**
 * Set last_viewed_at = now() and clear unread_marker_at. Used to be fired
 * on session open ("opening = read receipt"); now triggered on actual
 * interaction (textarea focus, send, explicit Mark read). Kept as a named
 * alias so older callers compile until they migrate.
 */
export function markSessionViewed(id: string): ChatSessionRecord | null {
  return markSessionRead(id);
}

/**
 * Marks the session as read by the user. Updates last_viewed_at to now
 * and clears any "Mark as unread" override the user previously toggled.
 */
export function markSessionRead(id: string): ChatSessionRecord | null {
  return updateChatSession(id, {
    last_viewed_at: new Date().toISOString(),
    unread_marker_at: null,
  });
}

/**
 * Force the session into the Unread bucket even when no new agent output
 * has landed. Sets unread_marker_at = now() so the read derivation
 * (`max(last_outcome, unread_marker) > last_viewed`) classifies the session
 * as unread on the next rail render.
 */
export function markSessionUnread(id: string): ChatSessionRecord | null {
  return updateChatSession(id, { unread_marker_at: new Date().toISOString() });
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
 * Sessions whose on-disk Claude transcript should be checked for drift.
 * Non-archived, with an `external_session_id` (set on first system event,
 * so a session that's never dispatched is excluded). The reconcile sweep
 * iterates this — order doesn't matter, so we lean on the
 * last-outcome-first ordering since "active recently" is also the most
 * interesting set to check first.
 */
export function listReconcilableSessions(): ChatSessionRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.status, 'active'),
        isNotNull(chatSessions.external_session_id),
      ),
    )
    .orderBy(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at}) DESC`)
    .all();
}

// Stuck-bootstrap detection moved to the execution: see
// `listStuckBootstrapExecutions` in the Executions section above. The
// provisioning state (setup_started_at / worktree_path / setup_error) now
// lives on the `executions` row.

/**
 * Sessions where the user owes the agent attention. Streaming filtering is
 * the caller's job — we return candidates so the client can subtract any
 * sessions currently piping live stdio.
 *
 * "Unread" derivation: the most recent of (last_outcome_event_at,
 * unread_marker_at) is newer than the user's last interaction
 * (last_viewed_at). unread_marker_at lets the user force a session into
 * Unread without an outcome event (the "Mark as unread" affordance).
 */
export function listNeedsReviewSessionCandidates(): ChatSessionWithExecution[] {
  const db = getDb();
  const rows = db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
    })
    .from(chatSessions)
    .leftJoin(executions, eq(chatSessions.execution_id, executions.id))
    .where(
      and(
        eq(chatSessions.status, 'active'),
        sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.unread_marker_at}) IS NOT NULL`,
        sql`COALESCE(
          MAX(
            COALESCE(${chatSessions.last_outcome_event_at}, '1970-01-01'),
            COALESCE(${chatSessions.unread_marker_at}, '1970-01-01')
          ),
          '1970-01-01'
        ) > COALESCE(${chatSessions.last_viewed_at}, '1970-01-01')`,
      ),
    )
    .orderBy(sql`COALESCE(
      MAX(
        COALESCE(${chatSessions.last_outcome_event_at}, '1970-01-01'),
        COALESCE(${chatSessions.unread_marker_at}, '1970-01-01')
      ),
      '1970-01-01'
    ) DESC`)
    .all();
  return rows.map(
    (r) => flattenSessionExecution(r as ChatSessionRecord & { execution: ExecutionRecord | null }),
  );
}

// ─── Rail (status view) ────────────────────────────────────────
//
// One join of chat_sessions × workspaces for the left-rail "by status"
// view. Each row carries enough workspace metadata (name, emoji, icon
// image, area_id) for the row renderer to draw without a second fetch.
// Bucket classification (Needs Approval / Working / Unread / Waiting
// Response) is done client-side from this list plus the live
// pendingInput + streaming sets.

export interface RailSessionRow extends ChatSessionWithExecution {
  workspace_name: string | null;
  workspace_emoji: string | null;
  workspace_attachments: Attachment[] | null;
  workspace_area_id: string | null;
  workspace_is_git: boolean | null;
}

/**
 * The "by status" rail is a list of active **executions** (the durable work
 * artifacts), not chats. We iterate `executions` and attach each one's
 * *primary chat* — the most-recently-active, non-archived chat — for the
 * conversation handle the rest of the app still addresses by: the row's
 * `id` is that chat's id (navigation into the execution view, executor
 * running/pending correlation, mark-read all key off chat_session_id), and
 * the bucket classification reads the chat's outcome/viewed timestamps.
 *
 * V1 is 1:1 (one chat per execution), so "primary chat" is simply the one
 * chat. When multi-chat-per-execution lands (spec §7), this is where the
 * per-execution state rollup goes — the structure (one row per execution)
 * is already correct.
 */
export function listRailSessions(): RailSessionRow[] {
  const db = getDb();
  const rows = db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
      workspace_name: workspaces.name,
      workspace_emoji: workspaces.emoji,
      workspace_attachments: workspaces.attachments,
      workspace_area_id: workspaces.area_id,
      workspace_is_git: workspaces.is_git,
    })
    .from(executions)
    // INNER JOIN — the rail mirrors the workspace tree, which only shows
    // active workspaces, so executions in an archived workspace are hidden
    // here too (keeps bucket counts consistent with the tree).
    .innerJoin(
      workspaces,
      and(eq(workspaces.id, executions.workspace_id), eq(workspaces.status, 'active')),
    )
    // Attach the execution's primary chat (most-recently-active, non-archived)
    // via a correlated subquery. INNER JOIN so an execution with no active
    // chat drops out (nothing to open) — can't happen in v1's 1:1 model.
    .innerJoin(
      chatSessions,
      sql`${chatSessions.id} = (
        SELECT cs2.id FROM chat_sessions cs2
        WHERE cs2.execution_id = ${executions.id} AND cs2.status = 'active'
        ORDER BY COALESCE(cs2.last_outcome_event_at, cs2.started_at) DESC
        LIMIT 1
      )`,
    )
    .where(eq(executions.status, 'active'))
    .orderBy(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at}) DESC`)
    .all();
  return rows.map(
    (r) => flattenSessionExecution(r as ChatSessionRecord & { execution: ExecutionRecord | null }) as RailSessionRow,
  );
}

/**
 * History feed: every execution session, regardless of `status` (active
 * AND archived) or its workspace's archive state. The history rail tab
 * is a chronological log; an archived workspace shouldn't make its
 * past sessions disappear, which is the opposite policy from
 * `listRailSessions`. Capped at `limit` (default 200) so the rail
 * doesn't load thousands of rows.
 */
export function listHistorySessions(opts: { limit?: number } = {}): RailSessionRow[] {
  const db = getDb();
  const limit = opts.limit ?? 200;
  const rows = db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
      workspace_name: workspaces.name,
      workspace_emoji: workspaces.emoji,
      workspace_attachments: workspaces.attachments,
      workspace_area_id: workspaces.area_id,
      workspace_is_git: workspaces.is_git,
    })
    .from(chatSessions)
    // LEFT JOIN so sessions whose workspace was deleted still render —
    // history is allowed to outlive its workspace. The renderer treats
    // null workspace_name as "(workspace removed)".
    .leftJoin(workspaces, eq(workspaces.id, chatSessions.workspace_id))
    .leftJoin(executions, eq(chatSessions.execution_id, executions.id))
    .where(eq(chatSessions.type, 'execution'))
    .orderBy(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at}) DESC`)
    .limit(limit)
    .all();
  return rows.map(
    (r) => flattenSessionExecution(r as ChatSessionRecord & { execution: ExecutionRecord | null }) as RailSessionRow,
  );
}

// ─── Chat Events ──────────────────────────────────────────────

/**
 * Single chokepoint for `chat_events` inserts. Every write path —
 * executor live stream, JSONL reconcile, user-message POST, inject
 * dev route, MCP/orchestrator handlers — goes through here so the
 * realtime broadcast and outcome-timestamp bump are guaranteed.
 *
 * Idempotent for CLI-backed events: replays of the same wire event
 * produce the same `external_event_id`, and the partial unique index
 * turns retries into no-ops. Rows without an `external_event_id`
 * (in-app user messages) aren't covered by the index and always insert.
 *
 * Returns the inserted row on success, or `null` when the insert was
 * a no-op due to the unique constraint. Callers that only need the id
 * can read `.id` off the row.
 */
export function insertChatEvent(input: CreateChatEventInput): ChatEventRecord | null {
  const db = getDb();
  // Caller-supplied id wins; mint a UUIDv7 otherwise. Letting callers
  // pass an id lets the user-message write path use the *same* id the
  // client minted for its optimistic placeholder, so the optimistic
  // row and the persisted row share React keys and there's no
  // unmount/remount when the POST resolves.
  const id = input.id ?? uuidv7();
  // `.returning().all()` gives us the row that was actually written (or
  // an empty array on conflict). Cheaper than a follow-up SELECT and
  // ensures the broadcast carries the canonical row, not a synthesized
  // one — important because the DB may have filled defaults.
  const rows = db
    .insert(chatEvents)
    .values({ ...input, id })
    .onConflictDoNothing()
    .returning()
    .all();
  if (rows.length === 0) return null;
  const row = rows[0]!;

  if (OUTCOME_SOURCES.has(input.source as ChatEventSource)) {
    bumpSessionOutcome(input.session_id, input.created_at ?? new Date().toISOString());
  }

  publishChatEvent(row);
  return row;
}

/**
 * Returns chat events in chronological order. When a session has more
 * events than `limit`, the OLDEST get cut off, not the newest — older
 * history can be re-fetched on demand later via paging, but losing
 * the latest content makes the chat look broken (the transcript on
 * disk and chat_events stay in sync; only the GET response is
 * truncated). The internal fetch goes DESC + limit to grab the tail,
 * then reverses the page so the wire shape stays ASC for callers.
 */
export function listChatEvents(sessionId: string, opts: { limit?: number; offset?: number } = {}): ChatEventRecord[] {
  const db = getDb();
  const limit = opts.limit ?? 10_000;
  const offset = opts.offset ?? 0;
  const tail = db
    .select()
    .from(chatEvents)
    .where(eq(chatEvents.session_id, sessionId))
    .orderBy(desc(chatEvents.created_at), desc(chatEvents.id))
    .limit(limit)
    .offset(offset)
    .all();
  return tail.reverse();
}

/**
 * Single chat_event by primary key. Used by the per-send retry path —
 * when a client-minted `id` PK-conflicts on insert, the route returns
 * the existing row instead of 500ing, making the HTTP semantics match
 * the DB's idempotent `onConflictDoNothing`.
 */
export function getChatEventById(id: string): ChatEventRecord | null {
  const db = getDb();
  const rows = db.select().from(chatEvents).where(eq(chatEvents.id, id)).limit(1).all();
  return rows[0] ?? null;
}

/**
 * Most recent events for a session, newest first. Used by the health
 * checker to classify session liveness without pulling the entire
 * transcript — sessions can have thousands of events.
 */
export function listRecentChatEvents(sessionId: string, limit = 30): ChatEventRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatEvents)
    .where(eq(chatEvents.session_id, sessionId))
    .orderBy(desc(chatEvents.created_at), desc(chatEvents.id))
    .limit(limit)
    .all();
}

/**
 * Events newer than `afterId` for a session, ordered chronologically.
 * Used by the per-session SSE endpoint to replay missed events when an
 * EventSource reconnects with a `Last-Event-ID` header. UUIDv7 ids are
 * monotonic-by-creation-time per process, so an id-comparison is a
 * cheap, correct cursor without a separate sequence column.
 */
export function listChatEventsAfter(sessionId: string, afterId: string, limit = 1000): ChatEventRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatEvents)
    .where(and(eq(chatEvents.session_id, sessionId), gt(chatEvents.id, afterId)))
    .orderBy(asc(chatEvents.created_at), asc(chatEvents.id))
    .limit(limit)
    .all();
}

/**
 * Sessions currently stuck on a given chat_event source (typically
 * `auth_required`), enriched with the most recent user-message text so
 * the floating "Resume sessions" card can render a preview and resend
 * action per row.
 *
 * Single round-trip: window function picks each session's latest event
 * (drives the filter) and joins to that session's most-recent user event
 * (drives the preview). Non-archived sessions only — archived ones don't
 * need a "resume" prompt.
 */
export interface StuckSessionRow {
  session_id: string;
  label: string | null;
  last_user_event_id: string | null;
  last_user_content: string | null;
  last_user_attachments: string | null;
}

export function listSessionsStuckOnSource(source: ChatEventSource): StuckSessionRow[] {
  const db = getRawDb();
  return db
    .prepare(
      `WITH ranked_events AS (
         SELECT session_id, source, id, content, attachments, created_at,
           ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC, id DESC) AS rn_any,
           ROW_NUMBER() OVER (
             PARTITION BY session_id, CASE WHEN source = 'user' THEN 1 ELSE 0 END
             ORDER BY created_at DESC, id DESC
           ) AS rn_in_source
         FROM chat_events
       ),
       latest AS (
         SELECT session_id FROM ranked_events WHERE rn_any = 1 AND source = ?
       ),
       last_user AS (
         SELECT session_id, id AS event_id, content, attachments
         FROM ranked_events
         WHERE source = 'user' AND rn_in_source = 1
       )
       SELECT
         l.session_id AS session_id,
         s.label AS label,
         lu.event_id AS last_user_event_id,
         lu.content AS last_user_content,
         lu.attachments AS last_user_attachments
       FROM latest l
       JOIN chat_sessions s ON s.id = l.session_id
       LEFT JOIN last_user lu ON lu.session_id = l.session_id
       WHERE s.status = 'active'
       ORDER BY s.last_outcome_event_at DESC, s.started_at DESC`,
    )
    .all(source) as StuckSessionRow[];
}

/**
 * Wipe every chat_event row for a session. Used by the dev-page reset
 * button to start a fresh transcript. Also clears the session's
 * outcome timestamp so the rail's needs-review marker doesn't linger
 * past the wipe.
 */
export function deleteAllChatEvents(sessionId: string): number {
  const db = getDb();
  const result = db.delete(chatEvents).where(eq(chatEvents.session_id, sessionId)).run();
  db.update(chatSessions)
    .set({ last_outcome_event_at: null, last_viewed_at: null })
    .where(eq(chatSessions.id, sessionId))
    .run();
  return result.changes;
}

// ─── Chat Refs ────────────────────────────────────────────────
// Materialized M:N references between chat sessions / events and
// entities (tasks, notes, areas, files, the session's own scratchpad).
// Two layers in one table — see schema.ts. `event_id IS NULL` = pin;
// set = per-message mention. The partial unique on (session_id,
// entity_type, entity_id) only fires for pins, so mentions can repeat.

/**
 * Insert a chat_refs row. For pins, returns the existing row on
 * conflict (idempotent re-pinning). For mentions, always inserts.
 */
export function createChatRef(input: CreateChatRefInput): ChatRefRecord {
  const db = getDb();
  const inserted = db
    .insert(chatRefs)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      created_at: input.created_at ?? new Date().toISOString(),
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (inserted) return inserted;
  // Partial-unique conflict — must have been a pin re-insert. Fetch.
  const existing = db
    .select()
    .from(chatRefs)
    .where(
      and(
        eq(chatRefs.session_id, input.session_id),
        eq(chatRefs.entity_type, input.entity_type),
        eq(chatRefs.entity_id, input.entity_id),
        isNull(chatRefs.event_id),
      ),
    )
    .get();
  if (!existing) {
    throw new Error('createChatRef: insert conflict but no matching row found');
  }
  return existing;
}

/** All refs for a session — pins (event_id null) + mentions. */
export function listSessionRefs(
  sessionId: string,
  opts?: { pinnedOnly?: boolean; mentionsOnly?: boolean },
): ChatRefRecord[] {
  const db = getDb();
  const conditions: SQL[] = [eq(chatRefs.session_id, sessionId)];
  if (opts?.pinnedOnly) conditions.push(isNull(chatRefs.event_id));
  if (opts?.mentionsOnly) conditions.push(isNotNull(chatRefs.event_id));
  return db
    .select()
    .from(chatRefs)
    .where(and(...conditions))
    .orderBy(asc(chatRefs.position), asc(chatRefs.created_at))
    .all();
}

/** All refs bound to a specific chat_events row. */
export function listEventRefs(eventId: string): ChatRefRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatRefs)
    .where(eq(chatRefs.event_id, eventId))
    .orderBy(asc(chatRefs.position))
    .all();
}

/** Reverse lookup: every ref pointing at a given entity. */
export function listEntityRefs(
  entityType: ChatRefEntityType,
  entityId: string,
): ChatRefRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatRefs)
    .where(and(eq(chatRefs.entity_type, entityType), eq(chatRefs.entity_id, entityId)))
    .orderBy(desc(chatRefs.created_at))
    .all();
}

/** Sessions that reference an entity, deduped — for the "🔗 N sessions" UI. */
export function listSessionsReferencingEntity(
  entityType: ChatRefEntityType,
  entityId: string,
): ChatSessionRecord[] {
  const db = getDb();
  const seen = new Set<string>();
  const rows = db
    .select({ session: getTableColumns(chatSessions) })
    .from(chatRefs)
    .innerJoin(chatSessions, eq(chatRefs.session_id, chatSessions.id))
    .where(
      and(eq(chatRefs.entity_type, entityType), eq(chatRefs.entity_id, entityId)),
    )
    .orderBy(
      desc(sql`COALESCE(${chatSessions.last_outcome_event_at}, ${chatSessions.started_at})`),
    )
    .all();
  const out: ChatSessionRecord[] = [];
  for (const r of rows) {
    if (seen.has(r.session.id)) continue;
    seen.add(r.session.id);
    out.push(r.session);
  }
  return out;
}

export function deleteChatRef(id: string): boolean {
  const db = getDb();
  const result = db.delete(chatRefs).where(eq(chatRefs.id, id)).run();
  return result.changes > 0;
}

/**
 * Drop every ref currently bound to a chat_events row. Used as the
 * idempotent prelude to `materializeEventRefs` so re-runs don't pile
 * up duplicate mention rows.
 */
export function deleteEventRefs(eventId: string): number {
  const db = getDb();
  const result = db.delete(chatRefs).where(eq(chatRefs.event_id, eventId)).run();
  return result.changes;
}

/**
 * Scan a `chat_events.content` string for `[[task:id]]` / `[[note:id]]`
 * / `[[scratchpad]]` markers and materialize one chat_refs row per
 * occurrence, all bound to `eventId`. File markers are tracked via
 * `chat_events.attachments` — not duplicated here. Idempotent: wipes
 * prior event refs before inserting.
 */
export function materializeEventRefs(
  eventId: string,
  sessionId: string,
  content: string,
  opts?: { createdBy?: 'user' | 'agent' },
): ChatRefRecord[] {
  deleteEventRefs(eventId);
  const markers = listEntityMarkers(content);
  const created: ChatRefRecord[] = [];
  const createdBy = opts?.createdBy ?? 'user';
  let position = 0;
  for (const m of markers) {
    if (m.kind === 'file') continue;
    const entity_id = m.kind === 'scratchpad' ? sessionId : m.id;
    if (!entity_id) continue;
    const row = createChatRef({
      session_id: sessionId,
      event_id: eventId,
      entity_type: m.kind,
      entity_id,
      position,
      created_by: createdBy,
    });
    created.push(row);
    position++;
  }
  return created;
}

/**
 * Pin a task/note/area/scratchpad to a session. Idempotent — re-pinning
 * the same entity returns the existing row. Files don't take this path;
 * they're attachment metadata, not session-level context.
 */
export function pinSessionRef(args: {
  sessionId: string;
  entityType: Exclude<ChatRefEntityType, 'file'>;
  entityId: string;
  position?: number;
  hydrate?: boolean;
  createdBy?: 'user' | 'agent';
}): ChatRefRecord {
  return createChatRef({
    session_id: args.sessionId,
    event_id: null,
    entity_type: args.entityType,
    entity_id: args.entityId,
    position: args.position ?? 0,
    hydrate: args.hydrate ?? true,
    created_by: args.createdBy ?? 'user',
  });
}

export function unpinSessionRef(args: {
  sessionId: string;
  entityType: Exclude<ChatRefEntityType, 'file'>;
  entityId: string;
}): boolean {
  const db = getDb();
  const result = db
    .delete(chatRefs)
    .where(
      and(
        eq(chatRefs.session_id, args.sessionId),
        eq(chatRefs.entity_type, args.entityType),
        eq(chatRefs.entity_id, args.entityId),
        isNull(chatRefs.event_id),
      ),
    )
    .run();
  return result.changes > 0;
}

/**
 * Update the session's scratch pad. Null clears it. Returns the updated
 * session row. The chat_refs side is unchanged — refs survive the
 * scratchpad text changing (the agent reads the latest body at
 * hydration time regardless).
 */
export function setSessionScratchPad(
  sessionId: string,
  scratchPad: string | null,
): ChatSessionRecord | null {
  return updateChatSession(sessionId, { scratch_pad: scratchPad });
}
