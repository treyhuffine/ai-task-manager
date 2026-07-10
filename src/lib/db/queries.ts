/**
 * Shared database query functions.
 * Used by both API route handlers and AI chat tools.
 */

import { getDb, getRawDb } from '@/lib/db';
import {
  tasks, notes, areas, stream, taskCompletions, decks, userState, apiKeys,
  workspaces, agents, executions, chatSessions, chatEvents, chatRefs,
  triggers, runs, previewTargets, entityVersions,
  notificationChannels, webPushSubscriptions, notificationDeliveries,
} from '@/lib/db/schema';
import { eq, and, or, desc, asc, sql, gt, lt, inArray, isNull, isNotNull, gte, lte, getTableColumns, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import slugify from '@sindresorhus/slugify';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';
import { syncEntity, syncDeletion } from '@/lib/export/mirror';
import type {
  TaskRecord, TaskListRecord, CreateTaskInput, UpdateTaskInput, TaskFilter,
  NoteRecord, CreateNoteInput, UpdateNoteInput, NoteFilter,
  AreaRecord, CreateAreaInput, UpdateAreaInput, AreaFilter,
  StreamRecord, CreateStreamInput, UpdateStreamInput,
  DeckRecord, CreateDeckInput, UpdateDeckInput,
  UpdateUserStateInput,
  ApiKeyRecord, CreateApiKeyInput, UpdateApiKeyInput,
  Attachment,
  WorkspaceRecord, CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceWithCounts, WorkspaceStatus, WorkspaceConnectorScope,
  AgentRecord, CreateAgentInput,
  ExecutionRecord, CreateExecutionInput, UpdateExecutionInput, ChatSessionWithExecution,
  PreviewTargetRecord, CreatePreviewTargetInput, UpdatePreviewTargetInput, PreviewUrl,
  ChatSessionRecord, CreateChatSessionInput, UpdateChatSessionInput,
  ChatEventRecord, CreateChatEventInput, ChatEventSource,
  ChatRefRecord, CreateChatRefInput, ChatRefEntityType,
  TriggerRecord, CreateTriggerInput, UpdateTriggerInput,
  RunRecord, CreateRunInput, UpdateRunInput, RunStatus, RunTrigger, TriggerWithLastRun,
  EntityVersionRecord, EntityVersionSnapshot, EntityVersionSource, EntityVersionEntityType,
  TaskStatus, NoteStatus, Energy, Effort,
  NotificationChannelRecord, CreateNotificationChannelInput, UpdateNotificationChannelInput,
  WebPushSubscriptionRecord, CreateWebPushSubscriptionInput,
  NotificationDeliveryRecord, CreateNotificationDeliveryInput, StoredRenderedNotification,
} from '@/db/types';
import { listEntityMarkers } from '@/lib/entity-refs/parse-markers';
import { CHAT_PAGE_SIZE } from '@/constants/chat';
import { OUTCOME_SOURCES } from '@/db/types';
import { generateToken, type GeneratedToken } from '@/lib/auth/tokens';
import { deriveAttachments } from '@/lib/attachments/derive';
import { publishChatEvent } from '@/lib/realtime/bus';
import { hydrateRow, dehydrateAttachments, withoutAttachments } from '@/lib/db/hydrate';
import { camelizeKeys } from '@/lib/case/keys';
import type { StoredAttachment } from '@/lib/db/schema';
import { explicitAgentSelection, providerIdForHarness } from '@/lib/agent-options';

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

  if (filter.areaId) conditions.push(eq(tasks.areaId, filter.areaId));
  if (filter.workspaceId) conditions.push(eq(tasks.workspaceId, filter.workspaceId));
  if (filter.parentId) conditions.push(eq(tasks.parentId, filter.parentId));
  if (filter.energy) conditions.push(eq(tasks.energy, filter.energy));
  if (filter.q) conditions.push(sql`${tasks.title} LIKE ${'%' + filter.q + '%'}`);

  const limit = filter.limit ?? 10000;
  const offset = filter.offset ?? 0;

  const orderClauses = (() => {
    switch (filter.orderBy) {
      case 'lastViewedAt': return [sql`${tasks.lastViewedAt} DESC NULLS LAST`, desc(tasks.createdAt)];
      case 'hardDeadline':  return [sql`${tasks.hardDeadline} ASC NULLS LAST`, desc(tasks.createdAt)];
      case 'createdAt':     return [desc(tasks.createdAt)];
      case 'updatedAt':     return [desc(tasks.updatedAt)];
      default:               return [sql`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt)];
    }
  })();

  const rows = db
    .select({
      ...getTableColumns(tasks),
      subtaskCount: sql<number>`(SELECT COUNT(*) FROM tasks t2 WHERE t2.parent_id = ${sql.raw('"tasks"."id"')})`.as('subtaskCount'),
      subtaskPreview: sql<string | null>`(SELECT GROUP_CONCAT(t3.title, '|||') FROM (SELECT title FROM tasks t3 WHERE t3.parent_id = ${sql.raw('"tasks"."id"')} LIMIT 4) t3)`.as('subtaskPreview'),
    })
    .from(tasks)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderClauses)
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map((r) => hydrateRow(r));
}

export function getTask(id: string): TaskRecord | undefined {
  const db = getDb();
  return hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
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

export function createTask(input: Omit<CreateTaskInput, 'rawInput'> & { rawInput?: string }): TaskRecord {
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

  const rest = withoutAttachments(input);
  const row = hydrateRow(db
    .insert(tasks)
    .values({
      ...rest,
      rawInput: input.rawInput ?? input.title,
      id: uuidv7(),
      status: input.status ?? 'active',
      contextTags: input.contextTags ?? [],
      attachments: dehydrateAttachments(attachments) ?? [],
      timesDeferred: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get());

  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  void syncEntity('task', row.id);
  return row;
}

export function updateTask(id: string, input: UpdateTaskInput, meta?: EntityVersionMeta): TaskRecord | null {
  const db = getDb();

  const existing = hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
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

  const rest = withoutAttachments(input);
  const row = hydrateRow(db
    .update(tasks)
    .set({
      ...rest,
      ...(attachments !== undefined ? { attachments: dehydrateAttachments(attachments) ?? [] } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tasks.id, id))
    .returning()
    .get());

  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  void syncEntity('task', row.id);
  captureEntityVersion('task', row.id, taskSnapshot(existing), taskSnapshot(row), meta, existing.updatedAt);
  return row;
}

export function deleteTask(id: string): boolean {
  const db = getDb();
  const result = db.delete(tasks).where(eq(tasks.id, id)).run();
  if (result.changes === 0) return false;
  deleteEmbedding('task', id);
  void syncDeletion('task', id);
  db.delete(entityVersions)
    .where(and(eq(entityVersions.entityType, 'task'), eq(entityVersions.entityId, id)))
    .run();
  return true;
}

export function completeTask(id: string, note?: string): { task: TaskRecord; recurring: boolean; nextRecurrenceAt?: string } | null {
  const db = getDb();

  const task = hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
  if (!task) return null;

  const now = new Date().toISOString();

  if (task.recurrence) {
    db.insert(taskCompletions).values({
      id: uuidv7(),
      taskId: id,
      completedAt: now,
      note: note ?? null,
    }).run();

    const nextDate = computeNextRecurrence(task.recurrence, now);

    const updated = hydrateRow(db
      .update(tasks)
      .set({ nextRecurrenceAt: nextDate, lastProgressAt: now, updatedAt: now })
      .where(eq(tasks.id, id))
      .returning()
      .get());

    void syncEntity('task', updated.id);
    return { task: updated, recurring: true, nextRecurrenceAt: nextDate };
  } else {
    const updated = hydrateRow(db
      .update(tasks)
      .set({ status: 'done', completedAt: now, updatedAt: now })
      .where(eq(tasks.id, id))
      .returning()
      .get());

    db.insert(taskCompletions).values({
      id: uuidv7(),
      taskId: id,
      completedAt: now,
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

  if (filter.areaId) conditions.push(eq(notes.areaId, filter.areaId));
  if (filter.workspaceId) conditions.push(eq(notes.workspaceId, filter.workspaceId));
  if (filter.taskId) conditions.push(eq(notes.taskId, filter.taskId));
  if (filter.status) conditions.push(eq(notes.status, filter.status));
  if (filter.decisionsOnly) {
    // Convention: agent-written decisions land as notes with a
    // 'Decision: ' title prefix. Surfaces the convention without a
    // schema column. See docs/async-agents-v1.md §4.5. Lower-cased
    // comparison so 'decision: …' / 'DECISION: …' / etc. all match —
    // SQLite's default LIKE is case-sensitive for ASCII.
    conditions.push(sql`LOWER(${notes.title}) LIKE 'decision: %'`);
  }

  const limit = filter.limit ?? 10000;
  const offset = filter.offset ?? 0;

  const orderClauses = (() => {
    switch (filter.orderBy) {
      case 'createdAt':     return [desc(notes.createdAt)];
      case 'updatedAt':     return [desc(notes.updatedAt)];
      default:               return [sql`${notes.lastViewedAt} DESC NULLS LAST`, desc(notes.createdAt)];
    }
  })();

  const rows = db
    .select()
    .from(notes)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderClauses)
    .limit(limit)
    .offset(offset)
    .all();
  return rows.map((r) => hydrateRow(r));
}

export function getNote(id: string): NoteRecord | undefined {
  const db = getDb();
  return hydrateRow(db.select().from(notes).where(eq(notes.id, id)).get());
}

export function createNote(input: CreateNoteInput): NoteRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const attachments = deriveAttachments({
    body: input.body ?? '',
    prior: [],
    newUploads: input.attachments ?? [],
  });

  const rest = withoutAttachments(input);
  const row = hydrateRow(db
    .insert(notes)
    .values({
      ...rest,
      id: uuidv7(),
      status: input.status ?? 'active',
      contextTags: input.contextTags ?? [],
      attachments: dehydrateAttachments(attachments) ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get());

  void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
  void syncEntity('note', row.id);
  return row;
}

export function updateNote(id: string, input: UpdateNoteInput, meta?: EntityVersionMeta): NoteRecord | null {
  const db = getDb();

  const existing = hydrateRow(db.select().from(notes).where(eq(notes.id, id)).get());
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

  const rest = withoutAttachments(input);
  const row = hydrateRow(db
    .update(notes)
    .set({
      ...rest,
      ...(attachments !== undefined ? { attachments: dehydrateAttachments(attachments) ?? [] } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(notes.id, id))
    .returning()
    .get());

  void upsertEmbedding('note', row.id, buildEmbeddingText('note', row));
  void syncEntity('note', row.id);
  captureEntityVersion('note', row.id, noteSnapshot(existing), noteSnapshot(row), meta, existing.updatedAt);
  return row;
}

export function deleteNote(id: string): boolean {
  const db = getDb();
  const result = db.delete(notes).where(eq(notes.id, id)).run();
  if (result.changes === 0) return false;
  deleteEmbedding('note', id);
  void syncDeletion('note', id);
  db.delete(entityVersions)
    .where(and(eq(entityVersions.entityType, 'note'), eq(entityVersions.entityId, id)))
    .run();
  return true;
}

// ─── Entity Versions (note/task change history) ───────────────
// Append-only snapshot history that powers the in-document chat's diff +
// one-tap undo. Capture is best-effort and folded into updateTask/updateNote
// so EVERY sanctioned content change is tracked through one path — UI edits
// land as `human`, agent (MCP) edits as `ai`. Bumps that touch only
// non-content fields (sortKey, lastViewedAt, embeddings) produce identical
// snapshots and are skipped, so the history stays signal, not noise.

/** Optional provenance for a version, threaded from the mutation caller. */
export interface EntityVersionMeta {
  /** Who authored the change. Defaults to 'human'. */
  source?: EntityVersionSource;
  /** The content chat session whose turn made the edit, when known. */
  actorSessionId?: string | null;
  /** Short human label for the change. */
  summary?: string | null;
  /** For reverts: the version whose snapshot this restored. */
  revertedFromVersionId?: string | null;
}

function taskSnapshot(t: TaskRecord): EntityVersionSnapshot {
  return {
    title: t.title ?? null,
    body: t.body ?? '',
    description: t.description ?? null,
    status: t.status,
    energy: t.energy ?? null,
    effort: t.effort ?? null,
    hardDeadline: t.hardDeadline ?? null,
    resurfaceAfter: t.resurfaceAfter ?? null,
    recurrence: t.recurrence ?? null,
    blockedOn: t.blockedOn ?? null,
    outcome: t.outcome ?? null,
    userContext: t.userContext ?? null,
  };
}

function noteSnapshot(n: NoteRecord): EntityVersionSnapshot {
  return {
    title: n.title ?? null,
    body: n.body,
    url: n.url ?? null,
    status: n.status,
  };
}

/** Stable structural equality for two snapshots built by the same builder. */
function snapshotsEqual(a: EntityVersionSnapshot, b: EntityVersionSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Append a version for a content change, no-op when nothing meaningful moved.
 * On the first tracked change for an entity we also seed a baseline row from
 * the pre-change snapshot (back-dated to the entity's prior `updatedAt`) so
 * the very first diff has a "before" — this covers entities that predate the
 * feature. Best-effort: a versioning failure must never break the mutation.
 */
function captureEntityVersion(
  entityType: EntityVersionEntityType,
  entityId: string,
  before: EntityVersionSnapshot,
  after: EntityVersionSnapshot,
  meta: EntityVersionMeta | undefined,
  baselineCreatedAt: string,
): void {
  if (snapshotsEqual(before, after)) return;
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db
      .select({ c: sql<number>`count(*)` })
      .from(entityVersions)
      .where(and(eq(entityVersions.entityType, entityType), eq(entityVersions.entityId, entityId)))
      .get();
    if ((existing?.c ?? 0) === 0) {
      db.insert(entityVersions)
        .values({
          id: uuidv7(),
          entityType,
          entityId,
          snapshot: before,
          source: 'human',
          createdAt: baselineCreatedAt,
        })
        .run();
    }
    db.insert(entityVersions)
      .values({
        id: uuidv7(),
        entityType,
        entityId,
        snapshot: after,
        source: meta?.source ?? 'human',
        actorSessionId: meta?.actorSessionId ?? null,
        summary: meta?.summary ?? null,
        revertedFromVersionId: meta?.revertedFromVersionId ?? null,
        createdAt: now,
      })
      .run();
  } catch (err) {
    console.error(`[queries] failed to capture version for ${entityType} ${entityId}:`, err);
  }
}

/** Version history for an entity, newest first. */
export function listEntityVersions(
  entityType: EntityVersionEntityType,
  entityId: string,
  opts: { limit?: number } = {},
): EntityVersionRecord[] {
  const db = getDb();
  const base = db
    .select()
    .from(entityVersions)
    .where(and(eq(entityVersions.entityType, entityType), eq(entityVersions.entityId, entityId)))
    .orderBy(desc(entityVersions.createdAt), desc(entityVersions.id));
  return (opts.limit ? base.limit(opts.limit) : base).all();
}

export function getEntityVersion(id: string): EntityVersionRecord | null {
  const db = getDb();
  return db.select().from(entityVersions).where(eq(entityVersions.id, id)).get() ?? null;
}

function snapshotToTaskInput(snap: EntityVersionSnapshot): UpdateTaskInput {
  return {
    ...(snap.title != null ? { title: snap.title } : {}),
    body: snap.body,
    description: snap.description ?? null,
    ...(snap.status ? { status: snap.status as TaskStatus } : {}),
    energy: (snap.energy ?? null) as Energy | null,
    effort: (snap.effort ?? null) as Effort | null,
    hardDeadline: snap.hardDeadline ?? null,
    resurfaceAfter: snap.resurfaceAfter ?? null,
    recurrence: snap.recurrence ?? null,
    blockedOn: snap.blockedOn ?? null,
    outcome: snap.outcome ?? null,
    userContext: snap.userContext ?? null,
  };
}

function snapshotToNoteInput(snap: EntityVersionSnapshot): UpdateNoteInput {
  return {
    title: snap.title,
    body: snap.body,
    url: snap.url ?? null,
    ...(snap.status ? { status: snap.status as NoteStatus } : {}),
  };
}

/**
 * Restore an entity to a prior version's snapshot. Routes through the normal
 * update path, so the restore is itself recorded as a new (`system`) version —
 * history stays linear and the undo is itself undoable. Returns the updated
 * record, or null if the version (or its entity) is gone.
 */
export function revertEntityTo(
  versionId: string,
): { entityType: EntityVersionEntityType; entityId: string; record: TaskRecord | NoteRecord } | null {
  const version = getEntityVersion(versionId);
  if (!version) return null;
  const snap = version.snapshot;
  const meta: EntityVersionMeta = {
    source: 'system',
    summary: 'Reverted to an earlier version',
    revertedFromVersionId: versionId,
  };
  if (version.entityType === 'task') {
    const record = updateTask(version.entityId, snapshotToTaskInput(snap), meta);
    return record ? { entityType: 'task', entityId: version.entityId, record } : null;
  }
  const record = updateNote(version.entityId, snapshotToNoteInput(snap), meta);
  return record ? { entityType: 'note', entityId: version.entityId, record } : null;
}

// ─── Stream ───────────────────────────────────────────────────

export function listStream(
  filter: {
    status?: 'pending' | 'promoted' | 'dismissed';
    limit?: number;
    offset?: number;
  } = {},
): StreamRecord[] {
  const db = getDb();
  const rows = db
    .select()
    .from(stream)
    .where(filter.status ? eq(stream.status, filter.status) : undefined)
    .orderBy(desc(stream.createdAt))
    .limit(filter.limit ?? 100)
    .offset(filter.offset ?? 0)
    .all();
  return rows.map((r) => hydrateRow(r));
}

export function getStream(id: string): StreamRecord | undefined {
  const db = getDb();
  return hydrateRow(db.select().from(stream).where(eq(stream.id, id)).get());
}

/** Lookup an existing stream item by upstream id (e.g. Pocket recording.id).
 *  Used to dedupe at-least-once webhook redeliveries. */
export function findStreamByExternalId(
  externalSource: string,
  externalId: string,
): StreamRecord | undefined {
  const db = getDb();
  return hydrateRow(db
    .select()
    .from(stream)
    .where(and(eq(stream.externalSource, externalSource), eq(stream.externalId, externalId)))
    .limit(1)
    .get());
}

export function createStream(input: CreateStreamInput): StreamRecord {
  const db = getDb();
  const now = new Date().toISOString();

  const attachments = deriveAttachments({
    body: input.rawText ?? '',
    prior: [],
    newUploads: input.attachments ?? [],
  });

  const rest = withoutAttachments(input);
  const row = hydrateRow(db
    .insert(stream)
    .values({
      ...rest,
      id: uuidv7(),
      source: input.source ?? 'capture',
      status: input.status ?? 'pending',
      attachments: dehydrateAttachments(attachments) ?? [],
      createdAt: input.createdAt ?? now,
    })
    .returning()
    .get());

  void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
  void syncEntity('stream', row.id);
  return row;
}

export function updateStream(id: string, input: UpdateStreamInput): StreamRecord | null {
  const db = getDb();

  const existing = hydrateRow(db.select().from(stream).where(eq(stream.id, id)).get());
  if (!existing) return null;

  const bodyChanged = Object.prototype.hasOwnProperty.call(input, 'rawText');
  const attachmentsHint = input.attachments;
  const attachments =
    bodyChanged || attachmentsHint !== undefined
      ? deriveAttachments({
          body: bodyChanged ? input.rawText ?? '' : existing.rawText,
          prior: existing.attachments ?? [],
          newUploads: attachmentsHint ?? [],
        })
      : undefined;

  const rest = withoutAttachments(input);
  const row = hydrateRow(db
    .update(stream)
    .set({
      ...rest,
      ...(attachments !== undefined ? { attachments: dehydrateAttachments(attachments) ?? [] } : {}),
    })
    .where(eq(stream.id, id))
    .returning()
    .get());

  void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
  void syncEntity('stream', row.id);
  return row;
}

export function dismissStream(id: string, dismissedBy = 'user'): StreamRecord | null {
  return updateStream(id, { status: 'dismissed', dismissedBy });
}

// ─── Areas ────────────────────────────────────────────────────

export function listAreas(filter: AreaFilter = {}): AreaRecord[] {
  const db = getDb();
  const status = filter.status ?? 'active';

  const rows = db
    .select()
    .from(areas)
    .where(status !== 'all' ? eq(areas.status, status as 'active' | 'inactive' | 'archived') : undefined)
    .orderBy(asc(areas.sortOrder))
    .all();
  return rows.map((r) => hydrateRow(r));
}

export function getArea(id: string): AreaRecord | undefined {
  const db = getDb();
  return hydrateRow(db.select().from(areas).where(eq(areas.id, id)).get());
}

export function createArea(input: CreateAreaInput): AreaRecord {
  const db = getDb();
  const now = new Date().toISOString();

  // Areas have no body — attachments are the cover image(s) the UI passes
  // directly. Any other attachments in the payload are accepted as-is.
  const { attachments: inputAttachments, ...rest } = input;
  const row = hydrateRow(db
    .insert(areas)
    .values({
      ...rest,
      id: uuidv7(),
      status: input.status ?? 'active',
      attachments: dehydrateAttachments(inputAttachments) ?? [],
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get());

  void syncEntity('area', row.id);
  return row;
}

export function updateArea(id: string, input: UpdateAreaInput): AreaRecord | null {
  const db = getDb();

  const existing = hydrateRow(db.select().from(areas).where(eq(areas.id, id)).get());
  if (!existing) return null;

  const { attachments: inputAttachments, ...rest } = input;
  const row = hydrateRow(db
    .update(areas)
    .set({
      ...rest,
      ...(inputAttachments !== undefined ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(areas.id, id))
    .returning()
    .get());

  if (row) void syncEntity('area', row.id);
  return row;
}

// ─── Deck ─────────────────────────────────────────────────────

export function getLatestDeck(): DeckRecord | null {
  const db = getDb();
  return db
    .select()
    .from(decks)
    .orderBy(desc(decks.createdAt))
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
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(decks.id, id))
    .returning()
    .get();

  return deck ?? null;
}

// ─── Proactive deck: day boundary, versions, revert ──────────────

/** The active deck for a given local day (YYYY-MM-DD), or null. */
export function getActiveDeckForDate(date: string): DeckRecord | null {
  const db = getDb();
  return db
    .select()
    .from(decks)
    .where(and(eq(decks.forDate, date), isNull(decks.supersededAt)))
    .orderBy(desc(decks.createdAt))
    .limit(1)
    .all()[0] ?? null;
}

/** Every version produced for a day, oldest → newest (drives the revert UI). */
export function getDeckVersions(date: string): DeckRecord[] {
  const db = getDb();
  return db
    .select()
    .from(decks)
    .where(eq(decks.forDate, date))
    .orderBy(asc(decks.createdAt))
    .all();
}

/** Content fields for a new deck version — id/lineage/supersede are managed. */
export type SupersedeDeckInput = Omit<
  CreateDeckInput,
  'supersededAt' | 'replacesDeckId' | 'createdAt' | 'updatedAt'
> & { forDate: string };

/**
 * The core proactive-deck write. Atomically supersedes the current active
 * deck for `input.forDate` and inserts a new active version, chaining
 * `replacesDeckId`. Every prior version survives (for revert). Returns the
 * new active deck.
 */
export function supersedeAndInsertDeck(input: SupersedeDeckInput): DeckRecord {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const prior = tx
      .select()
      .from(decks)
      .where(and(eq(decks.forDate, input.forDate), isNull(decks.supersededAt)))
      .orderBy(desc(decks.createdAt))
      .all();
    for (const p of prior) {
      tx.update(decks)
        .set({ supersededAt: now, updatedAt: now })
        .where(eq(decks.id, p.id))
        .run();
    }
    return tx
      .insert(decks)
      .values({
        ...input,
        id: uuidv7(),
        replacesDeckId: prior[0]?.id ?? null,
        supersededAt: null,
      })
      .returning()
      .get();
  });
}

/**
 * Make a prior deck version active again. Supersedes whatever is currently
 * active for that day and clears the target's `supersededAt`. Idempotent if
 * the target is already active. Returns the reverted deck, or null if absent.
 */
export function revertDeckTo(deckId: string): DeckRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const target = tx.select().from(decks).where(eq(decks.id, deckId)).get();
    if (!target) return null;

    if (target.forDate) {
      const active = tx
        .select()
        .from(decks)
        .where(and(eq(decks.forDate, target.forDate), isNull(decks.supersededAt)))
        .all();
      for (const a of active) {
        if (a.id === deckId) continue;
        tx.update(decks)
          .set({ supersededAt: now, updatedAt: now })
          .where(eq(decks.id, a.id))
          .run();
      }
    }

    return (
      tx
        .update(decks)
        .set({ supersededAt: null, updatedAt: now })
        .where(eq(decks.id, deckId))
        .returning()
        .get() ?? null
    );
  });
}

// ─── User State ───────────────────────────────────────────────

export function getUserState() {
  const db = getDb();
  return db.select().from(userState).where(eq(userState.id, 1)).get();
}

/** The user's working-hours window (local HH:MM), with 9–6 defaults. */
export function getWorkdayBounds(): { workdayStart: string; workdayEnd: string } {
  const us = getUserState();
  return {
    workdayStart: us?.workdayStart ?? '09:00',
    workdayEnd: us?.workdayEnd ?? '18:00',
  };
}

export function updateUserState(input: UpdateUserStateInput) {
  const db = getDb();
  return db
    .update(userState)
    .set({ ...input, updatedAt: new Date().toISOString() })
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
      deviceType: input.deviceType ?? 'other',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return { key, token };
}

export function listApiKeys(options: { includeRevoked?: boolean } = {}): ApiKeyRecord[] {
  const db = getDb();
  const q = db.select().from(apiKeys);
  const rows = options.includeRevoked
    ? q.orderBy(desc(apiKeys.createdAt)).all()
    : q.where(isNull(apiKeys.revokedAt)).orderBy(desc(apiKeys.createdAt)).all();
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
    .set({ ...input, updatedAt: now })
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
    .set({ revokedAt: now, revokedReason: reason ?? null, updatedAt: now })
    .where(eq(apiKeys.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function touchApiKey(
  id: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): void {
  const db = getDb();
  db.update(apiKeys)
    .set({
      lastUsedAt: new Date().toISOString(),
      lastUsedIp: meta.ip ?? null,
      lastUsedUserAgent: meta.userAgent ?? null,
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
 * left-nav render path. `needsReviewCandidateCount` is the candidate set
 * before runtime streaming filtering — the client subtracts streaming
 * sessions to get the rendered count.
 */
export function listWorkspaces(filter: { status?: WorkspaceStatus } = {}): WorkspaceWithCounts[] {
  const db = getDb();
  const status = filter.status ?? 'active';

  const rows = db
    .select({
      ...getTableColumns(workspaces),
      sessionCount: sql<number>`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql.raw('"workspaces"."id"')} AND cs.status = 'active'
      )`.as('sessionCount'),
      needsReviewCandidateCount: sql<number>`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql.raw('"workspaces"."id"')}
          AND cs.status = 'active'
          AND cs.last_outcome_event_at IS NOT NULL
          AND cs.last_outcome_event_at > COALESCE(cs.last_viewed_at, '1970-01-01')
      )`.as('needsReviewCandidateCount'),
      activeSessionCount: sql<number>`(
        SELECT COUNT(*) FROM chat_sessions cs
        WHERE cs.workspace_id = ${sql.raw('"workspaces"."id"')} AND cs.status = 'active'
      )`.as('activeSessionCount'),
    })
    .from(workspaces)
    .where(eq(workspaces.status, status))
    .orderBy(asc(workspaces.position), asc(workspaces.createdAt))
    .all();

  return rows.map((r) => hydrateRow(r));
}

export function getWorkspace(id: string): WorkspaceRecord | undefined {
  const db = getDb();
  return hydrateRow(db.select().from(workspaces).where(eq(workspaces.id, id)).get());
}

/**
 * Create a workspace. Caller is responsible for filesystem detection
 * (`isGit`, `baseBranch`) — we don't shell out from the query layer.
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

  const { attachments: inputAttachments, ...rest } = input;
  const row = hydrateRow(db
    .insert(workspaces)
    .values({
      ...rest,
      id: uuidv7(),
      slug,
      position,
      status: input.status ?? 'active',
      ...(inputAttachments !== undefined ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get());
  return row;
}

export function updateWorkspace(id: string, input: UpdateWorkspaceInput): WorkspaceRecord | null {
  const db = getDb();
  const { attachments: inputAttachments, ...rest } = input;
  const row = hydrateRow(db
    .update(workspaces)
    .set({
      ...rest,
      ...(inputAttachments !== undefined ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(workspaces.id, id))
    .returning()
    .get());
  return row ?? null;
}

/**
 * Replace a workspace's connector allowlist (docs/connectors-workspace-scoping-spec.md §6e). The
 * raw storage primitive only — validation (reject-unknown / preserve-dormant) and active-session
 * recycling live at the route, which can reach the (async) connector runtime + executor.
 */
export function setWorkspaceConnectorScopes(
  id: string,
  scopes: WorkspaceConnectorScope[],
): WorkspaceRecord | null {
  return updateWorkspace(id, { connectorScopes: scopes });
}

export function archiveWorkspace(id: string): WorkspaceRecord | null {
  const now = new Date().toISOString();
  const db = getDb();
  const row = hydrateRow(db
    .update(workspaces)
    .set({ status: 'archived', archivedAt: now, updatedAt: now })
    .where(eq(workspaces.id, id))
    .returning()
    .get());
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
        .set({ position: index, updatedAt: now })
        .where(eq(workspaces.id, id))
        .run();
    });
  });
}

// ─── Agents ───────────────────────────────────────────────────

export function listAgents(filter: { status?: 'active' | 'archived' } = {}): AgentRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.status) conditions.push(eq(agents.status, filter.status));
  let query = db.select().from(agents).$dynamic();
  if (conditions.length > 0) query = query.where(and(...conditions));
  return query.orderBy(asc(agents.name)).all();
}

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
 * at an agentId; until per-workspace agents are a real product surface we
 * collapse all executor sessions onto a single shared agent per harness.
 */
export function getOrCreateDefaultExecutor(harness: string): AgentRecord {
  const db = getDb();
  const existing = db
    .select()
    .from(agents)
    .where(and(eq(agents.kind, 'executor'), eq(agents.harness, harness), eq(agents.status, 'active')))
    .orderBy(asc(agents.createdAt))
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

/**
 * Find or create the default orchestrator agent. Mirrors
 * `getOrCreateDefaultExecutor` for the orchestrator side — used by the
 * trigger action's `agentId` default when `targetKind='orchestrator'`
 * and the caller didn't pick one. Single shared agent until per-purpose
 * orchestrators become real surfaces.
 */
export function getOrCreateDefaultOrchestrator(harness = 'claude_code'): AgentRecord {
  const db = getDb();
  // Scope by harness: an orchestrator agent's harness *is* its provider, so
  // each provider gets its own default orchestrator (created on demand). A
  // harness-agnostic lookup returned whichever orchestrator existed first,
  // which silently pinned codex-default users (and provider switches) to the
  // claude agent.
  const existing = db
    .select()
    .from(agents)
    .where(and(eq(agents.kind, 'orchestrator'), eq(agents.status, 'active'), eq(agents.harness, harness)))
    .orderBy(asc(agents.createdAt))
    .limit(1)
    .get();
  if (existing) return existing;
  return createAgent({
    kind: 'orchestrator',
    harness,
    name: 'Orchestrator',
    config: {},
  });
}

// ─── Executions ───────────────────────────────────────────────
// A durable work artifact (worktree + branch + PR + takeover state)
// anchored to a workspace. Chats point at it via executionId. The
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
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    })
    .returning()
    .get();
}

/** Low-level execution patch. Always bumps updatedAt. Prefer the named
 *  helpers below at call sites so the mutation intent is explicit. */
export function updateExecution(id: string, input: UpdateExecutionInput): ExecutionRecord | null {
  const db = getDb();
  const row = db
    .update(executions)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(executions.id, id))
    .returning()
    .get();
  return row ?? null;
}

// ── Setup / provisioning ──────────────────────────────────────

/** Mark the start of a worktree-provisioning attempt. Clears any prior
 *  setupError so a retry flips the UI out of the failed chip immediately;
 *  the per-attempt timer (setupStartedAt) re-anchors to now. */
export function markExecutionSetupStarted(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, {
    setupStartedAt: new Date().toISOString(),
    setupError: null,
  });
}

/** Record a successful worktree provision. */
export function markExecutionSetupComplete(
  executionId: string,
  params: { worktreePath: string; branchName: string; baseSha: string },
): ExecutionRecord | null {
  return updateExecution(executionId, {
    worktreePath: params.worktreePath,
    branchName: params.branchName,
    baseSha: params.baseSha,
    setupError: null,
  });
}

export function recordExecutionSetupError(executionId: string, error: string): ExecutionRecord | null {
  return updateExecution(executionId, { setupError: error });
}

export function clearExecutionSetupError(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, { setupError: null });
}

/**
 * Set the background setup-script state for an execution. `status` null clears
 * it; passing `error` overwrites the stored failure tail (omit to leave it).
 */
export function setExecutionSetupScript(
  executionId: string,
  status: 'running' | 'done' | 'failed' | null,
  error?: string | null,
): ExecutionRecord | null {
  return updateExecution(executionId, {
    setupScriptStatus: status,
    ...(error !== undefined ? { setupScriptError: error } : {}),
  });
}

/**
 * Boot recovery: any execution still marked `setupScriptStatus='running'` at
 * startup is orphaned — its background runner died with the previous server
 * process and can never resolve, so the UI spins on "Running setup script…"
 * forever. Flip those to `failed` with a retryable message. Returns the count.
 */
export function resetOrphanedSetupScripts(): number {
  const db = getDb();
  const rows = db
    .update(executions)
    .set({
      setupScriptStatus: 'failed',
      setupScriptError: 'Setup was interrupted (Flow restarted). Retry to re-run it.',
      updatedAt: new Date().toISOString(),
    })
    .where(eq(executions.setupScriptStatus, 'running'))
    .returning({ id: executions.id })
    .all();
  return rows.length;
}

/**
 * Reset worktree-identity fields on an execution so a fresh `provisionWorktreeForSession`
 * call repopulates them. Used by the "Continue" flow when reopening an archived
 * execution whose worktree was torn down — the row's `worktreePath` still
 * points at the deleted directory after archive, so we null it (along with
 * `branchName` / `baseSha`) and bump `setupStartedAt` so the UI's
 * "setting up..." anchor reads as starting now, not at the original create.
 */
export function resetExecutionForReprovision(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, {
    worktreePath: null,
    branchName: null,
    baseSha: null,
    setupStartedAt: new Date().toISOString(),
    setupError: null,
  });
}


// ── PR linkage ────────────────────────────────────────────────

export function setExecutionPR(executionId: string, prNumber: number | null): ExecutionRecord | null {
  return updateExecution(executionId, { prNumber: prNumber });
}

// ── Execution label ───────────────────────────────────────────

/**
 * Set the execution's label — the stable artifact title shown in the
 * execution header. Distinct from a chat's own `label` (per-conversation,
 * auto-derived from its first message). Renaming in the header routes here;
 * starting a new chat against the same execution leaves this untouched, so
 * the header title survives across conversations. Empty/whitespace clears it.
 */
export function setExecutionLabel(executionId: string, label: string | null): ExecutionRecord | null {
  return updateExecution(executionId, { label: label?.trim() || null });
}

// ── Takeover lifecycle (all five columns move together) ───────

export function startExecutionTakeover(
  executionId: string,
  params: {
    token: string;
    branch: string;
    baseSha: string;
    expiresAt: string;
    /** Chat session that initiated the takeover. Optional for backward
     *  compat with legacy callers; new callers should pass it so the
     *  resume handoff lands in the exact chat under multi-chat
     *  executions. */
    chatSessionId?: string | null;
  },
): ExecutionRecord | null {
  return updateExecution(executionId, {
    takeoverStartedAt: new Date().toISOString(),
    takeoverBaseSha: params.baseSha,
    takeoverBranch: params.branch,
    takeoverToken: params.token,
    takeoverTokenExpiresAt: params.expiresAt,
    takeoverChatSessionId: params.chatSessionId ?? null,
  });
}

export function clearExecutionTakeover(executionId: string): ExecutionRecord | null {
  return updateExecution(executionId, {
    takeoverStartedAt: null,
    takeoverBaseSha: null,
    takeoverBranch: null,
    takeoverToken: null,
    takeoverTokenExpiresAt: null,
    takeoverChatSessionId: null,
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
  const exec = db.select().from(executions).where(eq(executions.takeoverToken, token)).get();
  if (!exec) return undefined;
  // Prefer the chat that initiated the takeover (recorded on the
  // execution at startExecutionTakeover time). This is the only correct
  // target once executions accumulate multiple chats — scheduled
  // recurring fires now spawn sibling chats against the same execution,
  // and "most-recently-active" can resolve to a chat that wasn't part
  // of the takeover at all.
  if (exec.takeoverChatSessionId) {
    const initiating = db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, exec.takeoverChatSessionId))
      .get();
    if (initiating) return flattenSessionExecution({ ...initiating, execution: exec });
    // Initiating chat was hard-deleted while takeover was live (rare,
    // but the cascade is SET NULL on chat_sessions). Fall through to
    // the legacy heuristic so the user can still resume *somewhere*.
  }
  const chat = db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.executionId, exec.id), eq(chatSessions.status, 'active')))
    .orderBy(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`)
    .get();
  if (!chat) return undefined;
  return flattenSessionExecution({ ...chat, execution: exec });
}

/**
 * Executions whose worktree provisioning began but never completed and
 * never failed cleanly — silent hangs the cold-start reaper marks with a
 * synthetic setupError so the UI surfaces them as retryable. Mirrors the
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
        isNotNull(executions.setupStartedAt),
        isNull(executions.worktreePath),
        isNull(executions.setupError),
        lte(executions.setupStartedAt, cutoff),
      ),
    )
    .all();
}

// ── Archive / unarchive ───────────────────────────────────────

/**
 * Archive an execution and cascade to its chats. Product code never
 * hard-deletes — this flips status='archived' (+ archivedAt) on the
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
      .set({ status: 'archived', archivedAt: now, updatedAt: now })
      .where(eq(executions.id, executionId))
      .returning()
      .get();
    if (!row) return null;
    tx.update(chatSessions)
      .set({ status: 'archived', archivedAt: now })
      .where(and(eq(chatSessions.executionId, executionId), eq(chatSessions.status, 'active')))
      .run();
    return row;
  });
}

/**
 * Reactivate an archived execution. Symmetric inverse of `archiveExecution`:
 * flips status='active' (+ clears archivedAt) on the execution and on every
 * chat that's currently archived under it, in one transaction. The cascade
 * is what makes "send to an archived execution" a valid resume signal —
 * without it the chats stay disabled even after the execution is active.
 */
export function unarchiveExecution(executionId: string): ExecutionRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  return db.transaction((tx) => {
    const row = tx
      .update(executions)
      .set({ status: 'active', archivedAt: null, updatedAt: now })
      .where(eq(executions.id, executionId))
      .returning()
      .get();
    if (!row) return null;
    tx.update(chatSessions)
      .set({ status: 'active', archivedAt: null })
      .where(and(eq(chatSessions.executionId, executionId), eq(chatSessions.status, 'archived')))
      .run();
    return row;
  });
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
    worktreePath: e?.worktreePath ?? null,
    branchName: e?.branchName ?? null,
    baseSha: e?.baseSha ?? null,
    prNumber: e?.prNumber ?? null,
    setupError: e?.setupError ?? null,
    setupStartedAt: e?.setupStartedAt ?? null,
    setupScriptStatus: e?.setupScriptStatus ?? null,
    setupScriptError: e?.setupScriptError ?? null,
    takeoverStartedAt: e?.takeoverStartedAt ?? null,
    takeoverBaseSha: e?.takeoverBaseSha ?? null,
    takeoverBranch: e?.takeoverBranch ?? null,
    takeoverToken: e?.takeoverToken ?? null,
    takeoverTokenExpiresAt: e?.takeoverTokenExpiresAt ?? null,
  } as T & ChatSessionWithExecution;
}

/**
 * Single chat session with its execution's git/worktree/PR/takeover state
 * flattened on top. Drop-in replacement for `getChatSession` at every
 * call site that reads worktreePath / branchName / baseSha / prNumber
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
    .leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .where(eq(chatSessions.id, id))
    .get();
  if (!row) return null;
  return flattenSessionExecution(row as ChatSessionRecord & { execution: ExecutionRecord | null });
}

/**
 * Replace the manual preview URLs on an execution (§6 — BYO tunnel). The
 * full list is set at once (set-or-clear semantics); pass `[]` to clear.
 * Returns the updated execution, or null for an unknown id.
 */
export function setExecutionPreviewUrls(
  executionId: string,
  urls: PreviewUrl[],
): ExecutionRecord | null {
  return updateExecution(executionId, { previewUrls: urls });
}

// ─── Preview Targets ──────────────────────────────────────────
// The per-worktree desired-state for the preview system. See the table
// comment in schema.ts and docs/preview-system-spec.md §2. `service` is the
// optional multi-service discriminator; `null` is the default/only app. The
// (executionId, service) pair is unique, so reads filter on both.

/** Match on the nullable `service` column — `IS NULL` vs `= value`. */
function previewTargetServiceClause(service: string | null | undefined): SQL {
  return service == null
    ? isNull(previewTargets.service)
    : eq(previewTargets.service, service);
}

export function getPreviewTarget(
  executionId: string,
  service: string | null = null,
): PreviewTargetRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(previewTargets)
    .where(and(eq(previewTargets.executionId, executionId), previewTargetServiceClause(service)))
    .get();
}

export function getPreviewTargetById(id: string): PreviewTargetRecord | undefined {
  const db = getDb();
  return db.select().from(previewTargets).where(eq(previewTargets.id, id)).get();
}

export function listPreviewTargetsForExecution(executionId: string): PreviewTargetRecord[] {
  const db = getDb();
  return db
    .select()
    .from(previewTargets)
    .where(eq(previewTargets.executionId, executionId))
    .all();
}

/** All pinned targets across active executions — the boot/restore-set source. */
export function listPinnedPreviewTargets(): PreviewTargetRecord[] {
  const db = getDb();
  return db.select().from(previewTargets).where(eq(previewTargets.pinned, true)).all();
}

/** Pinned targets for one workspace (the per-workspace restore-set action). */
export function listPinnedPreviewTargetsForWorkspace(workspaceId: string): PreviewTargetRecord[] {
  const db = getDb();
  return db
    .select({ ...getTableColumns(previewTargets) })
    .from(previewTargets)
    .innerJoin(executions, eq(previewTargets.executionId, executions.id))
    .where(and(eq(executions.workspaceId, workspaceId), eq(previewTargets.pinned, true)))
    .all();
}

export function createPreviewTarget(input: CreatePreviewTargetInput): PreviewTargetRecord {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(previewTargets)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      service: input.service ?? null,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    })
    .returning()
    .get();
}

export function updatePreviewTarget(
  id: string,
  input: UpdatePreviewTargetInput,
): PreviewTargetRecord | null {
  const db = getDb();
  const row = db
    .update(previewTargets)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(previewTargets.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function deletePreviewTarget(id: string): void {
  const db = getDb();
  db.delete(previewTargets).where(eq(previewTargets.id, id)).run();
}

/** Stamp lastViewedAt — used by idle-evict to decide what to reap. */
export function touchPreviewTarget(id: string): void {
  const db = getDb();
  db.update(previewTargets)
    .set({ lastViewedAt: new Date().toISOString() })
    .where(eq(previewTargets.id, id))
    .run();
}

// ─── Chat Sessions ────────────────────────────────────────────

export function listChatSessions(filter: {
  workspaceId?: string;
  executionId?: string;
  status?: 'active' | 'archived';
  type?: 'orchestration' | 'content' | 'execution';
} = {}): ChatSessionWithExecution[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.workspaceId) conditions.push(eq(chatSessions.workspaceId, filter.workspaceId));
  if (filter.executionId) conditions.push(eq(chatSessions.executionId, filter.executionId));
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
    .leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`)
    .all();
  return rows.map((r) => flattenSessionExecution(r as ChatSessionRecord & { execution: ExecutionRecord | null }));
}

export function getChatSession(id: string): ChatSessionRecord | undefined {
  const db = getDb();
  return db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
}

export function createChatSession(input: CreateChatSessionInput & { id?: string }): ChatSessionRecord {
  const db = getDb();
  const agent = db.select().from(agents).where(eq(agents.id, input.agentId)).get();
  const selection = explicitAgentSelection(
    providerIdForHarness(agent?.harness),
    { model: input.model, effort: input.effort },
  );
  const row = db
    .insert(chatSessions)
    .values({
      ...input,
      // A session owns a concrete provider tuple. Never let nullable legacy
      // defaults or a model from another provider reach the executor.
      model: selection.model,
      effort: selection.effort,
      id: input.id ?? uuidv7(),
      status: input.status ?? 'active',
      // Store ISO (UTC) rather than the SQLite `datetime('now')` default's
      // space-format, so `startedAt` sorts consistently against the ISO
      // outcome/unread timestamps it's compared with (see session-sort.ts).
      startedAt: input.startedAt ?? new Date().toISOString(),
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
  return updateChatSession(id, { status: 'archived', archivedAt: new Date().toISOString() });
}

// Takeover lifecycle moved to the execution: see `startExecutionTakeover`,
// `clearExecutionTakeover`, and `findChatSessionByTakeoverToken` in the
// Executions section above. The token + branch + baseSha now live on the
// `executions` row, not chat_sessions.

/**
 * Atomically create an execution artifact and its first chat (the chat
 * points at the execution via executionId). This is the single creation
 * chokepoint for execution chats — both the user-facing dispatch path and
 * the dev scratch route go through it — so the §2.2 invariant ("active
 * execution chats have executionId NOT NULL") can never be violated by a
 * crash between two inserts.
 *
 * Initial execution state is optional: live-mode dispatches pass the
 * already-known worktreePath/branchName/baseSha; git dispatches pass
 * `setupStartedAt` and leave the worktree fields null for the background
 * provisioner to fill via `markExecutionSetupComplete`.
 */
export function createExecutionWithChat(params: {
  workspaceId: string;
  agentId: string;
  chatSessionId?: string;
  label: string | null;
  worktreePath?: string | null;
  branchName?: string | null;
  baseSha?: string | null;
  prNumber?: number | null;
  setupStartedAt?: string | null;
  /** Optional preferred model (e.g. propagated from a trigger). Missing or
   *  invalid values are resolved to the provider's explicit fallback. */
  model?: string | null;
  /** Optional preferred effort, normalized against the selected model. */
  effort?: ChatSessionRecord['effort'];
}): { execution: ExecutionRecord; session: ChatSessionRecord } {
  const db = getDb();
  const now = new Date().toISOString();
  const agent = db.select().from(agents).where(eq(agents.id, params.agentId)).get();
  const selection = explicitAgentSelection(
    providerIdForHarness(agent?.harness),
    { model: params.model, effort: params.effort },
  );
  return db.transaction((tx) => {
    const executionId = uuidv7();
    const execution = tx
      .insert(executions)
      .values({
        id: executionId,
        workspaceId: params.workspaceId,
        label: params.label,
        worktreePath: params.worktreePath ?? null,
        branchName: params.branchName ?? null,
        baseSha: params.baseSha ?? null,
        prNumber: params.prNumber ?? null,
        setupStartedAt: params.setupStartedAt ?? null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const session = tx
      .insert(chatSessions)
      .values({
        id: params.chatSessionId ?? uuidv7(),
        agentId: params.agentId,
        type: 'execution',
        workspaceId: params.workspaceId,
        executionId: executionId,
        label: params.label,
        status: 'active',
        // ISO (UTC) to match the execution's timestamps and to sort
        // consistently against ISO outcome/unread timestamps (the SQLite
        // `datetime('now')` default would store the space-format instead).
        startedAt: now,
        model: selection.model,
        effort: selection.effort,
      })
      .returning()
      .get();
    return { execution, session };
  });
}

/**
 * Create a new execution session in a workspace. Auto-resolves the default
 * executor agent (currently Claude Code) so callers don't have to pass an
 * agentId.
 *
 * Creates the execution artifact eagerly, in the same transaction as the
 * chat, so the chat always has an `executionId` (docs/executions-spec.md
 * §5: "created eagerly when a chat opens; worktree provisioned lazily at
 * first dispatch"). Worktree creation is deferred to the dispatch path —
 * the execution lands with null worktree fields and the rail surfaces a
 * "not started" state until provisioning runs.
 *
 * Label is optional; null/empty means "derive from first message." It's
 * copied to both the execution (for the artifact) and the chat.
 */
export function createExecutionSession(args: {
  workspaceId: string;
  label?: string | null;
  harness?: string;
}): ChatSessionRecord {
  const agent = getOrCreateDefaultExecutor(args.harness ?? 'claude_code');
  const { session } = createExecutionWithChat({
    workspaceId: args.workspaceId,
    agentId: agent.id,
    label: args.label?.trim() || null,
  });
  return session;
}

/**
 * Start a fresh chat against an EXISTING execution — same worktree/branch/PR,
 * a new conversation, optionally on a different provider. The counterpart to
 * `createExecutionWithChat` (which mints a *new* execution): here the artifact
 * is reused, so the agent picks up the existing code in place. This is the
 * "new chat" / "switch provider" primitive for the execution view, mirroring
 * the scheduled-fire pattern (one execution hosts many chats). The caller is
 * responsible for archiving + tearing down the prior chat. Returns null if the
 * execution is gone.
 */
export function createExecutionChat(args: {
  executionId: string;
  /** Executor harness ('claude_code' | 'codex'); picks the agent. */
  harness?: string;
  model?: string | null;
  effort?: ChatSessionRecord['effort'];
  label?: string | null;
}): ChatSessionRecord | null {
  const execution = getExecution(args.executionId);
  if (!execution) return null;
  const agent = getOrCreateDefaultExecutor(args.harness ?? 'claude_code');
  return createChatSession({
    type: 'execution',
    executionId: args.executionId,
    workspaceId: execution.workspaceId,
    agentId: agent.id,
    label: args.label ?? null,
    status: 'active',
    ...(args.model !== undefined ? { model: args.model } : {}),
    ...(args.effort !== undefined ? { effort: args.effort } : {}),
  });
}

/**
 * Set lastViewedAt = now() and clear unreadMarkerAt. Used to be fired
 * on session open ("opening = read receipt"); now triggered on actual
 * interaction (textarea focus, send, explicit Mark read). Kept as a named
 * alias so older callers compile until they migrate.
 */
export function markSessionViewed(id: string): ChatSessionRecord | null {
  return markSessionRead(id);
}

/**
 * Marks the session as read by the user. Updates lastViewedAt to now
 * and clears any "Mark as unread" override the user previously toggled.
 */
export function markSessionRead(id: string): ChatSessionRecord | null {
  return updateChatSession(id, {
    lastViewedAt: new Date().toISOString(),
    unreadMarkerAt: null,
  });
}

/**
 * Force the session into the Unread bucket even when no new agent output
 * has landed. Sets unreadMarkerAt = now() so the read derivation
 * (`max(last_outcome, unread_marker) > last_viewed`) classifies the session
 * as unread on the next rail render.
 */
export function markSessionUnread(id: string): ChatSessionRecord | null {
  return updateChatSession(id, { unreadMarkerAt: new Date().toISOString() });
}

/** Advance the outcome timestamp. Called when an `agent`/`result` event lands. */
export function bumpSessionOutcome(id: string, at: string = new Date().toISOString()): void {
  const db = getDb();
  db.update(chatSessions)
    .set({ lastOutcomeEventAt: at })
    .where(eq(chatSessions.id, id))
    .run();
}

/**
 * Sessions whose on-disk Claude transcript should be checked for drift.
 * Non-archived, with an `externalSessionId` (set on first system event,
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
        isNotNull(chatSessions.externalSessionId),
      ),
    )
    .orderBy(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`)
    .all();
}

// Stuck-bootstrap detection moved to the execution: see
// `listStuckBootstrapExecutions` in the Executions section above. The
// provisioning state (setupStartedAt / worktreePath / setupError) now
// lives on the `executions` row.

/**
 * Sessions where the user owes the agent attention. Streaming filtering is
 * the caller's job — we return candidates so the client can subtract any
 * sessions currently piping live stdio.
 *
 * "Unread" derivation: the most recent of (lastOutcomeEventAt,
 * unreadMarkerAt) is newer than the user's last interaction
 * (lastViewedAt). unreadMarkerAt lets the user force a session into
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
    .leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .where(
      and(
        eq(chatSessions.status, 'active'),
        // The interactive orchestrator chat (orchestration + no creating
        // run) is "the assistant in the Chat tab" — its replies are the
        // conversation itself, not output owed review, so it never belongs
        // in the unread queue. Scheduled orchestrator chats
        // (created_by_run_id set) stay eligible: surfacing their results
        // here is how scheduled-fire output reaches the user.
        sql`NOT (${chatSessions.type} = 'orchestration' AND ${chatSessions.createdByRunId} IS NULL)`,
        sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.unreadMarkerAt}) IS NOT NULL`,
        sql`COALESCE(
          MAX(
            COALESCE(${chatSessions.lastOutcomeEventAt}, '1970-01-01'),
            COALESCE(${chatSessions.unreadMarkerAt}, '1970-01-01')
          ),
          '1970-01-01'
        ) > COALESCE(${chatSessions.lastViewedAt}, '1970-01-01')`,
      ),
    )
    .orderBy(sql`COALESCE(
      MAX(
        COALESCE(${chatSessions.lastOutcomeEventAt}, '1970-01-01'),
        COALESCE(${chatSessions.unreadMarkerAt}, '1970-01-01')
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
// image, areaId) for the row renderer to draw without a second fetch.
// Bucket classification (Needs Approval / Working / Unread / Waiting
// Response) is done client-side from this list plus the live
// pendingInput + streaming sets.

export interface RailSessionRow extends ChatSessionWithExecution {
  workspaceName: string | null;
  workspaceEmoji: string | null;
  workspaceAttachments: Attachment[] | null;
  workspaceAreaId: string | null;
  workspaceIsGit: boolean | null;
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
      workspaceName: workspaces.name,
      workspaceEmoji: workspaces.emoji,
      workspaceAttachments: workspaces.attachments,
      workspaceAreaId: workspaces.areaId,
      workspaceIsGit: workspaces.isGit,
    })
    .from(executions)
    // INNER JOIN — the rail mirrors the workspace tree, which only shows
    // active workspaces, so executions in an archived workspace are hidden
    // here too (keeps bucket counts consistent with the tree).
    .innerJoin(
      workspaces,
      and(eq(workspaces.id, executions.workspaceId), eq(workspaces.status, 'active')),
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
    .orderBy(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`)
    .all();
  return rows.map((r) => hydrateRailRow(r));
}

/**
 * Active executions for a single workspace — one row per execution, keyed
 * to its primary chat (most-recently-active non-archived chat), execution
 * state flattened on top. This is the workspace tree's source of truth:
 * an execution with several active chats (e.g. scheduled fires, or sibling
 * "new chats") collapses to ONE row, named by the execution. Sibling chats
 * are reached from the in-execution chat-history dropdown, not the tree.
 *
 * Mirrors `listRailSessions`'s correlated-subquery dedup, scoped to one
 * (already-known-active) workspace, so the tree and the by-status rail
 * agree on cardinality.
 */
export function listWorkspaceExecutions(workspaceId: string): ChatSessionWithExecution[] {
  const db = getDb();
  const rows = db
    .select({
      ...getTableColumns(chatSessions),
      execution: getTableColumns(executions),
    })
    .from(executions)
    .innerJoin(
      chatSessions,
      sql`${chatSessions.id} = (
        SELECT cs2.id FROM chat_sessions cs2
        WHERE cs2.execution_id = ${executions.id} AND cs2.status = 'active'
        ORDER BY COALESCE(cs2.last_outcome_event_at, cs2.started_at) DESC
        LIMIT 1
      )`,
    )
    .where(and(eq(executions.workspaceId, workspaceId), eq(executions.status, 'active')))
    .orderBy(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`)
    .all();
  return rows.map((r) =>
    flattenSessionExecution(r as ChatSessionRecord & { execution: ExecutionRecord | null }),
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
      workspaceName: workspaces.name,
      workspaceEmoji: workspaces.emoji,
      workspaceAttachments: workspaces.attachments,
      workspaceAreaId: workspaces.areaId,
      workspaceIsGit: workspaces.isGit,
    })
    .from(chatSessions)
    // LEFT JOIN so sessions whose workspace was deleted still render —
    // history is allowed to outlive its workspace. The renderer treats
    // null workspaceName as "(workspace removed)".
    .leftJoin(workspaces, eq(workspaces.id, chatSessions.workspaceId))
    .leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .where(eq(chatSessions.type, 'execution'))
    .orderBy(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt}) DESC`)
    .limit(limit)
    .all();
  return rows.map((r) => hydrateRailRow(r));
}

/**
 * Camelize the aliased `workspaceAttachments` JSON column and run the
 * row through `flattenSessionExecution`. The execution flatten copies
 * camelCase columns through unchanged; `attachments` would otherwise
 * stay snake_case because `hydrateRow` only recognizes a field literally
 * named `attachments`.
 */
function hydrateRailRow(
  row: ChatSessionRecord & { execution: ExecutionRecord | null; workspaceAttachments: StoredAttachment[] | null },
): RailSessionRow {
  const { workspaceAttachments, ...rest } = row;
  const flat = flattenSessionExecution(rest as ChatSessionRecord & { execution: ExecutionRecord | null });
  return {
    ...flat,
    workspaceAttachments: workspaceAttachments ? camelizeKeys(workspaceAttachments) : null,
  } as RailSessionRow;
}

// ─── Chat Events ──────────────────────────────────────────────

/**
 * Single chokepoint for `chat_events` inserts. Every write path —
 * executor live stream, JSONL reconcile, user-message POST, inject
 * dev route, MCP/orchestrator handlers — goes through here so the
 * realtime broadcast and outcome-timestamp bump are guaranteed.
 *
 * Idempotent for CLI-backed events: replays of the same wire event
 * produce the same `externalEventId`, and the partial unique index
 * turns retries into no-ops. Rows without an `externalEventId`
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
  const { attachments: inputAttachments, ...rest } = input;
  // `.returning().all()` gives us the row that was actually written (or
  // an empty array on conflict). Cheaper than a follow-up SELECT and
  // ensures the broadcast carries the canonical row, not a synthesized
  // one — important because the DB may have filled defaults.
  const rows = db
    .insert(chatEvents)
    .values({
      ...rest,
      id,
      ...(inputAttachments !== undefined ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {}),
    })
    .onConflictDoNothing()
    .returning()
    .all();
  if (rows.length === 0) return null;
  const row = hydrateRow(rows[0]!);

  if (OUTCOME_SOURCES.has(input.source as ChatEventSource)) {
    bumpSessionOutcome(input.sessionId, input.createdAt ?? new Date().toISOString());
  }

  publishChatEvent(row);
  return row;
}

/**
 * Returns chat events in chronological order. When a session has more
 * events than `limit`, the OLDEST get cut off, not the newest — older
 * history is re-fetched on demand via the `before` cursor as the user
 * scrolls up, but losing the latest content makes the chat look broken
 * (the transcript on disk and chat_events stay in sync; only the GET
 * response is truncated). The internal fetch goes DESC + limit to grab
 * the tail, then reverses the page so the wire shape stays ASC for
 * callers.
 *
 * Backward paging (`before` = an event id): returns the page of events
 * strictly OLDER than that anchor, again ASC. The cursor is the
 * composite `(createdAt, id)` of the anchor row so it stays stable when
 * fresh events land at the tail mid-scroll — offset paging would shift
 * its window under live appends and produce gaps/dupes. A short page
 * (fewer than `limit` rows) tells the client it has reached the start.
 */
export function listChatEvents(
  sessionId: string,
  opts: { limit?: number; offset?: number; before?: string } = {},
): ChatEventRecord[] {
  const db = getDb();
  const limit = opts.limit ?? CHAT_PAGE_SIZE;

  if (opts.before) {
    const anchor = db
      .select({ createdAt: chatEvents.createdAt, id: chatEvents.id })
      .from(chatEvents)
      .where(eq(chatEvents.id, opts.before))
      .limit(1)
      .get();
    // Unknown cursor (e.g. an optimistic row that never persisted) — no
    // older page to return rather than scanning the whole table.
    if (!anchor) return [];
    const older = db
      .select()
      .from(chatEvents)
      .where(
        and(
          eq(chatEvents.sessionId, sessionId),
          or(
            lt(chatEvents.createdAt, anchor.createdAt),
            and(eq(chatEvents.createdAt, anchor.createdAt), lt(chatEvents.id, anchor.id)),
          ),
        ),
      )
      .orderBy(desc(chatEvents.createdAt), desc(chatEvents.id))
      .limit(limit)
      .all();
    return older.reverse().map((r) => hydrateRow(r));
  }

  const offset = opts.offset ?? 0;
  const tail = db
    .select()
    .from(chatEvents)
    .where(eq(chatEvents.sessionId, sessionId))
    .orderBy(desc(chatEvents.createdAt), desc(chatEvents.id))
    .limit(limit)
    .offset(offset)
    .all();
  return tail.reverse().map((r) => hydrateRow(r));
}

/**
 * Most recent event of a given source for a session. Backs the
 * orchestrator-chat history's snippet (last user message) — a cheap
 * single-row probe instead of paging the whole tail.
 */
export function getLastChatEventBySource(
  sessionId: string,
  source: string,
): ChatEventRecord | null {
  const db = getDb();
  const row = db
    .select()
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, sessionId), eq(chatEvents.source, source)))
    .orderBy(desc(chatEvents.createdAt), desc(chatEvents.id))
    .limit(1)
    .get();
  return row ? hydrateRow(row) : null;
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
  return rows[0] ? hydrateRow(rows[0]) : null;
}

/**
 * Most recent events for a session, newest first. Used by the health
 * checker to classify session liveness without pulling the entire
 * transcript — sessions can have thousands of events.
 */
export function listRecentChatEvents(sessionId: string, limit = 30): ChatEventRecord[] {
  const db = getDb();
  const rows = db
    .select()
    .from(chatEvents)
    .where(eq(chatEvents.sessionId, sessionId))
    .orderBy(desc(chatEvents.createdAt), desc(chatEvents.id))
    .limit(limit)
    .all();
  return rows.map((r) => hydrateRow(r));
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
  const rows = db
    .select()
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, sessionId), gt(chatEvents.id, afterId)))
    .orderBy(asc(chatEvents.createdAt), asc(chatEvents.id))
    .limit(limit)
    .all();
  return rows.map((r) => hydrateRow(r));
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
  sessionId: string;
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
         l.session_id AS sessionId,
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
  const result = db.delete(chatEvents).where(eq(chatEvents.sessionId, sessionId)).run();
  db.update(chatSessions)
    .set({ lastOutcomeEventAt: null, lastViewedAt: null })
    .where(eq(chatSessions.id, sessionId))
    .run();
  return result.changes;
}

// ─── Chat Refs ────────────────────────────────────────────────
// Materialized M:N references between chat sessions / events and
// entities (tasks, notes, areas, files, the session's own scratchpad).
// Two layers in one table — see schema.ts. `eventId IS NULL` = pin;
// set = per-message mention. The partial unique on (sessionId,
// entityType, entityId) only fires for pins, so mentions can repeat.

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
      createdAt: input.createdAt ?? new Date().toISOString(),
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
        eq(chatRefs.sessionId, input.sessionId),
        eq(chatRefs.entityType, input.entityType),
        eq(chatRefs.entityId, input.entityId),
        isNull(chatRefs.eventId),
      ),
    )
    .get();
  if (!existing) {
    throw new Error('createChatRef: insert conflict but no matching row found');
  }
  return existing;
}

/** All refs for a session — pins (eventId null) + mentions. */
export function listSessionRefs(
  sessionId: string,
  opts?: { pinnedOnly?: boolean; mentionsOnly?: boolean },
): ChatRefRecord[] {
  const db = getDb();
  const conditions: SQL[] = [eq(chatRefs.sessionId, sessionId)];
  if (opts?.pinnedOnly) conditions.push(isNull(chatRefs.eventId));
  if (opts?.mentionsOnly) conditions.push(isNotNull(chatRefs.eventId));
  return db
    .select()
    .from(chatRefs)
    .where(and(...conditions))
    .orderBy(asc(chatRefs.position), asc(chatRefs.createdAt))
    .all();
}

/** All refs bound to a specific chat_events row. */
export function listEventRefs(eventId: string): ChatRefRecord[] {
  const db = getDb();
  return db
    .select()
    .from(chatRefs)
    .where(eq(chatRefs.eventId, eventId))
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
    .where(and(eq(chatRefs.entityType, entityType), eq(chatRefs.entityId, entityId)))
    .orderBy(desc(chatRefs.createdAt))
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
    .innerJoin(chatSessions, eq(chatRefs.sessionId, chatSessions.id))
    .where(
      and(eq(chatRefs.entityType, entityType), eq(chatRefs.entityId, entityId)),
    )
    .orderBy(
      desc(sql`COALESCE(${chatSessions.lastOutcomeEventAt}, ${chatSessions.startedAt})`),
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
  const result = db.delete(chatRefs).where(eq(chatRefs.eventId, eventId)).run();
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
    const entityId = m.kind === 'scratchpad' ? sessionId : m.id;
    if (!entityId) continue;
    const row = createChatRef({
      sessionId: sessionId,
      eventId: eventId,
      entityType: m.kind,
      entityId,
      position,
      createdBy: createdBy,
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
    sessionId: args.sessionId,
    eventId: null,
    entityType: args.entityType,
    entityId: args.entityId,
    position: args.position ?? 0,
    hydrate: args.hydrate ?? true,
    createdBy: args.createdBy ?? 'user',
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
        eq(chatRefs.sessionId, args.sessionId),
        eq(chatRefs.entityType, args.entityType),
        eq(chatRefs.entityId, args.entityId),
        isNull(chatRefs.eventId),
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
  return updateChatSession(sessionId, { scratchPad: scratchPad });
}

// ─── Triggers ────────────────────────────────────────────────
// All trigger mutations route through here so the scheduler tick, the
// orchestrator actions, and the UI share a single write path. Reads
// land in two flavors: bare `TriggerRecord` for the tick (it doesn't
// want the extra join cost) and `TriggerWithLastRun` for surfaces
// that render status pills.

export interface TriggerFilter {
  enabled?: boolean;
  kind?: TriggerRecord['kind'];
  targetKind?: TriggerRecord['targetKind'];
  workspaceId?: string | null;
  /** Default 'all' — include archived workspaces' triggers unless overridden. */
  limit?: number;
  offset?: number;
}

export function listTriggers(filter: TriggerFilter = {}): TriggerRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.enabled != null) conditions.push(eq(triggers.enabled, filter.enabled));
  if (filter.kind) conditions.push(eq(triggers.kind, filter.kind));
  if (filter.targetKind) conditions.push(eq(triggers.targetKind, filter.targetKind));
  if (filter.workspaceId === null) conditions.push(isNull(triggers.workspaceId));
  else if (filter.workspaceId) conditions.push(eq(triggers.workspaceId, filter.workspaceId));
  let query = db.select().from(triggers).$dynamic();
  if (conditions.length > 0) query = query.where(and(...conditions));
  query = query.orderBy(desc(triggers.createdAt));
  if (filter.limit) query = query.limit(filter.limit);
  if (filter.offset) query = query.offset(filter.offset);
  return query.all();
}

export function getTrigger(id: string): TriggerRecord | undefined {
  const db = getDb();
  return db.select().from(triggers).where(eq(triggers.id, id)).get();
}

/**
 * Lookup by user-facing name within scope. workspaceId === undefined
 * means brain-level only; pass a workspaceId to scope to that workspace.
 * Matches the partial-unique index semantics — exact within-scope.
 */
export function findTriggerByName(
  name: string,
  workspaceId?: string | null,
): TriggerRecord | undefined {
  const db = getDb();
  const scopeFilter =
    workspaceId == null ? isNull(triggers.workspaceId) : eq(triggers.workspaceId, workspaceId);
  return db
    .select()
    .from(triggers)
    .where(and(eq(triggers.name, name), scopeFilter))
    .get();
}

export function createTrigger(input: CreateTriggerInput): TriggerRecord {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(triggers)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    })
    .returning()
    .get();
}

export function updateTrigger(
  id: string,
  input: UpdateTriggerInput,
): TriggerRecord | null {
  const db = getDb();
  const row = db
    .update(triggers)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(triggers.id, id))
    .returning()
    .get();
  return row ?? null;
}

/**
 * Delete a trigger. Runs that reference it get triggerId nulled (ON
 * DELETE SET NULL) so the run history survives. Owning execution and
 * its chats are unaffected — multiple triggers can share an
 * execution.
 */
export function deleteTrigger(id: string): boolean {
  const db = getDb();
  const result = db.delete(triggers).where(eq(triggers.id, id)).run();
  return result.changes > 0;
}

/** Triggers due to fire — what the tick reads. */
export function listDueTriggers(now: Date): TriggerRecord[] {
  const db = getDb();
  return db
    .select()
    .from(triggers)
    .where(
      and(
        eq(triggers.enabled, true),
        isNotNull(triggers.nextRunAt),
        lte(triggers.nextRunAt, now.toISOString()),
      ),
    )
    .all();
}

/**
 * Atomically advance the trigger's nextRunAt and record the fire time.
 * Used by the tick BEFORE dispatching — that's the at-most-once
 * guarantee. Returns the patched row so caller can verify.
 */
export function advanceTriggerNextRun(
  id: string,
  nextRunAt: string | null,
  firedAt: string,
): TriggerRecord | null {
  return updateTrigger(id, {
    nextRunAt: nextRunAt,
    lastFiredAt: firedAt,
  });
}

/** Persist the result of a run back to its parent trigger. */
export function setTriggerLastRun(
  id: string,
  runId: string,
  status: 'completed' | 'failed' | 'skipped',
): TriggerRecord | null {
  // Reset consecutive_failures on success, otherwise bump it.
  const current = getTrigger(id);
  if (!current) return null;
  const nextFailures =
    status === 'failed' ? current.consecutiveFailures + 1 : 0;
  return updateTrigger(id, {
    lastRunId: runId,
    lastRunStatus: status,
    consecutiveFailures: nextFailures,
  });
}

export function resetTriggerFailures(id: string): TriggerRecord | null {
  return updateTrigger(id, { consecutiveFailures: 0 });
}

/** Find the trigger (if any) currently owning this execution. */
export function findTriggersByOwningExecution(executionId: string): TriggerRecord[] {
  const db = getDb();
  return db
    .select()
    .from(triggers)
    .where(eq(triggers.owningExecutionId, executionId))
    .all();
}

/** Webhook lookup. Single row by definition (unique index). */
export function findTriggerByWebhookPublicId(publicId: string): TriggerRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(triggers)
    .where(eq(triggers.webhookPublicId, publicId))
    .get();
}

/** Pair a trigger with its most-recent run for the list view. */
export function listTriggersWithLastRun(filter: TriggerFilter = {}): TriggerWithLastRun[] {
  const list = listTriggers(filter);
  if (list.length === 0) return [];
  const db = getDb();
  // Single round-trip — fetch last-run rows for the result set in one shot.
  const ids = list.map((s) => s.lastRunId).filter((id): id is string => !!id);
  const lastRuns = ids.length
    ? db.select().from(runs).where(inArray(runs.id, ids)).all()
    : [];
  const byId = new Map<string, RunRecord>(lastRuns.map((r) => [r.id, r]));
  return list.map((s) => ({
    ...s,
    lastRun: s.lastRunId ? byId.get(s.lastRunId) ?? null : null,
  }));
}

// ─── Runs ─────────────────────────────────────────────────────
// Runs are append-mostly: insert at queued, update through running →
// terminal. Heavy reads are the inbox view (status, recency) and the
// spend rollups. Keep the write paths granular so the dispatcher and
// the result-event handler can each call exactly what they need.

export interface RunFilter {
  status?: RunStatus | RunStatus[];
  trigger?: RunTrigger | RunTrigger[];
  triggerId?: string;
  agentId?: string;
  executionId?: string;
  workspaceId?: string;
  /** Inclusive lower bound on startedAt (ISO). */
  since?: string;
  limit?: number;
  offset?: number;
}

export function listRuns(filter: RunFilter = {}): RunRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.status) {
    const arr = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(arr.length === 1 ? eq(runs.status, arr[0]) : inArray(runs.status, arr));
  }
  if (filter.trigger) {
    const arr = Array.isArray(filter.trigger) ? filter.trigger : [filter.trigger];
    conditions.push(
      arr.length === 1 ? eq(runs.triggerKind, arr[0]) : inArray(runs.triggerKind, arr),
    );
  }
  if (filter.triggerId) conditions.push(eq(runs.triggerId, filter.triggerId));
  if (filter.agentId) conditions.push(eq(runs.agentId, filter.agentId));
  if (filter.executionId) conditions.push(eq(runs.executionId, filter.executionId));
  if (filter.workspaceId) conditions.push(eq(runs.workspaceId, filter.workspaceId));
  if (filter.since) conditions.push(gte(runs.startedAt, filter.since));
  let query = db.select().from(runs).$dynamic();
  if (conditions.length > 0) query = query.where(and(...conditions));
  query = query.orderBy(desc(runs.createdAt));
  if (filter.limit) query = query.limit(filter.limit);
  if (filter.offset) query = query.offset(filter.offset);
  return query.all();
}

export function getRun(id: string): RunRecord | undefined {
  const db = getDb();
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

export function createRun(input: CreateRunInput): RunRecord {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(runs)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      queuedAt: input.queuedAt ?? now,
      createdAt: input.createdAt ?? now,
    })
    .returning()
    .get();
}

export function updateRun(id: string, input: UpdateRunInput): RunRecord | null {
  const db = getDb();
  const row = db.update(runs).set(input).where(eq(runs.id, id)).returning().get();
  return row ?? null;
}

/** Transition a queued run to running. */
export function markRunStarted(id: string, startedAt: string = new Date().toISOString()): RunRecord | null {
  return updateRun(id, { status: 'running', startedAt });
}

/** Terminal transition with timing. completedAt defaults to now.
 *  Guards against re-finalizing a row that already reached a terminal
 *  state (completed/failed/skipped) — the second call would otherwise
 *  silently overwrite. */
export function markRunCompleted(
  id: string,
  patch: Partial<Pick<RunRecord, 'summary' | 'artifactRefs' | 'model' | 'inputTokens' | 'outputTokens' | 'cachedInputTokens' | 'cacheCreationInputTokens' | 'costUsd'>> = {},
): RunRecord | null {
  const current = getRun(id);
  if (!current) return null;
  if (current.status !== 'queued' && current.status !== 'running') return current;
  const completedAt = new Date().toISOString();
  const durationMs = current.startedAt
    ? Math.max(0, new Date(completedAt).getTime() - new Date(current.startedAt).getTime())
    : null;
  return updateRun(id, {
    ...patch,
    status: 'completed',
    completedAt,
    durationMs,
  });
}

export function markRunFailed(
  id: string,
  patch: { errorCode: string; errorMessage: string; statusReason?: string | null } = { errorCode: 'agent_error', errorMessage: 'unknown' },
): RunRecord | null {
  const current = getRun(id);
  if (!current) return null;
  if (current.status !== 'queued' && current.status !== 'running') return current;
  const completedAt = new Date().toISOString();
  const durationMs = current.startedAt
    ? Math.max(0, new Date(completedAt).getTime() - new Date(current.startedAt).getTime())
    : null;
  return updateRun(id, {
    status: 'failed',
    completedAt,
    durationMs,
    errorCode: patch.errorCode,
    errorMessage: patch.errorMessage.slice(0, 2000),
    statusReason: patch.statusReason ?? null,
  });
}

/**
 * Boot recovery: anything in `running` OR `queued` from a prior process
 * is a ghost — the in-memory dispatcher state didn't survive the
 * restart. `queued` would normally only persist for the synchronous
 * window between `createRun` and `markRunStarted`, but a crash there
 * leaves an orphan that the mutex check wouldn't catch (it only looks
 * at running). Reap both so the execution-level mutex clears cleanly
 * and the inbox doesn't show a fake spinning run forever.
 */
export function reapStaleRunningRuns(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .update(runs)
    .set({
      status: 'failed',
      errorCode: 'process_restart',
      errorMessage: 'Process restarted while this run was active.',
      completedAt: now,
    })
    .where(inArray(runs.status, ['queued', 'running']))
    .returning()
    .all();
  return result.length;
}

/** The execution-level mutex check — one row max in `running`. */
export function findActiveRunForExecution(executionId: string): RunRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.executionId, executionId), eq(runs.status, 'running')))
    .get();
}

/** Per-trigger concurrency check (distinct from the execution mutex). */
export function findActiveRunForTrigger(triggerId: string): RunRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.triggerId, triggerId), eq(runs.status, 'running')))
    .get();
}

/**
 * Sum costUsd across runs since the given ISO timestamp. Used by the
 * budget guardrail (current month) and the TopHud (today). Skipped /
 * failed runs are included — Anthropic charges for failed turns too,
 * and the user wants visibility into that spend.
 */
export function sumRunCostSince(sinceIso: string): number {
  const db = getDb();
  const row = db
    .select({ total: sql<number>`COALESCE(SUM(${runs.costUsd}), 0)` })
    .from(runs)
    .where(gte(runs.startedAt, sinceIso))
    .get();
  return row?.total ?? 0;
}

/** Active run count for the TopHud indicator. */
export function countActiveRuns(): number {
  const db = getDb();
  const row = db
    .select({ count: sql<number>`COUNT(*)` })
    .from(runs)
    .where(inArray(runs.status, ['queued', 'running']))
    .get();
  return row?.count ?? 0;
}

// ─── Notifications (docs/connectors-email-and-notifier-spec.md §2) ──────────────
// The Notifier's data layer: channels (preference/config), web-push subscriptions
// (browser endpoints), and deliveries (the durable outbox). No raw SQL elsewhere.

export interface NotificationChannelFilter {
  userId?: string;
  enabled?: boolean;
  connectionId?: string;
}

export function listNotificationChannels(filter: NotificationChannelFilter = {}): NotificationChannelRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.userId) conditions.push(eq(notificationChannels.userId, filter.userId));
  if (filter.enabled != null) conditions.push(eq(notificationChannels.enabled, filter.enabled));
  if (filter.connectionId) conditions.push(eq(notificationChannels.connectionId, filter.connectionId));
  let query = db.select().from(notificationChannels).$dynamic();
  if (conditions.length > 0) query = query.where(and(...conditions));
  return query.orderBy(desc(notificationChannels.createdAt)).all();
}

export function getNotificationChannel(id: string): NotificationChannelRecord | undefined {
  return getDb().select().from(notificationChannels).where(eq(notificationChannels.id, id)).get();
}

export function createNotificationChannel(input: CreateNotificationChannelInput): NotificationChannelRecord {
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(notificationChannels)
    .values({ ...input, id: input.id ?? uuidv7(), createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now })
    .returning()
    .get();
}

export function updateNotificationChannel(id: string, input: UpdateNotificationChannelInput): NotificationChannelRecord | null {
  const db = getDb();
  const row = db
    .update(notificationChannels)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(notificationChannels.id, id))
    .returning()
    .get();
  return row ?? null;
}

/** Delete a channel and scrub its id from every trigger's deliverResultTo binding (§2.13). */
export function deleteNotificationChannel(id: string): boolean {
  const db = getDb();
  removeChannelFromTriggerBindings(id);
  const result = db.delete(notificationChannels).where(eq(notificationChannels.id, id)).run();
  return result.changes > 0; // notification_deliveries FK-cascade automatically
}

/** Disconnect cascade: drop the channels that deliver through a removed engine connection (§2.13). */
export function deleteChannelsForConnection(connectionId: string): number {
  const db = getDb();
  const affected = listNotificationChannels({ connectionId });
  for (const c of affected) removeChannelFromTriggerBindings(c.id);
  const result = db.delete(notificationChannels).where(eq(notificationChannels.connectionId, connectionId)).run();
  return result.changes;
}

/** Remove a channel id from every trigger's deliverResultTo[] (channel-delete cascade, §2.13). */
export function removeChannelFromTriggerBindings(channelId: string): void {
  const db = getDb();
  const bound = db.select().from(triggers).all().filter((s) => (s.deliverResultTo ?? []).includes(channelId));
  for (const s of bound) {
    db.update(triggers)
      .set({ deliverResultTo: (s.deliverResultTo ?? []).filter((id) => id !== channelId), updatedAt: new Date().toISOString() })
      .where(eq(triggers.id, s.id))
      .run();
  }
}

// ── web push subscriptions ──
export function listWebPushSubscriptions(userId: string): WebPushSubscriptionRecord[] {
  return getDb().select().from(webPushSubscriptions).where(eq(webPushSubscriptions.userId, userId)).all();
}

/** Upsert by endpoint (a browser re-subscribing replaces its keys). */
export function upsertWebPushSubscription(input: CreateWebPushSubscriptionInput): WebPushSubscriptionRecord {
  const db = getDb();
  return db
    .insert(webPushSubscriptions)
    .values({ ...input, id: input.id ?? uuidv7(), createdAt: input.createdAt ?? new Date().toISOString() })
    .onConflictDoUpdate({ target: webPushSubscriptions.endpoint, set: { p256dh: input.p256dh, auth: input.auth, userId: input.userId } })
    .returning()
    .get();
}

export function deleteWebPushSubscriptionByEndpoint(endpoint: string): boolean {
  const result = getDb().delete(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, endpoint)).run();
  return result.changes > 0;
}

// ── deliveries (the outbox) ──
/** Insert a delivery row, idempotent on (dedupeKey, channelId). Returns true if a NEW row was created. */
export function upsertDelivery(input: CreateNotificationDeliveryInput): boolean {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .insert(notificationDeliveries)
    .values({ ...input, id: input.id ?? uuidv7(), createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now })
    .onConflictDoNothing({ target: [notificationDeliveries.dedupeKey, notificationDeliveries.channelId] })
    .run();
  return result.changes > 0;
}

/** All still-processable deliveries for an event across the given channels (pending OR failed → self-heals on re-fire). */
export function listProcessableDeliveries(dedupeKey: string, channelIds: string[]): NotificationDeliveryRecord[] {
  if (channelIds.length === 0) return [];
  return getDb()
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.dedupeKey, dedupeKey),
        inArray(notificationDeliveries.channelId, channelIds),
        inArray(notificationDeliveries.status, ['pending', 'failed']),
      ),
    )
    .all();
}

export function markDeliverySent(id: string, patch: { providerMessageId?: string; rendered?: StoredRenderedNotification }): void {
  getDb()
    .update(notificationDeliveries)
    .set({
      status: 'sent',
      sentAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: sql`${notificationDeliveries.attempts} + 1`,
      ...(patch.providerMessageId !== undefined ? { providerMessageId: patch.providerMessageId } : {}),
      ...(patch.rendered !== undefined ? { rendered: patch.rendered } : {}),
    })
    .where(eq(notificationDeliveries.id, id))
    .run();
}

export function markDeliveryFailed(id: string, lastError: string): void {
  getDb()
    .update(notificationDeliveries)
    .set({
      status: 'failed',
      lastError: lastError.slice(0, 2000),
      updatedAt: new Date().toISOString(),
      attempts: sql`${notificationDeliveries.attempts} + 1`,
    })
    .where(eq(notificationDeliveries.id, id))
    .run();
}

/** A single delivery by its idempotency key — used to report the outcome of a test send. */
export function getDelivery(dedupeKey: string, channelId: string): NotificationDeliveryRecord | undefined {
  return getDb()
    .select()
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.dedupeKey, dedupeKey), eq(notificationDeliveries.channelId, channelId)))
    .get();
}

/** Delivery history for a user (newest first) — the in-app center reads this later. */
export function listNotificationDeliveries(userId: string, limit = 100): NotificationDeliveryRecord[] {
  return getDb()
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.userId, userId))
    .orderBy(desc(notificationDeliveries.createdAt))
    .limit(limit)
    .all();
}
