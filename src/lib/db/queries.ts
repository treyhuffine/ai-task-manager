/**
 * Shared database query functions.
 * Used by both API route handlers and AI chat tools.
 */

import nodePath from 'node:path';
import os from 'node:os';
import { getDb, getRawDb } from '@/lib/db';
import {
  tasks, notes, areas, stream, taskCompletions, taskStatusChanges, executionReviews, executionTasks, decks, userState, agentHarnessSettings, agentHarnessOperations, apiKeys,
  workspaces, referenceFolders, agents, executions, chatSessions, externalSessionImports, chatEvents, chatRefs,
  triggers, runs, previewTargets, entityVersions, entityLinks, entityProjectionState,
  notificationChannels, webPushSubscriptions, notificationDeliveries,
  triagePasses, triageDecisions, streamLinks, skillUsage,
} from '@/lib/db/schema';
import { eq, and, or, desc, asc, sql, gt, lt, inArray, isNull, isNotNull, notExists, gte, lte, getTableColumns, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import slugify from '@sindresorhus/slugify';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';
import { toFtsMatchQuery, normalizeFtsRank } from '@/lib/embeddings/fts-query';
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
  ReferenceFolderRecord, CreateReferenceFolderInput, UpdateReferenceFolderInput,
  AgentRecord, CreateAgentInput,
  ExecutionRecord, ExecutionReviewRecord, ExecutionTaskRecord, CreateExecutionInput, UpdateExecutionInput, ChatSessionWithExecution,
  PreviewTargetRecord, CreatePreviewTargetInput, UpdatePreviewTargetInput, PreviewUrl,
  ChatSessionRecord, CreateChatSessionInput, UpdateChatSessionInput,
  ExternalSessionImportRecord, CreateExternalSessionImportInput, UpdateExternalSessionImportInput,
  ChatEventRecord, CreateChatEventInput, ChatEventSource,
  ChatRefRecord, CreateChatRefInput, ChatRefEntityType,
  TriggerRecord, CreateTriggerInput, UpdateTriggerInput,
  RunRecord, CreateRunInput, UpdateRunInput, RunStatus, RunTrigger, TriggerWithLastRun,
  EntityVersionRecord, EntityVersionSnapshot, EntityVersionSource, EntityVersionEntityType,
  TaskStatus, Energy, Effort,
  NotificationChannelRecord, CreateNotificationChannelInput, UpdateNotificationChannelInput,
  WebPushSubscriptionRecord, CreateWebPushSubscriptionInput,
  NotificationDeliveryRecord, CreateNotificationDeliveryInput, StoredRenderedNotification,
  SkillUsageRecord,
  AgentHarnessSettingsRecord, UpsertAgentHarnessSettingsInput, AgentHarnessOperationRecord,
  StreamStatus,
  TriagePassRecord, TriagePassTrigger,
  TriageDecisionRecord, TriageDecisionState, TriageActor,
  StreamLinkRecord, CreateStreamLinkInput,
  StreamOutcome, StreamRecordWithOutcomes,
  TriageDisposition, TriageDraft, StreamAutonomyConfig, StreamAutonomyLevel,
} from '@/db/types';
import type { HarnessId } from '@/lib/agents/registry';
import { listEntityMarkers } from '@/lib/entity-refs/parse-markers';
import { linksFromTexts } from '@/lib/entity-refs/derive-links';
import { CHAT_PAGE_SIZE } from '@/constants/chat';
import { OUTCOME_SOURCES } from '@/db/types';
import { isSubagentTool } from '@/lib/executions/tool-display';
import {
  activityReasonForEventSource,
  isActivity,
  shouldThrottledBump,
  type ActivityReason,
} from '@/lib/sessions/activity';
import { generateToken, type GeneratedToken } from '@/lib/auth/tokens';
import { deriveAttachments } from '@/lib/attachments/derive';
import { publishChatEvent } from '@/lib/realtime/bus';
import { hydrateRow, dehydrateAttachments, withoutAttachments } from '@/lib/db/hydrate';
import {
  normalizeTaskStatus,
  canApply,
  targetState,
  transitionLabel,
  availableCommands,
  considerBlockers,
  isTerminal,
  TaskLifecycleError,
  type TransitionCommand,
  type LifecycleCommand,
  type TaskStatus as LifecycleTaskStatus,
} from '@/lib/tasks/lifecycle';
import type { LifecycleCommandResult } from '@/lib/db/schema';
import { camelizeKeys } from '@/lib/case/keys';
import type { StoredAttachment } from '@/lib/db/schema';
import {
  explicitAgentSelection,
  modelsForProvider,
  normalizeCustomModelId,
  providerIdForHarness,
} from '@/lib/agent-options';
import { TRIGGERS_WITH_OWN_REVIEW_SURFACE } from '@/lib/triggers/reserved';

// ─── Tasks ────────────────────────────────────────────────────

/**
 * Normalize a just-read task row's status at the read boundary: legacy `active`
 * bytes (and any unknown value) become `todo` so no surface downstream ever
 * sees a non-canonical status. Cheap identity return when already canonical.
 */
function normalizeTaskRow<T extends { status: string }>(row: T): T {
  const normalized = normalizeTaskStatus(row.status);
  return normalized === row.status ? row : ({ ...row, status: normalized } as T);
}

/**
 * Expand a status filter for the compatibility window. A legacy `active`
 * filter means the derived current union `todo | in_progress`, and also matches
 * any not-yet-backfilled `active` bytes still on disk so pre-backfill rows keep
 * showing. Canonical values pass through unchanged.
 */
function expandStatusFilter(input: TaskFilter['status']): string[] {
  const arr = Array.isArray(input) ? input : input ? [input] : [];
  const out = new Set<string>();
  for (const s of arr) {
    if (s === 'active') {
      out.add('todo');
      out.add('in_progress');
      out.add('active');
    } else {
      out.add(s);
    }
  }
  return [...out];
}

export function listTasks(filter: TaskFilter = {}): TaskListRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];

  if (filter.status) {
    // Casts are runtime-safe: SQLite compares status as text, and the legacy
    // `active` token is intentionally outside the canonical enum type.
    const statuses = expandStatusFilter(filter.status);
    if (statuses.length === 1) {
      conditions.push(eq(tasks.status, statuses[0] as LifecycleTaskStatus));
    } else {
      conditions.push(inArray(tasks.status, statuses as LifecycleTaskStatus[]));
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
      // Named explicitly, not just the fallback: callers that specifically want
      // the user's drag order (the launcher does) shouldn't silently change
      // behavior if this default is ever repointed.
      case 'sortKey':       return [sql`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt)];
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
  return rows.map((r) => normalizeTaskRow(hydrateRow(r)));
}

export function getTask(id: string): TaskRecord | undefined {
  const db = getDb();
  const row = hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
  return row ? normalizeTaskRow(row) : undefined;
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

// ─── Entity links (docs/entity-links-spec.md) ────────────────────────
// Derived backlink index. Reconciliation is a pure function of a source's
// own link-bearing text. The create/update helpers reconcile inline as plain
// statements (so they compose inside an outer transaction such as triage, and
// stand alone otherwise); the pure-SQL trigger marks any bypass pending and
// read-repair heals it, so correctness never depends on the inline call.

type LinkSourceType = 'task' | 'note';

export interface BacklinkItem {
  sourceType: LinkSourceType;
  sourceId: string;
  /** Current title (null when the source is untitled). */
  title: string | null;
}

export interface OutgoingLinkItem {
  targetType: LinkSourceType;
  targetId: string;
  /** Current title, or null when unresolved/untitled. */
  title: string | null;
  /** False when the target no longer exists (an Obsidian-style unresolved link). */
  resolved: boolean;
}

/** Current link-bearing text for a source, or null if the row is gone. */
function getLinkTextsForSource(
  sourceType: LinkSourceType,
  sourceId: string,
): Array<string | null> | null {
  const db = getDb();
  if (sourceType === 'task') {
    const row = db
      .select({ description: tasks.description, body: tasks.body })
      .from(tasks)
      .where(eq(tasks.id, sourceId))
      .get();
    return row ? [row.description, row.body] : null;
  }
  const row = db.select({ body: notes.body }).from(notes).where(eq(notes.id, sourceId)).get();
  return row ? [row.body] : null;
}

/**
 * Replace a source's outgoing edges with those declared by `texts`.
 * Upsert-and-prune: unchanged edges keep their id/created_at, so it is
 * row-identical under retry. Runs on the caller's connection/transaction.
 */
function reconcileEntityLinks(
  sourceType: LinkSourceType,
  sourceId: string,
  texts: Array<string | null | undefined>,
): void {
  const db = getDb();
  const desired = linksFromTexts(texts);
  const desiredKeys = new Set(desired.map((e) => `${e.targetType}:${e.targetId}`));

  for (const e of desired) {
    db.insert(entityLinks)
      .values({
        id: uuidv7(),
        sourceType,
        sourceId,
        targetType: e.targetType,
        targetId: e.targetId,
      })
      .onConflictDoNothing()
      .run();
  }

  const existing = db
    .select({
      id: entityLinks.id,
      targetType: entityLinks.targetType,
      targetId: entityLinks.targetId,
    })
    .from(entityLinks)
    .where(and(eq(entityLinks.sourceType, sourceType), eq(entityLinks.sourceId, sourceId)))
    .all();
  const staleIds = existing
    .filter((r) => !desiredKeys.has(`${r.targetType}:${r.targetId}`))
    .map((r) => r.id);
  if (staleIds.length) {
    db.delete(entityLinks).where(inArray(entityLinks.id, staleIds)).run();
  }
}

/** Advance a source's links projection to its current source_revision. */
function advanceLinksProjection(sourceType: LinkSourceType, sourceId: string): void {
  const db = getDb();
  db.update(entityProjectionState)
    .set({ linksProjectedRevision: sql`${entityProjectionState.sourceRevision}` })
    .where(
      and(
        eq(entityProjectionState.sourceType, sourceType),
        eq(entityProjectionState.sourceId, sourceId),
      ),
    )
    .run();
}

/**
 * Ensure a projection row exists for a source and is marked caught up. Unlike
 * `advanceLinksProjection`, this CREATES the row when missing — used by the
 * full rebuild so legacy sources (which predate the triggers and have no row)
 * become tracked. Otherwise read-repair, which only scans existing rows, could
 * never discover them (docs/entity-links-spec.md §10).
 */
function ensureProjectionCaughtUp(sourceType: LinkSourceType, sourceId: string): void {
  const db = getDb();
  db.insert(entityProjectionState)
    .values({ sourceType, sourceId, sourceRevision: 1, linksProjectedRevision: 1 })
    .onConflictDoUpdate({
      target: [entityProjectionState.sourceType, entityProjectionState.sourceId],
      set: { linksProjectedRevision: sql`${entityProjectionState.sourceRevision}` },
    })
    .run();
}

/** The create/update fast path: reconcile edges from the row we just wrote and
 *  mark the projection caught up. Plain statements (no own transaction). */
function projectEntityLinksInline(
  sourceType: LinkSourceType,
  sourceId: string,
  texts: Array<string | null | undefined>,
): void {
  reconcileEntityLinks(sourceType, sourceId, texts);
  advanceLinksProjection(sourceType, sourceId);
}

/**
 * Run `fn` atomically. If a transaction is already open (e.g. the triage apply
 * core wraps createTask/updateTask), that outer transaction provides atomicity
 * and we must NOT open a nested one (drizzle's top-level transaction re-runs
 * BEGIN, which SQLite rejects). Otherwise open a fresh transaction so a row
 * write, its projection trigger, and reconciliation commit together — without
 * this, a concurrent writer can slip between the commit and the reconcile and
 * leave stale edges marked current (docs/entity-links-spec.md §6, R1/R3).
 * `immediate` acquires the write lock up front for read-then-write bodies
 * (read-repair), avoiding SQLITE_BUSY_SNAPSHOT under concurrent writers.
 */
function inEntityTx<T>(fn: () => T, immediate = false): T {
  if (getRawDb().inTransaction) return fn();
  const db = getDb();
  return immediate ? db.transaction(fn, { behavior: 'immediate' }) : db.transaction(fn);
}

/**
 * Reconcile every source whose text changed since its links projection last
 * caught up (source_revision > links_projected_revision). Recompute is
 * idempotent and order-independent, so at-least-once/out-of-order both
 * converge. Assumes the caller holds a transaction (see listBacklinks).
 */
function repairPendingLinks(): void {
  const db = getDb();
  const pending = db
    .select({
      sourceType: entityProjectionState.sourceType,
      sourceId: entityProjectionState.sourceId,
      sourceRevision: entityProjectionState.sourceRevision,
    })
    .from(entityProjectionState)
    .where(gt(entityProjectionState.sourceRevision, entityProjectionState.linksProjectedRevision))
    .all();
  for (const p of pending) {
    const texts = getLinkTextsForSource(p.sourceType, p.sourceId);
    if (texts === null) {
      // Source is gone (the delete trigger should have cleaned up; heal
      // defensively): drop its edges and projection row.
      db.delete(entityLinks)
        .where(and(eq(entityLinks.sourceType, p.sourceType), eq(entityLinks.sourceId, p.sourceId)))
        .run();
      db.delete(entityProjectionState)
        .where(
          and(
            eq(entityProjectionState.sourceType, p.sourceType),
            eq(entityProjectionState.sourceId, p.sourceId),
          ),
        )
        .run();
      continue;
    }
    reconcileEntityLinks(p.sourceType, p.sourceId, texts);
    // Advance to the revision observed at select time. If a concurrent writer
    // bumped it again after our read, it stays pending and repairs next pass.
    db.update(entityProjectionState)
      .set({ linksProjectedRevision: p.sourceRevision })
      .where(
        and(
          eq(entityProjectionState.sourceType, p.sourceType),
          eq(entityProjectionState.sourceId, p.sourceId),
        ),
      )
      .run();
  }
}

/** Current title for an entity: string|null title, or undefined if it's gone. */
function resolveEntityTitle(type: LinkSourceType, id: string): string | null | undefined {
  const db = getDb();
  if (type === 'task') {
    const row = db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, id)).get();
    return row ? row.title : undefined;
  }
  const row = db.select({ title: notes.title }).from(notes).where(eq(notes.id, id)).get();
  return row ? row.title : undefined;
}

export interface EntityTitleRef {
  type: LinkSourceType;
  id: string;
}

export interface EntityTitleResult {
  type: LinkSourceType;
  id: string;
  title: string | null;
  status: string;
}

/**
 * Resolve titles + status for a batch of entity refs. Read-only and
 * side-effect-free by design: link chips render dozens of these, and they must
 * NOT bump `last_viewed_at` (which the per-entity GET routes do) or fetch full
 * bodies. Unresolved refs are omitted (the caller renders them as unresolved).
 * At most two queries regardless of ref count.
 */
export function resolveEntityTitles(refs: EntityTitleRef[]): EntityTitleResult[] {
  if (refs.length === 0) return [];
  const db = getDb();
  const taskIds = [...new Set(refs.filter((r) => r.type === 'task').map((r) => r.id))];
  const noteIds = [...new Set(refs.filter((r) => r.type === 'note').map((r) => r.id))];
  const out = new Map<string, EntityTitleResult>();
  if (taskIds.length) {
    for (const t of db
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, taskIds))
      .all()) {
      out.set(`task:${t.id}`, { type: 'task', id: t.id, title: t.title, status: t.status });
    }
  }
  if (noteIds.length) {
    for (const n of db
      .select({ id: notes.id, title: notes.title, status: notes.status })
      .from(notes)
      .where(inArray(notes.id, noteIds))
      .all()) {
      out.set(`note:${n.id}`, { type: 'note', id: n.id, title: n.title, status: n.status });
    }
  }
  return refs
    .map((r) => out.get(`${r.type}:${r.id}`))
    .filter((x): x is EntityTitleResult => x !== undefined);
}

// Read helpers below assume read-repair has already run in the caller's
// transaction. They never open their own transaction.

function readBacklinks(targetType: LinkSourceType, targetId: string): BacklinkItem[] {
  const db = getDb();
  const rows = db
    .select({ sourceType: entityLinks.sourceType, sourceId: entityLinks.sourceId })
    .from(entityLinks)
    .where(and(eq(entityLinks.targetType, targetType), eq(entityLinks.targetId, targetId)))
    .all();
  const items: BacklinkItem[] = [];
  for (const r of rows) {
    if (r.sourceType === targetType && r.sourceId === targetId) continue; // filter self
    const title = resolveEntityTitle(r.sourceType, r.sourceId);
    if (title === undefined) continue; // source vanished; skip defensively
    items.push({ sourceType: r.sourceType, sourceId: r.sourceId, title });
  }
  return items;
}

function readOutgoing(sourceType: LinkSourceType, sourceId: string): OutgoingLinkItem[] {
  const db = getDb();
  return db
    .select({ targetType: entityLinks.targetType, targetId: entityLinks.targetId })
    .from(entityLinks)
    .where(and(eq(entityLinks.sourceType, sourceType), eq(entityLinks.sourceId, sourceId)))
    .all()
    .map((r) => {
      const title = resolveEntityTitle(r.targetType, r.targetId);
      return {
        targetType: r.targetType,
        targetId: r.targetId,
        title: title ?? null,
        resolved: title !== undefined,
      };
    });
}

/**
 * Backlinks + outgoing links for an entity, repaired and read in ONE
 * transaction so both reflect the same snapshot (a separate call per direction
 * could straddle a concurrent write). Repairs pending sources first, so a
 * source that just added its first link to the target — invisible from the
 * target's stale index — is discovered (docs/entity-links-spec.md §6, R7).
 */
export function listEntityLinksFor(
  type: LinkSourceType,
  id: string,
): { backlinks: BacklinkItem[]; outgoing: OutgoingLinkItem[] } {
  return inEntityTx(() => {
    repairPendingLinks();
    return { backlinks: readBacklinks(type, id), outgoing: readOutgoing(type, id) };
  }, true);
}

/** Backlinks only (repairs first). See listEntityLinksFor for the combined read. */
export function listBacklinks(targetType: LinkSourceType, targetId: string): BacklinkItem[] {
  return inEntityTx(() => {
    repairPendingLinks();
    return readBacklinks(targetType, targetId);
  }, true);
}

/** Outgoing links only (repairs first), with unresolved targets flagged. */
export function listOutgoingLinks(
  sourceType: LinkSourceType,
  sourceId: string,
): OutgoingLinkItem[] {
  return inEntityTx(() => {
    repairPendingLinks();
    return readOutgoing(sourceType, sourceId);
  }, true);
}

/** Delete edges whose source no longer exists. Never prunes unresolved targets
 *  (those are valid unresolved links). Returns rows removed. */
function pruneOrphanEdges(): number {
  const db = getDb();
  const a = db.run(
    sql`DELETE FROM entity_links WHERE source_type = 'task' AND source_id NOT IN (SELECT id FROM tasks)`,
  );
  const b = db.run(
    sql`DELETE FROM entity_links WHERE source_type = 'note' AND source_id NOT IN (SELECT id FROM notes)`,
  );
  return Number(a.changes ?? 0) + Number(b.changes ?? 0);
}

/**
 * Maintenance / backfill: reconcile every task and note's edges from scratch,
 * mark all projections caught up, and prune orphaned source rows. Idempotent.
 * Used by the post-migration lifecycle and the repair CLI.
 */
export function rebuildAllEntityLinks(): { sources: number; pruned: number } {
  const db = getDb();
  return inEntityTx(() => {
    const taskRows = db
      .select({ id: tasks.id, description: tasks.description, body: tasks.body })
      .from(tasks)
      .all();
    for (const t of taskRows) {
      reconcileEntityLinks('task', t.id, [t.description, t.body]);
      ensureProjectionCaughtUp('task', t.id);
    }
    const noteRows = db.select({ id: notes.id, body: notes.body }).from(notes).all();
    for (const n of noteRows) {
      reconcileEntityLinks('note', n.id, [n.body]);
      ensureProjectionCaughtUp('note', n.id);
    }
    const pruned = pruneOrphanEdges();
    return { sources: taskRows.length + noteRows.length, pruned };
  }, true);
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
  const row = inEntityTx(() => {
    const created = hydrateRow(db
      .insert(tasks)
      .values({
        ...rest,
        rawInput: input.rawInput ?? input.title,
        id: uuidv7(),
        // Generic creation defaults to Todo, the committed queue. A legacy
        // `active` from an in-flight caller normalizes to Todo too.
        status: normalizeTaskStatus(input.status ?? 'todo'),
        // A freshly created task enters its status now, so its lifecycle age is
        // known from creation (unlike mechanically backfilled legacy rows).
        statusChangedAt: now,
        contextTags: input.contextTags ?? [],
        attachments: dehydrateAttachments(attachments) ?? [],
        timesDeferred: 0,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get());
    projectEntityLinksInline('task', created.id, [created.description, created.body]);
    return created;
  });
  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  void syncEntity('task', row.id);
  return normalizeTaskRow(row);
}

export function updateTask(id: string, input: UpdateTaskInput, meta?: EntityVersionMeta): TaskRecord | null {
  const db = getDb();

  const existingRaw = hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
  if (!existingRaw) return null;
  const existing = normalizeTaskRow(existingRaw);

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
  // Generic updates NEVER change lifecycle status. The only sanctioned status
  // path is the semantic chokepoint (transitionTask / completeTask), which
  // bumps the revision, stamps lifecycle age, and writes the append-only
  // ledger. Drop any status the caller sent, and warn if it would have moved
  // the task — a mis-wired caller, not a silent lifecycle change.
  if (Object.prototype.hasOwnProperty.call(rest, 'status')) {
    const attempted = normalizeTaskStatus((rest as { status?: string }).status);
    if (attempted !== existing.status) {
      console.warn(
        `[queries] updateTask ignored a status change for ${id} (${existing.status} -> ${attempted}); use transitionTask/completeTask.`,
      );
    }
    delete (rest as { status?: unknown }).status;
  }
  const row = inEntityTx(() => {
    const updated = hydrateRow(db
      .update(tasks)
      .set({
        ...rest,
        ...(attachments !== undefined ? { attachments: dehydrateAttachments(attachments) ?? [] } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tasks.id, id))
      .returning()
      .get());
    if (bodyChanged || descriptionChanged) {
      projectEntityLinksInline('task', updated.id, [updated.description, updated.body]);
    }
    return updated;
  });
  void upsertEmbedding('task', row.id, buildEmbeddingText('task', row));
  void syncEntity('task', row.id);
  captureEntityVersion('task', row.id, taskSnapshot(existing), taskSnapshot(normalizeTaskRow(row)), meta, existing.updatedAt);
  return normalizeTaskRow(row);
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

// ─── Lifecycle command chokepoint ─────────────────────────────
// Every semantic lifecycle change (the transitions AND completion) funnels
// through here so all of them share one discipline: an immediate transaction,
// an optional expected-revision guard, a durable idempotency replay, an
// append-only ledger row, provenance capture, and mirror sync. Generic
// `update_task` never changes lifecycle status (see the guard in updateTask's
// callers / REST parsing) — this is the only sanctioned status-mutation path.

/** Provenance threaded from the mutation caller onto the lifecycle ledger. */
export interface LifecycleActorMeta {
  source?: EntityVersionSource; // 'human' | 'ai' | 'system'
  actorSessionId?: string | null;
  executionId?: string | null;
  runId?: string | null;
  reason?: string | null;
}

export interface TransitionTaskInput {
  taskId: string;
  command: TransitionCommand;
  /** Durable caller-supplied key. A retry with the same (task, key) replays the
   * original recorded result rather than re-applying — safe across lost
   * responses and even after the task later moved through other states. */
  idempotencyKey: string;
  /** Optimistic-concurrency guard: the status_changed_count the caller last
   * saw. If provided and stale, throws `conflict`. */
  expectedStatusChangedCount?: number;
  /** Coordinated stop: archive any live owning execution as part of this same
   * transaction before applying a terminal transition. Without it, archiving a
   * task with a live owning execution throws `active_execution`. */
  stopOwningExecutions?: boolean;
  meta?: LifecycleActorMeta;
}

export interface LifecycleOutcome {
  task: TaskRecord;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  statusChangedCount: number;
  recurring?: boolean;
  nextRecurrenceAt?: string | null;
  /** True when an idempotent replay returned the original recorded result. */
  replayed: boolean;
}

/**
 * A `blocked_on` reference is unresolved unless it names a task that is now
 * terminal (Done/Archived). Free-text blockers that are not a known task id
 * count as unresolved — we cannot prove resolution. Empty = not blocked.
 */
function isBlockerUnresolved(blockedOn: string | null | undefined): boolean {
  if (!blockedOn) return false;
  const dep = getDb().select({ status: tasks.status }).from(tasks).where(eq(tasks.id, blockedOn)).get();
  if (!dep) return true;
  return !isTerminal(normalizeTaskStatus(dep.status));
}

/**
 * Whether a non-archived agent execution owns this task. This is the durable
 * "live owning execution" signal used by the Consider precondition and the
 * terminal-transition guard. The finer runtime distinction (actively working
 * vs idle) is derived at the UI layer from session activity.
 */
function hasLiveOwningExecution(taskId: string): boolean {
  const row = getDb()
    .select({ id: executions.id })
    .from(executions)
    .innerJoin(executionTasks, eq(executionTasks.executionId, executions.id))
    .where(and(eq(executionTasks.taskId, taskId), eq(executions.status, 'active')))
    .get();
  return !!row;
}

/** Archive every live execution owning a task (the coordinated-stop half of
 * "Stop agents and change status"). The runtime cancel of a running agent is a
 * separate UI/runtime concern; this is the durable stopped state. */
function stopOwningExecutionsFor(taskId: string): void {
  const now = new Date().toISOString();
  const owners = getDb()
    .select({ id: executionTasks.executionId })
    .from(executionTasks)
    .innerJoin(executions, eq(executions.id, executionTasks.executionId))
    .where(and(eq(executionTasks.taskId, taskId), eq(executions.status, 'active')))
    .all()
    .map((r) => r.id);
  if (owners.length === 0) return;
  getDb()
    .update(executions)
    .set({ status: 'archived', archivedAt: now, pinnedAt: null, updatedAt: now })
    .where(inArray(executions.id, owners))
    .run();
}

/** Throw active_execution unless the caller opted into a coordinated stop, in
 * which case stop the owning executions here. Used before terminal transitions. */
function guardLiveExecutions(taskId: string, stop: boolean | undefined, action: string): void {
  if (!hasLiveOwningExecution(taskId)) return;
  if (stop) {
    stopOwningExecutionsFor(taskId);
    return;
  }
  throw new TaskLifecycleError(
    'active_execution',
    `An agent is working on this task. Stop it first, or ${action} and stop the agent together.`,
    { taskId },
  );
}

function recordLifecycleCommand(
  taskId: string,
  idempotencyKey: string,
  command: LifecycleCommand,
  from: string,
  to: string,
  statusChangedCount: number,
  meta: LifecycleActorMeta | undefined,
  result: LifecycleCommandResult,
): void {
  getDb()
    .insert(taskStatusChanges)
    .values({
      id: uuidv7(),
      taskId,
      idempotencyKey,
      command,
      fromStatus: from,
      toStatus: to,
      statusChangedCount,
      actorSource: meta?.source ?? 'human',
      actorSessionId: meta?.actorSessionId ?? null,
      executionId: meta?.executionId ?? null,
      runId: meta?.runId ?? null,
      reason: meta?.reason ?? null,
      result,
    })
    .run();
}

/** Look up a prior ledger row for an idempotent replay. */
function priorLifecycleCommand(taskId: string, idempotencyKey: string) {
  return getDb()
    .select()
    .from(taskStatusChanges)
    .where(and(eq(taskStatusChanges.taskId, taskId), eq(taskStatusChanges.idempotencyKey, idempotencyKey)))
    .get();
}

/**
 * Apply a semantic lifecycle transition. The single sanctioned path for
 * move_to_todo / move_to_consider / start / return_to_todo / reopen / archive /
 * restore. Throws {@link TaskLifecycleError} with a stable code on not_found,
 * invalid_transition, conflict, or consider_precondition. Never throws on an
 * idempotent replay.
 */
export function transitionTask(input: TransitionTaskInput): LifecycleOutcome {
  const { taskId, command, idempotencyKey } = input;
  return inEntityTx(() => {
    // 1. Idempotent replay — a retry of this exact command returns the original
    //    result even if the task has since moved elsewhere.
    const prior = priorLifecycleCommand(taskId, idempotencyKey);
    if (prior) {
      const task = getTask(taskId);
      if (!task) throw new TaskLifecycleError('not_found', `Task ${taskId} not found.`);
      const res = prior.result;
      return {
        task,
        fromStatus: res.fromStatus as TaskStatus,
        toStatus: res.toStatus as TaskStatus,
        statusChangedCount: res.statusChangedCount,
        recurring: res.recurring,
        nextRecurrenceAt: res.nextRecurrenceAt ?? null,
        replayed: true,
      };
    }

    // 2. Load and normalize.
    const raw = hydrateRow(getDb().select().from(tasks).where(eq(tasks.id, taskId)).get());
    if (!raw) throw new TaskLifecycleError('not_found', `Task ${taskId} not found.`);
    const task = normalizeTaskRow(raw);
    const from = task.status;

    // 3. Transition legality.
    if (!canApply(command, from)) {
      const valid = availableCommands(from).join(', ') || 'none';
      throw new TaskLifecycleError(
        'invalid_transition',
        `Cannot ${transitionLabel(command)} a task that is ${from}. Valid actions from ${from}: ${valid}.`,
        { from, command },
      );
    }

    // 4. Optimistic-concurrency guard.
    if (input.expectedStatusChangedCount != null && input.expectedStatusChangedCount !== task.statusChangedCount) {
      throw new TaskLifecycleError(
        'conflict',
        `Task changed since it was loaded (expected status-change count ${input.expectedStatusChangedCount}, now ${task.statusChangedCount}). Reload and retry.`,
        { expected: input.expectedStatusChangedCount, actual: task.statusChangedCount },
      );
    }

    // 5. Consider preconditions — never silently cleared; surfaced instead.
    if (command === 'move_to_consider') {
      const reasons = considerBlockers({
        hardDeadline: task.hardDeadline ?? null,
        recurrence: task.recurrence ?? null,
        hasUnresolvedBlocker: isBlockerUnresolved(task.blockedOn),
        hasLiveOwningExecution: hasLiveOwningExecution(taskId),
      });
      if (reasons.length) {
        throw new TaskLifecycleError(
          'consider_precondition',
          `Cannot move to Consider while this task has ${reasons.join(', ')}. Resolve or remove ${reasons.length > 1 ? 'those' : 'that'} first.`,
          { reasons },
        );
      }
    }

    // 5b. Archiving is terminal — it cannot displace a live owning execution
    //     without an explicit coordinated stop.
    if (command === 'archive') {
      guardLiveExecutions(taskId, input.stopOwningExecutions, 'archive');
    }

    // 6. Apply. Status change stamps a fresh lifecycle age and bumps revision.
    const to = targetState(command);
    const now = new Date().toISOString();
    const nextCount = task.statusChangedCount + 1;
    const patch: Partial<typeof tasks.$inferInsert> = {
      status: to,
      statusChangedCount: nextCount,
      statusChangedAt: now,
      updatedAt: now,
    };
    // Reopen clears CURRENT completion fields; the task_completions history and
    // its evidence are preserved.
    if (command === 'reopen') patch.completedAt = null;

    const updated = hydrateRow(getDb().update(tasks).set(patch).where(eq(tasks.id, taskId)).returning().get());

    // 7. Ledger + mirror (status drives frontmatter and archive placement).
    const result: LifecycleCommandResult = { fromStatus: from, toStatus: to, statusChangedCount: nextCount };
    recordLifecycleCommand(taskId, idempotencyKey, command, from, to, nextCount, input.meta, result);
    void syncEntity('task', taskId);

    return { task: normalizeTaskRow(updated), fromStatus: from, toStatus: to, statusChangedCount: nextCount, replayed: false };
  }, true);
}

export interface CompleteTaskInput {
  note?: string | null;
  idempotencyKey?: string;
  expectedStatusChangedCount?: number;
  /** Coordinated stop of a live owning execution as part of completing. */
  stopOwningExecutions?: boolean;
  meta?: LifecycleActorMeta;
}

/**
 * Complete a task. The only completion command: it records exactly one
 * `task_completions` occurrence and (for recurring tasks) advances recurrence
 * and ends WIP by returning the task to Todo. Transactional, revision-bumping,
 * and retry-safe via the same idempotency ledger as {@link transitionTask} — a
 * retry with the same key never duplicates completion history or double-advances
 * a recurrence. Returns null if the task does not exist; throws
 * {@link TaskLifecycleError} on an illegal completion or a stale revision.
 */
export function completeTask(id: string, input: CompleteTaskInput = {}): LifecycleOutcome | null {
  const idempotencyKey = input.idempotencyKey ?? uuidv7();
  return inEntityTx(() => {
    // Idempotent replay.
    const prior = priorLifecycleCommand(id, idempotencyKey);
    if (prior) {
      const task = getTask(id);
      if (!task) return null;
      const res = prior.result;
      return {
        task,
        fromStatus: res.fromStatus as TaskStatus,
        toStatus: res.toStatus as TaskStatus,
        statusChangedCount: res.statusChangedCount,
        recurring: res.recurring,
        nextRecurrenceAt: res.nextRecurrenceAt ?? null,
        replayed: true,
      };
    }

    const raw = hydrateRow(getDb().select().from(tasks).where(eq(tasks.id, id)).get());
    if (!raw) return null;
    const task = normalizeTaskRow(raw);
    const from = task.status;

    if (!canApply('complete', from)) {
      const valid = availableCommands(from).join(', ') || 'none';
      throw new TaskLifecycleError(
        'invalid_transition',
        `Cannot complete a task that is ${from}. Valid actions from ${from}: ${valid}.`,
        { from, command: 'complete' },
      );
    }
    if (input.expectedStatusChangedCount != null && input.expectedStatusChangedCount !== task.statusChangedCount) {
      throw new TaskLifecycleError(
        'conflict',
        `Task changed since it was loaded (expected status-change count ${input.expectedStatusChangedCount}, now ${task.statusChangedCount}). Reload and retry.`,
        { expected: input.expectedStatusChangedCount, actual: task.statusChangedCount },
      );
    }

    // Completing is terminal — a live owning execution must be stopped first
    // (or coordinated with stopOwningExecutions).
    guardLiveExecutions(id, input.stopOwningExecutions, 'complete');

    const now = new Date().toISOString();

    // Exactly one completion occurrence, whether or not recurring.
    getDb().insert(taskCompletions).values({ id: uuidv7(), taskId: id, completedAt: now, note: input.note ?? null }).run();

    if (task.recurrence) {
      // Recurring: record the occurrence, advance once, end WIP -> Todo. The
      // cadence anchors to the scheduled occurrence, not completion time.
      const nextDate = computeNextRecurrence(task.recurrence, now);
      const statusChanged = from !== 'todo';
      const nextCount = statusChanged ? task.statusChangedCount + 1 : task.statusChangedCount;
      const updated = hydrateRow(
        getDb()
          .update(tasks)
          .set({
            status: 'todo',
            nextRecurrenceAt: nextDate,
            lastProgressAt: now,
            updatedAt: now,
            statusChangedCount: nextCount,
            ...(statusChanged ? { statusChangedAt: now } : {}),
          })
          .where(eq(tasks.id, id))
          .returning()
          .get(),
      );
      const result: LifecycleCommandResult = {
        fromStatus: from,
        toStatus: 'todo',
        statusChangedCount: nextCount,
        recurring: true,
        nextRecurrenceAt: nextDate,
      };
      recordLifecycleCommand(id, idempotencyKey, 'complete', from, 'todo', nextCount, input.meta, result);
      void syncEntity('task', id);
      return { task: normalizeTaskRow(updated), fromStatus: from, toStatus: 'todo', statusChangedCount: nextCount, recurring: true, nextRecurrenceAt: nextDate, replayed: false };
    }

    // Non-recurring: close it out.
    const nextCount = task.statusChangedCount + 1;
    const updated = hydrateRow(
      getDb()
        .update(tasks)
        .set({ status: 'done', completedAt: now, updatedAt: now, statusChangedCount: nextCount, statusChangedAt: now })
        .where(eq(tasks.id, id))
        .returning()
        .get(),
    );
    const result: LifecycleCommandResult = { fromStatus: from, toStatus: 'done', statusChangedCount: nextCount, recurring: false };
    recordLifecycleCommand(id, idempotencyKey, 'complete', from, 'done', nextCount, input.meta, result);
    void syncEntity('task', id);
    return { task: normalizeTaskRow(updated), fromStatus: from, toStatus: 'done', statusChangedCount: nextCount, recurring: false, replayed: false };
  }, true);
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

// ─── Task-owned executions & review ───────────────────────────
// Ownership is many-to-many via `execution_tasks`: a task can be worked by many
// executions (several attempts = one In progress outcome), and an execution can
// own many tasks (a batch with shared context). Taskless quick work has no rows.
// Reading output only moves unread state; review is an explicit disposition tied
// to the exact output event.

/** Executions owning a task, newest first. */
export function getTaskExecutions(taskId: string): ExecutionRecord[] {
  return getDb()
    .select(getTableColumns(executions))
    .from(executions)
    .innerJoin(executionTasks, eq(executionTasks.executionId, executions.id))
    .where(eq(executionTasks.taskId, taskId))
    .orderBy(desc(executions.createdAt))
    .all();
}

/** Tasks an execution owns, newest ownership first. */
export function getExecutionTasks(executionId: string): TaskRecord[] {
  const rows = getDb()
    .select(getTableColumns(tasks))
    .from(tasks)
    .innerJoin(executionTasks, eq(executionTasks.taskId, tasks.id))
    .where(eq(executionTasks.executionId, executionId))
    .orderBy(desc(executionTasks.createdAt))
    .all();
  return rows.map((r) => normalizeTaskRow(hydrateRow(r)));
}

/**
 * Record that an execution owns a task. Many-to-many, so it simply ensures the
 * (execution, task) pair exists — idempotent, never a conflict. Both must exist.
 */
export function attachExecutionToTask(executionId: string, taskId: string): ExecutionTaskRecord {
  return inEntityTx(() => {
    const exec = getDb().select({ id: executions.id }).from(executions).where(eq(executions.id, executionId)).get();
    if (!exec) throw new TaskLifecycleError('not_found', `Execution ${executionId} not found.`);
    const task = getDb().select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get();
    if (!task) throw new TaskLifecycleError('not_found', `Task ${taskId} not found.`);
    const existing = getDb()
      .select()
      .from(executionTasks)
      .where(and(eq(executionTasks.executionId, executionId), eq(executionTasks.taskId, taskId)))
      .get();
    if (existing) return existing;
    return getDb()
      .insert(executionTasks)
      .values({ id: uuidv7(), executionId, taskId })
      .returning()
      .get();
  });
}

/** Remove an ownership pair. Returns true if a row was removed. */
export function detachExecutionFromTask(executionId: string, taskId: string): boolean {
  const res = getDb()
    .delete(executionTasks)
    .where(and(eq(executionTasks.executionId, executionId), eq(executionTasks.taskId, taskId)))
    .run();
  return res.changes > 0;
}

export interface ReviewOutputInput {
  executionId: string;
  outputEventId: string;
  disposition: 'accepted' | 'changes_requested' | 'dismissed';
  actorSource?: EntityVersionSource;
  actorSessionId?: string | null;
  note?: string | null;
}

/**
 * Record a review disposition against an exact output event. Append-only: the
 * newest row for an output event is its current disposition, and new output
 * after the last reviewed output creates a fresh obligation. Reading output
 * never calls this.
 */
export function reviewExecutionOutput(input: ReviewOutputInput): ExecutionReviewRecord {
  const exec = getDb().select({ id: executions.id }).from(executions).where(eq(executions.id, input.executionId)).get();
  if (!exec) throw new TaskLifecycleError('not_found', `Execution ${input.executionId} not found.`);
  return getDb()
    .insert(executionReviews)
    .values({
      id: uuidv7(),
      executionId: input.executionId,
      outputEventId: input.outputEventId,
      disposition: input.disposition,
      actorSource: input.actorSource ?? 'human',
      actorSessionId: input.actorSessionId ?? null,
      note: input.note ?? null,
    })
    .returning()
    .get();
}

/** All review events for an execution, newest first. */
export function getExecutionReviews(executionId: string): ExecutionReviewRecord[] {
  return getDb()
    .select()
    .from(executionReviews)
    .where(eq(executionReviews.executionId, executionId))
    .orderBy(desc(executionReviews.createdAt), desc(executionReviews.id))
    .all();
}

/** The current (latest) disposition for a specific output event, if any. */
export function getLatestOutputReview(outputEventId: string): ExecutionReviewRecord | null {
  return (
    getDb()
      .select()
      .from(executionReviews)
      .where(eq(executionReviews.outputEventId, outputEventId))
      .orderBy(desc(executionReviews.createdAt), desc(executionReviews.id))
      .get() ?? null
  );
}

/** Durable lifecycle signals for a task, for badges and guards. Runtime
 * working/needs-input/stalled are layered on top at the UI from session
 * activity; these are the parts derivable from stored state. */
export function getTaskLifecycleSignals(taskId: string): {
  blocked: boolean;
  hasLiveExecution: boolean;
  executionCount: number;
} {
  const task = getDb().select({ blockedOn: tasks.blockedOn }).from(tasks).where(eq(tasks.id, taskId)).get();
  const execs = getTaskExecutions(taskId);
  return {
    blocked: isBlockerUnresolved(task?.blockedOn),
    hasLiveExecution: execs.some((e) => e.status === 'active'),
    executionCount: execs.length,
  };
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
  const row = inEntityTx(() => {
    const created = hydrateRow(db
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
    projectEntityLinksInline('note', created.id, [created.body]);
    return created;
  });
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
  const row = inEntityTx(() => {
    const updated = hydrateRow(db
      .update(notes)
      .set({
        ...rest,
        ...(attachments !== undefined ? { attachments: dehydrateAttachments(attachments) ?? [] } : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(notes.id, id))
      .returning()
      .get());
    if (bodyChanged) {
      projectEntityLinksInline('note', updated.id, [updated.body]);
    }
    return updated;
  });
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
    // Recorded for history/diff only, normalized so no snapshot preserves a
    // legacy `active`. Lifecycle is NOT restored on revert (see
    // snapshotToTaskInput) — reverting text never moves a task between lanes.
    status: normalizeTaskStatus(t.status),
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
  // Content-only restore. Lifecycle `status` and completion metadata are
  // deliberately NOT restored: an undo of an edit must never silently
  // un-complete a task or move it between lanes. Lifecycle changes only ever
  // happen through an explicit semantic transition command.
  return {
    ...(snap.title != null ? { title: snap.title } : {}),
    body: snap.body,
    description: snap.description ?? null,
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
  // Content-only restore (see snapshotToTaskInput). Note `status`
  // (active/archived) is a lifecycle field and is not rewound by a content undo.
  return {
    title: snap.title,
    body: snap.body,
    url: snap.url ?? null,
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
    status?: StreamStatus | StreamStatus[];
    passId?: string;
    limit?: number;
    offset?: number;
  } = {},
): StreamRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.status) {
    const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
    conditions.push(statuses.length === 1 ? eq(stream.status, statuses[0]) : inArray(stream.status, statuses));
  }
  if (filter.passId) {
    // Items touched by a pass = items referenced by any of the pass's decisions.
    conditions.push(sql`EXISTS (
      SELECT 1 FROM ${triageDecisions}
      WHERE ${triageDecisions.passId} = ${filter.passId}
        AND EXISTS (SELECT 1 FROM json_each(${triageDecisions.streamItemIds}) WHERE json_each.value = ${stream.id})
    )`);
  }
  const rows = db
    .select()
    .from(stream)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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

function streamInsertValues(input: CreateStreamInput): typeof stream.$inferInsert {
  const now = new Date().toISOString();
  const attachments = deriveAttachments({
    body: input.rawText ?? '',
    prior: [],
    newUploads: input.attachments ?? [],
  });

  const rest = withoutAttachments(input);
  return {
    ...rest,
    id: uuidv7(),
    source: input.source ?? 'capture',
    status: input.status ?? 'pending',
    attachments: dehydrateAttachments(attachments) ?? [],
    createdAt: input.createdAt ?? now,
  };
}

function finishCreatedStream(raw: typeof stream.$inferSelect): StreamRecord {
  const row = hydrateRow(raw);
  void upsertEmbedding('stream', row.id, buildEmbeddingText('stream', row));
  void syncEntity('stream', row.id);
  return row;
}

export function createStream(input: CreateStreamInput): StreamRecord {
  const row = getDb()
    .insert(stream)
    .values(streamInsertValues(input))
    .returning()
    .get();
  return finishCreatedStream(row);
}

/**
 * Atomically insert an externally identified Stream item. The partial unique
 * index on `(external_source, external_id)` is the cross-process retry guard.
 * A losing concurrent caller receives the already committed canonical row.
 */
export function createExternalStream(
  input: CreateStreamInput & { externalSource: string; externalId: string },
): { row: StreamRecord; created: boolean } {
  const inserted = getDb()
    .insert(stream)
    .values(streamInsertValues(input))
    .onConflictDoNothing()
    .returning()
    .get();

  if (inserted) {
    return { row: finishCreatedStream(inserted), created: true };
  }

  const existing = findStreamByExternalId(input.externalSource, input.externalId);
  if (!existing) {
    throw new Error('External Stream insert conflicted without a canonical row');
  }
  return { row: existing, created: false };
}

/**
 * Placeholder raw_text values written by the capture route when async
 * preprocessing (transcription / image extraction) hasn't produced real
 * content yet. These are the ONLY raw_text values that may be rewritten —
 * the retry path filling in a real transcript. See the immutability guard
 * in `updateStream` and docs/streaming-spec-tasks.md §1.2.
 */
export function streamRawTextIsPlaceholder(rawText: string): boolean {
  const head = rawText.trimStart();
  return (
    head.startsWith('[Voice memo, transcription failed]') ||
    head.startsWith('[Voice memo, pending transcription]') ||
    head.startsWith('[Images, extraction pending]')
  );
}

export function updateStream(id: string, input: UpdateStreamInput): StreamRecord | null {
  const db = getDb();

  const existing = hydrateRow(db.select().from(stream).where(eq(stream.id, id)).get());
  if (!existing) return null;

  const bodyChanged = Object.prototype.hasOwnProperty.call(input, 'rawText');

  // Trust contract: the user's original words are immutable. The one
  // exception is preprocessing retry replacing a placeholder with the first
  // successful transcript/extraction.
  if (
    bodyChanged &&
    input.rawText !== existing.rawText &&
    existing.rawText.trim() !== '' &&
    !streamRawTextIsPlaceholder(existing.rawText)
  ) {
    throw new TriageError(
      'invalid_params',
      'Stream raw_text is immutable once captured. Corrections live on the derived task or note.',
    );
  }
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

/**
 * Dismiss is triage: it now records a decision (telemetry + undo) instead of
 * bare-stamping the status. Signature kept for existing callers.
 */
export function dismissStream(id: string, dismissedBy = 'user'): StreamRecord | null {
  const item = getStream(id);
  if (!item) return null;
  recordTriageDecisionAndApply(
    {
      disposition: 'dismiss',
      streamItemIds: [id],
      actor: dismissedBy === 'agent' ? 'agent' : 'user',
    },
    'accepted',
  );
  return getStream(id) ?? null;
}

// ─── Stream Triage ────────────────────────────────────────────
// The reconciliation layer. Every disposition (agent OR manual UI) flows
// through recordTriageDecisionAndApply / applyTriageDecision so that:
//   - provenance lands in stream_links (many-to-many, source of truth)
//   - acceptance telemetry lands in triage_decisions
//   - undo has a precise record to reverse
// See docs/streaming-spec-tasks.md Part 3.

/** Typed error the orchestrator action layer maps to ActionError and API
 *  routes map to HTTP status codes. */
export class TriageError extends Error {
  constructor(
    public code: 'not_found' | 'invalid_params' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'TriageError';
  }
}

const STALE_PASS_MS = 10 * 60_000;
/** Executed (auto-applied) decisions settle into "accepted" after this many
 *  days without a correction or undo. */
export const EXECUTED_SETTLES_AFTER_DAYS = 7;

export const ENTITY_DISPOSITIONS: TriageDisposition[] = [
  'promote_task', 'promote_note', 'merge_task', 'merge_note', 'combine_task', 'combine_note',
];

export const DEFAULT_AUTONOMY_LEVELS: Record<TriageDisposition, StreamAutonomyLevel> = {
  promote_task: 'suggest',
  promote_note: 'suggest',
  merge_task: 'suggest',
  merge_note: 'suggest',
  combine_task: 'suggest',
  combine_note: 'suggest',
  // A no-op with a record: the cheapest trust to build, auto from day one.
  journal: 'auto_digest',
  dismiss: 'suggest',
  incubate: 'suggest',
};

// ── Autonomy config ──────────────────────────────────────────

export interface ResolvedStreamAutonomy {
  killSwitch: boolean;
  levels: Record<TriageDisposition, StreamAutonomyLevel>;
}

export function getStreamAutonomy(): ResolvedStreamAutonomy {
  const config = getUserState()?.streamAutonomy ?? null;
  const levels = { ...DEFAULT_AUTONOMY_LEVELS, ...(config?.levels ?? {}) };
  return { killSwitch: config?.killSwitch ?? false, levels };
}

export function setStreamAutonomy(config: StreamAutonomyConfig): ResolvedStreamAutonomy {
  const existing = getUserState()?.streamAutonomy ?? {};
  updateUserState({
    streamAutonomy: {
      killSwitch: config.killSwitch ?? existing.killSwitch ?? false,
      levels: { ...(existing.levels ?? {}), ...(config.levels ?? {}) },
    },
  });
  return getStreamAutonomy();
}

/** The level policy enforcement actually applies: kill switch wins. */
export function effectiveAutonomyLevel(disposition: TriageDisposition): StreamAutonomyLevel {
  const { killSwitch, levels } = getStreamAutonomy();
  if (killSwitch) return 'suggest';
  return levels[disposition];
}

// ── Passes ───────────────────────────────────────────────────

/**
 * The single-flight lock: at most one live sweep. A `running` pass older
 * than the staleness window is dead (crashed session, lost run) — mark it
 * failed so the queue never wedges. Items touched by a failed pass are
 * still pending/proposed, never half-disposed.
 */
export function findRunningTriagePass(): TriagePassRecord | null {
  const db = getDb();
  const row = db
    .select()
    .from(triagePasses)
    .where(eq(triagePasses.status, 'running'))
    .orderBy(desc(triagePasses.createdAt))
    .get();
  if (!row) return null;
  if (Date.now() - new Date(row.createdAt).getTime() > STALE_PASS_MS) {
    db.update(triagePasses)
      .set({ status: 'failed', summary: row.summary ?? 'Sweep did not finish and was marked stale.', completedAt: new Date().toISOString() })
      .where(eq(triagePasses.id, row.id))
      .run();
    return null;
  }
  return row;
}

export function createTriagePass(
  trigger: TriagePassTrigger,
  opts: { sessionId?: string | null; itemsSeen?: number } = {},
): TriagePassRecord {
  const running = findRunningTriagePass();
  if (running) {
    throw new TriageError('conflict', `A sweep is already running (pass ${running.id}, started ${running.createdAt}).`);
  }
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(triagePasses)
    .values({
      id: uuidv7(),
      trigger,
      status: 'running',
      sessionId: opts.sessionId ?? null,
      itemsSeen: opts.itemsSeen ?? 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function getTriagePass(id: string): TriagePassRecord | null {
  const db = getDb();
  return db.select().from(triagePasses).where(eq(triagePasses.id, id)).get() ?? null;
}

export function listTriagePasses(
  filter: { status?: TriagePassRecord['status']; limit?: number } = {},
): TriagePassRecord[] {
  const db = getDb();
  return db
    .select()
    .from(triagePasses)
    .where(filter.status ? eq(triagePasses.status, filter.status) : undefined)
    .orderBy(desc(triagePasses.createdAt))
    .limit(filter.limit ?? 20)
    .all();
}

/** Finalize a pass. Counts derive from its decisions unless provided. */
export function completeTriagePass(
  id: string,
  opts: { summary?: string | null; itemsSeen?: number } = {},
): TriagePassRecord | null {
  const db = getDb();
  const pass = getTriagePass(id);
  if (!pass) return null;
  const decisions = listTriageDecisions({ passId: id });
  const itemIds = new Set(decisions.flatMap((d) => d.streamItemIds));
  return db
    .update(triagePasses)
    .set({
      status: 'completed',
      summary: opts.summary ?? pass.summary,
      itemsSeen: opts.itemsSeen ?? Math.max(pass.itemsSeen, itemIds.size),
      autoApplied: decisions.filter((d) => d.state === 'executed').length,
      proposed: decisions.filter((d) => d.state === 'proposed').length,
      completedAt: new Date().toISOString(),
    })
    .where(eq(triagePasses.id, id))
    .returning()
    .get() ?? null;
}

export function failTriagePass(id: string, reason?: string): TriagePassRecord | null {
  const db = getDb();
  return db
    .update(triagePasses)
    .set({ status: 'failed', summary: reason ?? null, completedAt: new Date().toISOString() })
    .where(eq(triagePasses.id, id))
    .returning()
    .get() ?? null;
}

export function markTriagePassDigestSeen(id: string): TriagePassRecord | null {
  const db = getDb();
  return db
    .update(triagePasses)
    .set({ digestSeenAt: new Date().toISOString() })
    .where(eq(triagePasses.id, id))
    .returning()
    .get() ?? null;
}

// ── Links (provenance source of truth) ───────────────────────

export function createStreamLinks(rows: CreateStreamLinkInput[]): StreamLinkRecord[] {
  if (rows.length === 0) return [];
  const db = getDb();
  const now = new Date().toISOString();
  return db
    .insert(streamLinks)
    .values(rows.map((r) => ({ ...r, id: uuidv7(), createdAt: now, updatedAt: now })))
    .returning()
    .all();
}

export function listStreamLinks(streamId: string): StreamLinkRecord[] {
  const db = getDb();
  return db
    .select()
    .from(streamLinks)
    .where(eq(streamLinks.streamId, streamId))
    .orderBy(asc(streamLinks.createdAt))
    .all();
}

/** Captures that produced this entity — the reverse lookup shared by the UI
 *  and the markdown mirror (Sources sections). */
export function getStreamSources(entityType: 'task' | 'note', entityId: string): StreamRecord[] {
  const db = getDb();
  const rows = db
    .select({ s: stream })
    .from(streamLinks)
    .innerJoin(stream, eq(stream.id, streamLinks.streamId))
    .where(and(eq(streamLinks.entityType, entityType), eq(streamLinks.entityId, entityId)))
    .orderBy(asc(streamLinks.createdAt))
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

/** Where a capture went, with entity titles for outcome annotations. */
export function getStreamOutcomes(streamId: string): StreamOutcome[] {
  return batchStreamOutcomes([streamId]).get(streamId) ?? [];
}

function batchStreamOutcomes(streamIds: string[]): Map<string, StreamOutcome[]> {
  const map = new Map<string, StreamOutcome[]>();
  if (streamIds.length === 0) return map;
  const db = getDb();
  const links = db
    .select()
    .from(streamLinks)
    .where(inArray(streamLinks.streamId, streamIds))
    .orderBy(asc(streamLinks.createdAt))
    .all();
  if (links.length === 0) return map;

  const taskIds = [...new Set(links.filter((l) => l.entityType === 'task').map((l) => l.entityId))];
  const noteIds = [...new Set(links.filter((l) => l.entityType === 'note').map((l) => l.entityId))];
  const titles = new Map<string, string | null>();
  if (taskIds.length > 0) {
    for (const t of db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, taskIds)).all()) {
      titles.set(`task:${t.id}`, t.title);
    }
  }
  if (noteIds.length > 0) {
    for (const n of db.select({ id: notes.id, title: notes.title }).from(notes).where(inArray(notes.id, noteIds)).all()) {
      titles.set(`note:${n.id}`, n.title);
    }
  }
  for (const l of links) {
    const key = `${l.entityType}:${l.entityId}`;
    if (!titles.has(key)) continue; // entity deleted — stale link, skip in UI
    const outcome: StreamOutcome = {
      entityType: l.entityType,
      entityId: l.entityId,
      relation: l.relation,
      entityTitle: titles.get(key) ?? null,
      decisionId: l.decisionId,
    };
    const list = map.get(l.streamId) ?? [];
    list.push(outcome);
    map.set(l.streamId, list);
  }
  return map;
}

/** Ledger view: stream rows plus their outcome annotations, one batch. */
export function listStreamWithOutcomes(
  filter: Parameters<typeof listStream>[0] = {},
): StreamRecordWithOutcomes[] {
  const items = listStream(filter);
  const outcomes = batchStreamOutcomes(items.map((i) => i.id));
  return items.map((i) => ({ ...i, outcomes: outcomes.get(i.id) ?? [] }));
}

// ── Non-destructive appends (T0.1) ───────────────────────────

/**
 * Append content to a note body, never replacing it. Versioned through the
 * normal update path so undo has a snapshot to restore. Returns the version
 * created by the append (the undo handle), null when versioning was a no-op.
 */
export function appendToNote(
  noteId: string,
  content: string,
  meta?: EntityVersionMeta,
): { note: NoteRecord; versionId: string | null } | null {
  const note = getNote(noteId);
  if (!note) return null;
  const trimmed = content.trim();
  if (!trimmed) return { note, versionId: null };
  const body = note.body.trim() ? `${note.body.replace(/\s+$/, '')}\n\n${trimmed}` : trimmed;
  const updated = updateNote(noteId, { body }, meta ?? { source: 'ai', summary: 'Appended from stream capture' });
  if (!updated) return null;
  const versions = listEntityVersions('note', noteId, { limit: 1 });
  return { note: updated, versionId: versions[0]?.id ?? null };
}

const TASK_CONTEXT_HEADING = '## Context';

/**
 * Append context to a task body under a `## Context` heading (created when
 * absent). Same versioning contract as appendToNote.
 */
export function appendTaskContext(
  taskId: string,
  content: string,
  meta?: EntityVersionMeta,
): { task: TaskRecord; versionId: string | null } | null {
  const task = getTask(taskId);
  if (!task) return null;
  const trimmed = content.trim();
  if (!trimmed) return { task, versionId: null };
  const existingBody = (task.body ?? '').replace(/\s+$/, '');
  const body = existingBody
    ? existingBody.includes(TASK_CONTEXT_HEADING)
      ? `${existingBody}\n\n${trimmed}`
      : `${existingBody}\n\n${TASK_CONTEXT_HEADING}\n\n${trimmed}`
    : `${TASK_CONTEXT_HEADING}\n\n${trimmed}`;
  const updated = updateTask(taskId, { body }, meta ?? { source: 'ai', summary: 'Added context from stream capture' });
  if (!updated) return null;
  const versions = listEntityVersions('task', taskId, { limit: 1 });
  return { task: updated, versionId: versions[0]?.id ?? null };
}

// ── Decisions ────────────────────────────────────────────────

export interface TriageDecisionInput {
  disposition: TriageDisposition;
  streamItemIds: string[];
  targetType?: 'task' | 'note' | null;
  targetId?: string | null;
  draft?: TriageDraft | null;
  rationale?: string | null;
  confidence?: number | null;
  passId?: string | null;
  actor: TriageActor;
}

export interface TriageApplyResult {
  decision: TriageDecisionRecord;
  streamItems: StreamRecord[];
  /** Entity created by promote/combine, or the merge target. Null for
   *  journal/dismiss/incubate. */
  entity: { entityType: 'task' | 'note'; entityId: string } | null;
  created: TaskRecord | NoteRecord | null;
  entityVersionId: string | null;
}

export interface TriageUndoResult {
  decision: TriageDecisionRecord;
  /** Whether the derived entity's content was actually reversed. False when
   *  later edits made automatic reversal unsafe — links and statuses are
   *  still reset, and `reason` explains what to do manually. */
  entityReverted: boolean;
  entityRemoved: 'deleted' | 'archived' | null;
  reason?: string;
  streamItems: StreamRecord[];
}

export function getTriageDecision(id: string): TriageDecisionRecord | null {
  const db = getDb();
  return db.select().from(triageDecisions).where(eq(triageDecisions.id, id)).get() ?? null;
}

export function listTriageDecisions(
  filter: {
    passId?: string;
    state?: TriageDecisionState | TriageDecisionState[];
    disposition?: TriageDisposition;
    actor?: TriageActor;
    streamItemId?: string;
    sinceDays?: number;
    limit?: number;
  } = {},
): TriageDecisionRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.passId) conditions.push(eq(triageDecisions.passId, filter.passId));
  if (filter.state) {
    const states = Array.isArray(filter.state) ? filter.state : [filter.state];
    conditions.push(states.length === 1 ? eq(triageDecisions.state, states[0]) : inArray(triageDecisions.state, states));
  }
  if (filter.disposition) conditions.push(eq(triageDecisions.disposition, filter.disposition));
  if (filter.actor) conditions.push(eq(triageDecisions.actor, filter.actor));
  if (filter.streamItemId) {
    conditions.push(sql`EXISTS (SELECT 1 FROM json_each(${triageDecisions.streamItemIds}) WHERE json_each.value = ${filter.streamItemId})`);
  }
  if (filter.sinceDays) {
    const since = new Date(Date.now() - filter.sinceDays * 86_400_000).toISOString();
    conditions.push(gte(triageDecisions.createdAt, since));
  }
  return db
    .select()
    .from(triageDecisions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(triageDecisions.createdAt))
    .limit(filter.limit ?? 500)
    .all();
}

/** Server-side draft validation — the contract the prompt can't bypass. */
export function validateTriageDecisionInput(input: TriageDecisionInput): void {
  const { disposition, streamItemIds, draft, targetType, targetId } = input;
  if (streamItemIds.length === 0) {
    throw new TriageError('invalid_params', 'A triage decision needs at least one stream item.');
  }
  if (new Set(streamItemIds).size !== streamItemIds.length) {
    throw new TriageError('invalid_params', 'Duplicate stream item ids in one decision.');
  }
  if ((disposition === 'combine_task' || disposition === 'combine_note') && streamItemIds.length < 2) {
    throw new TriageError('invalid_params', 'Combine needs at least two stream items. Use promote for a single item.');
  }
  if ((draft?.hardDeadline || draft?.reminderAt) && !draft?.evidence?.trim()) {
    throw new TriageError(
      'invalid_params',
      'Dates require evidence: quote the exact source words that state the deadline or time.',
    );
  }
  if (disposition === 'promote_task' || disposition === 'combine_task') {
    if (!draft?.title?.trim()) {
      throw new TriageError('invalid_params', 'Creating a task requires a non-empty draft.title.');
    }
  }
  if (disposition === 'merge_task' || disposition === 'merge_note') {
    const wanted = disposition === 'merge_task' ? 'task' : 'note';
    if (!targetId || (targetType ?? wanted) !== wanted) {
      throw new TriageError('invalid_params', `merge_${wanted} requires targetId of an existing ${wanted}.`);
    }
  }
  if (disposition === 'incubate' && !draft?.resurfaceAt) {
    throw new TriageError('invalid_params', 'Incubate requires draft.resurfaceAt (when to bring it back).');
  }
  if (draft?.resurfaceAt && Number.isNaN(Date.parse(draft.resurfaceAt))) {
    throw new TriageError('invalid_params', `draft.resurfaceAt is not a parseable date: ${draft.resurfaceAt}`);
  }
}

/** Statuses a decision may be applied against. */
const APPLICABLE_ITEM_STATUSES: StreamStatus[] = ['pending', 'proposed', 'incubating'];

function loadDecisionItems(streamItemIds: string[]): StreamRecord[] {
  const items = streamItemIds.map((id) => {
    const item = getStream(id);
    if (!item) throw new TriageError('not_found', `Stream item not found: ${id}`);
    return item;
  });
  for (const item of items) {
    if (!APPLICABLE_ITEM_STATUSES.includes(item.status)) {
      const outcomes = getStreamOutcomes(item.id);
      const where = outcomes[0] ? ` (→ ${outcomes[0].entityType} ${outcomes[0].entityId})` : '';
      throw new TriageError('conflict', `Stream item ${item.id} is already ${item.status}${where}.`);
    }
  }
  return items;
}

function dispositionRelation(d: TriageDisposition): 'created' | 'merged_into' | 'combined_into' {
  if (d === 'merge_task' || d === 'merge_note') return 'merged_into';
  if (d === 'combine_task' || d === 'combine_note') return 'combined_into';
  return 'created';
}

/** Union of the items' attachments (deduped by fileName) for created entities. */
function collectItemAttachments(items: StreamRecord[]): Attachment[] {
  const seen = new Set<string>();
  const out: Attachment[] = [];
  for (const item of items) {
    for (const a of item.attachments ?? []) {
      if (seen.has(a.fileName)) continue;
      seen.add(a.fileName);
      out.push(a);
    }
  }
  return out;
}

/**
 * Recompute an item's status (and legacy stamp columns) from its decisions
 * and links. The ONE place lifecycle state is derived, so multi-decision
 * splits, undo, and correction all converge on the same rules:
 *   any proposed decision      → proposed
 *   any applied entity outcome → promoted
 *   else applied incubate      → incubating
 *   else applied journal       → reviewed
 *   else applied dismiss       → dismissed
 *   nothing standing           → pending
 * Items with no decisions at all are left untouched (legacy rows).
 */
export function recomputeStreamStatus(streamId: string): StreamRecord | null {
  const existing = getStream(streamId);
  if (!existing) return null;
  const decisions = listTriageDecisions({ streamItemId: streamId });
  if (decisions.length === 0) return existing;

  const applied = decisions.filter((d) => d.state === 'executed' || d.state === 'accepted');
  const anyProposed = decisions.some((d) => d.state === 'proposed');

  let status: StreamStatus;
  if (anyProposed) status = 'proposed';
  else if (applied.some((d) => ENTITY_DISPOSITIONS.includes(d.disposition))) status = 'promoted';
  else if (applied.some((d) => d.disposition === 'incubate')) status = 'incubating';
  else if (applied.some((d) => d.disposition === 'journal')) status = 'reviewed';
  else if (applied.some((d) => d.disposition === 'dismiss')) status = 'dismissed';
  else status = 'pending';

  const dismissDecision = [...applied].reverse().find((d) => d.disposition === 'dismiss');
  const incubateDecision = [...applied].reverse().find((d) => d.disposition === 'incubate');

  const patch: UpdateStreamInput = {
    status,
    dismissedBy: status === 'dismissed' ? (dismissDecision?.actor ?? existing.dismissedBy ?? 'user') : null,
    resurfaceAt: status === 'incubating' ? (incubateDecision?.draft?.resurfaceAt ?? existing.resurfaceAt ?? null) : null,
  };
  return updateStream(streamId, patch);
}

/**
 * The transactional apply core. Never opens its own transaction — callers
 * own that — and never leaves a half-applied decision: any throw rolls the
 * whole thing back.
 */
function executeDecisionWithin(
  decision: TriageDecisionRecord,
  finalState: 'executed' | 'accepted',
): TriageApplyResult {
  const db = getDb();
  const items = loadDecisionItems(decision.streamItemIds);
  const draft = decision.draft ?? {};
  const now = new Date().toISOString();
  const joinedRaw = items.map((i) => i.rawText).join('\n\n---\n\n');

  let entity: TriageApplyResult['entity'] = null;
  let created: TaskRecord | NoteRecord | null = null;
  let entityVersionId: string | null = null;

  switch (decision.disposition) {
    case 'promote_task':
    case 'combine_task': {
      // Consider is a possibility, not a commitment: it never carries a
      // deadline or reminder. Todo (the default) may.
      const toConsider = draft.status === 'consider';
      const task = createTask({
        rawInput: joinedRaw,
        title: draft.title!.trim(),
        body: draft.body ?? joinedRaw,
        description: draft.description ?? undefined,
        status: toConsider ? 'consider' : 'todo',
        areaId: draft.areaId ?? null,
        parentId: draft.parentId ?? null,
        energy: draft.energy ?? null,
        effort: draft.effort ?? null,
        hardDeadline: toConsider ? null : draft.hardDeadline ?? null,
        reminderAt: toConsider ? null : draft.reminderAt ?? null,
        streamItemId: items[0]?.id ?? null,
        attachments: collectItemAttachments(items),
      });
      created = task;
      entity = { entityType: 'task', entityId: task.id };
      break;
    }
    case 'promote_note':
    case 'combine_note': {
      const note = createNote({
        title: draft.title ?? undefined,
        body: draft.body ?? joinedRaw,
        areaId: draft.areaId ?? null,
        taskId: draft.taskId ?? null,
        attachments: collectItemAttachments(items),
      });
      created = note;
      entity = { entityType: 'note', entityId: note.id };
      break;
    }
    case 'merge_task': {
      const target = getTask(decision.targetId!);
      if (!target) throw new TriageError('not_found', `Merge target task not found: ${decision.targetId}`);
      if (draft.expectedTargetUpdatedAt && draft.expectedTargetUpdatedAt !== target.updatedAt) {
        throw new TriageError(
          'conflict',
          `Task ${target.id} changed since the proposal was made (expected updated_at ${draft.expectedTargetUpdatedAt}, now ${target.updatedAt}). Re-review with fresh state.`,
        );
      }
      if (draft.asSubtask) {
        const subtask = createTask({
          rawInput: joinedRaw,
          title: draft.title?.trim() || firstLineTitle(joinedRaw),
          body: draft.body ?? joinedRaw,
          parentId: target.id,
          areaId: draft.areaId ?? target.areaId ?? null,
          energy: draft.energy ?? null,
          effort: draft.effort ?? null,
          streamItemId: items[0]?.id ?? null,
          attachments: collectItemAttachments(items),
        });
        created = subtask;
        entity = { entityType: 'task', entityId: subtask.id };
      } else {
        const appended = appendTaskContext(target.id, draft.body ?? joinedRaw, {
          source: decision.actor === 'agent' ? 'ai' : 'human',
          summary: 'Merged from stream capture',
        });
        if (!appended) throw new TriageError('not_found', `Merge target task not found: ${decision.targetId}`);
        entityVersionId = appended.versionId;
        entity = { entityType: 'task', entityId: target.id };
      }
      break;
    }
    case 'merge_note': {
      const target = getNote(decision.targetId!);
      if (!target) throw new TriageError('not_found', `Merge target note not found: ${decision.targetId}`);
      if (draft.expectedTargetUpdatedAt && draft.expectedTargetUpdatedAt !== target.updatedAt) {
        throw new TriageError(
          'conflict',
          `Note ${target.id} changed since the proposal was made (expected updated_at ${draft.expectedTargetUpdatedAt}, now ${target.updatedAt}). Re-review with fresh state.`,
        );
      }
      const appended = appendToNote(target.id, draft.body ?? joinedRaw, {
        source: decision.actor === 'agent' ? 'ai' : 'human',
        summary: 'Merged from stream capture',
      });
      if (!appended) throw new TriageError('not_found', `Merge target note not found: ${decision.targetId}`);
      entityVersionId = appended.versionId;
      entity = { entityType: 'note', entityId: target.id };
      break;
    }
    case 'journal':
    case 'dismiss':
      break;
    case 'incubate':
      break;
  }

  if (entity) {
    // asSubtask merges CREATE a fresh entity — the link says so, matching
    // the undo semantics (delete/archive the subtask, not revert an append).
    const relation =
      decision.disposition === 'merge_task' && draft.asSubtask
        ? 'created'
        : dispositionRelation(decision.disposition);
    createStreamLinks(
      items.map((item) => ({
        streamId: item.id,
        entityType: entity!.entityType,
        entityId: entity!.entityId,
        relation,
        decisionId: decision.id,
      })),
    );
  }

  const db2 = db
    .update(triageDecisions)
    .set({
      state: finalState,
      decidedAt: now,
      targetType: entity?.entityType ?? decision.targetType ?? null,
      targetId: entity?.entityId ?? decision.targetId ?? null,
      entityVersionId,
      updatedAt: now,
    })
    .where(eq(triageDecisions.id, decision.id))
    .returning()
    .get();

  const streamItems = decision.streamItemIds
    .map((id) => recomputeStreamStatus(id))
    .filter((r): r is StreamRecord => r != null);

  return { decision: db2, streamItems, entity, created, entityVersionId };
}

/**
 * Create a decision and apply it in one atomic step. The path for manual UI
 * triage (actor 'user', finalState 'accepted') and for agent execute-actions
 * that policy allows to run (actor 'agent', finalState 'executed').
 */
export function recordTriageDecisionAndApply(
  input: TriageDecisionInput,
  finalState: 'executed' | 'accepted',
): TriageApplyResult {
  validateTriageDecisionInput(input);
  const db = getDb();
  return db.transaction(() => {
    const now = new Date().toISOString();
    const decision = db
      .insert(triageDecisions)
      .values({
        id: uuidv7(),
        passId: input.passId ?? null,
        streamItemIds: input.streamItemIds,
        disposition: input.disposition,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        draft: input.draft ?? null,
        confidence: input.confidence ?? null,
        rationale: input.rationale ?? null,
        state: 'proposed',
        actor: input.actor,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return executeDecisionWithin(decision, finalState);
  });
}

/**
 * Write suggest-mode proposals: decisions in state `proposed`, items flipped
 * to status `proposed`. Nothing mutates until the user (or policy) applies.
 */
export function proposeTriageDecisions(
  proposals: TriageDecisionInput[],
  passId: string | null,
): TriageDecisionRecord[] {
  for (const p of proposals) validateTriageDecisionInput(p);
  // Validate item existence/status up front so a batch is all-or-nothing.
  for (const p of proposals) loadDecisionItems(p.streamItemIds);
  const db = getDb();
  return db.transaction(() => {
    const now = new Date().toISOString();
    const rows = proposals.map((p) =>
      db
        .insert(triageDecisions)
        .values({
          id: uuidv7(),
          passId,
          streamItemIds: p.streamItemIds,
          disposition: p.disposition,
          targetType: p.targetType ?? null,
          targetId: p.targetId ?? null,
          draft: p.draft ?? null,
          confidence: p.confidence ?? null,
          rationale: p.rationale ?? null,
          state: 'proposed',
          actor: p.actor,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
    );
    const itemIds = new Set(rows.flatMap((r) => r.streamItemIds));
    for (const id of itemIds) recomputeStreamStatus(id);
    return rows;
  });
}

/**
 * Apply a proposed decision. Idempotent: an already-applied decision returns
 * its prior result shape instead of double-applying.
 */
export function applyTriageDecision(
  id: string,
  opts: { decidedBy: 'user' | 'policy' },
): TriageApplyResult {
  const db = getDb();
  return db.transaction(() => {
    const decision = getTriageDecision(id);
    if (!decision) throw new TriageError('not_found', `Triage decision not found: ${id}`);
    if (decision.state === 'executed' || decision.state === 'accepted') {
      return {
        decision,
        streamItems: decision.streamItemIds.map((sid) => getStream(sid)).filter((r): r is StreamRecord => r != null),
        entity: decision.targetType && decision.targetId ? { entityType: decision.targetType, entityId: decision.targetId } : null,
        created: null,
        entityVersionId: decision.entityVersionId,
      };
    }
    if (decision.state !== 'proposed') {
      throw new TriageError('conflict', `Triage decision is already ${decision.state}.`);
    }
    return executeDecisionWithin(decision, opts.decidedBy === 'user' ? 'accepted' : 'executed');
  });
}

/** Any human edit (version with source 'human') after `sinceIso`? */
function entityEditedByHumanSince(
  entityType: 'task' | 'note',
  entityId: string,
  sinceIso: string,
): boolean {
  return listEntityVersions(entityType, entityId).some(
    (v) => v.source === 'human' && v.createdAt > sinceIso,
  );
}

/**
 * System archive routed through the lifecycle chokepoint (never a raw status
 * write). No-op when the task is already terminal. Used by internal undo paths.
 */
function archiveTaskSystem(taskId: string, reason: string): boolean {
  const t = getTask(taskId);
  if (!t || isTerminal(t.status)) return false;
  transitionTask({ taskId, command: 'archive', idempotencyKey: uuidv7(), meta: { source: 'system', reason } });
  return true;
}

/** Delete a created-from-stream task when safe, archive when it has grown
 *  children or completions. Undo must never destroy other work. */
function removeCreatedTaskForUndo(taskId: string): 'deleted' | 'archived' | null {
  const db = getDb();
  const childCount = db.select({ c: sql<number>`count(*)` }).from(tasks).where(eq(tasks.parentId, taskId)).get()?.c ?? 0;
  const completionCount = db.select({ c: sql<number>`count(*)` }).from(taskCompletions).where(eq(taskCompletions.taskId, taskId)).get()?.c ?? 0;
  if (childCount > 0 || completionCount > 0) {
    archiveTaskSystem(taskId, 'Archived by triage undo (task had grown)');
    return 'archived';
  }
  return deleteTask(taskId) ? 'deleted' : null;
}

/** Shared effect-reversal used by undo and by correcting an applied decision. */
function reverseDecisionEffectsWithin(decision: TriageDecisionRecord): {
  entityReverted: boolean;
  entityRemoved: 'deleted' | 'archived' | null;
  reason?: string;
} {
  const db = getDb();
  let entityReverted = false;
  let entityRemoved: 'deleted' | 'archived' | null = null;
  let reason: string | undefined;

  const isCreate =
    decision.disposition === 'promote_task' ||
    decision.disposition === 'promote_note' ||
    decision.disposition === 'combine_task' ||
    decision.disposition === 'combine_note' ||
    // asSubtask merges created a fresh entity too
    ((decision.disposition === 'merge_task') && !!decision.draft?.asSubtask);

  if (decision.targetType && decision.targetId && ENTITY_DISPOSITIONS.includes(decision.disposition)) {
    const appliedAt = decision.decidedAt ?? decision.updatedAt;
    if (isCreate) {
      const entityId = decision.targetId;
      const exists = decision.targetType === 'task' ? !!getTask(entityId) : !!getNote(entityId);
      if (!exists) {
        reason = 'The created entity is already gone.';
      } else if (entityEditedByHumanSince(decision.targetType, entityId, appliedAt)) {
        // Human work on top: archive, never delete.
        if (decision.targetType === 'task') {
          archiveTaskSystem(entityId, 'Archived (not deleted) by undo: you edited it after it was created');
        } else {
          updateNote(entityId, { status: 'archived' }, { source: 'system', summary: 'Archived (not deleted) by undo: you edited it after it was created' });
        }
        entityRemoved = 'archived';
        entityReverted = true;
        reason = 'Archived instead of deleted because you edited it after it was created.';
      } else if (decision.targetType === 'task') {
        entityRemoved = removeCreatedTaskForUndo(entityId);
        entityReverted = entityRemoved != null;
      } else {
        entityRemoved = deleteNote(entityId) ? 'deleted' : null;
        entityReverted = entityRemoved != null;
      }
    } else {
      // Merge/append: revert through entity versions when ours is still the
      // latest content change; otherwise refuse the automatic revert.
      if (!decision.entityVersionId) {
        reason = 'No version snapshot was recorded for this append, so it must be edited out manually.';
      } else {
        const versions = listEntityVersions(decision.targetType, decision.targetId);
        if (versions[0]?.id !== decision.entityVersionId) {
          reason = 'The entity was edited after this append. Review its version history to unwind it manually.';
        } else {
          const before = versions[1];
          if (before && revertEntityTo(before.id)) {
            entityReverted = true;
          } else {
            reason = 'No prior version to restore. Review the entity manually.';
          }
        }
      }
    }
  }

  // Provenance for a reversed decision goes away regardless.
  db.delete(streamLinks).where(eq(streamLinks.decisionId, decision.id)).run();
  return { entityReverted, entityRemoved, reason };
}

/** For asSubtask merges the created subtask id lives on targetId already. */
function isCreateSubtask(decision: TriageDecisionRecord): string | null {
  return decision.disposition === 'merge_task' && decision.draft?.asSubtask ? decision.targetId : null;
}

/**
 * Undo a decision per the spec's exact table (3.10). Proposed decisions are
 * simply rejected. Applied decisions reverse their effects; when reversal is
 * unsafe (human edits on top) the links and statuses still reset and the
 * result says why the content was left alone. Never touches stream items'
 * raw text, never deletes attachments, always returns items toward pending.
 */
export function undoTriageDecision(id: string): TriageUndoResult {
  const db = getDb();
  return db.transaction(() => {
    const decision = getTriageDecision(id);
    if (!decision) throw new TriageError('not_found', `Triage decision not found: ${id}`);
    if (decision.state === 'undone') {
      return {
        decision,
        entityReverted: false,
        entityRemoved: null,
        reason: 'Already undone.',
        streamItems: decision.streamItemIds.map((sid) => getStream(sid)).filter((r): r is StreamRecord => r != null),
      };
    }
    if (decision.state === 'corrected') {
      throw new TriageError('conflict', 'This decision was corrected. Undo the correction decision instead.');
    }

    let effects: { entityReverted: boolean; entityRemoved: 'deleted' | 'archived' | null; reason?: string } = {
      entityReverted: false,
      entityRemoved: null,
    };
    if (decision.state === 'executed' || decision.state === 'accepted') {
      effects = reverseDecisionEffectsWithin(decision);
    }

    const now = new Date().toISOString();
    const updated = db
      .update(triageDecisions)
      .set({ state: 'undone', undoneAt: now, updatedAt: now })
      .where(eq(triageDecisions.id, id))
      .returning()
      .get();

    const streamItems = decision.streamItemIds
      .map((sid) => recomputeStreamStatus(sid))
      .filter((r): r is StreamRecord => r != null);

    return { decision: updated, ...effects, streamItems };
  });
}

export interface TriageCorrection {
  disposition: TriageDisposition;
  targetType?: 'task' | 'note' | null;
  targetId?: string | null;
  draft?: TriageDraft | null;
}

/**
 * The re-route affordance: the user changes what a decision did (or was
 * about to do). The original is marked `corrected` (rich telemetry signal),
 * its effects are reversed if it had applied, and the corrected action runs
 * as a fresh user decision.
 */
export function correctTriageDecision(
  id: string,
  correction: TriageCorrection,
): { original: TriageDecisionRecord; applied: TriageApplyResult } {
  const db = getDb();
  return db.transaction(() => {
    const decision = getTriageDecision(id);
    if (!decision) throw new TriageError('not_found', `Triage decision not found: ${id}`);
    if (decision.state === 'undone' || decision.state === 'corrected') {
      throw new TriageError('conflict', `Triage decision is already ${decision.state}.`);
    }
    if (decision.state === 'executed' || decision.state === 'accepted') {
      reverseDecisionEffectsWithin(decision);
    }
    const now = new Date().toISOString();
    const original = db
      .update(triageDecisions)
      .set({ state: 'corrected', correctedDisposition: correction.disposition, decidedAt: decision.decidedAt ?? now, updatedAt: now })
      .where(eq(triageDecisions.id, id))
      .returning()
      .get();

    // Reset items so the corrected action can apply cleanly.
    for (const sid of decision.streamItemIds) recomputeStreamStatus(sid);

    const applied = recordTriageDecisionAndApplyWithin({
      disposition: correction.disposition,
      streamItemIds: decision.streamItemIds,
      targetType: correction.targetType ?? null,
      targetId: correction.targetId ?? null,
      draft: correction.draft ?? decision.draft ?? null,
      rationale: null,
      confidence: null,
      passId: decision.passId,
      actor: 'user',
    });
    return { original, applied };
  });
}

/** Same as recordTriageDecisionAndApply but transaction-less — for callers
 *  already inside one (SQLite has no nested BEGIN). */
function recordTriageDecisionAndApplyWithin(input: TriageDecisionInput): TriageApplyResult {
  validateTriageDecisionInput(input);
  const db = getDb();
  const now = new Date().toISOString();
  const decision = db
    .insert(triageDecisions)
    .values({
      id: uuidv7(),
      passId: input.passId ?? null,
      streamItemIds: input.streamItemIds,
      disposition: input.disposition,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      draft: input.draft ?? null,
      confidence: input.confidence ?? null,
      rationale: input.rationale ?? null,
      state: 'proposed',
      actor: input.actor,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return executeDecisionWithin(decision, 'accepted');
}

/**
 * Return a terminal item to `pending`. For promoted items this DETACHES:
 * single-item decisions are marked undone and links removed, but derived
 * entities are left alone (use undoTriageDecision to reverse content).
 * Items inside a multi-item combine must be unwound via their decision.
 */
export function reopenStream(id: string): StreamRecord | null {
  const db = getDb();
  return db.transaction(() => {
    const item = getStream(id);
    if (!item) return null;
    if (item.status === 'pending') return item;

    const decisions = listTriageDecisions({ streamItemId: id, state: ['proposed', 'executed', 'accepted'] });
    for (const d of decisions) {
      if (d.streamItemIds.length > 1) {
        throw new TriageError(
          'conflict',
          `Stream item ${id} is part of a combined outcome (decision ${d.id}). Undo that decision instead.`,
        );
      }
    }
    const now = new Date().toISOString();
    for (const d of decisions) {
      db.delete(streamLinks).where(eq(streamLinks.decisionId, d.id)).run();
      db.update(triageDecisions)
        .set({ state: 'undone', undoneAt: now, updatedAt: now })
        .where(eq(triageDecisions.id, d.id))
        .run();
    }
    // Rows migrated from the pre-decisions era carry links with a null
    // decisionId — detach those too.
    db.delete(streamLinks).where(and(eq(streamLinks.streamId, id), isNull(streamLinks.decisionId))).run();

    if (listTriageDecisions({ streamItemId: id }).length > 0) {
      return recomputeStreamStatus(id);
    }
    return updateStream(id, { status: 'pending', dismissedBy: null, resurfaceAt: null });
  });
}

/** Incubating items whose resurface time has arrived → back to pending. */
export function resurfaceDueStreamItems(now: Date = new Date()): StreamRecord[] {
  const db = getDb();
  const due = db
    .select()
    .from(stream)
    .where(and(eq(stream.status, 'incubating'), lte(stream.resurfaceAt, now.toISOString())))
    .all()
    .map((r) => hydrateRow(r));
  const out: StreamRecord[] = [];
  for (const item of due) {
    const updated = updateStream(item.id, { status: 'pending', resurfaceAt: null });
    if (updated) out.push(updated);
  }
  return out;
}

// ── Acceptance telemetry (the moat metric) ───────────────────

export interface AcceptanceStats {
  disposition: TriageDisposition;
  accepted: number;
  corrected: number;
  undone: number;
  /** Auto-applied, still inside the settling window — not yet in the rate. */
  pendingExecuted: number;
  sample: number;
  /** accepted / (accepted + corrected + undone), null when sample is 0. */
  rate: number | null;
}

function classifyDecided(d: TriageDecisionRecord, nowMs: number): 'accepted' | 'corrected' | 'undone' | 'pendingExecuted' | null {
  if (d.state === 'accepted') return 'accepted';
  if (d.state === 'corrected') return 'corrected';
  if (d.state === 'undone') return 'undone';
  if (d.state === 'executed') {
    const decided = d.decidedAt ? new Date(d.decidedAt).getTime() : new Date(d.updatedAt).getTime();
    return nowMs - decided >= EXECUTED_SETTLES_AFTER_DAYS * 86_400_000 ? 'accepted' : 'pendingExecuted';
  }
  return null; // proposed — not decided yet
}

/**
 * Acceptance per disposition. Defaults to agent decisions only — the user's
 * own manual triage is ground truth for few-shot context, not a measure of
 * agent performance.
 */
export function getAcceptanceStats(
  opts: { actor?: TriageActor; windowDays?: number } = {},
): AcceptanceStats[] {
  const decisions = listTriageDecisions({
    actor: opts.actor ?? 'agent',
    sinceDays: opts.windowDays,
    limit: 10_000,
  });
  const nowMs = Date.now();
  const byDisposition = new Map<TriageDisposition, AcceptanceStats>();
  for (const d of decisions) {
    const bucket = classifyDecided(d, nowMs);
    if (!bucket) continue;
    const stats = byDisposition.get(d.disposition) ?? {
      disposition: d.disposition,
      accepted: 0, corrected: 0, undone: 0, pendingExecuted: 0, sample: 0, rate: null,
    };
    stats[bucket]++;
    byDisposition.set(d.disposition, stats);
  }
  for (const stats of byDisposition.values()) {
    stats.sample = stats.accepted + stats.corrected + stats.undone;
    stats.rate = stats.sample > 0 ? stats.accepted / stats.sample : null;
  }
  return [...byDisposition.values()];
}

/**
 * Trailing-window acceptance for the demotion rule: the last `n` settled
 * agent decisions of a disposition. Undos weigh heavier than accepts — one
 * undo also cancels one accept's worth of credit.
 */
export function getTrailingAcceptance(
  disposition: TriageDisposition,
  n: number,
): { rate: number | null; sample: number } {
  const decisions = listTriageDecisions({ actor: 'agent', disposition, limit: 200 });
  const nowMs = Date.now();
  const settled = decisions
    .map((d) => classifyDecided(d, nowMs))
    .filter((b): b is 'accepted' | 'corrected' | 'undone' => b === 'accepted' || b === 'corrected' || b === 'undone')
    .slice(0, n);
  if (settled.length === 0) return { rate: null, sample: 0 };
  let credit = 0;
  for (const b of settled) {
    if (b === 'accepted') credit += 1;
    else if (b === 'corrected') credit -= 0.5;
    else credit -= 1; // undone
  }
  const rate = Math.max(0, Math.min(1, credit / settled.length));
  return { rate, sample: settled.length };
}

/** First line of raw capture text, clipped to a title-sized length. */
export function firstLineTitle(rawText: string): string {
  const firstLine = rawText.trim().split('\n')[0] ?? '';
  return firstLine.length <= 200 ? firstLine : firstLine.slice(0, 199).trimEnd() + '…';
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

// ─── Agent Harness Settings ──────────────────────────────────

export function getAgentHarnessSettings(harness: HarnessId): AgentHarnessSettingsRecord | undefined {
  return getDb().select().from(agentHarnessSettings)
    .where(eq(agentHarnessSettings.harness, harness)).get();
}

export function listAgentHarnessSettings(): AgentHarnessSettingsRecord[] {
  return getDb().select().from(agentHarnessSettings).orderBy(asc(agentHarnessSettings.harness)).all();
}

/**
 * Lazily materialize one settings row. Claude and Codex inherit a small,
 * useful default allowlist from the bundled fallback catalog. Dynamic-only
 * harnesses intentionally start empty until the user chooses live models.
 */
export function ensureAgentHarnessSettings(harness: HarnessId): AgentHarnessSettingsRecord {
  const existing = getAgentHarnessSettings(harness);
  if (existing) return existing;
  const state = getUserState();
  const bundled = modelsForProvider(harness).map((model) => model.id);
  const preferred = state?.defaultAgentHarness === harness ? state.defaultAgentModel : null;
  // Claude's bundled entries are tier aliases rather than pinned versions, so
  // the whole set stays useful indefinitely and all of it is seeded. Codex's
  // list is a versioned catalog whose tail is superseded, so only the current
  // models are seeded and the rest stay one toggle away in settings.
  const enabledModels = [...new Set([
    ...(preferred ? [preferred] : []),
    ...bundled.slice(0, 4),
  ])];
  return upsertAgentHarnessSettings({
    harness,
    enabledModels,
    customModels: [],
    defaultModel: preferred && enabledModels.includes(preferred) ? preferred : enabledModels[0] ?? null,
    defaultVariant: null,
    defaultEffort: state?.defaultAgentHarness === harness && (harness === 'claude' || harness === 'codex')
      ? state.defaultAgentEffort
      : null,
    catalogRefreshedAt: null,
  });
}

export function upsertAgentHarnessSettings(
  input: UpsertAgentHarnessSettingsInput,
): AgentHarnessSettingsRecord {
  const now = new Date().toISOString();
  const id = input.id ?? `harness:${input.harness}`;
  return getDb().insert(agentHarnessSettings)
    .values({ ...input, id, updatedAt: now })
    .onConflictDoUpdate({
      target: agentHarnessSettings.harness,
      set: {
        enabledModels: input.enabledModels,
        // Omitted on the callers that only touch the allowlist, so the pinned
        // ids survive a plain model save instead of being reset to empty.
        ...(input.customModels ? { customModels: input.customModels } : {}),
        defaultModel: input.defaultModel,
        defaultVariant: input.defaultVariant,
        defaultEffort: input.defaultEffort,
        catalogRefreshedAt: input.catalogRefreshedAt,
        updatedAt: now,
      },
    })
    .returning().get();
}

function normalizeEnabledModels(models: string[]): string[] {
  const normalized = models.map((model) => model.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) throw new Error('Enabled models must be unique');
  return normalized;
}

export function setEnabledHarnessModels(
  harness: HarnessId,
  models: string[],
  requestedDefault?: string | null,
): AgentHarnessSettingsRecord {
  const enabledModels = normalizeEnabledModels(models);
  const db = getDb();
  return db.transaction((tx) => {
    const existing = tx.select().from(agentHarnessSettings)
      .where(eq(agentHarnessSettings.harness, harness)).get();
    const defaultModel = requestedDefault ?? existing?.defaultModel ?? enabledModels[0] ?? null;
    if (defaultModel && !enabledModels.includes(defaultModel)) {
      throw new Error('The default model must be enabled');
    }
    const active = tx.select().from(userState).where(eq(userState.id, 1)).get()?.defaultAgentHarness;
    if (active === harness && enabledModels.length === 0) {
      throw new Error('The active harness must have at least one enabled model');
    }
    const now = new Date().toISOString();
    return tx.insert(agentHarnessSettings)
      .values({
        id: `harness:${harness}`,
        harness,
        enabledModels,
        defaultModel,
        defaultVariant: existing?.defaultVariant,
        defaultEffort: existing?.defaultEffort,
        catalogRefreshedAt: existing?.catalogRefreshedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: agentHarnessSettings.harness,
        set: { enabledModels, defaultModel, updatedAt: now },
      })
      .returning().get();
  });
}

/**
 * Pin an exact provider model id the catalog does not offer.
 *
 * Custom ids join `enabledModels` in the same write: a pinned model that is
 * invisible in the picker is indistinguishable from one that never saved, and
 * every downstream validator (session PATCH, dispatch preflight, the enabled
 * allowlist route) reads the merged catalog rather than the raw column.
 */
export function addCustomHarnessModel(harness: HarnessId, modelId: string): AgentHarnessSettingsRecord {
  const id = normalizeCustomModelId(modelId);
  if (!id) throw new Error('Enter a model ID with no spaces, for example claude-opus-4-8');
  ensureAgentHarnessSettings(harness);
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(agentHarnessSettings)
      .where(eq(agentHarnessSettings.harness, harness)).get()!;
    const customModels = [...new Set([...row.customModels, id])];
    const enabledModels = [...new Set([...row.enabledModels, id])];
    return tx.update(agentHarnessSettings).set({
      customModels,
      enabledModels,
      defaultModel: row.defaultModel ?? id,
      updatedAt: new Date().toISOString(),
    }).where(eq(agentHarnessSettings.harness, harness)).returning().get();
  });
}

/**
 * Drop a pinned model id. It leaves the allowlist with it, because a pin has
 * no catalog entry to fall back to and an enabled row that resolves to nothing
 * is worse than a missing one. The exception is an id that shadows a bundled
 * model (someone pinned `gpt-5.4` by hand): that one still resolves without
 * the pin, so unpinning must not also hide it from the picker.
 */
export function removeCustomHarnessModel(harness: HarnessId, modelId: string): AgentHarnessSettingsRecord {
  const id = modelId.trim();
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(agentHarnessSettings)
      .where(eq(agentHarnessSettings.harness, harness)).get();
    if (!row) throw new Error(`No settings for ${harness}`);
    if (!row.customModels.includes(id)) return row;
    const customModels = row.customModels.filter((entry) => entry !== id);
    const shadowsCatalogModel = modelsForProvider(harness).some((model) => model.id === id);
    const enabledModels = shadowsCatalogModel
      ? row.enabledModels
      : row.enabledModels.filter((entry) => entry !== id);
    const active = tx.select().from(userState).where(eq(userState.id, 1)).get()?.defaultAgentHarness;
    if (active === harness && enabledModels.length === 0) {
      throw new Error('The active harness must have at least one enabled model');
    }
    const replacesDefault = row.defaultModel === id && !shadowsCatalogModel;
    const defaultModel = replacesDefault ? enabledModels[0] ?? null : row.defaultModel;
    const now = new Date().toISOString();
    const updated = tx.update(agentHarnessSettings).set({
      customModels,
      enabledModels,
      defaultModel,
      // The pinned model owned this pair; the replacement advertises its own.
      defaultVariant: replacesDefault ? null : row.defaultVariant,
      defaultEffort: replacesDefault ? null : row.defaultEffort,
      updatedAt: now,
    }).where(eq(agentHarnessSettings.harness, harness)).returning().get();
    if (replacesDefault && active === harness) {
      tx.update(userState).set({
        defaultAgentModel: defaultModel,
        defaultAgentEffort: null,
        updatedAt: now,
      }).where(eq(userState.id, 1)).run();
    }
    return updated;
  });
}

export function setHarnessDefaultSelection(
  harness: HarnessId,
  selection: { model: string; variant?: string | null; effort?: AgentHarnessSettingsRecord['defaultEffort'] },
): AgentHarnessSettingsRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(agentHarnessSettings)
      .where(eq(agentHarnessSettings.harness, harness)).get();
    if (!row || !row.enabledModels.includes(selection.model)) throw new Error('The default model must be enabled');
    const updated = tx.update(agentHarnessSettings).set({
      defaultModel: selection.model,
      defaultVariant: selection.variant ?? null,
      defaultEffort: selection.effort ?? null,
      updatedAt: new Date().toISOString(),
    }).where(eq(agentHarnessSettings.harness, harness)).returning().get();
    const active = tx.select().from(userState).where(eq(userState.id, 1)).get()?.defaultAgentHarness;
    if (active === harness) {
      tx.update(userState).set({
        defaultAgentModel: selection.model,
        defaultAgentEffort: selection.effort ?? null,
        updatedAt: new Date().toISOString(),
      }).where(eq(userState.id, 1)).run();
    }
    return updated;
  });
}

export function setActiveHarness(harness: HarnessId): AgentHarnessSettingsRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(agentHarnessSettings)
      .where(eq(agentHarnessSettings.harness, harness)).get();
    if (!row?.defaultModel || !row.enabledModels.includes(row.defaultModel)) {
      throw new Error('The selected harness needs an enabled default model');
    }
    tx.update(userState).set({
      defaultAgentHarness: harness,
      defaultAgentModel: row.defaultModel,
      defaultAgentEffort: row.defaultEffort,
      updatedAt: new Date().toISOString(),
    }).where(eq(userState.id, 1)).run();
    return row;
  });
}

export function beginProviderDisconnectSaga(input: {
  upstreamProviderId: string;
  replacementHarness?: HarnessId | null;
  replacementModel?: string | null;
}): AgentHarnessOperationRecord {
  const db = getDb();
  return db.transaction((tx) => {
    if (input.replacementHarness) {
      const replacement = tx.select().from(agentHarnessSettings)
        .where(eq(agentHarnessSettings.harness, input.replacementHarness)).get();
      if (!replacement || !input.replacementModel || !replacement.enabledModels.includes(input.replacementModel)) {
        throw new Error('A valid enabled replacement selection is required');
      }
      tx.update(userState).set({
        defaultAgentHarness: input.replacementHarness,
        defaultAgentModel: input.replacementModel,
        defaultAgentEffort: replacement.defaultEffort,
        updatedAt: new Date().toISOString(),
      }).where(eq(userState.id, 1)).run();
    }
    return tx.insert(agentHarnessOperations).values({
      id: uuidv7(),
      harness: 'opencode',
      operation: 'disconnect_upstream_provider',
      upstreamProviderId: input.upstreamProviderId,
      status: 'pending',
      replacementHarness: input.replacementHarness ?? null,
      replacementModel: input.replacementModel ?? null,
    }).returning().get();
  });
}

export function completeProviderDisconnectSaga(id: string): AgentHarnessOperationRecord | undefined {
  return getDb().update(agentHarnessOperations).set({
    status: 'completed', lastErrorCode: null, updatedAt: new Date().toISOString(),
  }).where(eq(agentHarnessOperations.id, id)).returning().get();
}

export function failProviderDisconnectSaga(id: string, safeErrorCode: string): AgentHarnessOperationRecord | undefined {
  return getDb().update(agentHarnessOperations).set({
    status: 'failed', lastErrorCode: safeErrorCode.slice(0, 100), updatedAt: new Date().toISOString(),
  }).where(eq(agentHarnessOperations.id, id)).returning().get();
}

export function getProviderDisconnectSaga(id: string): AgentHarnessOperationRecord | undefined {
  return getDb().select().from(agentHarnessOperations).where(eq(agentHarnessOperations.id, id)).get();
}

export function listRetryableProviderDisconnectSagas(): AgentHarnessOperationRecord[] {
  return getDb().select().from(agentHarnessOperations)
    .where(inArray(agentHarnessOperations.status, ['pending', 'failed']))
    .orderBy(asc(agentHarnessOperations.createdAt)).all();
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

// ─── Reference folders ────────────────────────────────────────
// Read-only folders a workspace's agents may consult. See
// docs/reference-folders-spec.md. `workspaceId: null` rows are global and
// surface in every workspace.

/** Aliases must survive being typed after `@` without ambiguity against a path. */
const REFERENCE_ALIAS_RE = /^[a-z0-9][a-z0-9._-]*$/;

export class ReferenceFolderError extends Error {
  constructor(
    public code: 'invalid_params' | 'conflict' | 'not_found',
    message: string,
  ) {
    super(message);
    this.name = 'ReferenceFolderError';
  }
}

/**
 * Normalize a user-supplied alias. Lowercased and trimmed, because the alias
 * is a typing affordance and case-sensitivity here would only ever surprise.
 */
export function normalizeReferenceAlias(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Turn whatever the user typed into an absolute path.
 *
 * `~` matters: the folder picker and every `/api/fs` route expand it, so a
 * path typed by hand has to behave the same way. Without this, `~/code/api`
 * resolves against the *server process* cwd and the reference renders as
 * missing even though the folder is right there. Relative paths get the same
 * treatment for the same reason.
 */
export function normalizeReferencePath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('~')) {
    return nodePath.join(os.homedir(), trimmed.slice(1).replace(/^[/\\]/, ''));
  }
  return nodePath.resolve(trimmed);
}

/**
 * Columns a caller may set. Everything else (`id`, `createdAt`, `updatedAt`,
 * `status`, `archivedAt`) is owned by this layer.
 *
 * HTTP routes hand us `await request.json()` cast to the input type, which is
 * a compile-time claim and nothing more. Spreading that straight into `.set()`
 * let a stray `id` in the body rewrite the primary key and orphan the row, so
 * the whitelist lives here rather than at each route — the orchestrator
 * actions, the routes, and any future caller all get it.
 */
const REFERENCE_FOLDER_WRITABLE = [
  'workspaceId',
  'alias',
  'path',
  'targetWorkspaceId',
  'description',
  'position',
] as const;

function pickReferenceFolderFields<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of REFERENCE_FOLDER_WRITABLE) {
    if (key in input) out[key as keyof T] = input[key as keyof T];
  }
  return out;
}

/**
 * The partial unique indexes are the real arbiter of alias uniqueness. The
 * pre-check above gives a better message, but two concurrent creates can both
 * pass it, so translate the constraint violation rather than letting a raw
 * SQLite error escape as a 500.
 */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

function assertValidReferenceAlias(alias: string): void {
  if (!REFERENCE_ALIAS_RE.test(alias)) {
    throw new ReferenceFolderError(
      'invalid_params',
      `Invalid alias "${alias}". Use lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.`,
    );
  }
}

/**
 * Exactly one target. The DB has a CHECK for this as a backstop, but raising
 * here gives the caller a message that says which field to fix.
 */
function assertOneTarget(path: string | null | undefined, targetWorkspaceId: string | null | undefined): void {
  const hasPath = path != null && path.length > 0;
  const hasWorkspace = targetWorkspaceId != null && targetWorkspaceId.length > 0;
  if (hasPath === hasWorkspace) {
    throw new ReferenceFolderError(
      'invalid_params',
      hasPath
        ? 'A reference folder takes either a path or a target workspace, not both.'
        : 'A reference folder needs either a path or a target workspace.',
    );
  }
}

export function getReferenceFolder(id: string): ReferenceFolderRecord | undefined {
  const db = getDb();
  return db.select().from(referenceFolders).where(eq(referenceFolders.id, id)).get();
}

/**
 * Raw scope listing. `workspaceId === null` returns global rows only; a string
 * returns that workspace's own rows only. Use
 * `listReferenceFoldersForWorkspace` for the merged view an agent sees.
 */
export function listReferenceFolders(
  filter: { workspaceId?: string | null; status?: 'active' | 'archived' } = {},
): ReferenceFolderRecord[] {
  const db = getDb();
  const conditions: SQL[] = [];
  if (filter.workspaceId === null) conditions.push(isNull(referenceFolders.workspaceId));
  else if (filter.workspaceId) conditions.push(eq(referenceFolders.workspaceId, filter.workspaceId));
  conditions.push(eq(referenceFolders.status, filter.status ?? 'active'));
  return db
    .select()
    .from(referenceFolders)
    .where(and(...conditions))
    .orderBy(asc(referenceFolders.position), asc(referenceFolders.createdAt))
    .all();
}

/**
 * What a workspace's agents actually see: its own references plus every global
 * one, with the workspace's row winning on alias collision. Mirrors how
 * `resolveSkillDirsForSession` lets a workspace skill shadow a global one.
 */
export function listReferenceFoldersForWorkspace(
  workspaceId: string | null,
): ReferenceFolderRecord[] {
  const globals = listReferenceFolders({ workspaceId: null });
  if (!workspaceId) return globals;
  const own = listReferenceFolders({ workspaceId });
  const ownAliases = new Set(own.map((r) => r.alias));
  return [...own, ...globals.filter((g) => !ownAliases.has(g.alias))].sort(
    (a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Active references pointing AT this workspace — the reverse direction.
 * References are deliberately one-way, so this is how a workspace finds out
 * who is reading it. Each row is paired with the name of the workspace that
 * owns it; global rows (`workspaceId` null) report a null owner.
 */
export function listReferenceFoldersTargeting(
  targetWorkspaceId: string,
): Array<{ reference: ReferenceFolderRecord; ownerName: string | null }> {
  const db = getDb();
  const rows = db
    .select({ reference: getTableColumns(referenceFolders), ownerName: workspaces.name })
    .from(referenceFolders)
    .leftJoin(workspaces, eq(referenceFolders.workspaceId, workspaces.id))
    .where(
      and(
        eq(referenceFolders.targetWorkspaceId, targetWorkspaceId),
        eq(referenceFolders.status, 'active'),
      ),
    )
    .orderBy(asc(referenceFolders.createdAt))
    .all();
  return rows.map((r) => ({ reference: r.reference, ownerName: r.ownerName ?? null }));
}

/** Existing active row with this alias in this exact scope, if any. */
export function findReferenceFolderByAlias(
  alias: string,
  workspaceId: string | null,
): ReferenceFolderRecord | undefined {
  const db = getDb();
  const scope =
    workspaceId == null
      ? isNull(referenceFolders.workspaceId)
      : eq(referenceFolders.workspaceId, workspaceId);
  return db
    .select()
    .from(referenceFolders)
    .where(
      and(
        eq(referenceFolders.alias, normalizeReferenceAlias(alias)),
        eq(referenceFolders.status, 'active'),
        scope,
      ),
    )
    .get();
}

/**
 * Create a reference folder. Retry-safe: a repeat create in the same scope with
 * the same alias raises `conflict` rather than inserting a duplicate, which is
 * also what the partial unique index would do with a less useful message.
 */
export function createReferenceFolder(input: CreateReferenceFolderInput): ReferenceFolderRecord {
  const db = getDb();
  const alias = normalizeReferenceAlias(input.alias);
  assertValidReferenceAlias(alias);
  assertOneTarget(input.path, input.targetWorkspaceId);

  const workspaceId = input.workspaceId ?? null;
  if (input.targetWorkspaceId && input.targetWorkspaceId === workspaceId) {
    throw new ReferenceFolderError(
      'invalid_params',
      'A workspace cannot reference itself. Its own folder is already the working directory.',
    );
  }
  if (input.targetWorkspaceId && !getWorkspace(input.targetWorkspaceId)) {
    throw new ReferenceFolderError(
      'not_found',
      `Target workspace not found: ${input.targetWorkspaceId}`,
    );
  }
  if (findReferenceFolderByAlias(alias, workspaceId)) {
    throw new ReferenceFolderError(
      'conflict',
      `A ${workspaceId ? 'workspace' : 'global'} reference folder named "${alias}" already exists.`,
    );
  }

  const now = new Date().toISOString();
  try {
    return db
      .insert(referenceFolders)
      .values({
        ...pickReferenceFolderFields(input),
        alias,
        workspaceId,
        // `~` and relative paths are normalized here so every caller (route,
        // orchestrator action, test) stores the same absolute form.
        path: input.path ? normalizeReferencePath(input.path) : null,
        targetWorkspaceId: input.targetWorkspaceId ?? null,
        description: input.description?.trim() || null,
        // `id` is honoured when supplied so a retried create is idempotent
        // rather than duplicating. It is deliberately not part of the
        // writable whitelist, which governs *updates*.
        id: input.id ?? uuidv7(),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ReferenceFolderError(
        'conflict',
        `A ${workspaceId ? 'workspace' : 'global'} reference folder named "${alias}" already exists.`,
      );
    }
    throw err;
  }
}

export function updateReferenceFolder(
  id: string,
  input: UpdateReferenceFolderInput,
): ReferenceFolderRecord | null {
  const db = getDb();
  const existing = getReferenceFolder(id);
  if (!existing) return null;

  // Whitelist before anything else — the incoming object is an unvalidated
  // request body wearing a TypeScript type.
  const next = pickReferenceFolderFields(input);
  if (next.alias != null) {
    next.alias = normalizeReferenceAlias(next.alias);
    assertValidReferenceAlias(next.alias);
  }
  if (next.path != null) next.path = normalizeReferencePath(next.path);
  if (next.description != null) next.description = next.description.trim() || null;

  // Target fields are validated against the merged row, so changing one side
  // of the pair can't silently leave both set.
  const mergedPath = 'path' in next ? next.path : existing.path;
  const mergedTarget =
    'targetWorkspaceId' in next ? next.targetWorkspaceId : existing.targetWorkspaceId;
  assertOneTarget(mergedPath, mergedTarget);

  const mergedWorkspace = 'workspaceId' in next ? next.workspaceId ?? null : existing.workspaceId;
  if (mergedTarget && mergedTarget === mergedWorkspace) {
    throw new ReferenceFolderError(
      'invalid_params',
      'A workspace cannot reference itself. Its own folder is already the working directory.',
    );
  }
  if (mergedTarget && !getWorkspace(mergedTarget)) {
    throw new ReferenceFolderError('not_found', `Target workspace not found: ${mergedTarget}`);
  }

  const mergedAlias = next.alias ?? existing.alias;
  const clash = findReferenceFolderByAlias(mergedAlias, mergedWorkspace);
  if (clash && clash.id !== id) {
    throw new ReferenceFolderError(
      'conflict',
      `A ${mergedWorkspace ? 'workspace' : 'global'} reference folder named "${mergedAlias}" already exists.`,
    );
  }

  try {
    const row = db
      .update(referenceFolders)
      .set({ ...next, updatedAt: new Date().toISOString() })
      .where(eq(referenceFolders.id, id))
      .returning()
      .get();
    return row ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ReferenceFolderError(
        'conflict',
        `A ${mergedWorkspace ? 'workspace' : 'global'} reference folder named "${mergedAlias}" already exists.`,
      );
    }
    throw err;
  }
}

/**
 * Archive rather than delete, matching the rest of the app. Archiving also
 * frees the alias, since the partial unique indexes only cover active rows.
 */
export function archiveReferenceFolder(id: string): ReferenceFolderRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  const row = db
    .update(referenceFolders)
    .set({ status: 'archived', archivedAt: now, updatedAt: now })
    .where(eq(referenceFolders.id, id))
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
    // A warning describes the attempt that produced it, so a retry starts
    // clean rather than showing a stale "couldn't reach origin" note.
    setupWarning: null,
  });
}

/** Record a successful worktree provision. */
export function markExecutionSetupComplete(
  executionId: string,
  params: {
    worktreePath: string;
    branchName: string;
    baseSha: string;
    /** Non-fatal caveat, e.g. the remote was unreachable. Null clears it. */
    warning?: string | null;
  },
): ExecutionRecord | null {
  return updateExecution(executionId, {
    worktreePath: params.worktreePath,
    branchName: params.branchName,
    baseSha: params.baseSha,
    setupError: null,
    setupWarning: params.warning ?? null,
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
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
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
      // Archiving clears any rail pin in the same write: a pin is a
      // working-set marker for *active* work, so a pinned execution that
      // gets archived must drop out of the Pinned group, not linger there.
      .set({ status: 'archived', archivedAt: now, pinnedAt: null, updatedAt: now })
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
    setupWarning: e?.setupWarning ?? null,
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

// ── Rail pin ──────────────────────────────────────────────────

/**
 * Pin or unpin an execution in the left rail. Pinning stamps
 * `pinnedAt = now()`; unpinning clears it back to null. The timestamp both
 * flags the pin and orders the rail's "Pinned" group (most-recent first).
 *
 * A pin is a transient working-set marker — "keep this reachable while I
 * bounce between things" — not a durable priority. Archiving auto-clears it
 * (see `archiveExecution`), so a pin never outlives the active work it
 * points at. Safe under retry: setting the same state twice is idempotent
 * (the second pin just refreshes the timestamp).
 */
export function setExecutionPinned(
  executionId: string,
  pinned: boolean,
): ExecutionRecord | null {
  return updateExecution(executionId, {
    pinnedAt: pinned ? new Date().toISOString() : null,
  });
}

/**
 * Session-keyed pin toggle: resolves the session's execution and pins/unpins
 * it, then returns the session flattened with the updated execution state so
 * the caller can echo the new `execution.pinnedAt` straight into its caches.
 * Returns null for an unknown session or one with no execution (orchestration
 * and content chats can't be pinned — they never appear in the rail).
 */
export function setSessionPinned(
  sessionId: string,
  pinned: boolean,
): ChatSessionWithExecution | null {
  const session = getChatSessionWithExecution(sessionId);
  if (!session || !session.executionId) return null;
  setExecutionPinned(session.executionId, pinned);
  return getChatSessionWithExecution(sessionId);
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
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
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
  const providerId = providerIdForHarness(agent?.harness);
  const selection = explicitAgentSelection(
    providerId,
    { model: input.model, variant: input.modelVariant, effort: input.effort },
  );
  const row = db
    .insert(chatSessions)
    .values({
      ...input,
      // A session owns a concrete provider tuple. Never let nullable legacy
      // defaults or a model from another provider reach the executor.
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
      externalProviderType: input.externalProviderType
        ?? (input.externalSessionId ? providerId : null),
      id: input.id ?? uuidv7(),
      status: input.status ?? 'active',
      // Store ISO (UTC) rather than the SQLite `datetime('now')` default's
      // space-format, so `startedAt` sorts consistently against the ISO
      // outcome/unread timestamps it's compared with (see session-sort.ts).
      startedAt: input.startedAt ?? new Date().toISOString(),
      // Seed the sort key at creation. A NULL here would sink a brand-new
      // session to the BOTTOM of `ORDER BY last_activity_at DESC` (SQLite
      // sorts NULL last in DESC) — the exact "new chat disappears" bug the
      // old mixed-format COALESCE used to cause.
      lastActivityAt: input.lastActivityAt ?? input.startedAt ?? new Date().toISOString(),
    })
    .returning()
    .get();
  return row;
}

export function updateChatSession(id: string, input: UpdateChatSessionInput): ChatSessionRecord | null {
  const db = getDb();
  let normalized = input;
  if (Object.hasOwn(input, 'externalSessionId') && !Object.hasOwn(input, 'externalProviderType')) {
    if (input.externalSessionId === null) {
      normalized = { ...input, externalProviderType: null };
    } else if (input.externalSessionId) {
      const sessionAgent = db
        .select({ harness: agents.harness })
        .from(chatSessions)
        .innerJoin(agents, eq(chatSessions.agentId, agents.id))
        .where(eq(chatSessions.id, id))
        .get();
      normalized = {
        ...input,
        externalProviderType: providerIdForHarness(sessionAgent?.harness),
      };
    }
  }
  const row = db
    .update(chatSessions)
    .set(normalized)
    .where(eq(chatSessions.id, id))
    .returning()
    .get();
  return row ?? null;
}

export function getExternalSessionImportBySource(
  providerType: string,
  externalSessionId: string,
): ExternalSessionImportRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(externalSessionImports)
    .where(and(
      eq(externalSessionImports.providerType, providerType),
      eq(externalSessionImports.externalSessionId, externalSessionId),
    ))
    .get();
}

export function getExternalSessionImportForChat(
  chatSessionId: string,
): ExternalSessionImportRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(externalSessionImports)
    .where(eq(externalSessionImports.chatSessionId, chatSessionId))
    .get();
}

export function listExternalSessionImports(): ExternalSessionImportRecord[] {
  return getDb().select().from(externalSessionImports).all();
}

export function createExternalSessionImport(
  input: CreateExternalSessionImportInput & { id?: string },
): ExternalSessionImportRecord {
  const now = new Date().toISOString();
  return getDb()
    .insert(externalSessionImports)
    .values({
      ...input,
      id: input.id ?? uuidv7(),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    })
    .returning()
    .get();
}

export function updateExternalSessionImport(
  id: string,
  input: UpdateExternalSessionImportInput,
): ExternalSessionImportRecord | null {
  return getDb()
    .update(externalSessionImports)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(externalSessionImports.id, id))
    .returning()
    .get() ?? null;
}

export function archiveChatSession(id: string): ChatSessionRecord | null {
  return updateChatSession(id, { status: 'archived', archivedAt: new Date().toISOString() });
}

/**
 * Reactivate a single archived chat without touching its siblings or the
 * execution row. This is the sibling-chat resume primitive: opening an
 * archived chat of a still-active execution flips just that one chat back
 * on. The execution-wide cascade (which resurrects EVERY archived chat)
 * lives in `unarchiveExecution` and is only right when the whole execution
 * was archived.
 */
export function unarchiveChatSession(id: string): ChatSessionRecord | null {
  return updateChatSession(id, { status: 'active', archivedAt: null });
}

/**
 * Hard-delete a chat that never received a single event. Used when the
 * user opens a new chat while sitting on a blank one — the blank chat was
 * almost certainly accidental, so we remove it outright rather than leave
 * an empty tab (and empty history entry) behind. Returns false and leaves
 * the row untouched the moment there's any transcript to preserve, so this
 * can never destroy real work.
 *
 * Safe as a hard delete: FK enforcement is ON, so the only children an
 * empty chat could have (chat_events, chat_refs, external_session_imports)
 * cascade, and the SET-NULL refs (execution takeover pointer, runs,
 * entity_versions) detach cleanly. Chat sessions carry no embedding or
 * markdown mirror, so there's nothing else to reap.
 */
export function deleteChatSessionIfEmpty(id: string): boolean {
  const db = getDb();
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(chatEvents)
    .where(eq(chatEvents.sessionId, id))
    .get();
  if ((row?.n ?? 0) > 0) return false;
  return db.delete(chatSessions).where(eq(chatSessions.id, id)).run().changes > 0;
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
  /** Optional provider-native variant, validated with the model selection. */
  modelVariant?: string | null;
  /** Optional preferred effort, normalized against the selected model. */
  effort?: ChatSessionRecord['effort'];
}): { execution: ExecutionRecord; session: ChatSessionRecord } {
  const db = getDb();
  const now = new Date().toISOString();
  const agent = db.select().from(agents).where(eq(agents.id, params.agentId)).get();
  const selection = explicitAgentSelection(
    providerIdForHarness(agent?.harness),
    { model: params.model, variant: params.modelVariant, effort: params.effort },
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
        // Seed the rail sort key. This path does NOT go through
        // `createChatSession` — it writes the row inside the execution's
        // transaction — so the seeding there does not cover it, and this is
        // the path every execution chat takes. A NULL would sort the brand
        // new chat to the bottom of `ORDER BY last_activity_at DESC`.
        lastActivityAt: now,
        model: selection.model,
        modelVariant: selection.variant,
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
 * the scheduled-fire pattern (one execution hosts many chats). Prior chats
 * stay open — parallel chats on one worktree are the normal mode, and
 * closing one is an explicit user action (`close-chat`), never a side
 * effect here. Returns null if the execution is gone.
 */
export function createExecutionChat(args: {
  executionId: string;
  /** Executor harness key. Picks the provider-specific agent. */
  harness?: string;
  model?: string | null;
  modelVariant?: string | null;
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
    ...(args.modelVariant !== undefined ? { modelVariant: args.modelVariant } : {}),
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
  const at = new Date().toISOString();
  // Marking unread is a deliberate "come back to this" gesture, so it counts
  // as activity and floats the chat. This is also what lets the ORDER BYs key
  // off one column: `unread_marker_at` no longer needs to be a separate term
  // the SQL has to remember to consider (it used to be omitted, which is how
  // marked-unread chats ended up ranked by their months-old outcome instead).
  touchSessionActivity(id, 'mark_unread', { at });
  return updateChatSession(id, { unreadMarkerAt: at });
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
 * Advance the rail's sort key. Monotonic: `max(existing, at)`, so a path that
 * replays history (transcript import, the reconcile sweep) can insert
 * month-old events without yanking a live session to the bottom of the rail.
 *
 * `''` as the COALESCE floor rather than NULL because SQLite's multi-argument
 * `max()` returns NULL if ANY argument is NULL, which would blank the column
 * on the first bump of an un-backfilled row.
 *
 * Writes ISO only. `last_activity_at` is the one timestamp in this table
 * guaranteed to be single-format, which is what lets the ORDER BYs compare it
 * as a raw string (see src/lib/utils/timestamps.ts for why that matters).
 */
export function bumpSessionActivity(id: string, at: string = new Date().toISOString()): void {
  const db = getDb();
  db.update(chatSessions)
    .set({ lastActivityAt: sql`max(coalesce(${chatSessions.lastActivityAt}, ''), ${at})` })
    .where(eq(chatSessions.id, id))
    .run();
}

/**
 * Report that something happened in a session and let policy decide whether
 * it counts. This is the entry point every call site should use — the reason
 * set lives in `src/lib/sessions/activity.ts`.
 *
 * `throttle` is for sources that fire per-keystroke (terminal input). It caps
 * the write rate per session; the sort key does not need finer resolution.
 */
export function touchSessionActivity(
  id: string,
  reason: ActivityReason,
  opts: { at?: string; throttle?: boolean } = {},
): void {
  if (!isActivity(reason)) return;
  if (opts.throttle && !shouldThrottledBump(id, Date.now())) return;
  bumpSessionActivity(id, opts.at ?? new Date().toISOString());
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
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
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
  const createdBySelfReviewedRun = db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.id, chatSessions.createdByRunId),
        inArray(runs.triggerId, [...TRIGGERS_WITH_OWN_REVIEW_SURFACE]),
      ),
    );
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
        // in the unread queue. Scheduled orchestrator chats generally stay
        // eligible because this is how their results reach the user. The
        // app-managed deck and stream-triage runs are the exception: their
        // results already have purpose-built review surfaces (the Deck pane,
        // the stream digest and "Needs your call"), so a second, redundant
        // unread row is pure noise. See TRIGGERS_WITH_OWN_REVIEW_SURFACE.
        sql`NOT (${chatSessions.type} = 'orchestration' AND ${chatSessions.createdByRunId} IS NULL)`,
        notExists(createdBySelfReviewedRun),
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
    // Membership is an unread question (above), but ORDER is an activity
    // question, so it uses the same key as every other rail surface. The
    // Unread section is not re-sorted client-side, so this ordering is what
    // the user actually sees.
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
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
        ORDER BY COALESCE(cs2.last_activity_at, cs2.started_at) DESC
        LIMIT 1
      )`,
    )
    .where(eq(executions.status, 'active'))
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
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
export function listWorkspaceExecutions(
  workspaceId: string,
  opts: { includeArchived?: boolean } = {},
): ChatSessionWithExecution[] {
  const db = getDb();
  // Off by default: the workspace tree is a list of live work, and archiving is
  // how you get something out of it. The launcher's browse panel opts in — its
  // "Show archived" is the one place finished work is what you're looking for.
  // Both halves have to relax together. Leaving the inner subquery pinned to
  // active would return an archived execution joined to nothing, dropping it
  // from the results anyway and making the flag look broken.
  const sessionStatus = opts.includeArchived
    ? sql`cs2.status IN ('active', 'archived')`
    : sql`cs2.status = 'active'`;
  const executionStatus = opts.includeArchived
    ? inArray(executions.status, ['active', 'archived'])
    : eq(executions.status, 'active');
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
        WHERE cs2.execution_id = ${executions.id} AND ${sessionStatus}
        ORDER BY COALESCE(cs2.last_activity_at, cs2.started_at) DESC, cs2.id DESC
        LIMIT 1
      )`,
    )
    .where(and(eq(executions.workspaceId, workspaceId), executionStatus))
    .orderBy(
      sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC, ${chatSessions.id} DESC`,
    )
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
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
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

// ─── Chat / session search ────────────────────────────────────
//
// Full-text search over chat transcripts, backed by the `chat_events_fts`
// index (see EXTRA_SQL in src/lib/db/index.ts). Only message-bearing events
// (source IN ('user','agent')) are indexed. The result unit is a *session*:
// event hits are grouped to their session, keeping the best-ranked hit's
// snippet, so the UI lands on the conversation with the matching passage.
//
// Scoped to `type='execution'` chats (native + imported). Orchestration and
// content chats have no workspace/execution and render differently, so folding
// them into this rail-shaped result would be misleading — a separate surface
// can search those later if wanted.

/** Filter for native vs. imported (and which importer) chats. */
export type ChatSearchSource = 'native' | 'imported' | 'claude' | 'codex' | 'opencode';

/** A rail session row plus the FTS snippet + relevance that matched it. */
export interface ChatSearchResult extends RailSessionRow {
  /** FTS `snippet()` of the best-matching event. Matched terms are wrapped in
   *  the sentinels from `@/lib/search/highlight` (CHAT_SEARCH_HL_START/END);
   *  render with `splitHighlight`, or `stripHighlight` for plain text. */
  snippet: string;
  /** The event whose content produced the snippet — for future deep-linking. */
  matchedEventId: string;
  /** Normalized 0-1 BM25 relevance (higher = better). */
  score: number;
}

interface ChatSearchScanRow {
  sessionId: string;
  matchedEventId: string;
  snippet: string;
  rank: number;
}

export function searchChatSessions(opts: {
  query: string;
  status?: 'active' | 'archived';
  workspaceId?: string;
  source?: ChatSearchSource;
  /** Max sessions to return. Default 30. */
  limit?: number;
}): ChatSearchResult[] {
  const match = toFtsMatchQuery(opts.query);
  if (!match) return [];
  const limit = opts.limit ?? 30;

  // Named params so MATCH and the filters can't get transposed. The snippet()
  // highlight markers are emitted as char(2)/char(3) literals in SQL (== the
  // exported CHAT_SEARCH_HL_* sentinels) rather than bound, sidestepping any
  // FTS aux-function bind-arg quirks. Source clauses use constant literals.
  const params: Record<string, unknown> = {
    match,
    // Scan more events than sessions: many events collapse to one session.
    scanLimit: limit * 20,
  };
  const conds: string[] = ["cs.type = 'execution'"];
  if (opts.status) {
    conds.push('cs.status = :status');
    params.status = opts.status;
  }
  if (opts.workspaceId) {
    conds.push('cs.workspace_id = :workspaceId');
    params.workspaceId = opts.workspaceId;
  }
  if (opts.source === 'imported') {
    conds.push("cs.surface_kind = 'imported_agent'");
  } else if (opts.source === 'native') {
    conds.push("(cs.surface_kind IS NULL OR cs.surface_kind <> 'imported_agent')");
  } else if (opts.source === 'claude' || opts.source === 'codex' || opts.source === 'opencode') {
    conds.push(`(cs.surface_kind = 'imported_agent' AND cs.surface_ref = '${opts.source}')`);
  }

  const raw = getRawDb();
  const scanRows = raw
    .prepare(
      `SELECT f.session_id AS sessionId,
              f.event_id AS matchedEventId,
              snippet(chat_events_fts, 2, char(2), char(3), '…', 12) AS snippet,
              rank
       FROM chat_events_fts f
       JOIN chat_sessions cs ON cs.id = f.session_id
       WHERE chat_events_fts MATCH :match
         AND ${conds.join(' AND ')}
       ORDER BY rank
       LIMIT :scanLimit`,
    )
    .all(params) as ChatSearchScanRow[];

  // Collapse to one hit per session. scanRows is rank-ascending (best first),
  // so the first time a session appears is its best hit, and Map insertion
  // order preserves best-rank ordering across sessions.
  const bySession = new Map<string, ChatSearchScanRow>();
  for (const r of scanRows) {
    if (!bySession.has(r.sessionId)) bySession.set(r.sessionId, r);
  }
  const orderedIds = Array.from(bySession.keys()).slice(0, limit);
  if (orderedIds.length === 0) return [];

  // Hydrate the matched sessions with the same joins as listHistorySessions
  // (workspace identity + flattened execution state), then re-attach the
  // snippet/score and restore FTS rank order (SQL IN () doesn't preserve it).
  const db = getDb();
  const hydrated = db
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
    .leftJoin(workspaces, eq(workspaces.id, chatSessions.workspaceId))
    .leftJoin(executions, eq(chatSessions.executionId, executions.id))
    .where(inArray(chatSessions.id, orderedIds))
    .all();

  const rowById = new Map(
    hydrated.map((r) => [
      r.id,
      hydrateRailRow(
        r as ChatSessionRecord & {
          execution: ExecutionRecord | null;
          workspaceAttachments: StoredAttachment[] | null;
        },
      ),
    ]),
  );

  return orderedIds
    .map((id): ChatSearchResult | null => {
      const row = rowById.get(id);
      const hit = bySession.get(id);
      if (!row || !hit) return null;
      return {
        ...row,
        snippet: hit.snippet,
        matchedEventId: hit.matchedEventId,
        score: normalizeFtsRank(hit.rank),
      };
    })
    .filter((r): r is ChatSearchResult => r !== null);
}

// ─── Chat Events ──────────────────────────────────────────────

/**
 * Whether a row should bump `last_outcome_event_at` — i.e. whether it is
 * output *the user* is waiting on.
 *
 * `OUTCOME_SOURCES` answers "is this kind of event an outcome". This adds the
 * second half: *whose* outcome. Claude Code streams a subagent's own text and
 * tool calls onto the parent session tagged with the launching tool_use id,
 * and those are a nested actor talking to its caller, not the session
 * answering the user. Counting them meant a fan-out of four research
 * subagents re-marked the session unread on every line they narrated — a
 * session the user had just read would flip back to unread seconds later,
 * repeatedly, for as long as the subagents ran.
 *
 * The gate is on the *parent tool*, not on merely having a parent. Claude
 * tags anything nested under any tool call, and in the real corpus a third of
 * tagged rows hang off `Bash`, `Skill`, or `TaskOutput`. A Skill runs as the
 * session — if one ever emits assistant text, or a background task completes
 * inside one, that is the session's output and must still reach the user. For
 * a detached background task the terminal summary is the *only* signal there
 * is, so swallowing it would lose the result outright.
 *
 * Activity is deliberately *not* gated this way: subagent progress is real
 * work and should still float the session in sort order. Only the "needs your
 * attention" signal is scoped to the top-level actor.
 */
function isOutcomeEvent(input: CreateChatEventInput): boolean {
  if (!OUTCOME_SOURCES.has(input.source as ChatEventSource)) return false;
  const parentCallId = input.externalParentToolCallId;
  if (!parentCallId) return true;
  return !isSubagentLaunchCall(input.sessionId, parentCallId);
}

/**
 * Whether `callId` names a subagent-spawning tool call in this session.
 *
 * One indexed lookup, and only for rows that are both an outcome source and
 * nested — a few per fan-out, not per event.
 */
function isSubagentLaunchCall(sessionId: string, callId: string): boolean {
  const row = getDb()
    .select({ toolName: chatEvents.toolName })
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.sessionId, sessionId),
        eq(chatEvents.externalToolCallId, callId),
        eq(chatEvents.source, 'tool_call'),
      ),
    )
    .get();
  return isSubagentTool(row?.toolName ?? null);
}

/**
 * Chokepoint for `chat_events` inserts. The executor live stream, JSONL
 * reconcile, user-message POST, inject dev route, and MCP/orchestrator
 * handlers all go through here so the realtime broadcast and outcome-timestamp
 * bump are guaranteed.
 *
 * One deliberate exception: the external-agent importer bulk-inserts through
 * Drizzle directly (`src/lib/import/external-agents.ts`) and sets
 * `lastOutcomeEventAt` itself. Anything that changes the outcome rules here
 * has to be mirrored there.
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

  const at = input.createdAt ?? new Date().toISOString();
  if (isOutcomeEvent(input)) {
    bumpSessionOutcome(input.sessionId, at);
  }
  // Separate from the outcome bump on purpose: outcome drives "unread" and
  // must stay agent-only, activity drives sort order and takes everything
  // policy allows. See src/lib/sessions/activity.ts.
  touchSessionActivity(input.sessionId, activityReasonForEventSource(input.source), { at });

  publishChatEvent(row);
  return row;
}

/**
 * Persist a cumulative provider part. OpenCode emits the same stable part ID
 * as text grows, so conflict-do-nothing would keep only the first delta.
 * Insert the first observation, then replace that exact part in place.
 */
export function replaceChatEventPart(input: CreateChatEventInput): ChatEventRecord | null {
  const inserted = insertChatEvent(input);
  if (inserted || !input.externalEventId) return inserted;

  const sourcePartIndex = input.sourcePartIndex ?? 0;
  const row = getDb().update(chatEvents).set({
    role: input.role,
    source: input.source,
    content: input.content,
    toolName: input.toolName,
    toolInput: input.toolInput,
    toolIsError: input.toolIsError,
    toolExitCode: input.toolExitCode,
    raw: input.raw,
    externalMessageId: input.externalMessageId,
    externalTurnId: input.externalTurnId,
    externalToolCallId: input.externalToolCallId,
    externalParentToolCallId: input.externalParentToolCallId,
  }).where(and(
    eq(chatEvents.sessionId, input.sessionId),
    eq(chatEvents.externalEventId, input.externalEventId),
    eq(chatEvents.sourcePartIndex, sourcePartIndex),
  )).returning().get();
  if (!row) return null;

  const hydrated = hydrateRow(row);
  const at = input.createdAt ?? new Date().toISOString();
  if (isOutcomeEvent(input)) {
    bumpSessionOutcome(input.sessionId, at);
  }
  touchSessionActivity(input.sessionId, activityReasonForEventSource(input.source), { at });
  publishChatEvent(hydrated);
  return hydrated;
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
       ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC, s.started_at DESC`,
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

// ─── Skill Usage ──────────────────────────────────────────────

/**
 * Days for a command's score to lose half its weight. Picked so a skill used
 * daily clearly outranks one used monthly, which is the behavior we want. The
 * score only ever breaks ties inside a match tier (see the slash menu's
 * `ranking.ts`), so an imprecise half-life is cheap.
 */
export const SKILL_USAGE_HALF_LIFE_DAYS = 14;

const MS_PER_DAY = 86_400_000;

/**
 * Below this a score is noise, not signal — exponential decay never actually
 * reaches zero, so without a floor a command touched once years ago stays in
 * the ranking map forever carrying a number that rounds to nothing.
 */
const SKILL_USAGE_FLOOR = 1e-6;

/**
 * Decay a stored score forward to `now`. Exported for the ranking read path so
 * a command last used months ago doesn't keep a stale lead over one used this
 * morning purely because nothing has written to its row since.
 */
export function decaySkillScore(score: number, lastUsedAt: string | null, now = Date.now()): number {
  if (score <= 0) return 0;
  if (!lastUsedAt) return score;
  const elapsed = now - new Date(lastUsedAt).getTime();
  // Clock skew (or a future-dated row) would otherwise inflate the score.
  if (!Number.isFinite(elapsed) || elapsed <= 0) return score;
  return score * Math.pow(0.5, elapsed / MS_PER_DAY / SKILL_USAGE_HALF_LIFE_DAYS);
}

/**
 * Record one invocation of a slash command.
 *
 * The score is a decayed running count: decay what was there to now, then add
 * one. That keeps recency and frequency in a single number with an O(1)
 * update and no event log to prune — a command used twice today outranks one
 * used five times last quarter, without storing five rows.
 *
 * Safe to call with an unrecognized name; the read path filters against the
 * live command list, so junk rows are inert.
 */
export function recordSkillUse(name: string): void {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return;
  const now = new Date().toISOString();
  const existing = getDb().select().from(skillUsage).where(eq(skillUsage.name, trimmed)).get();

  if (!existing) {
    getDb()
      .insert(skillUsage)
      .values({ id: uuidv7(), name: trimmed, useCount: 1, score: 1, lastUsedAt: now })
      // A concurrent first-use of the same command (two tabs, two devices)
      // races here; fold it into the existing row rather than throwing on the
      // unique index.
      .onConflictDoUpdate({
        target: skillUsage.name,
        set: {
          useCount: sql`${skillUsage.useCount} + 1`,
          score: sql`${skillUsage.score} + 1`,
          lastUsedAt: now,
        },
      })
      .run();
    return;
  }

  getDb()
    .update(skillUsage)
    .set({
      useCount: existing.useCount + 1,
      score: decaySkillScore(existing.score, existing.lastUsedAt) + 1,
      lastUsedAt: now,
    })
    .where(eq(skillUsage.id, existing.id))
    .run();
}

/**
 * Current decayed score per command name. Returned as a map because the only
 * caller joins it against the discovered command list.
 */
export function getSkillUsageScores(): Map<string, number> {
  const now = Date.now();
  const out = new Map<string, number>();
  for (const row of getDb().select().from(skillUsage).all()) {
    const score = decaySkillScore(row.score, row.lastUsedAt, now);
    if (score >= SKILL_USAGE_FLOOR) out.set(row.name, score);
  }
  return out;
}

/** Full usage rows, most-used first. */
export function listSkillUsage(): SkillUsageRecord[] {
  return getDb().select().from(skillUsage).orderBy(desc(skillUsage.score)).all();
}
