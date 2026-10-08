/**
 * Shared database query functions.
 * Used by both API route handlers and AI chat tools.
 */

import { createHash, randomBytes } from 'node:crypto';
import nodePath from 'node:path';
import os from 'node:os';
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';
import { getDb, getRawDb } from '@/lib/db';
import { processState } from '@/lib/process-state';
import {
  tasks, notes, areas, stream, taskCompletions, taskStatusChanges, executionReviews, executionTasks, decks, userState, harnessSettings, harnessOperations, apiKeys,
  home, devices, deviceGrants, workerCommands, executionPlacements, executionTransfers, nativeSessions, reviewCheckouts, workspaceSetups, folderLinks,
  workspaces, referenceFolders, executions, chatSessions, externalSessionImports, chatEvents, chatRefs,
  triggers, runs, previewTargets, entityVersions, entityLinks, entityProjectionState,
  notificationChannels, webPushSubscriptions, notificationDeliveries,
  triagePasses, triageDecisions, streamLinks, skillUsage, isBackgroundTaskEvent, isAuthRequiredEvent, isConnectionCardEvent,
} from '@/lib/db/schema';
import { decodeBackgroundTaskEvent } from '@/lib/executor/background-task-event';
import { eq, and, or, desc, asc, sql, gt, lt, inArray, notInArray, isNull, isNotNull, notExists, gte, lte, getTableColumns, type SQL } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import slugify from '@sindresorhus/slugify';
import { upsertEmbedding, buildEmbeddingText, deleteEmbedding } from '@/lib/embeddings/embed';
import { toFtsMatchQuery, normalizeFtsRank } from '@/lib/embeddings/fts-query';
import { calendarDaysUntil, toDateOnly } from '@/lib/dates';
import { todayLocalDate } from '@/lib/deck/date';
import { syncEntity, syncDeletion, MutationContext, syncBatch } from '@/lib/export/mirror';
import type {
  AgentMainChatState,
  TaskRecord, TaskListRecord, CreateTaskInput, UpdateTaskInput, TaskFilter, TaskAttentionSignals, DeadlineTask,
  NoteRecord, CreateNoteInput, UpdateNoteInput, NoteFilter,
  AreaRecord, CreateAreaInput, UpdateAreaInput, AreaFilter,
  StreamRecord, CreateStreamInput, UpdateStreamInput,
  DeckRecord, CreateDeckInput, UpdateDeckInput,
  UpdateUserStateInput,
  UserStateRecord,
  ApiKeyRecord, CreateApiKeyInput, UpdateApiKeyInput,
  HomeRecord, HomeKind, DeviceRecord, CreateDeviceInput, UpdateDeviceInput,
  DeviceGrantRecord, DeviceGrantKind, DeviceKind, WorkerReportedState, WorkerHarnessReport,
  WorkerCommandRecord, WorkerCommandKind, WorkerCommandState, WorkerCommandActor, ExecutionPlacementRecord, ExecutionTransferRecord, NativeSessionRecord, ReviewCheckoutRecord,
  WorkspaceSetupRecord, SetupReferenceReport, FolderLinkRecord,
  Attachment,
  WorkspaceRecord, CreateWorkspaceInput, UpdateWorkspaceInput, WorkspaceWithCounts, WorkspaceStatus, WorkspaceIntegrationScope,
  ReferenceFolderRecord, CreateReferenceFolderInput, UpdateReferenceFolderInput,
  ExecutionRecord, ExecutionReviewRecord, ExecutionReviewContext, ExecutionTaskRecord, CreateExecutionInput, UpdateExecutionInput, ChatSessionWithExecution, ExecutionLocation,
  PreviewTargetRecord, CreatePreviewTargetInput, UpdatePreviewTargetInput, PreviewUrl,
  ChatSessionRecord, CreateChatSessionInput, UpdateChatSessionInput,
  ExternalSessionImportRecord, CreateExternalSessionImportInput, UpdateExternalSessionImportInput,
  ChatEventRecord, CreateChatEventInput, ChatEventSource,
  ChatRefRecord, CreateChatRefInput, ChatRefEntityType,
  TriggerRecord, CreateTriggerInput, UpdateTriggerInput,
  RunRecord, CreateRunInput, UpdateRunInput, RunStatus, RunTrigger, TriggerWithLastRun, RunArtifactRef,
  EntityVersionRecord, EntityVersionSnapshot, EntityVersionSource, EntityVersionEntityType,
  TaskStatus, Energy, Effort,
  NotificationChannelRecord, CreateNotificationChannelInput, UpdateNotificationChannelInput,
  WebPushSubscriptionRecord, CreateWebPushSubscriptionInput,
  NotificationDeliveryRecord, CreateNotificationDeliveryInput, StoredRenderedNotification,
  SkillUsageRecord,
  HarnessSettingsRecord, UpsertHarnessSettingsInput, HarnessOperationRecord,
  StreamStatus,
  TriagePassRecord, TriagePassTrigger,
  TriageDecisionRecord, TriageDecisionState, TriageActor,
  StreamLinkRecord, CreateStreamLinkInput,
  StreamOutcome, StreamRecordWithOutcomes,
  TriageDisposition, TriageDraft, StreamAutonomyConfig, StreamAutonomyLevel,
} from '@/db/types';
import { DEFAULT_HARNESS, isKnownHarnessId, type HarnessId } from '@/lib/harness/registry';
import { listEntityMarkers } from '@/lib/entity-refs/parse-markers';
import { linksFromTexts } from '@/lib/entity-refs/derive-links';
import { CHAT_PAGE_SIZE } from '@/constants/chat';
import { OUTCOME_SOURCES } from '@/db/types';
import { FILE_TOOL_NAMES, fileTargetPath, isSubagentTool } from '@/lib/executions/tool-display';
import {
  activityReasonForEventSource,
  isActivity,
  shouldThrottledBump,
  type ActivityReason,
} from '@/lib/sessions/activity';
import type { ReferencePage, ReferenceRow, ReferenceSection } from '@/lib/sessions/contracts';
import { generateToken, type GeneratedToken } from '@/lib/auth/tokens';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import { assertSupportedPermissionMode } from '@/lib/executor/permission-map';
import { DEFAULT_FILES_TO_COPY } from '@/lib/workspaces/defaults';
import { deriveAttachments } from '@/lib/attachments/derive';
import { AttachmentMetadataRepairError, planNoteAttachmentMetadataRepair } from '@/lib/attachments/repair-metadata';
import { publishChatEvent } from '@/lib/realtime/bus';
import { hydrateRow, dehydrateAttachments, withoutAttachments } from '@/lib/db/hydrate';
import { normalizeIntegrationScopes } from '@/lib/integrations/scope-pins';
import {
  normalizeTaskStatus,
  canApply,
  targetState,
  transitionLabel,
  availableCommands,
  considerBlockers,
  CONSIDER_FORBIDDEN_FIELDS,
  isTerminal,
  TaskLifecycleError,
  type TransitionCommand,
  type LifecycleCommand,
  type TaskStatus as LifecycleTaskStatus,
} from '@/lib/tasks/lifecycle';
import type { LifecycleCommandResult } from '@/lib/db/schema';
import { camelizeKeys, snakeizeKeys } from '@/lib/case/keys';
import type { StoredAttachment } from '@/lib/db/schema';
import { messagePreview } from '@/lib/utils/message-preview';
import {
  bundledModelIds,
  curatedDefaultModelIds,
  explicitHarnessSelection,
  harnessSupportsEffort,
  modelsForProvider,
  normalizeCustomModelId,
  reconcileEnabledModels,
} from '@/lib/harness/options';
import { TRIGGERS_WITH_OWN_REVIEW_SURFACE } from '@/lib/triggers/reserved';
import {
  baseOnboardingRecord,
  clampReply,
  readOnboardingRecord,
  withChatMoved,
  withFinished,
  withMessageSent,
  withStepRecorded,
  withStepShown,
  type OnboardingRecord,
  type OnboardingStepName,
} from '@/lib/onboarding/progress';

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

/**
 * Count of tasks by canonical status, optionally within an area. Legacy `active`
 * bytes fold into `todo`. Powers the lane count badges. Missing statuses are 0.
 */
export function getTaskStatusCounts(opts: { areaId?: string | null } = {}): Record<LifecycleTaskStatus, number> {
  const conditions: SQL[] = [];
  if (opts.areaId) conditions.push(eq(tasks.areaId, opts.areaId));
  const rows = getDb()
    .select({ status: tasks.status, c: sql<number>`count(*)` })
    .from(tasks)
    .where(conditions.length ? and(...conditions) : undefined)
    .groupBy(tasks.status)
    .all();
  const out: Record<LifecycleTaskStatus, number> = {
    consider: 0,
    todo: 0,
    in_progress: 0,
    done: 0,
    archived: 0,
  };
  for (const r of rows) out[normalizeTaskStatus(r.status)] += r.c;
  return out;
}

export interface DeadlineTasksOptions {
  /** Include deadlines up to this many calendar days ahead. Overdue is ALWAYS
   * included regardless of this bound. Default 7. */
  withinDays?: number;
  /** Injectable "now" for tests. */
  now?: Date;
}

/**
 * Every live task carrying a REAL hard deadline that is overdue or due within
 * `withinDays` calendar days, earliest-deadline first (so the most overdue sorts
 * to the top). This is the deterministic deadline surface: a plain status +
 * deadline query with NO model call, so a real deadline stays findable even when
 * Deck generation is unavailable (the deadline-selection logic in the deck
 * pipeline is gated to Ready-Todo and only runs during generation).
 *
 * Deliberately BROADER than deck eligibility:
 *   - Includes `in_progress` and blocked tasks — a deadline you are already on,
 *     or one that is stuck behind a blocker, is exactly what must stay visible.
 *   - Carries `status` + `blocked` so the surface can show lifecycle and blocked
 *     context honestly, and `overdue`/`dueToday` so late reads as late.
 *   - Excludes `done`/`archived` (resolved) and `consider` (which cannot hold a
 *     hard deadline; see CONSIDER_FORBIDDEN_FIELDS).
 *
 * NEVER invents a deadline: a task with no `hardDeadline` can never appear here.
 *
 * The SQL upper bound is an over-inclusive prefilter; the authoritative
 * calendar-day cut is done in JS via `calendarDaysUntil`, which reads the
 * date-only prefix in the user's local zone and tolerates the legacy
 * `T00:00:00.000Z` suffix that older rows may still carry.
 */
export function getDeadlineTasks(opts: DeadlineTasksOptions = {}): DeadlineTask[] {
  const withinDays = opts.withinDays ?? 7;
  const now = opts.now ?? new Date();

  // Loose upper bound: local today + withinDays + 1 day, as a bare date. One
  // extra day absorbs the legacy-suffix comparison edge (a `...T00:00:00.000Z`
  // value sorts just after the bare boundary date) so the JS cut below decides.
  const bound = new Date(now.getFullYear(), now.getMonth(), now.getDate() + withinDays + 1);
  const upperBound = todayLocalDate(bound);

  const rows = getDb()
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      areaId: tasks.areaId,
      parentId: tasks.parentId,
      hardDeadline: tasks.hardDeadline,
      blockedOn: tasks.blockedOn,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, ['todo', 'in_progress']),
        isNotNull(tasks.hardDeadline),
        lte(tasks.hardDeadline, upperBound),
      ),
    )
    .orderBy(asc(tasks.hardDeadline))
    .all();

  const out: DeadlineTask[] = [];
  for (const r of rows) {
    const daysUntil = calendarDaysUntil(r.hardDeadline, now);
    // Unparseable date (defensive) or beyond the window slack: skip. Overdue
    // (negative) is always kept.
    if (daysUntil === null || daysUntil > withinDays) continue;
    out.push({
      id: r.id,
      title: r.title,
      status: normalizeTaskStatus(r.status),
      areaId: r.areaId ?? null,
      parentId: r.parentId ?? null,
      hardDeadline: toDateOnly(r.hardDeadline)!,
      daysUntil,
      overdue: daysUntil < 0,
      dueToday: daysUntil === 0,
      blocked: isBlockerUnresolved(r.blockedOn),
      blockedOn: r.blockedOn ?? null,
    });
  }
  return out;
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

  // Consider items carry no commitments — enforce it at creation too, not only
  // on update, so a task can never be born in Consider with a deadline,
  // recurrence, or reminder attached.
  if (normalizeTaskStatus(input.status ?? 'todo') === 'consider') {
    const offending = CONSIDER_FORBIDDEN_FIELDS.filter(
      (f) => Object.prototype.hasOwnProperty.call(input, f) && (input as Record<string, unknown>)[f] != null,
    );
    if (offending.length) {
      throw new TaskLifecycleError(
        'consider_precondition',
        `A Consider task cannot carry ${offending.map((f) => CONSIDER_FIELD_LABELS[f]).join(', ')}. Create it as Todo, or leave ${offending.length > 1 ? 'those' : 'that'} unset.`,
        { fields: offending },
      );
    }
  }

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

/** Human labels for the commitment-bearing fields disallowed on Consider. */
const CONSIDER_FIELD_LABELS: Record<(typeof CONSIDER_FORBIDDEN_FIELDS)[number], string> = {
  hardDeadline: 'a deadline',
  recurrence: 'a recurrence',
  reminderAt: 'a reminder',
};

export function updateTask(id: string, input: UpdateTaskInput, meta: EntityVersionMeta): TaskRecord | null {
  const db = getDb();

  const existingRaw = hydrateRow(db.select().from(tasks).where(eq(tasks.id, id)).get());
  if (!existingRaw) return null;
  const existing = normalizeTaskRow(existingRaw);

  // Reject a parent assignment that would create a cycle, at the query boundary
  // so no surface can build one.
  if (Object.prototype.hasOwnProperty.call(input, 'parentId') && input.parentId && input.parentId !== existing.parentId) {
    assertNoParentCycle(id, input.parentId);
  }

  // Consider items carry no commitments. Reject setting a commitment-bearing
  // field (deadline / recurrence / reminder) on a Consider task through generic
  // update. The move_to_consider precondition already blocks entering Consider
  // while such a field is set; this closes the "add it afterward" gap so the
  // invariant holds in both directions rather than only on paper.
  if (existing.status === 'consider') {
    const offending = CONSIDER_FORBIDDEN_FIELDS.filter(
      (f) => Object.prototype.hasOwnProperty.call(input, f) && (input as Record<string, unknown>)[f] != null,
    );
    if (offending.length) {
      throw new TaskLifecycleError(
        'consider_precondition',
        `A Consider task cannot carry ${offending.map((f) => CONSIDER_FIELD_LABELS[f]).join(', ')}. Move it to Todo first, or leave ${offending.length > 1 ? 'those' : 'that'} unset.`,
        { fields: offending },
      );
    }
  }

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
  const result = inEntityTx(() => {
    // Completion history belongs to the task. Unlike the status ledger, its
    // original FK has no cascade. Keep cleanup and deletion atomic so a
    // remaining note/subtask reference cannot erase history on a failed delete.
    db.delete(taskCompletions).where(eq(taskCompletions.taskId, id)).run();
    return db.delete(tasks).where(eq(tasks.id, id)).run();
  });
  if (result.changes === 0) return false;
  deleteEmbedding('task', id);
  void syncDeletion('task', id);
  db.delete(entityVersions)
    .where(and(eq(entityVersions.entityType, 'task'), eq(entityVersions.entityId, id)))
    .run();
  return true;
}

/**
 * Reorder a task within its status lane, atomically and against the COMPLETE
 * sibling set (including tasks hidden by a client-side Area filter). The caller
 * passes the visible neighbors it dropped between; the server computes the new
 * key from the full, canonically-ordered set. Null or duplicate sort keys across
 * the lane are normalized to fresh evenly-spaced keys FIRST (so neighbor keys
 * are well-defined and two null-key cards can actually be reordered), then the
 * moved task's key is placed between the neighbors — all in one transaction.
 */
export function reorderTaskInLane(taskId: string, prevId: string | null, nextId: string | null): { sortKey: string } {
  return inEntityTx(() => {
    const moved = getDb().select({ status: tasks.status }).from(tasks).where(eq(tasks.id, taskId)).get();
    if (!moved) throw new TaskLifecycleError('not_found', `Task ${taskId} not found.`);

    // The full sibling set in this status, in the canonical order the lane uses.
    const siblings = getDb()
      .select({ id: tasks.id, sortKey: tasks.sortKey, createdAt: tasks.createdAt })
      .from(tasks)
      .where(eq(tasks.status, moved.status))
      .orderBy(sql`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt))
      .all();

    // Normalize null/duplicate keys across the whole lane so every neighbor key
    // is well-defined and distinct.
    const keys = new Map<string, string>();
    const seen = new Set<string>();
    let needsNormalize = false;
    for (const s of siblings) {
      if (s.sortKey == null || seen.has(s.sortKey)) { needsNormalize = true; break; }
      seen.add(s.sortKey);
    }
    if (needsNormalize && siblings.length > 0) {
      const fresh = generateNKeysBetween(null, null, siblings.length);
      siblings.forEach((s, i) => {
        keys.set(s.id, fresh[i]);
        getDb().update(tasks).set({ sortKey: fresh[i] }).where(eq(tasks.id, s.id)).run();
      });
    } else {
      for (const s of siblings) if (s.sortKey != null) keys.set(s.id, s.sortKey);
    }

    const prevKey = prevId ? keys.get(prevId) ?? null : null;
    const nextKey = nextId ? keys.get(nextId) ?? null : null;
    let key: string;
    try {
      key = generateKeyBetween(prevKey, nextKey);
    } catch {
      // Neighbors out of order (stale client) — fall back to appending.
      key = generateKeyBetween(keys.size ? [...keys.values()].sort().at(-1) ?? null : null, null);
    }
    getDb().update(tasks).set({ sortKey: key, updatedAt: new Date().toISOString() }).where(eq(tasks.id, taskId)).run();
    void syncEntity('task', taskId);
    return { sortKey: key };
  });
}

export const MAX_REORDER_TASKS = 1000;

export class TaskReorderError extends Error {
  constructor(public code: 'not_found' | 'invalid_params' | 'conflict', message: string) {
    super(message);
    this.name = 'TaskReorderError';
  }
}

/**
 * Put an explicit ordered selection at the top of one Area's manual order,
 * across statuses. Unlike a lane drag, this never normalizes other tasks:
 * unselected keys (including nulls and duplicates) and other Areas are intact.
 * The immediate transaction validates and places the whole selection together.
 * Repeating an already-satisfied request is a no-op, including timestamps.
 */
export async function reorderTasksToTop(input: { areaId: string; taskIds: string[] }) {
  const { areaId, taskIds } = input;
  if (!areaId?.trim() || !Array.isArray(taskIds) || taskIds.length === 0 || taskIds.length > MAX_REORDER_TASKS
    || taskIds.some((id) => typeof id !== 'string' || !id.trim()) || new Set(taskIds).size !== taskIds.length) {
    throw new TaskReorderError('invalid_params', `Provide an Area id and 1 to ${MAX_REORDER_TASKS} unique task ids in the desired order.`);
  }

  const result = inEntityTx(() => {
    const db = getDb();
    if (!db.select({ id: areas.id }).from(areas).where(eq(areas.id, areaId)).get()) {
      throw new TaskReorderError('not_found', `Area not found: ${areaId}`);
    }
    const selected = db.select({ id: tasks.id, areaId: tasks.areaId, sortKey: tasks.sortKey })
      .from(tasks).where(inArray(tasks.id, taskIds)).all();
    const selectedById = new Map(selected.map((task) => [task.id, task]));
    for (const id of taskIds) {
      const task = selectedById.get(id);
      if (!task) throw new TaskReorderError('not_found', `Task not found: ${id}`);
      if (task.areaId !== areaId) {
        throw new TaskReorderError('conflict', `Task ${id} does not belong to Area ${areaId}. No tasks were reordered.`);
      }
    }

    const siblings = db.select({ id: tasks.id, sortKey: tasks.sortKey })
      .from(tasks).where(eq(tasks.areaId, areaId))
      .orderBy(sql`${tasks.sortKey} ASC NULLS LAST`, desc(tasks.createdAt)).all();
    const changedTaskIds: string[] = [];
    if (!taskIds.every((id, index) => siblings[index]?.id === id)) {
      // Ignore the selected tasks' old keys. Only the remaining queue bounds
      // insertion, so an arbitrary selection (even every task) is supported.
      const upperBound = siblings.find((task) => !selectedById.has(task.id) && task.sortKey !== null)?.sortKey ?? null;
      let keys: string[];
      try {
        // fractional-indexing validates structure but not every digit. Without
        // the alphabet check, e.g. "a!" can silently generate invalid keys.
        if (upperBound !== null && !/^[A-Za-z][0-9A-Za-z]+$/.test(upperBound)) throw new Error('Invalid key alphabet');
        keys = generateNKeysBetween(null, upperBound, taskIds.length);
      } catch {
        // A malformed legacy bound cannot be safely normalized here without
        // violating the promise to leave unselected rows byte-for-byte intact.
        throw new TaskReorderError('conflict', 'The remaining Area queue has an invalid ordering key. No tasks were reordered.');
      }
      const updatedAt = new Date().toISOString();
      taskIds.forEach((id, index) => {
        if (selectedById.get(id)!.sortKey === keys[index]) return;
        db.update(tasks).set({ sortKey: keys[index], updatedAt }).where(eq(tasks.id, id)).run();
        changedTaskIds.push(id);
      });
    }
    return { areaId, position: 'top' as const, taskIds: [...taskIds], changedTaskIds };
  }, true);

  // Ordering does not change embedding text, content versions, links or
  // attachment derivation. One post-commit batch deduplicates shared backlink
  // cascades, avoiding concurrent writes to the same dependent mirror file.
  const mirrorChanges = new MutationContext();
  mirrorChanges.addMany('task', result.changedTaskIds);
  await syncBatch(mirrorChanges);
  return result;
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
  source: EntityVersionSource; // required — never silently guessed. 'human' | 'ai' | 'system'
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
  /** For `archive` on a parent with open children: the exact current open-child
   * ids the caller confirmed. A missing or stale set throws `conflict` with the
   * current open children. Children are never changed by acknowledging. */
  acknowledgedChildIds?: string[];
  meta: LifecycleActorMeta;
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
 * DONE. An archived blocker does NOT resolve the dependency: archiving means the
 * prerequisite was dropped, not delivered, so the dependent is still stuck and
 * should surface for a human re-decision rather than silently unblock. Free-text
 * blockers that are not a known task id count as unresolved — we cannot prove
 * resolution. Empty = not blocked.
 */
function isBlockerUnresolved(blockedOn: string | null | undefined): boolean {
  if (!blockedOn) return false;
  const dep = getDb().select({ status: tasks.status }).from(tasks).where(eq(tasks.id, blockedOn)).get();
  if (!dep) return true;
  return normalizeTaskStatus(dep.status) !== 'done';
}

/**
 * Parse a stored timestamp to epoch ms, tolerating both formats that appear in
 * this DB: ISO 8601 (`2026-09-03T12:00:00.000Z`, from app writes) and SQLite's
 * `datetime('now')` space form (`2026-09-03 12:00:00`, UTC, no zone). Comparing
 * the two as strings is wrong — a space sorts before `T` — so any time
 * comparison across sources must go through this. Returns 0 for null/unparseable.
 */
function tsToMs(ts: string | null | undefined): number {
  if (!ts) return 0;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/** Non-terminal (Consider/Todo/In progress) child task ids of a parent, sorted
 * for stable set comparison. Terminal children never gate a parent. */
function openChildIds(taskId: string): string[] {
  return getDb()
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.parentId, taskId))
    .all()
    .filter((c) => !isTerminal(normalizeTaskStatus(c.status)))
    .map((c) => c.id)
    .sort();
}

/**
 * Reject a parent assignment that would create a cycle: the new parent cannot be
 * the task itself, nor any descendant of it. Walks the ancestor chain of the
 * proposed parent (bounded) looking for the task. Enforced at the query boundary
 * so no surface — UI, REST, CLI, or agent — can build a cycle.
 */
function assertNoParentCycle(taskId: string, newParentId: string): void {
  if (newParentId === taskId) {
    throw new TaskLifecycleError('invalid_params', 'A task cannot be its own parent.', { taskId });
  }
  let current: string | null = newParentId;
  let guard = 0;
  while (current && guard < 1000) {
    const row: { parentId: string | null } | undefined = getDb()
      .select({ parentId: tasks.parentId })
      .from(tasks)
      .where(eq(tasks.id, current))
      .get();
    if (!row) return; // unknown ancestor — no cycle through a missing row
    if (row.parentId === taskId) {
      throw new TaskLifecycleError('invalid_params', 'That parent is a descendant of this task (would create a cycle).', { taskId, newParentId });
    }
    current = row.parentId;
    guard += 1;
  }
}

/**
 * Guard completing/archiving a parent that still has open children. When some
 * exist, the caller must acknowledge the EXACT current open-child set; a missing
 * or stale acknowledgement returns `conflict` with the current open children so
 * the caller cannot unknowingly confirm a different set. Children are never
 * changed here — acknowledging only lets the parent proceed.
 */
function guardOpenChildren(taskId: string, acknowledged: string[] | undefined, action: string): void {
  const open = openChildIds(taskId);
  if (open.length === 0) return;
  const ackSorted = acknowledged ? [...acknowledged].sort() : null;
  const matches = ackSorted != null && ackSorted.length === open.length && ackSorted.every((v, i) => v === open[i]);
  if (!matches) {
    const openChildren = getDb()
      .select({ id: tasks.id, title: tasks.title, status: tasks.status })
      .from(tasks)
      .where(inArray(tasks.id, open))
      .all()
      .map((t) => ({ id: t.id, title: t.title, status: normalizeTaskStatus(t.status) }));
    throw new TaskLifecycleError(
      'conflict',
      `This task has ${open.length} open ${open.length === 1 ? 'child' : 'children'}. Confirm to ${action} it (children are left unchanged).`,
      { requiresChildAck: true, openChildren },
    );
  }
}


function recordLifecycleCommand(
  taskId: string,
  idempotencyKey: string,
  command: LifecycleCommand,
  from: string,
  to: string,
  statusChangedCount: number,
  meta: LifecycleActorMeta,
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
      actorSource: meta.source,
      actorSessionId: meta.actorSessionId ?? null,
      executionId: meta.executionId ?? null,
      runId: meta.runId ?? null,
      reason: meta.reason ?? null,
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

export interface LifecyclePreflightInput {
  taskId: string;
  command: TransitionCommand | 'complete';
  idempotencyKey?: string;
  expectedStatusChangedCount?: number;
  acknowledgedChildIds?: string[];
}

/**
 * Validate a lifecycle command WITHOUT applying it, so a caller can run runtime
 * coordination (stopping an agent, sending a scope-change message) only for a
 * command that will actually apply — never stopping work for a command that then
 * rejects on a stale revision, an idempotent replay, or open children.
 *
 * Returns `{ replay: true }` when this key was already applied (the caller should
 * skip coordination and let the apply replay the recorded result). Throws
 * {@link TaskLifecycleError} on any precondition failure. Returns `{ replay:
 * false }` when the command is applicable now. This mirrors the checks the apply
 * itself re-runs authoritatively inside its transaction.
 */
export function lifecyclePreflight(input: LifecyclePreflightInput): { replay: boolean } {
  const { taskId, command } = input;
  if (input.idempotencyKey) {
    const prior = priorLifecycleCommand(taskId, input.idempotencyKey);
    if (prior) {
      if (prior.command !== command) {
        throw new TaskLifecycleError(
          'conflict',
          `Idempotency key already used for "${prior.command}", cannot reuse it for "${command}".`,
          { idempotencyKey: input.idempotencyKey, recordedCommand: prior.command, attemptedCommand: command },
        );
      }
      return { replay: true };
    }
  }

  const raw = hydrateRow(getDb().select().from(tasks).where(eq(tasks.id, taskId)).get());
  if (!raw) throw new TaskLifecycleError('not_found', `Task ${taskId} not found.`);
  const task = normalizeTaskRow(raw);

  if (!canApply(command, task.status)) {
    const valid = availableCommands(task.status).join(', ') || 'none';
    throw new TaskLifecycleError(
      'invalid_transition',
      `Cannot ${transitionLabel(command)} a task that is ${task.status}. Valid actions from ${task.status}: ${valid}.`,
      { from: task.status, command },
    );
  }
  if (input.expectedStatusChangedCount != null && input.expectedStatusChangedCount !== task.statusChangedCount) {
    throw new TaskLifecycleError(
      'conflict',
      `Task changed since it was loaded (expected status-change count ${input.expectedStatusChangedCount}, now ${task.statusChangedCount}). Reload and retry.`,
      { expected: input.expectedStatusChangedCount, actual: task.statusChangedCount },
    );
  }
  if (command === 'move_to_consider') {
    const reasons = considerBlockers({
      hardDeadline: task.hardDeadline ?? null,
      reminderAt: task.reminderAt ?? null,
      recurrence: task.recurrence ?? null,
      hasUnresolvedBlocker: isBlockerUnresolved(task.blockedOn),
    });
    if (reasons.length) {
      throw new TaskLifecycleError(
        'consider_precondition',
        `Cannot move to Consider while this task has ${reasons.join(', ')}. Resolve or remove ${reasons.length > 1 ? 'those' : 'that'} first.`,
        { reasons },
      );
    }
  }
  if (command === 'archive' || command === 'complete') {
    guardOpenChildren(taskId, input.acknowledgedChildIds, command === 'complete' ? 'complete' : 'archive');
  }
  return { replay: false };
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
    //    result even if the task has since moved elsewhere. Reusing the SAME key
    //    for a DIFFERENT command is a caller bug, not a retry: reject it rather
    //    than silently replay the wrong recorded result.
    const prior = priorLifecycleCommand(taskId, idempotencyKey);
    if (prior) {
      if (prior.command !== command) {
        throw new TaskLifecycleError(
          'conflict',
          `Idempotency key already used for "${prior.command}", cannot reuse it for "${command}".`,
          { idempotencyKey, recordedCommand: prior.command, attemptedCommand: command },
        );
      }
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
        reminderAt: task.reminderAt ?? null,
        recurrence: task.recurrence ?? null,
        hasUnresolvedBlocker: isBlockerUnresolved(task.blockedOn),
      });
      if (reasons.length) {
        throw new TaskLifecycleError(
          'consider_precondition',
          `Cannot move to Consider while this task has ${reasons.join(', ')}. Resolve or remove ${reasons.length > 1 ? 'those' : 'that'} first.`,
          { reasons },
        );
      }
    }

    // Task lifecycle is independent of execution lifecycle. Displacing a
    // genuinely running workstream (keep-running vs stop-agent) is coordinated
    // at the route/runtime layer BEFORE this transaction — the durable
    // transition here never stops, archives, or detaches an execution.

    // 5c. Archiving a parent with open children requires acknowledging the exact
    //     current open-child set. Children are left unchanged.
    if (command === 'archive') {
      guardOpenChildren(taskId, input.acknowledgedChildIds, 'archive');
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
  /** For completing a parent with open children: the exact current open-child
   * ids the caller confirmed. Missing/stale throws `conflict`. */
  acknowledgedChildIds?: string[];
  meta: LifecycleActorMeta;
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
export function completeTask(id: string, input: CompleteTaskInput): LifecycleOutcome | null {
  const idempotencyKey = input.idempotencyKey ?? uuidv7();
  return inEntityTx(() => completeTaskInTx(id, idempotencyKey, input), true);
}

/**
 * The completion body, run WITHIN an existing entity transaction (it opens no
 * transaction of its own), so it can be composed atomically with other writes —
 * e.g. recording a review AND completing the task in one transaction for
 * accept-and-complete. Never call this outside an active entity transaction.
 */
function completeTaskInTx(id: string, idempotencyKey: string, input: CompleteTaskInput): LifecycleOutcome | null {
    // Idempotent replay.
    const prior = priorLifecycleCommand(id, idempotencyKey);
    if (prior) {
      // Same key previously used for a non-completion command is a caller bug.
      if (prior.command !== 'complete') {
        throw new TaskLifecycleError(
          'conflict',
          `Idempotency key already used for "${prior.command}", cannot reuse it for "complete".`,
          { idempotencyKey, recordedCommand: prior.command, attemptedCommand: 'complete' },
        );
      }
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

    // Task lifecycle is independent of execution lifecycle: completing a task
    // never stops or detaches an execution still working other tasks. Any
    // keep-running vs stop-agent coordination for a genuinely running workstream
    // happens at the route/runtime layer before this transaction.

    // Completing a parent with open children requires acknowledging the exact
    // current open-child set. Children are left unchanged.
    guardOpenChildren(id, input.acknowledgedChildIds, 'complete');

    const now = new Date().toISOString();

    // Exactly one completion occurrence, whether or not recurring.
    getDb().insert(taskCompletions).values({ id: uuidv7(), taskId: id, completedAt: now, note: input.note ?? null }).run();

    if (task.recurrence) {
      // Recurring: record the occurrence, advance the schedule, end WIP -> Todo.
      // The cadence anchors to the SCHEDULED occurrence (nextRecurrenceAt), not
      // the completion instant, and advances in whole intervals until the first
      // FUTURE occurrence — so completing late (even several intervals late)
      // preserves phase and never schedules an already-overdue occurrence.
      const anchor = task.nextRecurrenceAt ?? now;
      const nextDate = nextFutureRecurrence(task.recurrence, anchor, now);
      // Every successful recurring completion advances the monotonic lifecycle
      // revision, even a Todo->Todo occurrence, so concurrent/duplicate
      // completions are detectable. The status-age stamp only moves when the
      // stored status actually changed.
      const statusChanged = from !== 'todo';
      const nextCount = task.statusChangedCount + 1;
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
}

/**
 * Advance a date by one recurrence interval. UTC throughout (the values are ISO
 * UTC instants) so cadence never drifts by a timezone offset. Month/year steps
 * clamp to the last valid day of the target month, so Jan 31 monthly lands on
 * Feb 28/29 and stays end-of-month instead of skidding into March.
 */
function computeNextRecurrence(recurrence: string, fromDate: string): string {
  const date = new Date(fromDate);
  const lower = recurrence.toLowerCase().trim();

  const addDays = (n: number) => date.setUTCDate(date.getUTCDate() + n);
  const addMonths = (n: number) => {
    const day = date.getUTCDate();
    // If the anchor is the last day of its month, keep the cadence end-of-month
    // (Jan 31 -> Feb 28 -> Mar 31), rather than sticking at the 28th once a short
    // month clamps it. Otherwise clamp the day into the target month.
    const origLastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    const wasEndOfMonth = day === origLastDay;
    date.setUTCDate(1); // avoid overflow while we change the month
    date.setUTCMonth(date.getUTCMonth() + n);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(wasEndOfMonth ? lastDay : Math.min(day, lastDay));
  };

  if (lower.includes('daily') || lower === '1d') addDays(1);
  else if (lower.includes('weekly') || lower === '1w') addDays(7);
  else if (lower.includes('monthly') || lower === '1m') addMonths(1);
  else if (lower.includes('yearly') || lower === '1y') addMonths(12);
  else {
    const match = lower.match(/^(\d+)\s*([dwmy])$/);
    if (match) {
      const n = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === 'd') addDays(n);
      else if (unit === 'w') addDays(n * 7);
      else if (unit === 'm') addMonths(n);
      else addMonths(n * 12);
    } else {
      addDays(7); // safe default for an unrecognized pattern
    }
  }

  return date.toISOString();
}

/**
 * The next occurrence at or after "now", advancing from the SCHEDULED occurrence
 * in whole intervals so the cadence's phase is preserved even when a completion
 * is several intervals late (a 3-days-late daily task lands tomorrow, not in 3
 * days). Bounded so a degenerate pattern can never loop forever.
 */
function nextFutureRecurrence(recurrence: string, scheduledAnchor: string, now: string): string {
  let next = computeNextRecurrence(recurrence, scheduledAnchor);
  let guard = 0;
  while (next <= now && guard < 5000) {
    next = computeNextRecurrence(recurrence, next);
    guard += 1;
  }
  return next;
}

// ─── Task↔execution associations & review ─────────────────────
// The association is many-to-many via `execution_tasks`: a task can be worked by
// many workstreams (several attempts = one In progress outcome), and a workstream
// can be associated with many tasks (a batch with shared context). Association is
// durable context, not ownership: it does not gate the task's lifecycle and does
// not claim liveness. Taskless quick work has no rows. Reading output only moves
// unread state; review is an explicit disposition tied to the exact output event.

/** Workstreams associated with a task, newest first. */
export function getTaskExecutions(taskId: string): ExecutionRecord[] {
  return getDb()
    .select(getTableColumns(executions))
    .from(executions)
    .innerJoin(executionTasks, eq(executionTasks.executionId, executions.id))
    .where(eq(executionTasks.taskId, taskId))
    .orderBy(desc(executions.createdAt))
    .all();
}

/**
 * Continue-with-agent targets for a task: its non-archived associated
 * executions that have a live chat session to resume, newest first. Zero means
 * launch a new execution, one means resume it, several means offer a chooser.
 * Archived executions are history, never automatic Continue targets.
 */
export function getTaskContinueTargets(taskId: string): { executionId: string; sessionId: string; label: string | null }[] {
  const out: { executionId: string; sessionId: string; label: string | null }[] = [];
  for (const e of getTaskExecutions(taskId)) {
    if (e.status !== 'active') continue;
    const session = listChatSessions({ executionId: e.id, status: 'active' })[0];
    if (session) out.push({ executionId: e.id, sessionId: session.id, label: e.label });
  }
  return out;
}

/** Tasks a workstream is associated with, newest association first. */
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
 * The open tasks a workspace's active executions are working, newest
 * association first, each with the executions that work it (the agent
 * view's Overview). Done and archived tasks are left out.
 */
export function listWorkspaceExecutionTasks(
  workspaceId: string,
): Array<{ id: string; title: string; status: TaskRecord['status']; executionIds: string[] }> {
  const rows = getDb()
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      executionId: executionTasks.executionId,
    })
    .from(executionTasks)
    .innerJoin(tasks, eq(executionTasks.taskId, tasks.id))
    .innerJoin(executions, eq(executionTasks.executionId, executions.id))
    .where(and(
      eq(executions.workspaceId, workspaceId),
      eq(executions.status, 'active'),
      sql`${tasks.status} NOT IN ('done', 'archived')`,
    ))
    .orderBy(desc(executionTasks.createdAt))
    .all();
  const byTask = new Map<string, { id: string; title: string; status: TaskRecord['status']; executionIds: string[] }>();
  for (const row of rows) {
    const entry = byTask.get(row.id);
    if (entry) entry.executionIds.push(row.executionId);
    else byTask.set(row.id, { id: row.id, title: row.title, status: row.status, executionIds: [row.executionId] });
  }
  return [...byTask.values()];
}

/**
 * Associate a workstream (execution) with a task. Many-to-many, so it simply
 * ensures the (execution, task) pair exists — idempotent, never a conflict.
 * Both must exist. This links durable context, it does not claim or start work.
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

/** Remove a task↔workstream association pair. Returns true if a row was removed. */
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
  actorSource: EntityVersionSource;
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

  // The output event must actually be a REVIEWABLE output of THIS execution: an
  // outcome-source event in one of the execution's sessions that is not nested
  // subagent narration. Otherwise a stale or spoofed id could record a
  // disposition against another execution's event, a non-output event, or a
  // subagent's line.
  const sessionIds = executionSessionIds(input.executionId);
  const evt =
    sessionIds.length > 0
      ? getDb()
          .select({ id: chatEvents.id, sessionId: chatEvents.sessionId, parentCallId: chatEvents.externalParentToolCallId })
          .from(chatEvents)
          .where(
            and(
              eq(chatEvents.id, input.outputEventId),
              inArray(chatEvents.sessionId, sessionIds),
              inArray(chatEvents.source, [...OUTCOME_SOURCES]),
            ),
          )
          .get()
      : undefined;
  const belongs = !!evt && (!evt.parentCallId || !isSubagentLaunchCall(evt.sessionId, evt.parentCallId));
  if (!belongs) {
    throw new TaskLifecycleError(
      'not_found',
      `Output event ${input.outputEventId} is not a reviewable output of execution ${input.executionId}.`,
      { executionId: input.executionId, outputEventId: input.outputEventId },
    );
  }

  return getDb()
    .insert(executionReviews)
    .values({
      id: uuidv7(),
      executionId: input.executionId,
      outputEventId: input.outputEventId,
      disposition: input.disposition,
      actorSource: input.actorSource,
      actorSessionId: input.actorSessionId ?? null,
      note: input.note ?? null,
    })
    .returning()
    .get();
}

export interface AcceptAndCompleteInput {
  executionId: string;
  /** The EXACT output event being accepted — never defaulted. */
  outputEventId: string;
  /** The single associated task being completed. */
  taskId: string;
  note?: string | null;
  idempotencyKey: string;
  actorSource: EntityVersionSource;
}

/**
 * Accept an execution's exact output AND complete one named associated task, in
 * ONE transaction. Atomic: if the output is no longer the latest reviewable
 * output (newer arrived) or the task is not an eligible associated task, neither
 * the acceptance nor the completion is recorded. Never stops or detaches the
 * execution and never touches any other associated task.
 */
export function acceptOutputAndCompleteTask(input: AcceptAndCompleteInput): { review: ExecutionReviewRecord; task: TaskRecord | null } {
  return inEntityTx(() => {
    // The accepted event must be the CURRENT latest reviewable output — inside
    // this transaction nothing newer can land, so completing can't bury an
    // unreviewed obligation.
    const latest = latestReviewableOutputEvent(executionSessionIds(input.executionId));
    if (!latest || latest.id !== input.outputEventId) {
      throw new TaskLifecycleError(
        'conflict',
        'That output is no longer the latest reviewable output. Review the newest output before completing.',
        { latestOutputEventId: latest?.id ?? null },
      );
    }
    // The task must be an eligible (non-terminal) associated task.
    const target = getExecutionTasks(input.executionId).find((t) => t.id === input.taskId);
    if (!target || isTerminal(normalizeTaskStatus(target.status))) {
      throw new TaskLifecycleError(
        'invalid_params',
        'That task is not an eligible associated task of this execution.',
        { taskId: input.taskId },
      );
    }
    // Record the acceptance and complete just that task, together.
    const review = getDb()
      .insert(executionReviews)
      .values({
        id: uuidv7(),
        executionId: input.executionId,
        outputEventId: input.outputEventId,
        disposition: 'accepted',
        actorSource: input.actorSource,
        actorSessionId: null,
        note: input.note ?? null,
      })
      .returning()
      .get();
    const outcome = completeTaskInTx(input.taskId, input.idempotencyKey, {
      meta: { source: input.actorSource, executionId: input.executionId },
    });
    return { review, task: outcome?.task ?? null };
  }, true);
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

/**
 * The latest reviewable output event of an execution and whether it still needs
 * review, by the EXACT-event model: a disposition recorded against an older
 * output event never clears a newer one. Shared by the review context and the
 * task Review badge so both agree instead of one using timestamps.
 */
/**
 * The newest REVIEWABLE output event across an execution's chat sessions. Uses
 * the same predicate as `isOutcomeEvent` at insert time: an outcome-source event
 * that is NOT nested subagent narration (a subagent's own text streamed onto the
 * parent session tagged with the launching tool_use id is a nested actor talking
 * to its caller, not the session answering the user, so it can never be the
 * review target). Returns the id and time, or null.
 */
function latestReviewableOutputEvent(sessionIds: string[]): { id: string; createdAt: string } | null {
  // One query per session, then the newest by (createdAt, id). An IN list over
  // several sessions can't walk idx_chat_events_session_created newest-first,
  // so SQLite sorted every event of every chat in the execution (0.6s on a long
  // codex run) on the server's only thread, and this backs two polls (the
  // review bar every 15s, task attention every 20s).
  let latest: { id: string; createdAt: string } | null = null;
  for (const sessionId of sessionIds) {
    // The newest outcome event that is NOT nested subagent narration, decided
    // in SQL (a correlated NOT EXISTS against the launching tool_call) so no
    // row cap can let enough nested output hide the real top-level result.
    // Kept in sync with isSubagentTool.
    const row = getDb()
      .select({ id: chatEvents.id, createdAt: chatEvents.createdAt })
      .from(chatEvents)
      .where(
        and(
          eq(chatEvents.sessionId, sessionId),
          inArray(chatEvents.source, [...OUTCOME_SOURCES]),
          or(
            isNull(chatEvents.externalParentToolCallId),
            sql`NOT EXISTS (SELECT 1 FROM chat_events sub WHERE sub.session_id = ${chatEvents.sessionId} AND sub.external_tool_call_id = ${chatEvents.externalParentToolCallId} AND sub.source = 'tool_call' AND sub.tool_name IN ('Task', 'Agent', 'spawn_agent'))`,
          ),
        ),
      )
      .orderBy(desc(chatEvents.createdAt), desc(chatEvents.id))
      .limit(1)
      .get();
    if (!row) continue;
    if (!latest || row.createdAt > latest.createdAt || (row.createdAt === latest.createdAt && row.id > latest.id)) {
      latest = { id: row.id, createdAt: row.createdAt };
    }
  }
  return latest;
}

function executionSessionIds(executionId: string): string[] {
  return getDb()
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(eq(chatSessions.executionId, executionId))
    .all()
    .map((s) => s.id);
}

function latestOutputReviewState(executionId: string): {
  latestOutputEventId: string | null;
  latestOutputEventAt: string | null;
  latestDisposition: ExecutionReviewRecord['disposition'] | null;
  hasUnreviewedOutput: boolean;
} {
  const latest = latestReviewableOutputEvent(executionSessionIds(executionId));
  const latestOutputEventId = latest?.id ?? null;
  const latestDisposition = latestOutputEventId ? getLatestOutputReview(latestOutputEventId)?.disposition ?? null : null;
  return {
    latestOutputEventId,
    latestOutputEventAt: latest?.createdAt ?? null,
    latestDisposition,
    hasUnreviewedOutput: !!latestOutputEventId && !latestDisposition,
  };
}

/**
 * Everything the review affordance needs for an execution: the latest output
 * event to disposition, its current disposition (a fresh output after the last
 * reviewed one is a new obligation), the sole associated task if any (so
 * Accept-and-complete is offered only when unambiguous), and how many tasks are
 * associated at all (so the review bar still shows for a shared workstream).
 */
export function getExecutionReviewContext(executionId: string): ExecutionReviewContext {
  const { latestOutputEventId, latestDisposition, hasUnreviewedOutput } = latestOutputReviewState(executionId);

  const associated = getExecutionTasks(executionId);
  const soleTaskId = associated.length === 1 ? associated[0].id : null;
  const soleTaskTitle = associated.length === 1 ? associated[0].title : null;

  return {
    latestOutputEventId,
    soleTaskId,
    soleTaskTitle,
    associatedTaskCount: associated.length,
    latestDisposition,
    hasUnreviewedOutput,
  };
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

/**
 * Derived attention badges for a task's Current-Work row. Blocked is the
 * unresolved-blocker signal; the rest come from the task's associated live
 * workstreams:
 *   - stalled: an associated workstream failed setup / dispatch.
 *   - review: an associated workstream produced outcome output that has not been
 *     reviewed since (a Review obligation — reading does not clear it).
 *   - working: an associated workstream is live on the task and not stalled.
 *     Given the running-session set, live means a turn is running right now,
 *     and that shows even beside an update still to review: both are true, and
 *     "is an agent doing something" is the question the badge answers. Without
 *     it, live is only an active association, so an update to review wins.
 * "Needs input" is intentionally absent: pending agent input is not durably
 * tracked, so we do not fake it.
 */
export function getTaskAttentionSignals(taskId: string, runningSessionIds?: Set<string>): TaskAttentionSignals {
  const base = getTaskLifecycleSignals(taskId);
  const task = getDb().select({ statusChangedAt: tasks.statusChangedAt }).from(tasks).where(eq(tasks.id, taskId)).get();
  const epoch = task?.statusChangedAt ?? '';

  // ALL associated executions, any status — an archived execution may still
  // hold an unreviewed obligation (archive is a runtime concern, not a review
  // one). Each carries its association time so output produced before a task was
  // associated never lands a badge on it.
  const associations = getDb()
    .select({ id: executions.id, setupError: executions.setupError, status: executions.status, associatedAt: executionTasks.createdAt })
    .from(executions)
    .innerJoin(executionTasks, eq(executionTasks.executionId, executions.id))
    .where(eq(executionTasks.taskId, taskId))
    .all();

  if (associations.length === 0) {
    return { ...base, stalled: false, review: false, working: false, agentSessionId: null };
  }

  // Working is a RUNTIME signal: prefer the live running-session set (genuinely
  // running) when the caller supplies it; otherwise fall back to the durable
  // active-execution association.
  const live = associations.filter((e) =>
    runningSessionIds
      ? executionSessionIds(e.id).some((sid) => runningSessionIds.has(sid))
      : e.status === 'active',
  );
  // Stalled is a setup FAILURE, which means the execution is active but NOT
  // running — so it is checked across active associations, not just live ones
  // (a stalled agent by definition has no live session).
  const stalledExecution = associations.find((e) => !!e.setupError && e.status === 'active');
  const stalled = !!stalledExecution;

  // Review: an associated execution's latest REVIEWABLE output is unreviewed AND
  // newer than both the association and the task's current-state epoch — so a
  // shared checkpoint or an older run never falsely flags this task. Times are
  // compared as instants (event times can be SQLite space-format while the
  // association/epoch are ISO — a lexicographic compare across formats is wrong).
  const gateMs = Math.max(tsToMs(epoch), 0);
  const reviewExecutions = associations.filter((e) => {
    const s = latestOutputReviewState(e.id);
    if (!s.hasUnreviewedOutput || !s.latestOutputEventAt) return false;
    const gate = Math.max(tsToMs(e.associatedAt), gateMs);
    return tsToMs(s.latestOutputEventAt) > gate;
  });
  const review = reviewExecutions.length > 0;

  // Where "open the agent" goes, in the badges' order of interest: the chat
  // running now, the execution with an update, the stalled one, then any
  // active one. An archived execution has no active chat and falls through.
  const activeChatOf = (executionId: string | undefined): string | null =>
    executionId ? listChatSessions({ executionId, status: 'active' })[0]?.id ?? null : null;
  const runningChat = runningSessionIds
    ? live.flatMap((e) => executionSessionIds(e.id)).find((sid) => runningSessionIds.has(sid)) ?? null
    : null;
  const agentSessionId =
    runningChat ??
    reviewExecutions.map((e) => activeChatOf(e.id)).find((sid) => sid !== null) ??
    activeChatOf(stalledExecution?.id) ??
    associations.filter((e) => e.status === 'active').map((e) => activeChatOf(e.id)).find((sid) => sid !== null) ??
    null;

  return {
    ...base,
    stalled,
    review,
    working: live.length > 0 && !stalled && (!!runningSessionIds || !review),
    agentSessionId,
  };
}

/** Batch attention signals, keyed by task id. Bounded call sites (Current Work,
 * visible In-progress rows), so per-task computation is fine. Pass the live
 * running-session set so Working/Stalled reflect genuine runtime, not just an
 * active-execution association. */
export function getTasksAttentionSignals(taskIds: string[], runningSessionIds?: Set<string>): Record<string, TaskAttentionSignals> {
  const out: Record<string, TaskAttentionSignals> = {};
  for (const id of taskIds) out[id] = getTaskAttentionSignals(id, runningSessionIds);
  return out;
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

/** Viewing metadata bypasses content versioning, embedding and mirror writes. */
export function markNoteViewed(id: string): void {
  getDb().update(notes).set({ lastViewedAt: new Date().toISOString() }).where(eq(notes.id, id)).run();
}

export function markTaskViewed(id: string): void {
  getDb().update(tasks).set({ lastViewedAt: new Date().toISOString() }).where(eq(tasks.id, id)).run();
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

export function updateNote(id: string, input: UpdateNoteInput, meta: EntityVersionMeta): NoteRecord | null {
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

/**
 * Copy authoritative metadata onto existing copied-note attachment stubs.
 * Validation and the attachment-only update share a write transaction. No
 * content, links, history, or embedding text changes, so their existing
 * projections remain valid. The mirror is refreshed after commit, including
 * on retries that may follow an interrupted earlier mirror write.
 */
export async function repairNoteAttachmentMetadata(input: {
  sourceNoteId: string;
  targetNoteId: string;
  fileNames: string[];
}): Promise<{ sourceNoteId: string; targetNoteId: string; repairedFileNames: string[]; unchangedFileNames: string[] }> {
  const repairedFileNames = inEntityTx(() => {
    const source = getNote(input.sourceNoteId);
    const target = getNote(input.targetNoteId);
    if (!source) throw new AttachmentMetadataRepairError('not_found', `Source note not found: ${input.sourceNoteId}`);
    if (!target) throw new AttachmentMetadataRepairError('not_found', `Target note not found: ${input.targetNoteId}`);
    const plan = planNoteAttachmentMetadataRepair({ source, target, fileNames: input.fileNames });
    if (plan.repairedFileNames.length) {
      getDb().update(notes).set({
        attachments: dehydrateAttachments(plan.attachments) ?? [],
        updatedAt: new Date().toISOString(),
      }).where(eq(notes.id, target.id)).run();
    }
    return plan.repairedFileNames;
  }, true);
  await syncEntity('note', input.targetNoteId);
  return {
    sourceNoteId: input.sourceNoteId,
    targetNoteId: input.targetNoteId,
    repairedFileNames,
    unchangedFileNames: input.fileNames.filter((name) => !repairedFileNames.includes(name)),
  };
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
  /** Who authored the change. Required so authorship is never silently guessed
   *  (see docs/schema-defaults.md, item 9). 'human' | 'ai' | 'system'. */
  source: EntityVersionSource;
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
    areaId: t.areaId ?? null,
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
    areaId: n.areaId ?? null,
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
  meta: EntityVersionMeta,
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
        source: meta.source,
        actorSessionId: meta.actorSessionId ?? null,
        summary: meta.summary ?? null,
        revertedFromVersionId: meta.revertedFromVersionId ?? null,
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

/**
 * The area to restore from a snapshot, or nothing to leave the current area
 * alone: when the snapshot predates area history (no `areaId` key), or when
 * the area it names no longer exists.
 */
function restorableArea(snap: EntityVersionSnapshot): { areaId: string | null } | Record<string, never> {
  if (!('areaId' in snap)) return {};
  const areaId = snap.areaId ?? null;
  if (areaId !== null && !getArea(areaId)) return {};
  return { areaId };
}

function snapshotToTaskInput(snap: EntityVersionSnapshot): UpdateTaskInput {
  // Content-only restore. Lifecycle `status` and completion metadata are
  // deliberately NOT restored: an undo of an edit must never silently
  // un-complete a task or move it between lanes. Lifecycle changes only ever
  // happen through an explicit semantic transition command.
  return {
    ...(snap.title != null ? { title: snap.title } : {}),
    body: snap.body,
    ...restorableArea(snap),
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
    ...restorableArea(snap),
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
    media: input.media ?? 'text',
    origin: input.origin ?? 'internal',
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
        // Policy default in the query layer (the schema carries none).
        origin: input.origin ?? 'manual',
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

export function getUserState(): UserStateRecord | undefined {
  const db = getDb();
  const row = db.select().from(userState).where(eq(userState.id, 1)).get();
  return row ? hydrateUserState(row) : undefined;
}

/**
 * The orchestrator's image is a snake_case attachment on disk, camelCase in
 * the app. Onboarding progress is read leniently: steps this version doesn't
 * know are dropped (src/lib/onboarding/progress.ts).
 */
function hydrateUserState(row: typeof userState.$inferSelect): UserStateRecord {
  return {
    ...row,
    orchestratorImage: row.orchestratorImage ? camelizeKeys(row.orchestratorImage) : null,
    onboarding: row.onboarding ? readOnboardingRecord(row.onboarding) : null,
  };
}

// ─── Main chat onboarding ────────────────────────────────────

/**
 * One change to the home's onboarding progress, read and written in a single
 * transaction, so two windows finishing steps at once both land. `change`
 * gets the record every rule starts from (`baseOnboardingRecord`) and returns
 * the new one plus any columns to set with it, or null to change nothing.
 */
function changeOnboarding(
  change: (
    record: OnboardingRecord,
    row: typeof userState.$inferSelect,
    now: string,
  ) => { record: OnboardingRecord; set?: Partial<typeof userState.$inferInsert> } | null,
): UserStateRecord | undefined {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(userState).where(eq(userState.id, 1)).get();
    if (!row) return undefined;
    const now = new Date().toISOString();
    const result = change(baseOnboardingRecord(row.onboarding, row.orchestratorIntroducedAt), row, now);
    if (!result) return hydrateUserState(row);
    const updated = tx
      .update(userState)
      .set({ ...result.set, onboarding: result.record, updatedAt: now })
      .where(eq(userState.id, 1))
      .returning()
      .get();
    return updated ? hydrateUserState(updated) : undefined;
  });
}

/** The question now on screen in a chat, so a message sent there instead skips it. */
export function showOnboardingStep(input: { step: OnboardingStepName; chatId: string }): UserStateRecord | undefined {
  return changeOnboarding((record) => {
    const next = withStepShown(record, input.step, input.chatId);
    return next === record ? null : { record: next };
  });
}

/** A step the person finished in the conversation. */
export function recordOnboardingStep(input: {
  step: OnboardingStepName;
  status: 'answered' | 'skipped';
  reply?: string;
  chatId: string;
}): UserStateRecord | undefined {
  return changeOnboarding((record, _row, now) => ({
    record: withStepRecorded(record, input.step, {
      status: input.status,
      ...(input.reply !== undefined ? { reply: clampReply(input.reply) } : {}),
      chatId: input.chatId,
      at: now,
    }),
  }));
}

/**
 * The conversation is over, finished or skipped: what's left is filled in
 * (`withFinished`), the home counts as introduced, and a new home as set up.
 * Idempotent, so a retry or a second window changes nothing more.
 */
export function finishOnboarding(input: { skipped: boolean; chatId?: string }): UserStateRecord | undefined {
  return changeOnboarding((record, row, now) => ({
    record: withFinished(record, { skipped: input.skipped, chatId: input.chatId, at: now }),
    set: {
      orchestratorIntroducedAt: row.orchestratorIntroducedAt ?? now,
      onboardedAt: row.onboardedAt ?? now,
    },
  }));
}

/** The empty chat the conversation is in was replaced: the conversation moves with it. */
export function moveOnboardingChat(input: { from: string; to: string }): UserStateRecord | undefined {
  return changeOnboarding((record) => ({ record: withChatMoved(record, input.from, input.to) }));
}

/**
 * A person sent a message in a chat. If a question was on screen there, they
 * passed it over, and it's skipped (`withMessageSent`). Returns whether it was.
 */
export function skipOnboardingStepOnScreen(chatId: string): boolean {
  let skipped = false;
  changeOnboarding((record, _row, now) => {
    const next = withMessageSent(record, chatId, now);
    if (!next) return null;
    skipped = true;
    return { record: next };
  });
  return skipped;
}

/** The user's working-hours window (local HH:MM), with 9–6 defaults. */
export function getWorkdayBounds(): { workdayStart: string; workdayEnd: string } {
  const us = getUserState();
  return {
    workdayStart: us?.workdayStart ?? '09:00',
    workdayEnd: us?.workdayEnd ?? '18:00',
  };
}

export function updateUserState(input: UpdateUserStateInput): UserStateRecord | undefined {
  const db = getDb();
  const { orchestratorImage, ...rest } = input;
  const row = db
    .update(userState)
    .set({
      ...rest,
      ...(orchestratorImage !== undefined
        ? { orchestratorImage: orchestratorImage ? snakeizeKeys(orchestratorImage) : null }
        : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userState.id, 1))
    .returning()
    .get();
  return row ? hydrateUserState(row) : undefined;
}

// ─── Agent Harness Settings ──────────────────────────────────

export function getHarnessSettings(harness: HarnessId): HarnessSettingsRecord | undefined {
  return getDb().select().from(harnessSettings)
    .where(eq(harnessSettings.harness, harness)).get();
}

export function listHarnessSettings(): HarnessSettingsRecord[] {
  return getDb().select().from(harnessSettings).orderBy(asc(harnessSettings.harness)).all();
}

/**
 * Lazily materialize one settings row. Claude and Codex inherit a small,
 * useful default allowlist from the bundled fallback catalog. Dynamic-only
 * harnesses intentionally start empty until the user chooses live models.
 */
export function ensureHarnessSettings(harness: HarnessId): HarnessSettingsRecord {
  const existing = getHarnessSettings(harness);
  if (existing) {
    // Fold in any model bundled since this row was last touched, so a new
    // release surfaces in the picker instead of hiding behind "Show more" —
    // without re-enabling anything the user deliberately turned off.
    const reconciled = reconcileEnabledModels(harness, existing.enabledModels, existing.knownModels);
    if (!reconciled.changed) return existing;
    return upsertHarnessSettings({
      ...existing,
      enabledModels: reconciled.enabledModels,
      knownModels: reconciled.knownModels,
      // A row with no default yet adopts the flagship; an existing choice stands.
      defaultModel: existing.defaultModel ?? reconciled.enabledModels[0] ?? null,
    });
  }
  const state = getUserState();
  const preferred = state?.defaultHarness === harness ? state.defaultModel : null;
  // Seed the curated (non-legacy) bundled models. Claude's are tier aliases
  // that never go stale, so all of them are curated; Codex's superseded tail
  // is flagged legacy and stays one toggle away in settings. `knownModels`
  // records the whole bundled catalog as already seen, so the legacy tail is
  // not later mistaken for a fresh model and auto-enabled.
  const enabledModels = [...new Set([
    ...(preferred ? [preferred] : []),
    ...curatedDefaultModelIds(harness),
  ])];
  return upsertHarnessSettings({
    harness,
    enabledModels,
    customModels: [],
    knownModels: bundledModelIds(harness),
    defaultModel: preferred && enabledModels.includes(preferred) ? preferred : enabledModels[0] ?? null,
    defaultVariant: null,
    defaultEffort: state?.defaultHarness === harness && harnessSupportsEffort(harness)
      ? state.defaultEffort
      : null,
    catalogRefreshedAt: null,
  });
}

export function upsertHarnessSettings(
  input: UpsertHarnessSettingsInput,
): HarnessSettingsRecord {
  const now = new Date().toISOString();
  const id = input.id ?? `harness:${input.harness}`;
  return getDb().insert(harnessSettings)
    .values({ ...input, id, updatedAt: now })
    .onConflictDoUpdate({
      target: harnessSettings.harness,
      set: {
        enabledModels: input.enabledModels,
        // Omitted on the callers that only touch the allowlist, so the pinned
        // ids survive a plain model save instead of being reset to empty.
        ...(input.customModels ? { customModels: input.customModels } : {}),
        // Same guard: an upsert that doesn't carry the known snapshot must not
        // wipe it back to NULL and re-trigger reconciliation.
        ...(input.knownModels !== undefined ? { knownModels: input.knownModels } : {}),
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
): HarnessSettingsRecord {
  const enabledModels = normalizeEnabledModels(models);
  const db = getDb();
  return db.transaction((tx) => {
    const existing = tx.select().from(harnessSettings)
      .where(eq(harnessSettings.harness, harness)).get();
    const defaultModel = requestedDefault ?? existing?.defaultModel ?? enabledModels[0] ?? null;
    if (defaultModel && !enabledModels.includes(defaultModel)) {
      throw new Error('The default model must be enabled');
    }
    const active = tx.select().from(userState).where(eq(userState.id, 1)).get()?.defaultHarness;
    if (active === harness && enabledModels.length === 0) {
      throw new Error('The active harness must have at least one enabled model');
    }
    // An explicit save means the user has now seen the whole current catalog,
    // so advance the known snapshot: a curated model they left off is recorded
    // as a decision and won't be re-added as "new" on the next reconcile.
    const knownModels = reconcileEnabledModels(harness, enabledModels, existing?.knownModels).knownModels;
    const now = new Date().toISOString();
    return tx.insert(harnessSettings)
      .values({
        id: `harness:${harness}`,
        harness,
        enabledModels,
        knownModels,
        defaultModel,
        defaultVariant: existing?.defaultVariant,
        defaultEffort: existing?.defaultEffort,
        catalogRefreshedAt: existing?.catalogRefreshedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: harnessSettings.harness,
        set: { enabledModels, knownModels, defaultModel, updatedAt: now },
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
export function addCustomHarnessModel(harness: HarnessId, modelId: string): HarnessSettingsRecord {
  const id = normalizeCustomModelId(modelId);
  if (!id) throw new Error('Enter a model ID with no spaces, for example claude-opus-4-8');
  ensureHarnessSettings(harness);
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(harnessSettings)
      .where(eq(harnessSettings.harness, harness)).get()!;
    const customModels = [...new Set([...row.customModels, id])];
    const enabledModels = [...new Set([...row.enabledModels, id])];
    return tx.update(harnessSettings).set({
      customModels,
      enabledModels,
      defaultModel: row.defaultModel ?? id,
      updatedAt: new Date().toISOString(),
    }).where(eq(harnessSettings.harness, harness)).returning().get();
  });
}

/**
 * Drop a pinned model id. It leaves the allowlist with it, because a pin has
 * no catalog entry to fall back to and an enabled row that resolves to nothing
 * is worse than a missing one. The exception is an id that shadows a bundled
 * model (someone pinned `gpt-6-luna` by hand): that one still resolves without
 * the pin, so unpinning must not also hide it from the picker.
 */
export function removeCustomHarnessModel(harness: HarnessId, modelId: string): HarnessSettingsRecord {
  const id = modelId.trim();
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(harnessSettings)
      .where(eq(harnessSettings.harness, harness)).get();
    if (!row) throw new Error(`No settings for ${harness}`);
    if (!row.customModels.includes(id)) return row;
    const customModels = row.customModels.filter((entry) => entry !== id);
    const shadowsCatalogModel = modelsForProvider(harness).some((model) => model.id === id);
    const enabledModels = shadowsCatalogModel
      ? row.enabledModels
      : row.enabledModels.filter((entry) => entry !== id);
    const active = tx.select().from(userState).where(eq(userState.id, 1)).get()?.defaultHarness;
    if (active === harness && enabledModels.length === 0) {
      throw new Error('The active harness must have at least one enabled model');
    }
    const replacesDefault = row.defaultModel === id && !shadowsCatalogModel;
    const defaultModel = replacesDefault ? enabledModels[0] ?? null : row.defaultModel;
    const now = new Date().toISOString();
    const updated = tx.update(harnessSettings).set({
      customModels,
      enabledModels,
      defaultModel,
      // The pinned model owned this pair; the replacement advertises its own.
      defaultVariant: replacesDefault ? null : row.defaultVariant,
      defaultEffort: replacesDefault ? null : row.defaultEffort,
      updatedAt: now,
    }).where(eq(harnessSettings.harness, harness)).returning().get();
    if (replacesDefault && active === harness) {
      tx.update(userState).set({
        defaultModel: defaultModel,
        defaultEffort: null,
        updatedAt: now,
      }).where(eq(userState.id, 1)).run();
    }
    return updated;
  });
}

export function setHarnessDefaultSelection(
  harness: HarnessId,
  selection: { model: string; variant?: string | null; effort?: HarnessSettingsRecord['defaultEffort'] },
): HarnessSettingsRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(harnessSettings)
      .where(eq(harnessSettings.harness, harness)).get();
    if (!row || !row.enabledModels.includes(selection.model)) throw new Error('The default model must be enabled');
    const updated = tx.update(harnessSettings).set({
      defaultModel: selection.model,
      defaultVariant: selection.variant ?? null,
      defaultEffort: selection.effort ?? null,
      updatedAt: new Date().toISOString(),
    }).where(eq(harnessSettings.harness, harness)).returning().get();
    const active = tx.select().from(userState).where(eq(userState.id, 1)).get()?.defaultHarness;
    if (active === harness) {
      tx.update(userState).set({
        defaultModel: selection.model,
        defaultEffort: selection.effort ?? null,
        updatedAt: new Date().toISOString(),
      }).where(eq(userState.id, 1)).run();
    }
    return updated;
  });
}

export function setActiveHarness(harness: HarnessId): HarnessSettingsRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const row = tx.select().from(harnessSettings)
      .where(eq(harnessSettings.harness, harness)).get();
    if (!row?.defaultModel || !row.enabledModels.includes(row.defaultModel)) {
      throw new Error('The selected harness needs an enabled default model');
    }
    tx.update(userState).set({
      defaultHarness: harness,
      defaultModel: row.defaultModel,
      defaultEffort: row.defaultEffort,
      updatedAt: new Date().toISOString(),
    }).where(eq(userState.id, 1)).run();
    return row;
  });
}

export function beginProviderDisconnectSaga(input: {
  upstreamProviderId: string;
  replacementHarness?: HarnessId | null;
  replacementModel?: string | null;
}): HarnessOperationRecord {
  const db = getDb();
  return db.transaction((tx) => {
    if (input.replacementHarness) {
      const replacement = tx.select().from(harnessSettings)
        .where(eq(harnessSettings.harness, input.replacementHarness)).get();
      if (!replacement || !input.replacementModel || !replacement.enabledModels.includes(input.replacementModel)) {
        throw new Error('A valid enabled replacement selection is required');
      }
      tx.update(userState).set({
        defaultHarness: input.replacementHarness,
        defaultModel: input.replacementModel,
        defaultEffort: replacement.defaultEffort,
        updatedAt: new Date().toISOString(),
      }).where(eq(userState.id, 1)).run();
    }
    return tx.insert(harnessOperations).values({
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

export function completeProviderDisconnectSaga(id: string): HarnessOperationRecord | undefined {
  return getDb().update(harnessOperations).set({
    status: 'completed', lastErrorCode: null, updatedAt: new Date().toISOString(),
  }).where(eq(harnessOperations.id, id)).returning().get();
}

export function failProviderDisconnectSaga(id: string, safeErrorCode: string): HarnessOperationRecord | undefined {
  return getDb().update(harnessOperations).set({
    status: 'failed', lastErrorCode: safeErrorCode.slice(0, 100), updatedAt: new Date().toISOString(),
  }).where(eq(harnessOperations.id, id)).returning().get();
}

export function getProviderDisconnectSaga(id: string): HarnessOperationRecord | undefined {
  return getDb().select().from(harnessOperations).where(eq(harnessOperations.id, id)).get();
}

export function listRetryableProviderDisconnectSagas(): HarnessOperationRecord[] {
  return getDb().select().from(harnessOperations)
    .where(inArray(harnessOperations.status, ['pending', 'failed']))
    .orderBy(asc(harnessOperations.createdAt)).all();
}

// ─── Home and devices (docs/homes-spec.md §5.1) ─────────────

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** This home's identity row, or null before `ensureHomeIdentity` has made it. */
export function getHome(): HomeRecord | null {
  return getDb().select().from(home).get() ?? null;
}

/**
 * Create this home and the device it runs on, together. Refuses when a
 * home already exists: a database holds exactly one. The ids come from the
 * caller, which writes them to the machine identity file first, so a crash
 * between the two steps repeats the same ids.
 */
export function createHomeIdentity(input: {
  homeId: string;
  kind: HomeKind;
  name: string;
  host: CreateDeviceInput & { id: string };
}): { home: HomeRecord; device: DeviceRecord } {
  const db = getDb();
  return db.transaction((tx) => {
    const existing = tx.select().from(home).get();
    if (existing) throw new Error(`This database already belongs to home ${existing.id}.`);
    const now = new Date().toISOString();
    const device = tx
      .insert(devices)
      .values({ ...input.host, status: input.host.status ?? 'active', createdAt: now, updatedAt: now })
      .onConflictDoNothing()
      .returning()
      .get() ?? tx.select().from(devices).where(eq(devices.id, input.host.id)).get()!;
    const row = tx
      .insert(home)
      .values({ id: input.homeId, kind: input.kind, name: input.name, hostDeviceId: device.id, createdAt: now, updatedAt: now })
      .returning()
      .get();
    return { home: row, device };
  }, { behavior: 'immediate' });
}

export function createDevice(input: CreateDeviceInput): DeviceRecord {
  const now = new Date().toISOString();
  return getDb()
    .insert(devices)
    .values({ ...input, id: input.id ?? uuidv7(), status: input.status ?? 'active', createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function getDevice(id: string): DeviceRecord | null {
  return getDb().select().from(devices).where(eq(devices.id, id)).get() ?? null;
}

export function listDevices(options: { includeRevoked?: boolean } = {}): DeviceRecord[] {
  const q = getDb().select().from(devices);
  return (options.includeRevoked ? q : q.where(eq(devices.status, 'active'))).orderBy(asc(devices.createdAt)).all();
}

export function updateDevice(id: string, input: UpdateDeviceInput): DeviceRecord | null {
  return getDb()
    .update(devices)
    .set({ ...input, updatedAt: new Date().toISOString() })
    .where(eq(devices.id, id))
    .returning()
    .get() ?? null;
}

/**
 * Pair a new device: the device and its first key, together (Settings,
 * Devices, and `ri pair`). The key's token is returned once.
 */
export function pairDevice(input: {
  name: string;
  kind: DeviceKind;
  description?: string | null;
  expiresAt?: string | null;
}): { device: DeviceRecord; key: ApiKeyRecord; token: GeneratedToken } {
  const db = getDb();
  return db.transaction((tx) => {
    const now = new Date().toISOString();
    const device = tx
      .insert(devices)
      .values({ id: uuidv7(), name: input.name, kind: input.kind, status: 'active', createdAt: now, updatedAt: now })
      .returning()
      .get();
    const { key, token } = insertApiKey(tx, {
      name: input.name,
      description: input.description ?? null,
      expiresAt: input.expiresAt ?? null,
      deviceId: device.id,
      role: 'sign_in',
    });
    return { device, key, token };
  }, { behavior: 'immediate' });
}

/**
 * Another key for a device already paired: a new pairing link for it, e.g.
 * a phone that lost its sign-in, or another browser on the same computer.
 */
export function addDeviceKey(deviceId: string, input: { name?: string; expiresAt?: string | null } = {}): { key: ApiKeyRecord; token: GeneratedToken } {
  const db = getDb();
  return db.transaction((tx) => {
    const device = tx.select().from(devices).where(eq(devices.id, deviceId)).get();
    if (!device || device.status !== 'active') throw new Error('That device was removed.');
    return insertApiKey(tx, { name: input.name ?? device.name, expiresAt: input.expiresAt ?? null, deviceId: device.id, role: 'sign_in' });
  }, { behavior: 'immediate' });
}

/**
 * Keys without a device are the home's own: only the home mints one before
 * its identity exists (`ensureLocalToken` at first start, and every key a
 * database had before devices, which the homes migration leaves for this).
 * They belong to the device the home runs on. Returns how many it gave.
 */
export function giveHostItsKeys(): number {
  const db = getDb();
  const host = db.select({ id: home.hostDeviceId }).from(home).get()?.id;
  if (!host) return 0;
  return db
    .update(apiKeys)
    .set({ deviceId: host, updatedAt: new Date().toISOString() })
    .where(isNull(apiKeys.deviceId))
    .run().changes;
}

/** A device's active worker key, inside a transaction. */
function activeWorkerKeyIn(tx: Pick<ReturnType<typeof getDb>, 'select'>, deviceId: string): string | null {
  return (
    tx
      .select({ id: apiKeys.id })
      .from(apiKeys)
      .where(and(eq(apiKeys.deviceId, deviceId), eq(apiKeys.role, 'worker'), isNull(apiKeys.revokedAt)))
      .get()?.id ?? null
  );
}

/**
 * A device left with no active key (its worker's included) and no home to
 * be is gone: it was made for a key that moved to the device it's really on
 * (re-pairing, or "This Mac"). Its records stay, removed.
 */
function retireIfEmpty(tx: Tx, deviceId: string | null, now: string): void {
  if (!deviceId) return;
  if (tx.select({ id: home.id }).from(home).where(eq(home.hostDeviceId, deviceId)).get()) return;
  const device = tx.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device || device.status !== 'active') return;
  const key = tx.select({ id: apiKeys.id }).from(apiKeys).where(and(eq(apiKeys.deviceId, deviceId), isNull(apiKeys.revokedAt))).get();
  if (key) return;
  tx.update(devices).set({ status: 'revoked', revokedAt: now, updatedAt: now }).where(eq(devices.id, deviceId)).run();
}

/**
 * Remove a device: every key it has stops working, its worker with them,
 * and it leaves the list. The home's own device can't be removed: it's
 * where the home runs. Returns the device's worker key, when it had one,
 * so the caller settles that worker's work (`retireWorker`).
 */
export function removeDevice(id: string, reason: string): { device: DeviceRecord; workerKeyId: string | null } | null {
  const db = getDb();
  return db.transaction((tx) => {
    const device = tx.select().from(devices).where(eq(devices.id, id)).get();
    if (!device || device.status !== 'active') return null;
    if (tx.select({ id: home.id }).from(home).where(eq(home.hostDeviceId, id)).get()) {
      throw new Error(`${device.name} is where this home runs. It can't be removed.`);
    }
    const now = new Date().toISOString();
    const workerKeyId = activeWorkerKeyIn(tx, id);
    tx.update(apiKeys)
      .set({ revokedAt: now, revokedReason: reason, updatedAt: now })
      .where(and(eq(apiKeys.deviceId, id), isNull(apiKeys.revokedAt)))
      .run();
    const row = tx
      .update(devices)
      .set({ status: 'revoked', revokedAt: now, updatedAt: now })
      .where(eq(devices.id, id))
      .returning()
      .get()!;
    return { device: row, workerKeyId };
  }, { behavior: 'immediate' });
}

/**
 * Make `deviceId` the machine this home runs on. Used when a person
 * explicitly selects a restored root as the active home (§10.3).
 */
export function setHomeHost(deviceId: string): HomeRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const current = tx.select().from(home).get();
    if (!current) throw new Error('This database has no home yet.');
    const device = tx.select().from(devices).where(eq(devices.id, deviceId)).get();
    if (!device || device.status !== 'active') throw new Error(`Device ${deviceId} is not an active device of this home.`);
    return tx
      .update(home)
      .set({ hostDeviceId: deviceId, updatedAt: new Date().toISOString() })
      .where(eq(home.id, current.id))
      .returning()
      .get();
  }, { behavior: 'immediate' });
}

/**
 * The home moves to another of its devices (docs/homes-spec.md §10.3:
 * "Relink only paths belonging to the moved host"). What ran on the old host
 * without saying so, because the home's own device needed no record, is
 * pinned to it now, since its worktrees and native transcripts are there:
 *
 * - Executions with no placement are placed on the old host with their
 *   worktree. The home's own path column follows whichever device is the
 *   host: set for work placed on the new host, cleared for the rest.
 * - An agent's chats outside an execution stay with the old host when the
 *   agent has no folder on the new one. Other chats outside an execution
 *   (the app's main chat, and agents set up on the new host) stay with the
 *   home and start a fresh native session there, the old one being on the
 *   other device.
 * - Terminal-history imports from the old host's disk are read from the old
 *   host from then on, never from a path on it.
 * - Each agent's folder at the home becomes its folder on the new host, when
 *   it has one there.
 *
 * The new host's worker key, if it ran agents for the home before, is
 * revoked: the home runs its own agents in process. The old host stays a
 * device of the home, ready to enroll as a worker.
 */
export function moveHomeHost(newHostId: string): { from: string; to: string; pinnedExecutions: number; pinnedChats: number; freshChats: number } {
  const db = getDb();
  const moved = db.transaction((tx) => {
    const current = tx.select().from(home).get();
    if (!current) throw new Error('This database has no home yet.');
    const oldHostId = current.hostDeviceId;
    const device = tx.select().from(devices).where(eq(devices.id, newHostId)).get();
    if (!device || device.status !== 'active') throw new Error(`Device ${newHostId} is not an active device of this home.`);
    const result = { from: oldHostId, to: newHostId, pinnedExecutions: 0, pinnedChats: 0, freshChats: 0, revokeKeys: [] as string[] };
    if (oldHostId === newHostId) return result;
    const now = new Date().toISOString();

    // Work the old host ran as the home.
    const unplaced = tx
      .select({ id: executions.id, worktreePath: executions.worktreePath })
      .from(executions)
      .where(sql`NOT EXISTS (SELECT 1 FROM ${executionPlacements} WHERE ${executionPlacements.executionId} = ${executions.id})`)
      .all();
    for (const e of unplaced) {
      tx.insert(executionPlacements)
        .values({ id: uuidv7(), executionId: e.id, deviceId: oldHostId, generation: 1, worktreePath: e.worktreePath, startReason: 'created', createdAt: now, updatedAt: now })
        .run();
    }
    result.pinnedExecutions = unplaced.length;
    // The home's path column: the new host's worktree for work placed there, nothing for the rest.
    tx.run(sql`UPDATE ${executions} SET worktree_path = (
      SELECT ${executionPlacements.worktreePath} FROM ${executionPlacements}
      WHERE ${executionPlacements.executionId} = ${executions.id} AND ${executionPlacements.endedAt} IS NULL AND ${executionPlacements.deviceId} = ${newHostId}
    ), updated_at = ${now}`);

    // Chats outside an execution that ran at the home.
    const onNewHost = new Set(
      tx.select({ id: workspaceSetups.workspaceId }).from(workspaceSetups).where(eq(workspaceSetups.deviceId, newHostId)).all().map((r) => r.id),
    );
    const homeChats = tx
      .select({ id: chatSessions.id, workspaceId: chatSessions.workspaceId, native: chatSessions.externalSessionId })
      .from(chatSessions)
      .where(and(isNull(chatSessions.executionId), isNull(chatSessions.deviceId)))
      .all();
    for (const c of homeChats) {
      if (c.workspaceId && !onNewHost.has(c.workspaceId)) {
        tx.update(chatSessions).set({ deviceId: oldHostId, updatedAt: now }).where(eq(chatSessions.id, c.id)).run();
        result.pinnedChats++;
      } else if (c.native) {
        tx.update(nativeSessions)
          .set({ endedAt: now, endReason: 'continued', updatedAt: now })
          .where(and(eq(nativeSessions.chatSessionId, c.id), isNull(nativeSessions.endedAt)))
          .run();
        tx.update(chatSessions).set({ externalSessionId: null, updatedAt: now }).where(eq(chatSessions.id, c.id)).run();
        result.freshChats++;
      }
    }

    // Terminal-history imports from the old host's own disk.
    tx.run(sql`UPDATE ${externalSessionImports} SET device_id = ${oldHostId}, source_path = NULL, updated_at = ${now}
      WHERE device_id IS NULL AND NOT EXISTS (
        SELECT 1 FROM ${externalSessionImports} other
        WHERE other.device_id = ${oldHostId} AND other.provider_type = ${externalSessionImports.providerType}
          AND other.external_session_id = ${externalSessionImports.externalSessionId}
      )`);

    // Each agent's folder at the home is its folder on the new host.
    for (const setup of tx.select().from(workspaceSetups).where(eq(workspaceSetups.deviceId, newHostId)).all()) {
      tx.update(workspaces).set({ cwd: setup.sourcePath, updatedAt: now }).where(eq(workspaces.id, setup.workspaceId)).run();
    }
    // Where the old host put worktrees is a path on that machine. The new
    // host uses its own Ri folder until the person chooses another.
    tx.update(workspaces).set({ worktreeRoot: null, updatedAt: now }).where(isNotNull(workspaces.worktreeRoot)).run();

    tx.update(home).set({ hostDeviceId: newHostId, updatedAt: now }).where(eq(home.id, current.id)).run();
    const workerKeyId = activeWorkerKeyIn(tx, newHostId);
    result.revokeKeys = workerKeyId ? [workerKeyId] : [];
    return result;
  }, { behavior: 'immediate' });
  for (const id of moved.revokeKeys) revokeApiKey(id, 'This device is the home now, so it runs agents itself.');
  const { revokeKeys: _revoked, ...summary } = moved;
  return summary;
}

/** The device a key belongs to. */
export function getDeviceForApiKey(apiKeyId: string): DeviceRecord | null {
  const row = getDb()
    .select({ device: getTableColumns(devices) })
    .from(apiKeys)
    .innerJoin(devices, eq(apiKeys.deviceId, devices.id))
    .where(eq(apiKeys.id, apiKeyId))
    .get();
  return row?.device ?? null;
}

/**
 * A computer calling with `apiKeyId` says what it is: its facts are stored
 * on the key's device (docs/homes-spec.md §3.1). Being on a device grants
 * no authority to run work. The device keeps the name the person gave it
 * when pairing: a report never renames it.
 */
export function registerDeviceForApiKey(input: {
  apiKeyId: string;
  name: string;
  platform?: string | null;
  hostname?: string | null;
  /**
   * The id this home gave the calling machine before, e.g. with an older key
   * or when it enrolled. The key moves to that device, so re-pairing keeps
   * one device, and the device the new pairing made is removed once it has
   * no key left. Never the home's own device, and never a removed one.
   */
  deviceId?: string | null;
}): { device: DeviceRecord; created: boolean } {
  const db = getDb();
  return db.transaction((tx) => {
    const key = tx.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).get();
    if (!key || key.revokedAt) throw new Error('This key is not active.');
    const now = new Date().toISOString();
    // What it reports, leaving what it doesn't say as it was.
    const facts = {
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      ...(input.hostname !== undefined ? { hostname: input.hostname } : {}),
      lastSeenAt: now,
      updatedAt: now,
    };
    const hostId = tx.select({ host: home.hostDeviceId }).from(home).get()?.host ?? null;
    // A worker key stays with the device it was issued to.
    const movable = key.role === 'sign_in' && key.deviceId !== hostId;
    if (movable && input.deviceId && input.deviceId !== key.deviceId && input.deviceId !== hostId) {
      const remembered = tx.select().from(devices).where(eq(devices.id, input.deviceId)).get();
      if (remembered && remembered.status === 'active') {
        tx.update(apiKeys).set({ deviceId: remembered.id, updatedAt: now }).where(eq(apiKeys.id, key.id)).run();
        retireIfEmpty(tx, key.deviceId, now);
        const device = tx.update(devices).set(facts).where(eq(devices.id, remembered.id)).returning().get()!;
        return { device, created: false };
      }
    }
    if (key.deviceId) {
      const device = tx
        .update(devices)
        .set(facts)
        .where(and(eq(devices.id, key.deviceId), eq(devices.status, 'active')))
        .returning()
        .get();
      if (device) return { device, created: false };
    }
    // A key with no device, or on a removed one: it gets a device of its own.
    const device = tx
      .insert(devices)
      .values({ id: uuidv7(), name: input.name, kind: 'computer', status: 'active', platform: input.platform ?? null, hostname: input.hostname ?? null, lastSeenAt: now, updatedAt: now, createdAt: now })
      .returning()
      .get();
    tx.update(apiKeys).set({ deviceId: device.id, updatedAt: now }).where(eq(apiKeys.id, key.id)).run();
    return { device, created: true };
  }, { behavior: 'immediate' });
}

// ─── Device grants and workers (docs/homes-build.md, P2.2) ───

export const ENROLL_GRANT_TTL_MS = 10 * 60 * 1000;
export const ASSOCIATE_GRANT_TTL_MS = 2 * 60 * 1000;

export class GrantError extends Error {
  constructor(
    readonly code: 'invalid' | 'expired' | 'used' | 'not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'GrantError';
  }
}

function hostDeviceIdIn(tx: Pick<ReturnType<typeof getDb>, 'select'>): string | null {
  return tx.select({ host: home.hostDeviceId }).from(home).get()?.host ?? null;
}

/**
 * Issue a single-use grant. An `enroll` grant names the device that will
 * run agents, or none to make a new one. It can't name the home's own
 * device, whose runner is in process. An `associate` grant names the
 * device whose browser it links. Returns the secret once: only its hash
 * is kept.
 */
export function createDeviceGrant(input: {
  kind: DeviceGrantKind;
  deviceId: string | null;
  deviceName?: string | null;
  createdByApiKeyId: string | null;
}): { grant: DeviceGrantRecord; secret: string } {
  const db = getDb();
  return db.transaction((tx) => {
    if (input.deviceId) {
      const device = tx.select().from(devices).where(eq(devices.id, input.deviceId)).get();
      if (!device || device.status !== 'active') throw new GrantError('invalid', 'That device is not active.');
      if (input.kind === 'enroll' && device.id === hostDeviceIdIn(tx)) {
        throw new GrantError('not_allowed', `${device.name} is where this home runs. It already runs agents.`);
      }
    } else if (input.kind === 'associate') {
      throw new GrantError('invalid', 'An association grant needs a device.');
    }
    const secret = `rg_${randomBytes(24).toString('base64url')}`;
    const now = new Date();
    const ttl = input.kind === 'enroll' ? ENROLL_GRANT_TTL_MS : ASSOCIATE_GRANT_TTL_MS;
    const grant = tx
      .insert(deviceGrants)
      .values({
        id: uuidv7(),
        kind: input.kind,
        hash: hashGrantSecret(secret),
        deviceId: input.deviceId,
        deviceName: input.deviceName ?? null,
        createdByApiKeyId: input.createdByApiKeyId,
        expiresAt: new Date(now.getTime() + ttl).toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })
      .returning()
      .get();
    return { grant, secret };
  }, { behavior: 'immediate' });
}

export function hashGrantSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Find a grant by its secret and check it can still be used. Throws `GrantError` otherwise. */
function usableGrant(
  tx: Pick<ReturnType<typeof getDb>, 'select'>,
  secret: string,
  kind: DeviceGrantKind,
): DeviceGrantRecord {
  const grant = tx.select().from(deviceGrants).where(eq(deviceGrants.hash, hashGrantSecret(secret.trim()))).get();
  if (!grant || grant.kind !== kind) throw new GrantError('invalid', 'That code is not valid. Make a new one and try again.');
  if (grant.redeemedAt) throw new GrantError('used', 'That code was already used. Make a new one.');
  if (new Date(grant.expiresAt).getTime() <= Date.now()) {
    throw new GrantError('expired', 'That code has expired. Make a new one.');
  }
  return grant;
}

/**
 * Redeem an enroll grant: the device runs agents. In one transaction the
 * home makes the device if the grant named none, issues it a new worker
 * key, which replaces any earlier one (one worker per device), and marks
 * the grant used. The key's token is returned once.
 */
export function redeemEnrollGrant(input: {
  secret: string;
  name: string;
  platform?: string | null;
  hostname?: string | null;
}): {
  homeId: string;
  device: DeviceRecord;
  key: ApiKeyRecord;
  token: GeneratedToken;
  /** Commands the earlier worker never acknowledged, now uncertain. `enrollWorker` finishes their runs. */
  uncertain: WorkerCommandRecord[];
} {
  const db = getDb();
  return db.transaction((tx) => {
    const grant = usableGrant(tx, input.secret, 'enroll');
    const now = new Date().toISOString();
    const homeRow = tx.select().from(home).get();
    if (!homeRow) throw new GrantError('invalid', 'This home has no identity yet.');
    let device: DeviceRecord;
    if (grant.deviceId) {
      const existing = tx.select().from(devices).where(eq(devices.id, grant.deviceId)).get();
      if (!existing || existing.status !== 'active') throw new GrantError('invalid', 'That device was removed.');
      if (existing.id === homeRow.hostDeviceId) {
        throw new GrantError('not_allowed', `${existing.name} is where this home runs.`);
      }
      device = existing;
    } else {
      device = tx
        .insert(devices)
        .values({
          id: uuidv7(),
          name: grant.deviceName?.trim() || input.name,
          kind: 'computer',
          status: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
    }

    // Commands streamed to an earlier worker and never acknowledged may have
    // been acted on. A new worker starts with no record of them, so they're
    // uncertain rather than sent again (docs/homes-build.md, P2.3).
    const uncertain = tx
      .update(workerCommands)
      .set({ state: 'uncertain', error: 'The device was enrolled again before acknowledging this.', updatedAt: now })
      .where(and(eq(workerCommands.deviceId, device.id), eq(workerCommands.state, 'sent')))
      .returning()
      .all();

    // One worker per device: its earlier worker key stops working.
    tx.update(apiKeys)
      .set({ revokedAt: now, revokedReason: 'Replaced by a new enrollment', updatedAt: now })
      .where(and(eq(apiKeys.deviceId, device.id), eq(apiKeys.role, 'worker'), isNull(apiKeys.revokedAt)))
      .run();

    const { key, token } = insertApiKey(tx, {
      name: `${device.name} worker`,
      description: 'Runs agents on this device for the home. Issued by enrollment.',
      deviceId: device.id,
      role: 'worker',
    });
    device = tx
      .update(devices)
      .set({
        platform: input.platform ?? device.platform,
        hostname: input.hostname ?? device.hostname,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(devices.id, device.id))
      .returning()
      .get()!;
    tx.update(deviceGrants)
      .set({ redeemedAt: now, redeemedByApiKeyId: key.id, updatedAt: now })
      .where(eq(deviceGrants.id, grant.id))
      .run();
    return { homeId: homeRow.id, device, key, token, uncertain };
  }, { behavior: 'immediate' });
}

/**
 * Redeem an associate grant with a browser's viewing key: that key moves to
 * the grant's device, where the browser is ("This Mac"). The device the key
 * was paired as is removed once it has no key left. Identity only, never
 * authority, and never for a worker key.
 */
export function redeemAssociateGrant(input: { secret: string; apiKeyId: string }): DeviceRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const grant = usableGrant(tx, input.secret, 'associate');
    const key = tx.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).get();
    if (!key || key.revokedAt) throw new GrantError('invalid', 'This browser is not signed in.');
    if (key.role === 'worker') throw new GrantError('not_allowed', 'A worker key is not a browser.');
    const device = tx.select().from(devices).where(eq(devices.id, grant.deviceId!)).get();
    if (!device || device.status !== 'active') throw new GrantError('invalid', 'That device was removed.');
    const now = new Date().toISOString();
    if (key.deviceId && key.deviceId === hostDeviceIdIn(tx)) {
      throw new GrantError('not_allowed', "This browser signs in with the home's own key. It stays the home's.");
    }
    if (key.deviceId !== device.id) {
      tx.update(apiKeys).set({ deviceId: device.id, updatedAt: now }).where(eq(apiKeys.id, key.id)).run();
      retireIfEmpty(tx, key.deviceId, now);
    }
    tx.update(deviceGrants)
      .set({ redeemedAt: now, redeemedByApiKeyId: key.id, updatedAt: now })
      .where(eq(deviceGrants.id, grant.id))
      .run();
    return device;
  }, { behavior: 'immediate' });
}

/** An active worker key's device, while that device is active. Null for any other key. */
export function getWorkerDevice(apiKeyId: string): DeviceRecord | null {
  const row = getDb()
    .select({ device: getTableColumns(devices) })
    .from(apiKeys)
    .innerJoin(devices, eq(devices.id, apiKeys.deviceId))
    .where(and(eq(apiKeys.id, apiKeyId), eq(apiKeys.role, 'worker'), isNull(apiKeys.revokedAt), eq(devices.status, 'active')))
    .get();
  return row?.device ?? null;
}

/** The key a device's worker runs agents with, while it and the device are active. */
export function getWorkerKeyId(deviceId: string): string | null {
  const row = getDb()
    .select({ keyId: apiKeys.id })
    .from(apiKeys)
    .innerJoin(devices, eq(devices.id, apiKeys.deviceId))
    .where(and(eq(apiKeys.deviceId, deviceId), eq(apiKeys.role, 'worker'), isNull(apiKeys.revokedAt), eq(devices.status, 'active')))
    .get();
  return row?.keyId ?? null;
}

/** The devices with an active worker key: every device that runs agents, besides the home's own. */
export function listEnrolledDeviceIds(): Set<string> {
  const rows = getDb()
    .select({ deviceId: devices.id })
    .from(apiKeys)
    .innerJoin(devices, eq(devices.id, apiKeys.deviceId))
    .where(and(eq(apiKeys.role, 'worker'), isNull(apiKeys.revokedAt), eq(devices.status, 'active')))
    .all();
  return new Set(rows.map((r) => r.deviceId));
}

/** Whether a key was issued as a worker key, active or not. The proxy's scope. */
export function isWorkerApiKey(apiKeyId: string): boolean {
  return getDb().select({ role: apiKeys.role }).from(apiKeys).where(eq(apiKeys.id, apiKeyId)).get()?.role === 'worker';
}

/** Store what a worker reported about its device, and when. */
export function recordWorkerHeartbeat(
  deviceId: string,
  report: { protocol: number; version: string; harnesses: WorkerHarnessReport[]; state: WorkerReportedState },
): DeviceRecord | null {
  const db = getDb();
  const now = new Date().toISOString();
  return (
    db.update(devices)
      .set({
        workerProtocol: report.protocol,
        workerVersion: report.version,
        harnesses: report.harnesses,
        reportedState: report.state,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(and(eq(devices.id, deviceId), eq(devices.status, 'active')))
      .returning()
      .get() ?? null
  );
}

// ─── Worker commands (docs/homes-build.md, P2 protocol and P2.3) ───

/**
 * Queue a command for a device. Call it inside the transaction that writes
 * what the command acts on (for a send, the user's chat event), so neither
 * exists without the other. The caller wakes the device's stream after
 * commit.
 */
export function queueWorkerCommand(input: {
  id?: string;
  deviceId: string;
  kind: WorkerCommandKind;
  payload: unknown;
  actor: WorkerCommandActor;
  executionId?: string | null;
  chatSessionId?: string | null;
  generation?: number | null;
  /** For a send: the user's chat event. A second send for it returns the first. */
  sourceEventId?: string | null;
}): WorkerCommandRecord {
  const now = new Date().toISOString();
  if (input.sourceEventId) {
    const existing = getDb().select().from(workerCommands).where(eq(workerCommands.sourceEventId, input.sourceEventId)).get();
    if (existing) return existing;
  }
  return getDb()
    .insert(workerCommands)
    .values({
      id: input.id ?? uuidv7(),
      deviceId: input.deviceId,
      kind: input.kind,
      payload: input.payload ?? {},
      actor: input.actor,
      executionId: input.executionId ?? null,
      chatSessionId: input.chatSessionId ?? null,
      generation: input.generation ?? null,
      sourceEventId: input.sourceEventId ?? null,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/** The send already queued for a user's chat event, if any. */
export function getSendForEvent(sourceEventId: string): WorkerCommandRecord | null {
  return getDb().select().from(workerCommands).where(eq(workerCommands.sourceEventId, sourceEventId)).get() ?? null;
}

/**
 * The send this device was given for a chat that started this turn, or
 * that carried this run. A worker's report about a turn or a run counts only
 * when it's about one of its own sends (P2 review fixes).
 */
export function sendForTurn(deviceId: string, chatSessionId: string, turnId: string): WorkerCommandRecord | null {
  return sendWhere(deviceId, chatSessionId, sql`json_extract(${workerCommands.payload}, '$.turnId') = ${turnId}`);
}

export function sendForRun(deviceId: string, chatSessionId: string, runId: string): WorkerCommandRecord | null {
  return sendWhere(deviceId, chatSessionId, sql`json_extract(${workerCommands.payload}, '$.runId') = ${runId}`);
}

/**
 * A device's commands that won't be carried out now that it no longer runs
 * agents (P2.8): queued ones are cancelled, since they never left, and sent
 * ones become uncertain, since they may have arrived. Returns them, for
 * their runs.
 */
export function retireDeviceCommands(deviceId: string): WorkerCommandRecord[] {
  const db = getDb();
  const now = new Date().toISOString();
  const cancelled = db
    .update(workerCommands)
    .set({ state: 'cancelled', error: 'Local execution on this device was turned off before this reached it.', finishedAt: now, updatedAt: now })
    .where(and(eq(workerCommands.deviceId, deviceId), eq(workerCommands.state, 'queued')))
    .returning()
    .all();
  const uncertain = db
    .update(workerCommands)
    .set({ state: 'uncertain', error: 'Local execution on this device was turned off before it acknowledged this.', updatedAt: now })
    .where(and(eq(workerCommands.deviceId, deviceId), eq(workerCommands.state, 'sent')))
    .returning()
    .all();
  return [...cancelled, ...uncertain];
}

/** Sends a device delivered whose runs are still open: turns under way there. */
export function deliveredSendsWithOpenRuns(deviceId: string): WorkerCommandRecord[] {
  return getDb()
    .select(getTableColumns(workerCommands))
    .from(workerCommands)
    .innerJoin(runs, sql`${runs.id} = json_extract(${workerCommands.payload}, '$.runId')`)
    .where(
      and(
        eq(workerCommands.deviceId, deviceId),
        eq(workerCommands.kind, 'send'),
        eq(workerCommands.state, 'delivered'),
        inArray(runs.status, ['queued', 'running']),
      ),
    )
    .all();
}

/** Whether a send to any device was saved for this run. */
export function hasSendForRun(runId: string): boolean {
  return (
    getDb()
      .select({ id: workerCommands.id })
      .from(workerCommands)
      .where(and(eq(workerCommands.kind, 'send'), sql`json_extract(${workerCommands.payload}, '$.runId') = ${runId}`))
      .get() !== undefined
  );
}

function sendWhere(deviceId: string, chatSessionId: string, match: SQL): WorkerCommandRecord | null {
  return (
    getDb()
      .select()
      .from(workerCommands)
      .where(
        and(
          eq(workerCommands.deviceId, deviceId),
          eq(workerCommands.chatSessionId, chatSessionId),
          eq(workerCommands.kind, 'send'),
          match,
        ),
      )
      .get() ?? null
  );
}

export function getWorkerCommand(id: string): WorkerCommandRecord | null {
  return getDb().select().from(workerCommands).where(eq(workerCommands.id, id)).get() ?? null;
}

export function listWorkerCommands(deviceId: string, options: { states?: WorkerCommandState[] } = {}): WorkerCommandRecord[] {
  const conditions = [eq(workerCommands.deviceId, deviceId)];
  if (options.states?.length) conditions.push(inArray(workerCommands.state, options.states));
  return getDb().select().from(workerCommands).where(and(...conditions)).orderBy(asc(workerCommands.id)).all();
}

/**
 * What a device's stream sends next, after the worker's receipt cursor
 * `after`: queued commands are numbered now, in the order they were queued,
 * and marked sent. Then every command numbered after the cursor and still
 * waiting for an acknowledgement goes out, resends included. An acknowledged
 * command is never resent: its worker has it. In one transaction, so two
 * streams can't number the same command twice.
 */
/**
 * Mark stale, and return, the queued or unacknowledged commands whose chat
 * or execution no longer runs on this device at their generation (P2.6,
 * P4). Ownership is checked before a command is sent or resent, not only by
 * the worker, which can't fence a command for a placement it never saw
 * replaced.
 */
export function staleQueuedCommands(deviceId: string): WorkerCommandRecord[] {
  const db = getDb();
  const now = new Date().toISOString();
  const stale: WorkerCommandRecord[] = [];
  // Queued, and streamed but not acknowledged (P4): a command sent before a
  // disconnect is resent on reconnect, and one for a placement that has
  // moved on since must not be. A transfer changes ownership only once the
  // source's commands are acknowledged, and the worker fences by generation
  // too, so what's left here was never received.
  const queued = db
    .select()
    .from(workerCommands)
    .where(and(eq(workerCommands.deviceId, deviceId), inArray(workerCommands.state, ['queued', 'sent'])))
    .all();
  for (const command of queued) {
    let current: boolean;
    if (command.executionId) {
      const placement = placementOf(command.executionId);
      const reserved = transferReservation(command.executionId);
      current =
        (placement?.deviceId === deviceId && placement.generation === command.generation) ||
        // A transfer preparing it here, at the generation it will have (P4.2).
        (reserved?.deviceId === deviceId && reserved.generation === command.generation);
    } else if (command.chatSessionId) {
      current = chatPlacement(command.chatSessionId)?.deviceId === deviceId;
    } else {
      continue;
    }
    if (current) continue;
    const row = db
      .update(workerCommands)
      .set({
        state: 'stale',
        error: 'The execution had moved to another device before this reached it.',
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(workerCommands.id, command.id), inArray(workerCommands.state, ['queued', 'sent'])))
      .returning()
      .get();
    if (row) stale.push(row);
  }
  return stale;
}

export function takeCommandsForStream(deviceId: string, after: number): WorkerCommandRecord[] {
  const db = getDb();
  return db.transaction((tx) => {
    const now = new Date().toISOString();
    const queued = tx
      .select()
      .from(workerCommands)
      .where(and(eq(workerCommands.deviceId, deviceId), eq(workerCommands.state, 'queued')))
      .orderBy(asc(workerCommands.id))
      .all();
    if (queued.length > 0) {
      let next =
        (tx
          .select({ max: sql<number | null>`max(${workerCommands.seq})` })
          .from(workerCommands)
          .where(eq(workerCommands.deviceId, deviceId))
          .get()?.max ?? 0) + 1;
      for (const command of queued) {
        tx.update(workerCommands)
          .set({ seq: next++, state: 'sent', sentAt: now, attempts: command.attempts + 1, updatedAt: now })
          .where(eq(workerCommands.id, command.id))
          .run();
      }
    }
    return tx
      .select()
      .from(workerCommands)
      .where(and(eq(workerCommands.deviceId, deviceId), gt(workerCommands.seq, after), eq(workerCommands.state, 'sent')))
      .orderBy(asc(workerCommands.seq))
      .all();
  }, { behavior: 'immediate' });
}

export type WorkerCommandAck = {
  state: Extract<WorkerCommandState, 'delivered' | 'failed' | 'stale' | 'uncertain'>;
  result?: unknown;
  error?: string | null;
};

/** States a command can't leave, except an uncertain one resolved by reconciliation. */
const FINAL_COMMAND_STATES = new Set<WorkerCommandState>(['delivered', 'failed', 'stale', 'cancelled']);

/**
 * Record a worker's acknowledgement, idempotently: the same report again
 * changes nothing, and a final state stays final. An uncertain command can
 * still become delivered or failed once reconciled. Returns the command as
 * the home holds it, or null when this device has no such command.
 */
export function ackWorkerCommand(deviceId: string, commandId: string, ack: WorkerCommandAck): WorkerCommandRecord | null {
  const db = getDb();
  return db.transaction((tx) => {
    const command = tx
      .select()
      .from(workerCommands)
      .where(and(eq(workerCommands.id, commandId), eq(workerCommands.deviceId, deviceId)))
      .get();
    if (!command) return null;
    if (FINAL_COMMAND_STATES.has(command.state) || command.state === ack.state) return command;
    if (command.state === 'queued') return command; // never streamed: nothing to acknowledge
    const now = new Date().toISOString();
    return tx
      .update(workerCommands)
      .set({
        state: ack.state,
        ...(ack.state === 'delivered' ? { deliveredAt: now } : {}),
        finishedAt: now,
        result: ack.result ?? null,
        error: ack.error ?? null,
        updatedAt: now,
      })
      .where(eq(workerCommands.id, commandId))
      .returning()
      .get()!;
  }, { behavior: 'immediate' });
}

/** A chat's sends, oldest first: one per message sent to a device elsewhere (P3.2). */
export function listSendsForChat(chatSessionId: string): WorkerCommandRecord[] {
  return getDb()
    .select()
    .from(workerCommands)
    .where(and(eq(workerCommands.chatSessionId, chatSessionId), eq(workerCommands.kind, 'send')))
    .orderBy(asc(workerCommands.id))
    .all();
}

/** A device's sends not yet delivered or given up on: queued, or sent and unacknowledged. */
export function listOpenSendsForDevice(deviceId: string): WorkerCommandRecord[] {
  return getDb()
    .select()
    .from(workerCommands)
    .where(and(
      eq(workerCommands.deviceId, deviceId),
      eq(workerCommands.kind, 'send'),
      inArray(workerCommands.state, ['queued', 'sent']),
    ))
    .all();
}

/**
 * Withdraw a command that hasn't been streamed. A streamed one can't be: stop
 * the execution instead. `reason` is what the person reads, when it isn't
 * simply that they withdrew it.
 */
export function cancelWorkerCommand(commandId: string, reason?: string): WorkerCommandRecord | null {
  const now = new Date().toISOString();
  return (
    getDb()
      .update(workerCommands)
      .set({ state: 'cancelled', finishedAt: now, updatedAt: now, ...(reason ? { error: reason } : {}) })
      .where(and(eq(workerCommands.id, commandId), eq(workerCommands.state, 'queued')))
      .returning()
      .get() ?? null
  );
}

/** The highest contiguous position of a device's worker journal the home has stored. */
export function getAckedEventSeq(deviceId: string): number {
  return getDb().select({ seq: devices.ackedEventSeq }).from(devices).where(eq(devices.id, deviceId)).get()?.seq ?? 0;
}

export function setAckedEventSeq(deviceId: string, position: number): void {
  getDb()
    .update(devices)
    .set({ ackedEventSeq: position, updatedAt: new Date().toISOString() })
    .where(eq(devices.id, deviceId))
    .run();
}

// ─── Execution placements (docs/homes-build.md, P0.3 and P2.4) ───

/** Where an execution runs, and the generation its commands carry. */
export interface Placement {
  deviceId: string;
  generation: number;
  worktreePath: string | null;
  /** Null for an execution with no placement row: the home's own device at generation 1. */
  placementId: string | null;
}

export function getOpenPlacement(executionId: string): ExecutionPlacementRecord | null {
  return (
    getDb()
      .select()
      .from(executionPlacements)
      .where(and(eq(executionPlacements.executionId, executionId), isNull(executionPlacements.endedAt)))
      .get() ?? null
  );
}

/**
 * Where an execution runs: its open placement, or the home's own device
 * at generation 1 when it has none. Null only before the home has an
 * identity.
 */
export function placementOf(executionId: string): Placement | null {
  const open = getOpenPlacement(executionId);
  if (open) {
    return { deviceId: open.deviceId, generation: open.generation, worktreePath: open.worktreePath, placementId: open.id };
  }
  const host = getHome()?.hostDeviceId;
  if (!host) return null;
  const execution = getDb().select({ worktreePath: executions.worktreePath }).from(executions).where(eq(executions.id, executionId)).get();
  return { deviceId: host, generation: 1, worktreePath: execution?.worktreePath ?? null, placementId: null };
}

/**
 * Place an execution on a device. A new execution starts at generation 1.
 * A continuation ends the open placement and opens the next generation; an
 * execution with no row counts as generation 1 on the home's own device.
 */
export function createPlacement(input: {
  executionId: string;
  deviceId: string;
  startReason: ExecutionPlacementRecord['startReason'];
  worktreePath?: string | null;
  checkpointSha?: string | null;
}): ExecutionPlacementRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const now = new Date().toISOString();
    const latest = tx
      .select({ max: sql<number | null>`max(${executionPlacements.generation})` })
      .from(executionPlacements)
      .where(eq(executionPlacements.executionId, input.executionId))
      .get()?.max;
    const base = latest ?? (input.startReason === 'created' ? 0 : 1);
    tx.update(executionPlacements)
      .set({ endedAt: now, endReason: 'transferred', updatedAt: now })
      .where(and(eq(executionPlacements.executionId, input.executionId), isNull(executionPlacements.endedAt)))
      .run();
    return tx
      .insert(executionPlacements)
      .values({
        id: uuidv7(),
        executionId: input.executionId,
        deviceId: input.deviceId,
        generation: base + 1,
        worktreePath: input.worktreePath ?? null,
        checkpointSha: input.checkpointSha ?? null,
        startReason: input.startReason,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }, { behavior: 'immediate' });
}

// ─── Transfers (P4.2) ─────────────────────────────────────────

/** Another transfer of this execution is under way. */
export class TransferConflictError extends Error {
  constructor(readonly transfer: ExecutionTransferRecord) {
    super('This execution is already moving to another device.');
    this.name = 'TransferConflictError';
  }
}

/**
 * Start a transfer: its record, and the lock. One active transfer per
 * execution, enforced by a partial unique index, so two starting at once
 * can't both hold it.
 *
 * Try again, in the same transaction: a move that stopped and still waits
 * for a decision is superseded, and the messages it held come along. So
 * Try again and Resume can't both take them (P4 review).
 */
export function createTransfer(input: {
  executionId: string;
  fromDeviceId: string;
  toDeviceId: string;
  fromGeneration: number;
  includeUntracked: string[];
  heldEventIds?: string[];
  requestedByApiKeyId: string | null;
}): ExecutionTransferRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const active = tx
      .select()
      .from(executionTransfers)
      .where(and(eq(executionTransfers.executionId, input.executionId), eq(executionTransfers.state, 'active')))
      .get();
    if (active) throw new TransferConflictError(active);
    const now = new Date().toISOString();
    const stopped = tx
      .select()
      .from(executionTransfers)
      .where(eq(executionTransfers.executionId, input.executionId))
      .orderBy(desc(executionTransfers.id))
      .limit(1)
      .get();
    // A move that stopped, or the delivery of one settled earlier that
    // stopped short: its messages come along, still in order.
    let carried: string[] = [];
    if (stopped && (stopped.state === 'failed' || stopped.heldEventIds.length > 0)) {
      carried = stopped.heldEventIds;
      tx.update(executionTransfers)
        .set({ state: stopped.state === 'failed' ? 'cancelled' : stopped.state, heldEventIds: [], updatedAt: now })
        .where(eq(executionTransfers.id, stopped.id))
        .run();
    }
    return tx
      .insert(executionTransfers)
      .values({
        id: uuidv7(),
        createdAt: now,
        updatedAt: now,
        executionId: input.executionId,
        fromDeviceId: input.fromDeviceId,
        toDeviceId: input.toDeviceId,
        fromGeneration: input.fromGeneration,
        stage: 'preparing',
        state: 'active',
        includeUntracked: input.includeUntracked,
        heldEventIds: [...new Set([...carried, ...(input.heldEventIds ?? [])])],
        requestedByApiKeyId: input.requestedByApiKeyId,
      })
      .returning()
      .get();
  }, { behavior: 'immediate' });
}

/**
 * Settle a move that stopped, once: Resume on the source (`resumed`, the
 * move set aside) or Finish on the destination (`finished`). Null when it
 * was already settled, by this or by Try again: a second click, another
 * tab, or an overlapping request finds nothing to do (P4 review).
 */
export function settleStoppedTransfer(transferId: string, outcome: 'resumed' | 'finished'): ExecutionTransferRecord | null {
  const db = getDb();
  return db.transaction((tx) => {
    const transfer = tx.select().from(executionTransfers).where(eq(executionTransfers.id, transferId)).get();
    if (!transfer || transfer.state !== 'failed') return null;
    if ((outcome === 'resumed') !== (transfer.toGeneration === null)) return null;
    const now = new Date().toISOString();
    return (
      tx
        .update(executionTransfers)
        // From here `error` says only why delivering its messages stopped;
        // where the move itself stopped stays in `failedStage`.
        .set(
          outcome === 'resumed'
            ? { state: 'cancelled', error: null, updatedAt: now }
            : { state: 'succeeded', stage: 'done', error: null, failedStage: null, finishedAt: now, updatedAt: now },
        )
        .where(eq(executionTransfers.id, transferId))
        .returning()
        .get() ?? null
    );
  }, { behavior: 'immediate' });
}

/** Take one held message off a transfer to deliver it. True only for the one caller that took it. */
export function takeHeldMessage(transferId: string, eventId: string): boolean {
  const db = getDb();
  return db.transaction((tx) => {
    const transfer = tx.select().from(executionTransfers).where(eq(executionTransfers.id, transferId)).get();
    if (!transfer?.heldEventIds.includes(eventId)) return false;
    tx.update(executionTransfers)
      .set({ heldEventIds: transfer.heldEventIds.filter((id) => id !== eventId), updatedAt: new Date().toISOString() })
      .where(eq(executionTransfers.id, transferId))
      .run();
    return true;
  }, { behavior: 'immediate' });
}

/** Whether new messages wait on this transfer (see `holdingTransfer`). */
function holdsNewMessages(transfer: ExecutionTransferRecord): boolean {
  return (
    (transfer.state === 'active' && transfer.toGeneration === null) || transfer.state === 'failed' || transfer.heldEventIds.length > 0
  );
}

/**
 * The transfer new messages wait on, or null: one under way before the
 * destination has the work, one that stopped and waits for Try again,
 * Resume or Finish, or one whose held messages are still going out. Nothing
 * reaches either side meanwhile, and nothing overtakes a held message
 * (P4 review and re-check).
 */
export function holdingTransfer(executionId: string): ExecutionTransferRecord | null {
  const latest = latestTransfer(executionId);
  return latest && holdsNewMessages(latest) ? latest : null;
}

export function getTransfer(id: string): ExecutionTransferRecord | null {
  return getDb().select().from(executionTransfers).where(eq(executionTransfers.id, id)).get() ?? null;
}

export function getActiveTransfer(executionId: string): ExecutionTransferRecord | null {
  return (
    getDb()
      .select()
      .from(executionTransfers)
      .where(and(eq(executionTransfers.executionId, executionId), eq(executionTransfers.state, 'active')))
      .get() ?? null
  );
}

/** The execution's most recent transfer, whatever became of it. */
export function latestTransfer(executionId: string): ExecutionTransferRecord | null {
  return (
    getDb()
      .select()
      .from(executionTransfers)
      .where(eq(executionTransfers.executionId, executionId))
      .orderBy(desc(executionTransfers.id))
      .limit(1)
      .get() ?? null
  );
}

export function updateTransfer(
  id: string,
  patch: Partial<Omit<ExecutionTransferRecord, 'id' | 'createdAt' | 'executionId'>>,
): ExecutionTransferRecord | null {
  return (
    getDb()
      .update(executionTransfers)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(executionTransfers.id, id))
      .returning()
      .get() ?? null
  );
}

/**
 * Hold a message for the execution's transfer, if one is under way: it's
 * delivered once, where the work ends up. Returns the transfer holding it,
 * or null when nothing is. Idempotent.
 */
export function holdForTransfer(executionId: string, eventId: string): ExecutionTransferRecord | null {
  const db = getDb();
  return db.transaction((tx) => {
    const latest = tx
      .select()
      .from(executionTransfers)
      .where(eq(executionTransfers.executionId, executionId))
      .orderBy(desc(executionTransfers.id))
      .limit(1)
      .get();
    // Held while it moves, until the destination owns the work, while a move
    // that stopped waits for a decision, and behind held messages still
    // going out (see `holdingTransfer`).
    if (!latest || !holdsNewMessages(latest)) return null;
    if (latest.heldEventIds.includes(eventId)) return latest;
    return tx
      .update(executionTransfers)
      .set({ heldEventIds: [...latest.heldEventIds, eventId], updatedAt: new Date().toISOString() })
      .where(eq(executionTransfers.id, latest.id))
      .returning()
      .get();
  }, { behavior: 'immediate' });
}

/**
 * Messages a transfer holds that haven't been taken for delivery, by chat.
 * Whatever became of the move: after Resume or Finish they stay listed until
 * each is taken, so nothing else sends one meanwhile.
 */
export function heldMessages(executionId: string): Map<string, { transfer: ExecutionTransferRecord }> {
  const out = new Map<string, { transfer: ExecutionTransferRecord }>();
  const transfer = latestTransfer(executionId);
  if (!transfer) return out;
  for (const id of transfer.heldEventIds) out.set(id, { transfer });
  return out;
}

/** Moves a restart left under way: nothing in this process is running them. */
export function listActiveTransfers(): ExecutionTransferRecord[] {
  return getDb().select().from(executionTransfers).where(eq(executionTransfers.state, 'active')).all();
}

/** Moves settled by Resume or Finish whose held messages weren't all taken before a restart. */
export function listTransfersStillDelivering(): ExecutionTransferRecord[] {
  return getDb()
    .select()
    .from(executionTransfers)
    .where(and(inArray(executionTransfers.state, ['cancelled', 'succeeded']), sql`json_array_length(${executionTransfers.heldEventIds}) > 0`))
    .all()
    .filter((t) => latestTransfer(t.executionId)?.id === t.id);
}

/** Commands of a transfer not yet sent to their device: a restarted home settles them. */
export function listQueuedTransferCommands(transfer: ExecutionTransferRecord): WorkerCommandRecord[] {
  return getDb()
    .select()
    .from(workerCommands)
    .where(
      and(
        eq(workerCommands.executionId, transfer.executionId),
        eq(workerCommands.state, 'queued'),
        gte(workerCommands.createdAt, transfer.createdAt),
        sql`(json_extract(${workerCommands.payload}, '$.transferId') = ${transfer.id} OR json_extract(${workerCommands.payload}, '$.transfer.id') = ${transfer.id})`,
      ),
    )
    .all();
}

/**
 * The generation a transfer prepares its destination at: one past its
 * source's, and past every earlier attempt from that source. A device
 * that was given a generation by an attempt that stopped may have let go
 * of it since, and a let-go generation is never taken up again, so Try
 * again never reuses one. Attempts run one at a time, so these only grow.
 */
export function targetGenerationOf(
  transfer: Pick<ExecutionTransferRecord, 'id' | 'executionId' | 'fromGeneration'>,
  db: Pick<ReturnType<typeof getDb>, 'select'> = getDb(),
): number {
  const earlier = db
    .select({ n: sql<number>`count(*)` })
    .from(executionTransfers)
    .where(
      and(
        eq(executionTransfers.executionId, transfer.executionId),
        eq(executionTransfers.fromGeneration, transfer.fromGeneration),
        lt(executionTransfers.id, transfer.id),
      ),
    )
    .get();
  return transfer.fromGeneration + 1 + (earlier?.n ?? 0);
}

/**
 * The generation a transfer is preparing on its destination, before it owns
 * the work (P4.2). Commands for it there aren't stale, and the destination
 * isn't told to let go of it, while the transfer is active.
 */
export function transferReservation(executionId: string): { deviceId: string; generation: number } | null {
  const active = getActiveTransfer(executionId);
  return active ? { deviceId: active.toDeviceId, generation: targetGenerationOf(active) } : null;
}

/**
 * The ownership change of a transfer, in one transaction (§8.2 step 9): the
 * source's placement ends as transferred and the destination's opens at the
 * next generation from the checkpoint. Each chat's native session ends as
 * continued and its binding is cleared, so the destination starts a fresh
 * one. The execution's worktree path is the home's own and follows the work:
 * set when it arrives here, cleared when it leaves.
 */
export function continueOwnership(input: {
  transferId: string;
  worktreePath: string;
  checkpointSha: string;
  branch: string;
}): { placement: ExecutionPlacementRecord; transfer: ExecutionTransferRecord } {
  const db = getDb();
  return db.transaction((tx) => {
    const transfer = tx.select().from(executionTransfers).where(eq(executionTransfers.id, input.transferId)).get();
    if (!transfer || transfer.state !== 'active') throw new Error('The transfer is no longer under way.');
    const now = new Date().toISOString();
    const open = tx
      .select()
      .from(executionPlacements)
      .where(and(eq(executionPlacements.executionId, transfer.executionId), isNull(executionPlacements.endedAt)))
      .get();
    const currentGeneration = open?.generation ?? 1;
    if (currentGeneration !== transfer.fromGeneration) throw new Error('The execution moved while this transfer ran.');
    if (open) {
      tx.update(executionPlacements)
        .set({ endedAt: now, endReason: 'transferred', updatedAt: now })
        .where(eq(executionPlacements.id, open.id))
        .run();
    } else {
      // Work that began on the home before placements had no row: its first
      // placement is recorded now, ended, with the worktree it had there, so
      // a later move back finds it.
      const execution = tx.select({ worktreePath: executions.worktreePath }).from(executions).where(eq(executions.id, transfer.executionId)).get();
      tx.insert(executionPlacements)
        .values({
          id: uuidv7(),
          executionId: transfer.executionId,
          deviceId: transfer.fromDeviceId,
          generation: transfer.fromGeneration,
          worktreePath: execution?.worktreePath ?? null,
          startReason: 'created',
          endedAt: now,
          endReason: 'transferred',
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    const placement = tx
      .insert(executionPlacements)
      .values({
        id: uuidv7(),
        executionId: transfer.executionId,
        deviceId: transfer.toDeviceId,
        generation: targetGenerationOf(transfer, tx),
        worktreePath: input.worktreePath,
        checkpointSha: input.checkpointSha,
        startReason: 'continued',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    const chats = tx.select({ id: chatSessions.id }).from(chatSessions).where(eq(chatSessions.executionId, transfer.executionId)).all();
    const chatIds = chats.map((c) => c.id);
    if (chatIds.length > 0) {
      tx.update(nativeSessions)
        .set({ endedAt: now, endReason: 'continued', updatedAt: now })
        .where(and(inArray(nativeSessions.chatSessionId, chatIds), isNull(nativeSessions.endedAt)))
        .run();
      tx.update(chatSessions).set({ externalSessionId: null, updatedAt: now }).where(inArray(chatSessions.id, chatIds)).run();
    }
    const host = tx.select({ hostDeviceId: home.hostDeviceId }).from(home).get()?.hostDeviceId ?? null;
    tx.update(executions)
      .set({
        worktreePath: transfer.toDeviceId === host ? input.worktreePath : null,
        branchName: input.branch,
        updatedAt: now,
      })
      .where(eq(executions.id, transfer.executionId))
      .run();
    const updated = tx
      .update(executionTransfers)
      .set({ toGeneration: placement.generation, stage: 'continuing', targetWorktreePath: input.worktreePath, updatedAt: now })
      .where(eq(executionTransfers.id, transfer.id))
      .returning()
      .get();
    return { placement, transfer: updated };
  }, { behavior: 'immediate' });
}

/** An execution's chats, oldest first. */
export function listExecutionChatIds(executionId: string): string[] {
  return getDb()
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(eq(chatSessions.executionId, executionId))
    .orderBy(asc(chatSessions.id))
    .all()
    .map((r) => r.id);
}

/** The newest event across an execution's chats: a transfer's conversation checkpoint. */
export function latestChatEventForExecution(executionId: string): string | null {
  return (
    getDb()
      .select({ id: chatEvents.id })
      .from(chatEvents)
      .innerJoin(chatSessions, eq(chatSessions.id, chatEvents.sessionId))
      .where(eq(chatSessions.executionId, executionId))
      .orderBy(desc(chatEvents.createdAt), desc(chatEvents.id))
      .limit(1)
      .get()?.id ?? null
  );
}

/** The worktree an execution last had on a device, from its placement history: where a move back goes. */
export function previousWorktreeOn(executionId: string, deviceId: string): string | null {
  return (
    getDb()
      .select({ worktreePath: executionPlacements.worktreePath })
      .from(executionPlacements)
      .where(and(eq(executionPlacements.executionId, executionId), eq(executionPlacements.deviceId, deviceId), isNotNull(executionPlacements.worktreePath)))
      .orderBy(desc(executionPlacements.generation))
      .limit(1)
      .get()?.worktreePath ?? null
  );
}

// ─── Native sessions (P4.3) ───────────────────────────────────

/**
 * Record the harness session now behind a chat. A different one than the
 * open record ends that record as replaced. The chat's own binding
 * (`external_session_id`) is set by the caller, as before.
 */
export function recordNativeSession(input: {
  chatSessionId: string;
  harness: string;
  nativeSessionId: string;
  deviceId: string | null;
  placementId: string | null;
}): NativeSessionRecord {
  const db = getDb();
  return db.transaction((tx) => {
    const now = new Date().toISOString();
    const open = tx
      .select()
      .from(nativeSessions)
      .where(and(eq(nativeSessions.chatSessionId, input.chatSessionId), isNull(nativeSessions.endedAt)))
      .get();
    if (open?.nativeSessionId === input.nativeSessionId) return open;
    if (open) {
      tx.update(nativeSessions).set({ endedAt: now, endReason: 'replaced', updatedAt: now }).where(eq(nativeSessions.id, open.id)).run();
    }
    return tx
      .insert(nativeSessions)
      .values({ id: uuidv7(), createdAt: now, updatedAt: now, startedAt: now, ...input })
      .returning()
      .get();
  }, { behavior: 'immediate' });
}

export function listNativeSessions(chatSessionId: string): NativeSessionRecord[] {
  return getDb()
    .select()
    .from(nativeSessions)
    .where(eq(nativeSessions.chatSessionId, chatSessionId))
    .orderBy(asc(nativeSessions.id))
    .all();
}

// ─── Review checkouts (P4.1) ──────────────────────────────────

export function getReviewCheckout(executionId: string, deviceId: string): ReviewCheckoutRecord | null {
  return (
    getDb()
      .select()
      .from(reviewCheckouts)
      .where(and(eq(reviewCheckouts.executionId, executionId), eq(reviewCheckouts.deviceId, deviceId)))
      .get() ?? null
  );
}

export function saveReviewCheckout(input: {
  executionId: string;
  deviceId: string;
  sourceDeviceId: string | null;
  path: string;
  branch: string;
  commitSha: string;
  dirty: boolean;
}): ReviewCheckoutRecord {
  const now = new Date().toISOString();
  return getDb()
    .insert(reviewCheckouts)
    .values({ id: uuidv7(), createdAt: now, updatedAt: now, ...input })
    .onConflictDoUpdate({
      target: [reviewCheckouts.executionId, reviewCheckouts.deviceId],
      set: {
        sourceDeviceId: input.sourceDeviceId,
        path: input.path,
        branch: input.branch,
        commitSha: input.commitSha,
        dirty: input.dirty,
        updatedAt: now,
      },
    })
    .returning()
    .get();
}

/** A placement's worktree is gone (archived) until its device prepares it again (P4.5). */
export function clearPlacementWorktree(placementId: string): void {
  getDb()
    .update(executionPlacements)
    .set({ worktreePath: null, updatedAt: new Date().toISOString() })
    .where(eq(executionPlacements.id, placementId))
    .run();
}

export function setPlacementWorktree(placementId: string, worktreePath: string, checkpointSha: string | null = null): void {
  getDb()
    .update(executionPlacements)
    .set({ worktreePath, checkpointSha, updatedAt: new Date().toISOString() })
    .where(eq(executionPlacements.id, placementId))
    .run();
}

/**
 * A connected device prepared its placement of an execution: record the
 * worktree there on the placement, and the branch and base on the
 * execution. `executions.worktree_path` stays the home device's own path,
 * so nothing on the home ever looks for the other device's folder here.
 */
export function markPlacementPrepared(
  executionId: string,
  generation: number,
  prepared: { worktreePath: string; branchName: string | null; baseSha: string | null; warning: string | null },
): ExecutionPlacementRecord | null {
  const now = new Date().toISOString();
  const placement = getDb()
    .update(executionPlacements)
    .set({ worktreePath: prepared.worktreePath, checkpointSha: prepared.baseSha, updatedAt: now })
    .where(and(eq(executionPlacements.executionId, executionId), eq(executionPlacements.generation, generation)))
    .returning()
    .get();
  if (!placement) return null;
  updateExecution(executionId, {
    branchName: prepared.branchName,
    baseSha: prepared.baseSha,
    setupError: null,
    setupWarning: prepared.warning,
  });
  return placement;
}

export function listOpenPlacementsForDevice(deviceId: string): ExecutionPlacementRecord[] {
  return getDb()
    .select()
    .from(executionPlacements)
    .where(and(eq(executionPlacements.deviceId, deviceId), isNull(executionPlacements.endedAt)))
    .all();
}

/** Whether a device held an execution at a generation, now or before. */
export function heldPlacement(executionId: string, deviceId: string, generation: number): boolean {
  return (
    getDb()
      .select({ id: executionPlacements.id })
      .from(executionPlacements)
      .where(
        and(
          eq(executionPlacements.executionId, executionId),
          eq(executionPlacements.deviceId, deviceId),
          eq(executionPlacements.generation, generation),
        ),
      )
      .get() !== undefined
  );
}

/** Where a chat runs, for routing its work (P2.4). */
export interface ChatPlacement {
  deviceId: string;
  /** The home's own device. */
  isHome: boolean;
  executionId: string | null;
  /** The execution's placement generation. Null for a chat without an execution. */
  generation: number | null;
  worktreePath: string | null;
}

/**
 * Where a chat runs: its execution's placement, or for a chat without one,
 * its own `device_id`, where null is the home's own device. Null only
 * for an unknown chat or a home with no identity yet.
 */
export function chatPlacement(chatSessionId: string): ChatPlacement | null {
  const chat = getDb()
    .select({ executionId: chatSessions.executionId, deviceId: chatSessions.deviceId })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId))
    .get();
  if (!chat) return null;
  const host = getHome()?.hostDeviceId ?? null;
  if (chat.executionId) {
    const placement = placementOf(chat.executionId);
    if (!placement) return null;
    return {
      deviceId: placement.deviceId,
      isHome: placement.deviceId === host,
      executionId: chat.executionId,
      generation: placement.generation,
      worktreePath: placement.worktreePath,
    };
  }
  const deviceId = chat.deviceId ?? host;
  if (!deviceId) return null;
  return { deviceId, isHome: deviceId === host, executionId: null, generation: null, worktreePath: null };
}

/**
 * Whether a chat has run anywhere yet: it has a native session, an agent
 * reply, or a message that left the home's queue for a device. And the
 * sends still waiting in a device's queue. A main chat that hasn't run has
 * nothing on its device to keep (`followAgentUntilRun`).
 */
export function chatRunState(chatSessionId: string): { hasRun: boolean; queuedSends: WorkerCommandRecord[]; queued: WorkerCommandRecord[] } {
  const db = getDb();
  const chat = db.select({ native: chatSessions.externalSessionId }).from(chatSessions).where(eq(chatSessions.id, chatSessionId)).get();
  if (!chat) return { hasRun: false, queuedSends: [], queued: [] };
  const native = db.select({ id: nativeSessions.id }).from(nativeSessions).where(eq(nativeSessions.chatSessionId, chatSessionId)).get();
  const replied = db
    .select({ id: chatEvents.id })
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, chatSessionId), eq(chatEvents.source, 'agent')))
    .get();
  const left = db
    .select({ id: workerCommands.id })
    .from(workerCommands)
    .where(and(eq(workerCommands.chatSessionId, chatSessionId), notInArray(workerCommands.state, ['queued', 'cancelled'])))
    .get();
  const queued = db
    .select()
    .from(workerCommands)
    .where(and(eq(workerCommands.chatSessionId, chatSessionId), eq(workerCommands.state, 'queued')))
    .all();
  return { hasRun: !!(chat.native || native || replied || left), queuedSends: queued.filter((c) => c.kind === 'send'), queued };
}

/**
 * The connected device a chat runs on, or null when it runs on the home's
 * own device. What a worker's events are checked against.
 */
export function getChatDeviceId(chatSessionId: string): string | null {
  const placement = chatPlacement(chatSessionId);
  return placement && !placement.isHome ? placement.deviceId : null;
}

// ─── Agent setups (docs/homes-spec.md §4.2) ───────────────────

/** Statuses that mean the setup file couldn't be read, so its references are unknown. */
export type WorkspaceSetupWithDevice = WorkspaceSetupRecord & { deviceName: string };

export function listWorkspaceSetups(filter: { workspaceId?: string; deviceId?: string } = {}): WorkspaceSetupWithDevice[] {
  const conds: SQL[] = [];
  if (filter.workspaceId) conds.push(eq(workspaceSetups.workspaceId, filter.workspaceId));
  if (filter.deviceId) conds.push(eq(workspaceSetups.deviceId, filter.deviceId));
  return getDb()
    .select({ ...getTableColumns(workspaceSetups), deviceName: devices.name })
    .from(workspaceSetups)
    .innerJoin(devices, eq(workspaceSetups.deviceId, devices.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(devices.name))
    .all();
}

export function getWorkspaceSetup(workspaceId: string, deviceId: string): WorkspaceSetupRecord | null {
  return (
    getDb()
      .select()
      .from(workspaceSetups)
      .where(and(eq(workspaceSetups.workspaceId, workspaceId), eq(workspaceSetups.deviceId, deviceId)))
      .get() ?? null
  );
}

// ─── Folder records (docs/homes-spec.md §4.1) ───────────────
// The home's database is the only place an agent's folders are kept: its
// project folder on each device (`workspace_setups`), and where each linked
// folder is on each device (`folder_links`). The device checks them and
// the home records what it found. Each setup's `references` and `status` are
// derived from these, by `recomputeWorkspaceSetups`, and never edited directly.

export function listFolderLinks(filter: { deviceId?: string; referenceFolderId?: string } = {}): FolderLinkRecord[] {
  const conds: SQL[] = [];
  if (filter.deviceId) conds.push(eq(folderLinks.deviceId, filter.deviceId));
  if (filter.referenceFolderId) conds.push(eq(folderLinks.referenceFolderId, filter.referenceFolderId));
  return getDb().select().from(folderLinks).where(conds.length ? and(...conds) : undefined).all();
}

export function getFolderLink(deviceId: string, referenceFolderId: string): FolderLinkRecord | null {
  return (
    getDb()
      .select()
      .from(folderLinks)
      .where(and(eq(folderLinks.deviceId, deviceId), eq(folderLinks.referenceFolderId, referenceFolderId)))
      .get() ?? null
  );
}

/**
 * Where a linked folder is on a device, or null for going without it there.
 * A new place is unchecked until the device looks. For a linked folder
 * every agent uses, this is its place for every agent on that device.
 */
export function setFolderLink(deviceId: string, referenceFolderId: string, folder: string | null): FolderLinkRecord {
  const now = new Date().toISOString();
  const value = folder === null ? null : nodePath.resolve(folder);
  const row = getDb().transaction((tx) => {
    const current = tx
      .select()
      .from(folderLinks)
      .where(and(eq(folderLinks.deviceId, deviceId), eq(folderLinks.referenceFolderId, referenceFolderId)))
      .get();
    const moved = !current || current.path !== value;
    const values = { path: value, updatedAt: now, ...(moved ? { found: null, checkedAt: null } : {}) };
    return tx
      .insert(folderLinks)
      .values({ id: uuidv7(), deviceId, referenceFolderId, createdAt: now, ...values })
      .onConflictDoUpdate({ target: [folderLinks.deviceId, folderLinks.referenceFolderId], set: values })
      .returning()
      .get();
  }, { behavior: 'immediate' });
  recomputeWorkspaceSetups(deviceId);
  return row;
}

/** Forget where a linked folder is on a device: it's unchosen there again. */
export function removeFolderLink(deviceId: string, referenceFolderId: string): void {
  getDb()
    .delete(folderLinks)
    .where(and(eq(folderLinks.deviceId, deviceId), eq(folderLinks.referenceFolderId, referenceFolderId)))
    .run();
  recomputeWorkspaceSetups(deviceId);
}

/**
 * The agent's project folder on a device. A new place is unchecked until
 * the device looks. On the home it's `workspaces.cwd` too, which the rest
 * of the app still reads for the home's own folder.
 */
export function setAgentFolder(workspaceId: string, deviceId: string, folder: string): WorkspaceSetupRecord {
  const now = new Date().toISOString();
  const sourcePath = nodePath.resolve(folder);
  getDb().transaction((tx) => {
    const current = tx
      .select()
      .from(workspaceSetups)
      .where(and(eq(workspaceSetups.workspaceId, workspaceId), eq(workspaceSetups.deviceId, deviceId)))
      .get();
    const moved = !current || current.sourcePath !== sourcePath;
    const values = { sourcePath, updatedAt: now, reportedAt: now, ...(moved ? { found: null } : {}) };
    tx.insert(workspaceSetups)
      .values({ id: uuidv7(), workspaceId, deviceId, createdAt: now, references: [], status: 'unchecked', problem: null, ...values })
      .onConflictDoUpdate({ target: [workspaceSetups.workspaceId, workspaceSetups.deviceId], set: values })
      .run();
    const isHost = tx.select({ host: home.hostDeviceId }).from(home).get()?.host === deviceId;
    if (isHost) {
      tx.update(workspaces)
        .set({ cwd: sourcePath, updatedAt: now })
        .where(and(eq(workspaces.id, workspaceId), sql`${workspaces.cwd} IS NOT ${sourcePath}`))
        .run();
    }
  }, { behavior: 'immediate' });
  recomputeWorkspaceSetups(deviceId);
  return getWorkspaceSetup(workspaceId, deviceId)!;
}

/**
 * Take an agent off a device: its setup there, and where its own linked
 * folders were there. A linked folder every agent uses keeps its place, for
 * the others.
 */
export function removeWorkspaceSetup(workspaceId: string, deviceId: string): boolean {
  const removed = getDb().transaction((tx) => {
    const own = tx
      .select({ id: referenceFolders.id })
      .from(referenceFolders)
      .where(eq(referenceFolders.workspaceId, workspaceId))
      .all()
      .map((r) => r.id);
    if (own.length) {
      tx.delete(folderLinks).where(and(eq(folderLinks.deviceId, deviceId), inArray(folderLinks.referenceFolderId, own))).run();
    }
    return tx
      .delete(workspaceSetups)
      .where(and(eq(workspaceSetups.workspaceId, workspaceId), eq(workspaceSetups.deviceId, deviceId)))
      .returning()
      .all().length;
  }, { behavior: 'immediate' });
  return removed > 0;
}

/** Every folder a device has to check: its agents' project folders and its linked folders. */
export function foldersToCheck(deviceId: string): string[] {
  const setups = getDb().select({ path: workspaceSetups.sourcePath }).from(workspaceSetups).where(eq(workspaceSetups.deviceId, deviceId)).all();
  const links = getDb()
    .select({ path: folderLinks.path })
    .from(folderLinks)
    .where(and(eq(folderLinks.deviceId, deviceId), isNotNull(folderLinks.path)))
    .all();
  return [...new Set([...setups.map((s) => s.path), ...links.map((l) => l.path!)])];
}

/** What a device found when it checked its folders, recorded against them. */
export function recordFolderChecks(deviceId: string, results: ReadonlyArray<{ path: string; exists: boolean }>): void {
  const now = new Date().toISOString();
  const found = new Map(results.map((r) => [nodePath.resolve(r.path), r.exists]));
  getDb().transaction((tx) => {
    for (const row of tx.select().from(workspaceSetups).where(eq(workspaceSetups.deviceId, deviceId)).all()) {
      const exists = found.get(nodePath.resolve(row.sourcePath));
      if (exists === undefined) continue;
      tx.update(workspaceSetups).set({ found: exists, reportedAt: now, updatedAt: now }).where(eq(workspaceSetups.id, row.id)).run();
    }
    for (const link of tx.select().from(folderLinks).where(eq(folderLinks.deviceId, deviceId)).all()) {
      if (!link.path) continue;
      const exists = found.get(nodePath.resolve(link.path));
      if (exists === undefined) continue;
      tx.update(folderLinks).set({ found: exists, checkedAt: now, updatedAt: now }).where(eq(folderLinks.id, link.id)).run();
    }
    tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, deviceId)).run();
  }, { behavior: 'immediate' });
  recomputeWorkspaceSetups(deviceId);
}

/**
 * Each setup's linked folders and status on a device, from the records:
 * the linked folders the agent uses (its own, then the ones for every agent),
 * where each is there, and what the device last found. `ready` once the
 * project folder and every linked folder are found. `unchecked` until the
 * device has looked (work can start: it checks again before it prepares).
 * A linked folder not chosen there, or not found, blocks work there.
 */
export function recomputeWorkspaceSetups(deviceId: string): void {
  const db = getDb();
  const deviceName = db.select({ name: devices.name }).from(devices).where(eq(devices.id, deviceId)).get()?.name ?? 'this device';
  const setups = db.select().from(workspaceSetups).where(eq(workspaceSetups.deviceId, deviceId)).all();
  if (setups.length === 0) return;
  const links = new Map(listFolderLinks({ deviceId }).map((l) => [l.referenceFolderId, l]));
  const bySetup = new Map(setups.map((s) => [s.workspaceId, s]));
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const setup of setups) {
      const agent = tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, setup.workspaceId)).get();
      if (!agent) continue;
      // Whether a chosen linked folder hasn't been checked there yet.
      let linkUnchecked = false;
      const references: SetupReferenceReport[] = listReferenceFoldersForWorkspace(setup.workspaceId).map((ref) => {
        if (ref.targetWorkspaceId) {
          const target = bySetup.get(ref.targetWorkspaceId);
          const targetName = tx.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, ref.targetWorkspaceId)).get()?.name ?? 'That agent';
          return {
            alias: ref.alias,
            value: { agentId: ref.targetWorkspaceId },
            form: 'agent' as const,
            path: target?.sourcePath ?? null,
            exists: target?.found === true,
            problem: !target
              ? `${targetName} isn't on ${deviceName} yet.`
              : target.found === false
                ? `${targetName}'s folder on ${deviceName}, ${target.sourcePath}, isn't there.`
                : null,
          };
        }
        const link = links.get(ref.id);
        if (!link) {
          return { alias: ref.alias, form: 'unconfigured' as const, path: null, exists: false, problem: `Choose where ${ref.alias} is on ${deviceName}, or go without it.` };
        }
        if (link.path === null) {
          return { alias: ref.alias, value: null, form: 'omitted' as const, path: null, exists: false, problem: null };
        }
        if (link.found === null) linkUnchecked = true;
        return {
          alias: ref.alias,
          value: link.path,
          form: 'path' as const,
          path: link.path,
          exists: link.found === true,
          problem: link.found === false ? `${ref.alias} isn't at ${link.path} on ${deviceName}.` : null,
        };
      });
      const blocking = references.find((r) => r.problem);
      const unchecked = setup.found === null || linkUnchecked;
      const status: WorkspaceSetupRecord['status'] =
        setup.found === false ? 'missing_folder' : blocking ? 'missing_reference' : unchecked ? 'unchecked' : 'ready';
      const problem =
        setup.found === false ? `${agent.name}'s folder on ${deviceName}, ${setup.sourcePath}, isn't there.` : (blocking?.problem ?? null);
      tx.update(workspaceSetups).set({ references, status, problem, updatedAt: now }).where(eq(workspaceSetups.id, setup.id)).run();
    }
  }, { behavior: 'immediate' });
}

/**
 * Move what existed before the home's records held every device's folders
 * into them (migration 0011), once and idempotently, at boot after the home
 * has its identity: an agent with no setup anywhere gets its home row from
 * `workspaces.cwd`, and each linked folder gets a place on each device from
 * what its agents last used there (their setup files' reports). The home
 * falls back to the linked folder's own path when no agent reported one.
 * Nothing that's already recorded is changed.
 *
 * A linked folder every agent uses has one place per device, so agents that
 * used different places there are settled in this order: an active agent
 * before an archived one, then a place someone chose before one that was only
 * the linked folder's own path carried along, then the latest report. Each
 * disagreement is returned, to say at boot what was kept.
 */
export function moveFolderRecords(): { setups: number; links: number; settled: string[] } {
  const db = getDb();
  const host = db.select({ host: home.hostDeviceId }).from(home).get()?.host ?? null;
  if (!host) return { setups: 0, links: 0, settled: [] };
  const now = new Date().toISOString();
  let setupsMoved = 0;
  let linksMoved = 0;
  const settled: string[] = [];
  const touched = new Set<string>();
  db.transaction((tx) => {
    const withSetups = new Set(tx.select({ id: workspaceSetups.workspaceId }).from(workspaceSetups).all().map((r) => r.id));
    for (const ws of tx.select().from(workspaces).where(eq(workspaces.status, 'active')).all()) {
      if (withSetups.has(ws.id) || !ws.cwd) continue;
      tx.insert(workspaceSetups)
        .values({ id: uuidv7(), workspaceId: ws.id, deviceId: host, sourcePath: ws.cwd, references: [], status: 'unchecked', problem: null, reportedAt: now, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run();
      setupsMoved++;
      touched.add(host);
    }
    const linked = new Set(tx.select({ c: folderLinks.deviceId, r: folderLinks.referenceFolderId }).from(folderLinks).all().map((l) => `${l.c}\u0000${l.r}`));
    const addLink = (deviceId: string, referenceFolderId: string, folder: string | null) => {
      const key = `${deviceId}\u0000${referenceFolderId}`;
      if (linked.has(key)) return;
      linked.add(key);
      tx.insert(folderLinks)
        .values({ id: uuidv7(), deviceId, referenceFolderId, path: folder, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run();
      linksMoved++;
      touched.add(deviceId);
    };
    const refs = tx.select().from(referenceFolders).where(eq(referenceFolders.status, 'active')).all();
    const agents = new Map(tx.select({ id: workspaces.id, name: workspaces.name, status: workspaces.status }).from(workspaces).all().map((w) => [w.id, w]));
    const deviceNames = new Map(tx.select({ id: devices.id, name: devices.name }).from(devices).all().map((c) => [c.id, c.name]));

    // Every place an agent last used for a linked folder, by device and linked folder.
    type Used = { agentId: string; place: string | null; chosen: boolean; active: boolean; at: string };
    const used = new Map<string, { deviceId: string; refId: string; uses: Used[] }>();
    for (const setup of tx.select().from(workspaceSetups).all()) {
      for (const report of setup.references ?? []) {
        const ref =
          refs.find((r) => r.workspaceId === setup.workspaceId && r.alias === report.alias && !r.targetWorkspaceId) ??
          refs.find((r) => r.workspaceId === null && r.alias === report.alias && !r.targetWorkspaceId);
        if (!ref) continue;
        const place = report.form === 'path' && report.path ? nodePath.resolve(report.path) : report.form === 'omitted' ? null : undefined;
        if (place === undefined) continue;
        const key = `${setup.deviceId}\u0000${ref.id}`;
        const entry = used.get(key) ?? { deviceId: setup.deviceId, refId: ref.id, uses: [] };
        const inherited = setup.deviceId === host && !!ref.path && place === nodePath.resolve(ref.path);
        entry.uses.push({ agentId: setup.workspaceId, place, chosen: !inherited, active: agents.get(setup.workspaceId)?.status === 'active', at: setup.reportedAt });
        used.set(key, entry);
      }
    }
    for (const { deviceId, refId, uses } of used.values()) {
      uses.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.chosen) - Number(a.chosen) || b.at.localeCompare(a.at));
      const kept = uses[0]!;
      const others = uses.filter((u) => u.active && u.place !== kept.place);
      if (others.length > 0) {
        const ref = refs.find((r) => r.id === refId)!;
        const said = (u: Used) => `${agents.get(u.agentId)?.name ?? u.agentId} used ${u.place ?? 'none'}`;
        settled.push(`@${ref.alias} on ${deviceNames.get(deviceId) ?? deviceId}: kept ${kept.place ?? 'going without'} (${[kept, ...others].map(said).join(', ')})`);
      }
      addLink(deviceId, refId, kept.place);
    }
    for (const ref of refs) {
      if (ref.path && !ref.targetWorkspaceId) addLink(host, ref.id, nodePath.resolve(ref.path));
    }
  }, { behavior: 'immediate' });
  for (const deviceId of touched) recomputeWorkspaceSetups(deviceId);
  return { setups: setupsMoved, links: linksMoved, settled };
}

// ─── API Keys ─────────────────────────────────────────────────

/** Insert a key on a device, inside a transaction. */
function insertApiKey(
  tx: Pick<ReturnType<typeof getDb>, 'insert'>,
  input: CreateApiKeyInput,
): { key: ApiKeyRecord; token: GeneratedToken } {
  const now = new Date().toISOString();
  // Defer to getTokenEnv() (env-aware: 'test' only under AUTH_TOKEN_ENV=test,
  // else 'live') rather than hardcoding 'live', which would mislabel keys minted
  // in a test environment. An explicit input.env still wins.
  const token = generateToken(input.env);
  const key = tx
    .insert(apiKeys)
    .values({
      ...input,
      id: uuidv7(),
      prefix: token.prefix,
      suffix: token.suffix,
      hash: token.hash,
      env: token.env,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { key, token };
}

/**
 * A key on a device that exists. A new device pairs with `pairDevice`,
 * which makes the device and its key together.
 */
export function createApiKey(input: CreateApiKeyInput): { key: ApiKeyRecord; token: GeneratedToken } {
  return insertApiKey(getDb(), input);
}

export function listApiKeys(options: { includeRevoked?: boolean } = {}): ApiKeyRecord[] {
  const db = getDb();
  const q = db.select().from(apiKeys);
  const rows = options.includeRevoked
    ? q.orderBy(desc(apiKeys.createdAt)).all()
    : q.where(isNull(apiKeys.revokedAt)).orderBy(desc(apiKeys.createdAt)).all();
  return rows;
}

export function getApiKey(id: string): ApiKeyRecord | null {
  return getDb().select().from(apiKeys).where(eq(apiKeys.id, id)).get() ?? null;
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

/**
 * Stop a key working. Revoking a worker key stops its device running agents
 * (`retireWorker` calls this, and settles that worker's work).
 */
export function revokeApiKey(id: string, reason?: string): ApiKeyRecord | null {
  const now = new Date().toISOString();
  return (
    getDb()
      .update(apiKeys)
      .set({ revokedAt: now, revokedReason: reason ?? null, updatedAt: now })
      .where(eq(apiKeys.id, id))
      .returning()
      .get() ?? null
  );
}

/** How often a key's "last used" is written while it keeps being used. */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * When each key was last written, and from where. Process-wide because the
 * proxy (HTTP) and the WebSocket host touch keys from different bundles.
 */
const touched = processState('api-keys.touched', () => new Map<string, { at: number; ip: string | null; userAgent: string | null }>());

/**
 * Record that a key was used. Written at most once a minute per key while it
 * keeps coming from the same place: every authenticated request calls this,
 * and the write is what a request waits on (holding the server's one thread)
 * whenever another process has the database's write lock. Settings shows the
 * time to the day, so a minute loses nothing.
 */
export function touchApiKey(
  id: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
  now = Date.now(),
): void {
  const ip = meta.ip ?? null;
  const userAgent = meta.userAgent ?? null;
  const last = touched.get(id);
  if (last && now - last.at < TOUCH_INTERVAL_MS && last.ip === ip && last.userAgent === userAgent) return;
  getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date(now).toISOString(), lastUsedIp: ip, lastUsedUserAgent: userAgent })
    .where(eq(apiKeys.id, id))
    .run();
  touched.set(id, { at: now, ip, userAgent });
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

  return rows.map((r) => readWorkspaceRow(hydrateRow(r)));
}

/**
 * Every workspace row leaves the query layer with its integration scopes in the current shape: a
 * legacy single `account` pin folded into `accounts` (docs/integrations-workspace-scoping-spec.md §4).
 * The column is JSON, so old rows are rewritten on read rather than by a migration, and the next
 * scope save stores the new shape.
 */
function readWorkspaceRow<R extends { integrationScopes: WorkspaceIntegrationScope[] }>(row: R): R;
function readWorkspaceRow<R extends { integrationScopes: WorkspaceIntegrationScope[] }>(row: R | undefined): R | undefined;
function readWorkspaceRow<R extends { integrationScopes: WorkspaceIntegrationScope[] }>(row: R | undefined): R | undefined {
  if (!row) return row;
  return { ...row, integrationScopes: normalizeIntegrationScopes(row.integrationScopes) };
}

export function getWorkspace(id: string): WorkspaceRecord | undefined {
  const db = getDb();
  return readWorkspaceRow(hydrateRow(db.select().from(workspaces).where(eq(workspaces.id, id)).get()));
}

/**
 * Caps on the agent-scope text fields (docs/agents-view-spec.md Phase 3). The
 * UI calls a workspace an agent. `purpose` is a sentence, `instructions` are
 * delivered into every session the agent starts, so both are bounded.
 */
export const WORKSPACE_PURPOSE_MAX = 500;
export const WORKSPACE_INSTRUCTIONS_MAX = 20_000;

/** A workspace field failed validation. Routes map it to 400, actions to `invalid_params`. */
export class WorkspaceFieldError extends Error {
  readonly code = 'invalid_params' as const;
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceFieldError';
  }
}

/**
 * Normalize `purpose` / `instructions`: trim the ends, store blank as null
 * (meaning none), and enforce the cap. `undefined` means "not being set" and
 * passes through, so a partial update leaves the column alone.
 */
function normalizeScopeText(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new WorkspaceFieldError(`${label} must be text.`);
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) {
    throw new WorkspaceFieldError(
      `${label} is ${text.length.toLocaleString('en-US')} characters. The limit is ${max.toLocaleString('en-US')}.`,
    );
  }
  return text;
}

function normalizeScopeFields<T extends { purpose?: string | null; instructions?: string | null }>(input: T): T {
  const purpose = normalizeScopeText(input.purpose, 'Purpose', WORKSPACE_PURPOSE_MAX);
  const instructions = normalizeScopeText(input.instructions, 'Instructions', WORKSPACE_INSTRUCTIONS_MAX);
  return {
    ...input,
    ...(purpose !== undefined ? { purpose } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
  };
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

  const { attachments: inputAttachments, ...rest } = normalizeScopeFields(input);
  const row = hydrateRow(db
    .insert(workspaces)
    .values({
      ...rest,
      id: uuidv7(),
      slug,
      position,
      status: input.status ?? 'active',
      filesToCopy: input.filesToCopy ?? DEFAULT_FILES_TO_COPY,
      collapsed: input.collapsed ?? false,
      skipLiveConfirm: input.skipLiveConfirm ?? false,
      browserEnabled: input.browserEnabled ?? true,
      ...(inputAttachments !== undefined ? { attachments: dehydrateAttachments(inputAttachments) ?? [] } : {}),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get());
  return readWorkspaceRow(row);
}

/**
 * Check a workspace update the way `updateWorkspace` will, without writing,
 * so a caller can refuse a bad patch before changing anything else (the
 * folder move in PATCH /api/workspaces/:id). Throws `WorkspaceFieldError`.
 */
export function validateWorkspaceUpdate(input: UpdateWorkspaceInput): UpdateWorkspaceInput {
  const normalized = normalizeScopeFields(input);
  if (input.name !== undefined && (typeof input.name !== 'string' || !input.name.trim())) {
    throw new WorkspaceFieldError('Name must be text.');
  }
  if (input.cwd !== undefined && (typeof input.cwd !== 'string' || !input.cwd.trim())) {
    throw new WorkspaceFieldError('Folder must be a path.');
  }
  return normalized;
}

export function updateWorkspace(id: string, input: UpdateWorkspaceInput): WorkspaceRecord | null {
  const db = getDb();
  const { attachments: inputAttachments, ...rest } = normalizeScopeFields(input);
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
  return readWorkspaceRow(row) ?? null;
}

/**
 * Replace a workspace's integration allowlist (docs/integrations-workspace-scoping-spec.md §6e). The
 * raw storage primitive only — validation (reject-unknown / preserve-dormant) and active-session
 * recycling live at the route, which can reach the (async) integration runtime + executor.
 */
export function setWorkspaceIntegrationScopes(
  id: string,
  scopes: WorkspaceIntegrationScope[],
): WorkspaceRecord | null {
  // Only ever write the current shape (`accounts`, never the legacy single `account`).
  return updateWorkspace(id, { integrationScopes: normalizeIntegrationScopes(scopes) });
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
  return readWorkspaceRow(row) ?? null;
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
  'readOnly',
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
/**
 * A linked folder is a folder, placed per device (`folder_links`), or
 * another agent: never both. A folder may have no place yet anywhere, to be
 * chosen on each device (docs/homes-spec.md §4.1).
 */
function assertOneTarget(path: string | null | undefined, targetWorkspaceId: string | null | undefined): void {
  const hasPath = path != null && path.length > 0;
  const hasWorkspace = targetWorkspaceId != null && targetWorkspaceId.length > 0;
  if (hasPath && hasWorkspace) {
    throw new ReferenceFolderError('invalid_params', 'A reference folder takes either a path or a target workspace, not both.');
  }
}

/** The home device, where a linked folder's `path` from the API or an action is placed. */
function hostOf(): string | null {
  return getDb().select({ host: home.hostDeviceId }).from(home).get()?.host ?? null;
}

/** Every device's setups, recomputed: after a linked folder's definition changes. */
export function recomputeAllWorkspaceSetups(): void {
  const ids = getDb().selectDistinct({ id: workspaceSetups.deviceId }).from(workspaceSetups).all().map((r) => r.id);
  for (const id of ids) recomputeWorkspaceSetups(id);
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
  // `~` and relative paths are normalized here so every caller (route,
  // orchestrator action, test) stores the same absolute form. A path is
  // where it is on the home: the home's link, once the home has an identity.
  const homePath = input.path ? normalizeReferencePath(input.path) : null;
  const host = hostOf();
  try {
    const row = db
      .insert(referenceFolders)
      .values({
        ...pickReferenceFolderFields(input),
        alias,
        workspaceId,
        // Always born active — caller-supplied status is deliberately ignored
        // (see "ignores caller-supplied status on create").
        status: 'active',
        path: host ? null : homePath,
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
    if (host && homePath) setFolderLink(host, row.id, homePath);
    // Every device's setups now use it: waiting on a place there, until chosen.
    recomputeAllWorkspaceSetups();
    return row;
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
  // of the pair can't silently leave both set. A path is the home's link.
  const host = hostOf();
  const homePathChange = 'path' in next && host ? { path: next.path ?? null } : null;
  if (homePathChange) delete next.path;
  const mergedPath = homePathChange ? homePathChange.path : 'path' in next ? next.path : existing.path;
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
      .set({ ...next, ...(homePathChange ? { path: null } : {}), updatedAt: new Date().toISOString() })
      .where(eq(referenceFolders.id, id))
      .returning()
      .get();
    if (homePathChange && host) {
      if (homePathChange.path) setFolderLink(host, id, homePathChange.path);
      else removeFolderLink(host, id);
    }
    recomputeAllWorkspaceSetups();
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
  // No longer used anywhere: every device's setups no longer wait on it.
  if (row) recomputeAllWorkspaceSetups();
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

// ─── Harness defaults ─────────────────────────────────────────

/**
 * The harness a trigger runs on when the caller doesn't pick one: the user's
 * default provider, the same default the chat composer and background AI use.
 * Without it, a Codex user's triggers silently ran on Claude.
 */
export function defaultTriggerHarness(): HarnessId {
  const saved = getUserState()?.defaultHarness;
  // Keep an explicit saved choice even when rollout disables dispatch.
  // The launch boundary refuses it instead of substituting another harness.
  return isKnownHarnessId(saved) ? saved : DEFAULT_HARNESS;
}

/**
 * A trigger plus the provider it runs on, for the detail page, the CLI table,
 * and agents editing triggers over MCP. `provider` is the row's `harness`
 * under the name `create_trigger` / `update_trigger` take it by.
 */
export function withTriggerProvider<T extends TriggerRecord>(row: T): T & { provider: HarnessId } {
  return { ...row, provider: row.harness };
}

// ─── Executions ───────────────────────────────────────────────
// A durable work artifact (worktree + branch + PR state) anchored to a
// workspace. Chats point at it via executionId. The git/worktree/PR
// columns were lifted off chat_sessions; reads
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
      setupScriptError: 'Setup was interrupted (Ri restarted). Retry to re-run it.',
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
  const host = getHome()?.hostDeviceId ?? null;
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
        // Only the home's own. One placed on a connected device keeps its
        // worktree on the placement and is set up by that device's worker,
        // whose prepare command settles by its own recovery. Its empty
        // `worktreePath` here says nothing about a stuck setup (found in the
        // P2.7 to P2.9 review's live check).
        notExists(
          db.select({ one: sql`1` })
            .from(executionPlacements)
            .where(and(
              eq(executionPlacements.executionId, executions.id),
              isNull(executionPlacements.endedAt),
              host ? sql`${executionPlacements.deviceId} <> ${host}` : sql`1 = 1`,
            )),
        ),
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
 * PR state hoisted to the top level under the field names the
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
    location: e ? executionLocation(e.id) : null,
  } as T & ChatSessionWithExecution;
}

/** Where an execution runs, by its device's name (P3.1). Null before the home has an identity. */
export function executionLocation(executionId: string): ExecutionLocation | null {
  const placement = placementOf(executionId);
  if (!placement) return null;
  const isHome = placement.deviceId === getHome()?.hostDeviceId;
  return {
    deviceId: placement.deviceId,
    name: getDevice(placement.deviceId)?.name ?? 'Unknown device',
    isHome,
    folder: isHome ? null : placement.worktreePath,
  };
}

/**
 * Single chat session with its execution's git/worktree/PR state
 * flattened on top. Drop-in replacement for `getChatSession` at every
 * call site that reads worktreePath / branchName / baseSha / prNumber
 * / setup_*. Returns null for unknown ids. Synchronous, like
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

/**
 * Every preview target on one workspace's active executions, newest first
 * (the agent view's Preview tab and Overview).
 */
export function listPreviewTargetsForWorkspace(workspaceId: string): PreviewTargetRecord[] {
  const db = getDb();
  return db
    .select({ ...getTableColumns(previewTargets) })
    .from(previewTargets)
    .innerJoin(executions, eq(previewTargets.executionId, executions.id))
    .where(and(eq(executions.workspaceId, workspaceId), eq(executions.status, 'active')))
    .orderBy(desc(previewTargets.createdAt))
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
      pinned: input.pinned ?? false,
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

/**
 * Main chats: interactive orchestration chats, newest activity first. The
 * app's main chat has no workspace (`workspaceId: null`), an agent's main
 * chat has its workspace (docs/agents-view-spec.md §4). Scheduled fires also
 * create orchestration chats, but they carry `createdByRunId` and belong to
 * the runs surface, so they are never main chats.
 */
export function listMainChats(
  workspaceId: string | null,
  filter: { status?: 'active' | 'archived'; limit?: number } = {},
): ChatSessionRecord[] {
  const db = getDb();
  const conditions: SQL[] = [
    eq(chatSessions.type, 'orchestration'),
    isNull(chatSessions.createdByRunId),
    isNull(chatSessions.executionId),
    workspaceId === null ? isNull(chatSessions.workspaceId) : eq(chatSessions.workspaceId, workspaceId),
  ];
  if (filter.status) conditions.push(eq(chatSessions.status, filter.status));
  const query = db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`);
  return filter.limit ? query.limit(filter.limit).all() : query.all();
}

/**
 * Every active agent's current main chat in one query, for the rail. Same
 * definition as `currentMainChat(workspaceId)`: the most recently active
 * main chat of an active agent. `preview` is its latest message as one line
 * of plain text (`messagePreview`).
 */
export function listAgentMainChats(): AgentMainChatState[] {
  const db = getDb();
  const rows = db
    .select({
      id: chatSessions.id,
      workspaceId: chatSessions.workspaceId,
      lastOutcomeEventAt: chatSessions.lastOutcomeEventAt,
      unreadMarkerAt: chatSessions.unreadMarkerAt,
      lastViewedAt: chatSessions.lastViewedAt,
      lastMessage: sql<string | null>`(
        SELECT e.content FROM chat_events e
        WHERE e.session_id = ${chatSessions.id} AND e.source = 'agent'
        ORDER BY e.created_at DESC LIMIT 1
      )`,
    })
    .from(chatSessions)
    .innerJoin(workspaces, eq(workspaces.id, chatSessions.workspaceId))
    .where(
      and(
        eq(chatSessions.type, 'orchestration'),
        isNull(chatSessions.createdByRunId),
        isNull(chatSessions.executionId),
        eq(chatSessions.status, 'active'),
        eq(workspaces.status, 'active'),
      ),
    )
    .orderBy(sql`COALESCE(${chatSessions.lastActivityAt}, ${chatSessions.startedAt}) DESC`)
    .all();
  const current = new Map<string, AgentMainChatState>();
  for (const { lastMessage, ...row } of rows) {
    if (row.workspaceId && !current.has(row.workspaceId)) {
      current.set(row.workspaceId, { ...row, workspaceId: row.workspaceId, preview: messagePreview(lastMessage) });
    }
  }
  return [...current.values()];
}

export function getChatSession(id: string): ChatSessionRecord | undefined {
  const db = getDb();
  return db.select().from(chatSessions).where(eq(chatSessions.id, id)).get();
}

export function createChatSession(input: CreateChatSessionInput & { id?: string }): ChatSessionRecord {
  const db = getDb();
  const providerId = input.harness;
  const permissionMode = input.permissionMode ?? DEFAULT_PERMISSION_MODE;
  assertSupportedPermissionMode(permissionMode, providerId);
  if (input.prePlanMode) assertSupportedPermissionMode(input.prePlanMode, providerId);
  const selection = explicitHarnessSelection(
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
      // Policy default lives here, not the schema (inert DB backstop equals
      // this). See docs/schema-defaults.md.
      permissionMode,
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
  if (input.harness !== undefined || input.permissionMode !== undefined || input.prePlanMode !== undefined) {
    const existing = getChatSession(id);
    if (!existing) return null;
    const harness = input.harness ?? existing.harness;
    assertSupportedPermissionMode(input.permissionMode ?? existing.permissionMode, harness);
    const prePlanMode = input.prePlanMode === undefined ? existing.prePlanMode : input.prePlanMode;
    if (prePlanMode) assertSupportedPermissionMode(prePlanMode, harness);
  }
  let normalized = input;
  if (Object.hasOwn(input, 'externalSessionId') && !Object.hasOwn(input, 'externalProviderType')) {
    if (input.externalSessionId === null) {
      normalized = { ...input, externalProviderType: null };
    } else if (input.externalSessionId) {
      const session = db
        .select({ harness: chatSessions.harness })
        .from(chatSessions)
        .where(eq(chatSessions.id, id))
        .get();
      normalized = {
        ...input,
        externalProviderType: session?.harness ?? null,
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

/** An import by its native session: on the home's own device, or on a connected one (P2.9). */
export function getExternalSessionImportBySource(
  providerType: string,
  externalSessionId: string,
  deviceId: string | null = null,
): ExternalSessionImportRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(externalSessionImports)
    .where(and(
      eq(externalSessionImports.providerType, providerType),
      eq(externalSessionImports.externalSessionId, externalSessionId),
      deviceId === null ? isNull(externalSessionImports.deviceId) : eq(externalSessionImports.deviceId, deviceId),
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
      // Initial-state default in the query layer (inert DB backstop equals this).
      status: input.status ?? 'importing',
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
 * cascade, and the SET-NULL refs (the retired execution takeover pointer, runs,
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
  /** Which engine runs the chat. A fact: always passed, no fallback. */
  harness: HarnessId;
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
  permissionMode?: ChatSessionRecord['permissionMode'];
  /** Start-with-agent: associate this task with the new execution AND Start it
   * (Consider/Todo -> In progress) in the SAME transaction, so execution + chat
   * + association + start commit atomically. A terminal race rolls everything
   * back (no orphan execution) and throws `conflict`. */
  startTask?: { taskId: string; idempotencyKey: string };
}): { execution: ExecutionRecord; session: ChatSessionRecord } {
  const permissionMode = params.permissionMode ?? DEFAULT_PERMISSION_MODE;
  assertSupportedPermissionMode(permissionMode, params.harness);
  const db = getDb();
  const now = new Date().toISOString();
  const selection = explicitHarnessSelection(
    params.harness,
    { model: params.model, variant: params.modelVariant, effort: params.effort },
  );
  const result = db.transaction((tx) => {
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
        harness: params.harness,
        type: 'execution',
        workspaceId: params.workspaceId,
        executionId: executionId,
        label: params.label,
        status: 'active',
        // Policy default lives here, not the schema. The DB default is an inert
        // backstop kept equal to this. See docs/schema-defaults.md.
        permissionMode,
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

    // Atomic Start-with-agent: associate + Start the task in this same
    // transaction. A terminal race throws and rolls back the execution, chat,
    // and association together — never an orphan or a taskless launch.
    if (params.startTask) {
      const { taskId, idempotencyKey } = params.startTask;
      const t = tx.select({ status: tasks.status, count: tasks.statusChangedCount }).from(tasks).where(eq(tasks.id, taskId)).get();
      if (!t) throw new TaskLifecycleError('not_found', `Task ${taskId} not found.`);
      const status = normalizeTaskStatus(t.status);
      const already = tx.select({ id: executionTasks.id }).from(executionTasks).where(and(eq(executionTasks.executionId, executionId), eq(executionTasks.taskId, taskId))).get();
      if (!already) tx.insert(executionTasks).values({ id: uuidv7(), executionId, taskId }).run();
      if (status !== 'in_progress') {
        if (status !== 'consider' && status !== 'todo') {
          throw new TaskLifecycleError('conflict', `Task ${taskId} is ${status}; it cannot be started.`, { from: status });
        }
        const prior = tx.select({ id: taskStatusChanges.id }).from(taskStatusChanges).where(and(eq(taskStatusChanges.taskId, taskId), eq(taskStatusChanges.idempotencyKey, idempotencyKey))).get();
        if (!prior) {
          const nextCount = t.count + 1;
          tx.update(tasks).set({ status: 'in_progress', statusChangedCount: nextCount, statusChangedAt: now, updatedAt: now }).where(eq(tasks.id, taskId)).run();
          tx.insert(taskStatusChanges).values({
            id: uuidv7(), taskId, idempotencyKey, command: 'start', fromStatus: status, toStatus: 'in_progress', statusChangedCount: nextCount,
            actorSource: 'human', actorSessionId: null, executionId, runId: null, reason: null,
            result: { fromStatus: status, toStatus: 'in_progress', statusChangedCount: nextCount },
          }).run();
        }
      }
    }
    return { execution, session };
  });
  // Mirror sync for the started task (fire-and-forget, post-commit).
  if (params.startTask) void syncEntity('task', params.startTask.taskId);
  return result;
}

/**
 * Create a new execution session in a workspace on the given harness.
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
  harness: HarnessId;
}): ChatSessionRecord {
  const { session } = createExecutionWithChat({
    workspaceId: args.workspaceId,
    harness: args.harness,
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
  /** Which engine runs the new chat. */
  harness: HarnessId;
  model?: string | null;
  modelVariant?: string | null;
  effort?: ChatSessionRecord['effort'];
  permissionMode?: ChatSessionRecord['permissionMode'];
  prePlanMode?: ChatSessionRecord['prePlanMode'];
  label?: string | null;
}): ChatSessionRecord | null {
  const execution = getExecution(args.executionId);
  if (!execution) return null;
  return createChatSession({
    type: 'execution',
    executionId: args.executionId,
    workspaceId: execution.workspaceId,
    harness: args.harness,
    permissionMode: args.permissionMode,
    prePlanMode: args.prePlanMode,
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
 *
 * `workspaceId` scopes the feed to one agent before the cap, so a quiet
 * agent's chats aren't crowded out of the newest 200 by busier ones (chat
 * search's recent list, filtered to an agent).
 */
export function listHistorySessions(opts: { limit?: number; workspaceId?: string } = {}): RailSessionRow[] {
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
    .where(
      and(
        eq(chatSessions.type, 'execution'),
        opts.workspaceId ? eq(chatSessions.workspaceId, opts.workspaceId) : undefined,
      ),
    )
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
  // A part with a revision replaces only an older one, so a late replay
  // can't overwrite newer text (docs/homes-build.md, P2.3).
  const revision = input.partRevision ?? null;
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
    ...(revision !== null ? { partRevision: revision } : {}),
  }).where(and(
    eq(chatEvents.sessionId, input.sessionId),
    eq(chatEvents.externalEventId, input.externalEventId),
    eq(chatEvents.sourcePartIndex, sourcePartIndex),
    revision !== null ? or(isNull(chatEvents.partRevision), lt(chatEvents.partRevision, revision)) : undefined,
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
 * Whether the agent wrote `text` verbatim in one of its replies in this chat.
 * The reply-image route serves a file outside the execution's folder only when
 * the agent itself named it (`src/lib/sessions/reply-images.ts`).
 */
export function agentReplyMentions(sessionId: string, text: string): boolean {
  if (!text) return false;
  const row = getDb()
    .select({ id: chatEvents.id })
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, sessionId), eq(chatEvents.role, 'assistant'), sql`instr(${chatEvents.content}, ${text}) > 0`))
    .limit(1)
    .get();
  return !!row;
}

/**
 * Whether a file tool call (Read, Write, Edit, apply_patch, …) in this chat,
 * or in any chat on its execution, named the absolute path `file`. The file
 * viewer opens a file outside the chat's folder only then
 * (`src/lib/sessions/named-files.ts`): it is what the transcript's file chips
 * point at.
 *
 * `instr` over the stored JSON finds the candidates and `fileTargetPath`
 * confirms the exact path, so `/tmp/a.png` never matches `/tmp/a.png.bak`.
 * Reads one execution's chats through the session index, never the table.
 */
export function fileToolCallNamed(scope: { sessionId: string; executionId: string | null }, file: string): boolean {
  if (!file) return false;
  const db = getDb();
  // The path as it sits inside the stored JSON string.
  const needle = JSON.stringify(file).slice(1, -1);
  const rows = db
    .select({ toolName: chatEvents.toolName, toolInput: chatEvents.toolInput })
    .from(chatEvents)
    .where(and(
      scope.executionId
        ? inArray(chatEvents.sessionId, db.select({ id: chatSessions.id }).from(chatSessions).where(eq(chatSessions.executionId, scope.executionId)))
        : eq(chatEvents.sessionId, scope.sessionId),
      eq(chatEvents.source, 'tool_call'),
      inArray(chatEvents.toolName, [...FILE_TOOL_NAMES]),
      sql`instr(${chatEvents.toolInput}, ${needle}) > 0`,
    ))
    .limit(20)
    .all();
  return rows.some((row) => {
    const named = fileTargetPath(row.toolName, row.toolInput);
    return !!named && nodePath.isAbsolute(named) && nodePath.normalize(named) === file;
  });
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
/**
 * A session's events of the given sources, oldest first. Narrow by design: connection cards read
 * their own requests and decisions with it (integrations/connection-requests.ts). Rides the
 * (session_id, created_at) index, so it scans one chat, never the whole table.
 */
/**
 * A chat's connection cards (an agent asking for an account) and their
 * answers, oldest first, through `idx_chat_events_connection_card`.
 * Unordered in SQL and sorted here: an ORDER BY created_at pulls SQLite
 * onto `idx_chat_events_session_created`, which walks the whole chat.
 */
export function listConnectionCardEvents(sessionId: string): ChatEventRecord[] {
  return getDb()
    .select()
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, sessionId), isConnectionCardEvent(chatEvents)))
    .all()
    .map((r) => hydrateRow(r))
    .sort(byTranscriptOrder);
}

/** Transcript order, `(createdAt, id)`, for rows read without an ORDER BY. */
function byTranscriptOrder(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

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
/**
 * What a session's stream missed while a client was away (P3 re-check): the
 * events written after `afterId`, and the cumulative parts revised in place
 * since `revisedSince` (the newest `updatedAt` the client has seen, the
 * home's clock). `complete` is false when that's more than `limit`, when
 * `afterId` isn't this session's, or when parts may have been revised and
 * there's no `revisedSince` to find them by: the client can't be brought up
 * to date from here, and should read the transcript afresh. Nothing is
 * returned then.
 *
 * "After" is in the order the home wrote them (rowid), not by id: a message
 * keeps the id its sender minted on its own clock, so a phone running ahead
 * puts its message's id past the replies that follow it.
 */
export function listChatEventsToResume(
  sessionId: string,
  afterId: string,
  revisedSince: string | null,
  limit = 1000,
): { rows: ChatEventRecord[]; complete: boolean } {
  const db = getDb();
  const at = db
    .select({ rowid: sql<number>`rowid` })
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, sessionId), eq(chatEvents.id, afterId)))
    .get();
  if (!at) return { rows: [], complete: false };
  const written = sql`rowid`;
  const revisable = and(lte(written, at.rowid), isNotNull(chatEvents.partRevision));
  if (revisedSince === null) {
    const revised = db.select({ id: chatEvents.id }).from(chatEvents).where(and(eq(chatEvents.sessionId, sessionId), revisable)).limit(1).get();
    if (revised) return { rows: [], complete: false };
  }
  const missed = revisedSince === null
    ? gt(written, at.rowid)
    : or(gt(written, at.rowid), and(revisable, gte(chatEvents.updatedAt, revisedSince)));
  const rows = db
    .select()
    .from(chatEvents)
    .where(and(eq(chatEvents.sessionId, sessionId), missed))
    .orderBy(asc(chatEvents.createdAt), asc(chatEvents.id))
    .limit(limit + 1)
    .all();
  if (rows.length > limit) return { rows: [], complete: false };
  return { rows: rows.map((r) => hydrateRow(r)), complete: true };
}

/**
 * Where a session's transcript stands: the event written last, and the
 * newest change to any (`updatedAt`). A stream client resumes from here once
 * it has read the transcript. The last written rather than the greatest id:
 * a message keeps the id its sender minted, on its sender's clock.
 */
export function chatEventsPosition(sessionId: string): { after: string | null; since: string | null } {
  const db = getDb();
  const last = db.select({ id: chatEvents.id }).from(chatEvents).where(eq(chatEvents.sessionId, sessionId)).orderBy(desc(sql`rowid`)).limit(1).get();
  const since = db
    .select({ since: sql<string | null>`max(${chatEvents.updatedAt})` })
    .from(chatEvents)
    .where(eq(chatEvents.sessionId, sessionId))
    .get();
  return { after: last?.id ?? null, since: since?.since ?? null };
}

/**
 * Everything the background-task strip needs for specific tasks, however far
 * back they started: each task's lifecycle events plus the tool call that
 * launched it and that call's result (the command and its output).
 *
 * The transcript loads the newest page of events only, so a long-lived task
 * (a dev server an agent left running) can start more than a page ago while
 * the runtime still reports it live. This lets the strip show it anyway.
 *
 * The SQL filter is a cheap prefilter on both envelope shapes (Agentex's
 * `taskId`, and the legacy Claude `raw.task_id`). `decodeBackgroundTaskEvent`
 * is the authority, applied after, so this matches the decoder's own rules.
 */
export function listBackgroundTaskEvents(sessionId: string, taskIds: readonly string[]): ChatEventRecord[] {
  if (taskIds.length === 0) return [];
  const db = getDb();
  const wanted = new Set(taskIds);
  const idList = [...wanted];
  const candidates = db
    .select()
    .from(chatEvents)
    .where(
      and(
        eq(chatEvents.sessionId, sessionId),
        // Narrows to the session's lifecycle rows through
        // idx_chat_events_background_task before any `raw` is parsed.
        isBackgroundTaskEvent(chatEvents),
        or(
          inArray(sql<string>`json_extract(${chatEvents.raw}, '$.taskId')`, idList),
          inArray(sql<string>`json_extract(${chatEvents.raw}, '$.raw.task_id')`, idList),
        ),
      ),
    )
    // Unordered on purpose, here and below: given an ORDER BY created_at,
    // SQLite prefers idx_chat_events_session_created and walks every event
    // of the session. The few rows found are sorted at the end.
    .all()
    .map((r) => hydrateRow(r));

  const lifecycle: ChatEventRecord[] = [];
  const toolUseIds = new Set<string>();
  for (const row of candidates) {
    const decoded = decodeBackgroundTaskEvent(row.raw);
    if (!decoded?.taskId || !wanted.has(decoded.taskId)) continue;
    lifecycle.push(row);
    if (decoded.toolUseId) toolUseIds.add(decoded.toolUseId);
  }
  // By tool call id alone, through idx_chat_events_tool_call_id, then this
  // session's: with a session_id term SQLite walks the session instead.
  const launches = toolUseIds.size === 0 ? [] : db
    .select()
    .from(chatEvents)
    .where(inArray(chatEvents.externalToolCallId, [...toolUseIds]))
    .all()
    .filter((r) => r.sessionId === sessionId)
    .map((r) => hydrateRow(r));

  const byId = new Map<string, ChatEventRecord>();
  for (const row of [...launches, ...lifecycle]) byId.set(row.id, row);
  return [...byId.values()].sort(byTranscriptOrder);
}

/**
 * Provider identity columns for every event in a session, with no content or
 * raw payload. Backs Codex transcript reconcile, which has to know which turns
 * and items the live stream already persisted before it replays the on-disk
 * rollout (see `codexLiveCoverage`).
 */
export function listChatEventIdentities(
  sessionId: string,
): Pick<ChatEventRecord, 'externalTurnId' | 'externalMessageId' | 'externalToolCallId'>[] {
  return getDb()
    .select({
      externalTurnId: chatEvents.externalTurnId,
      externalMessageId: chatEvents.externalMessageId,
      externalToolCallId: chatEvents.externalToolCallId,
    })
    .from(chatEvents)
    .where(eq(chatEvents.sessionId, sessionId))
    .all();
}

/**
 * Active sessions whose latest event is `auth_required`, enriched with the
 * most recent user-message text so the floating "Resume sessions" card can
 * render a preview and resend action per row.
 *
 * Single round-trip. The candidates are the few sessions that ever paused
 * on a sign-in, read from `idx_chat_events_auth_required`, which holds only
 * those rows. Each candidate gets one `LIMIT 1` probe of
 * `idx_chat_events_session_created` for its latest event (drives the
 * filter), and those still paused probe again for their most-recent user
 * event (drives the preview). Non-archived sessions only — archived ones
 * don't need a "resume" prompt.
 *
 * Never rank the whole of `chat_events` here. The card polls this every
 * 30s, better-sqlite3 runs on the server's only thread, and a window
 * function over every event (1.4M rows, 600 MB of content in prod) took
 * 30-50s, stalling every other request until it returned. Probing every
 * active session instead was usually 20ms but up to 0.6s on a cold cache.
 */
export interface StuckSessionRow {
  sessionId: string;
  label: string | null;
  last_user_event_id: string | null;
  last_user_content: string | null;
  last_user_attachments: string | null;
}

export function listSessionsAwaitingAuth(): StuckSessionRow[] {
  // The candidate subquery leaves `chat_events` unaliased so the shared
  // predicate renders as written in the partial index's WHERE.
  return getDb().all<StuckSessionRow>(sql`
    SELECT
      s.id AS sessionId,
      s.label AS label,
      lu.id AS last_user_event_id,
      lu.content AS last_user_content,
      lu.attachments AS last_user_attachments
    FROM chat_sessions s
    LEFT JOIN chat_events lu ON lu.id = (
      SELECT u.id FROM chat_events u
      WHERE u.session_id = s.id AND u.source = 'user'
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 1
    )
    WHERE s.status = 'active'
      AND s.id IN (SELECT session_id FROM chat_events WHERE ${isAuthRequiredEvent(chatEvents)})
      AND (
        SELECT e.source FROM chat_events e
        WHERE e.session_id = s.id
        ORDER BY e.created_at DESC, e.id DESC
        LIMIT 1
      ) = 'auth_required'
    ORDER BY COALESCE(s.last_activity_at, s.started_at) DESC, s.started_at DESC`);
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
      hydrate: input.hydrate ?? true,
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
  opts: { createdBy: 'user' | 'agent' },
): ChatRefRecord[] {
  deleteEventRefs(eventId);
  const markers = listEntityMarkers(content);
  const created: ChatRefRecord[] = [];
  const createdBy = opts.createdBy;
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
  createdBy: 'user' | 'agent';
}): ChatRefRecord {
  return createChatRef({
    sessionId: args.sessionId,
    eventId: null,
    entityType: args.entityType,
    entityId: args.entityId,
    position: args.position ?? 0,
    hydrate: args.hydrate ?? true,
    createdBy: args.createdBy,
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

// ─── Session references (the Notes & tasks view) ─────────────

/** Rows per page of the execution's Notes & tasks view. */
export const REFERENCE_PAGE_SIZE = 50;
const MAX_REFERENCE_PAGE_SIZE = 200;
/** Words past this many are ignored, which bounds the statement. */
const MAX_REFERENCE_SEARCH_TERMS = 8;
const REFERENCE_SECTIONS: readonly ReferenceSection[] = ['inChat', 'workspace', 'all'];
/** Statuses are constants, so they go in the SQL as literals. */
const sqlList = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
// Legacy `active` bytes count as open, as everywhere else (expandStatusFilter).
const REFERENCE_OPEN_TASKS = sqlList(expandStatusFilter('active'));
const REFERENCE_LISTED_TASKS = sqlList(expandStatusFilter(['active', 'done']));

export class ReferenceCursorError extends Error {
  constructor() {
    super('Not a Notes & tasks cursor. Start again from the first page.');
    this.name = 'ReferenceCursorError';
  }
}

/** The last row's sort position: section, match, open rank, sort time, kind, id. */
type ReferenceCursor = [number, number, number, string, 'task' | 'note', string];

function encodeReferenceCursor(cursor: ReferenceCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeReferenceCursor(raw: string): ReferenceCursor {
  try {
    const c: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      Array.isArray(c) && c.length === 6 &&
      Number.isInteger(c[0]) && Number.isInteger(c[1]) && Number.isInteger(c[2]) &&
      typeof c[3] === 'string' && (c[4] === 'task' || c[4] === 'note') && typeof c[5] === 'string'
    ) {
      return c as ReferenceCursor;
    }
  } catch {
    // Not base64url JSON. Same answer as a well-formed stranger.
  }
  throw new ReferenceCursorError();
}

/** `text` as a `LIKE` pattern that matches only itself (case aside). */
function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface ReferenceScanRow {
  kind: 'task' | 'note';
  id: string;
  title: string | null;
  status: string | null;
  areaId: string | null;
  workspaceId: string | null;
  updatedAt: string;
  referencedAt: string | null;
  sectionRank: number;
  matchRank: number;
  openRank: number;
  sortAt: string;
}

/**
 * One page of the tasks and notes a chat can pull in, for the execution's
 * Notes & tasks view. Three sections in one order, so the view pages through
 * them as a single list:
 *
 *   inChat     mentioned or pinned in this chat (chat_refs), any status,
 *              last referenced first
 *   workspace  in the chat's agent: open tasks first, then done tasks and
 *              notes, each by recency
 *   all        every other open or done task and active note, by recency
 *
 * `q` keeps the rows whose title contains every word of it, case-insensitive
 * (ASCII), across the whole home rather than the pages already loaded.
 * Within a section a title that is the search, then one that starts with
 * it, comes before one that only contains it. `kind` keeps one kind (the
 * composer's `@task:` and `@note:`). `counts` cover each section under the
 * same search. The cursor is the last row's sort position, so an edit while
 * the user scrolls can't shift the next page onto rows they have already
 * seen. The composer's `@` picker reads the same list, a page per kind.
 */
export function listSessionReferences(opts: {
  sessionId: string;
  workspaceId: string | null;
  q?: string;
  kind?: 'task' | 'note';
  cursor?: string | null;
  limit?: number;
}): ReferencePage {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? REFERENCE_PAGE_SIZE), 1), MAX_REFERENCE_PAGE_SIZE);
  const terms = (opts.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, MAX_REFERENCE_SEARCH_TERMS);
  const params: Record<string, string | number | null> = {
    sessionId: opts.sessionId,
    workspaceId: opts.workspaceId,
  };
  const filters = terms.map((term, i) => {
    params[`term${i}`] = `%${likeLiteral(term)}%`;
    return `title LIKE :term${i} ESCAPE '\\'`;
  });
  if (opts.kind) {
    params.kind = opts.kind;
    filters.push('kind = :kind');
  }
  // LIKE without wildcards is equality that ignores (ASCII) case.
  let matchRank = '0';
  if (terms.length > 0) {
    params.phrase = likeLiteral(terms.join(' '));
    params.phrasePrefix = `${params.phrase}%`;
    matchRank = `CASE
          WHEN title LIKE :phrase ESCAPE '\\' THEN 0
          WHEN title LIKE :phrasePrefix ESCAPE '\\' THEN 1
          ELSE 2
        END`;
  }

  // A NULL workspaceId never equals anything, so a chat without an agent
  // has no workspace section and everything else lands in `all`.
  const ranked = `
    WITH refs AS (
      SELECT entity_type AS type, entity_id AS id, MAX(created_at) AS referencedAt
      FROM chat_refs
      WHERE session_id = :sessionId AND entity_type IN ('task', 'note')
      GROUP BY entity_type, entity_id
    ),
    candidates AS (
      SELECT 'task' AS kind, t.id AS id, t.title AS title, t.status AS status,
             t.area_id AS areaId, t.workspace_id AS workspaceId,
             t.updated_at AS updatedAt, r.referencedAt AS referencedAt
      FROM tasks t
      LEFT JOIN refs r ON r.type = 'task' AND r.id = t.id
      WHERE r.id IS NOT NULL OR t.status IN (${REFERENCE_LISTED_TASKS})
      UNION ALL
      SELECT 'note', n.id, n.title, NULL, n.area_id, n.workspace_id, n.updated_at, r.referencedAt
      FROM notes n
      LEFT JOIN refs r ON r.type = 'note' AND r.id = n.id
      WHERE r.id IS NOT NULL OR n.status = 'active'
    ),
    ranked AS (
      SELECT *,
        CASE
          WHEN referencedAt IS NOT NULL THEN 0
          WHEN workspaceId = :workspaceId THEN 1
          ELSE 2
        END AS sectionRank,
        ${matchRank} AS matchRank,
        CASE
          WHEN referencedAt IS NULL AND workspaceId = :workspaceId
               AND kind = 'task' AND status IN (${REFERENCE_OPEN_TASKS}) THEN 0
          ELSE 1
        END AS openRank,
        COALESCE(referencedAt, updatedAt) AS sortAt
      FROM candidates
      ${filters.length > 0 ? `WHERE ${filters.join(' AND ')}` : ''}
    )`;

  const raw = getRawDb();
  const counts: Record<ReferenceSection, number> = { inChat: 0, workspace: 0, all: 0 };
  const countRows = raw
    .prepare(`${ranked} SELECT sectionRank, COUNT(*) AS n FROM ranked GROUP BY sectionRank`)
    .all(params) as Array<{ sectionRank: number; n: number }>;
  for (const r of countRows) counts[REFERENCE_SECTIONS[r.sectionRank]] = r.n;

  // Keyset: everything strictly after the cursor in
  // (sectionRank, matchRank, openRank, sortAt DESC, kind DESC, id DESC) order.
  let after = '';
  const pageParams: Record<string, string | number | null> = { ...params, limit: limit + 1 };
  if (opts.cursor) {
    const [section, match, open, at, kind, id] = decodeReferenceCursor(opts.cursor);
    Object.assign(pageParams, {
      afterSection: section, afterMatch: match, afterOpen: open, afterAt: at, afterKind: kind, afterId: id,
    });
    after = `
      WHERE (sectionRank, matchRank, openRank) > (:afterSection, :afterMatch, :afterOpen)
         OR ((sectionRank, matchRank, openRank) = (:afterSection, :afterMatch, :afterOpen)
             AND (sortAt < :afterAt OR (sortAt = :afterAt AND (kind, id) < (:afterKind, :afterId))))`;
  }
  const scan = raw
    .prepare(`${ranked}
      SELECT * FROM ranked ${after}
      ORDER BY sectionRank, matchRank, openRank, sortAt DESC, kind DESC, id DESC
      LIMIT :limit`)
    .all(pageParams) as ReferenceScanRow[];
  const page = scan.slice(0, limit);

  // The chevron's count matches what expanding shows: subtasks not archived.
  const taskIds = page.filter((r) => r.kind === 'task').map((r) => r.id);
  const subtaskCounts = new Map<string, number>();
  if (taskIds.length > 0) {
    const rows = getDb()
      .select({ parentId: tasks.parentId, n: sql<number>`count(*)` })
      .from(tasks)
      .where(and(inArray(tasks.parentId, taskIds), notInArray(tasks.status, ['archived'])))
      .groupBy(tasks.parentId)
      .all();
    for (const r of rows) if (r.parentId) subtaskCounts.set(r.parentId, r.n);
  }

  const last = page[page.length - 1];
  return {
    rows: page.map((r): ReferenceRow => ({
      kind: r.kind,
      id: r.id,
      title: r.title ?? 'Untitled',
      ...(r.kind === 'task'
        ? { status: normalizeTaskStatus(r.status), subtaskCount: subtaskCounts.get(r.id) ?? 0 }
        : {}),
      areaId: r.areaId,
      workspaceId: r.workspaceId,
      updatedAt: r.updatedAt,
      section: REFERENCE_SECTIONS[r.sectionRank],
      referencedAt: r.referencedAt,
    })),
    counts,
    nextCursor:
      scan.length > limit && last
        ? encodeReferenceCursor([last.sectionRank, last.matchRank, last.openRank, last.sortAt, last.kind, last.id])
        : null,
  };
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
      // Policy defaults live here, not the schema (which carries none).
      enabled: input.enabled ?? true,
      concurrencyPolicy: input.concurrencyPolicy ?? 'coalesce_if_active',
      catchUpPolicy: input.catchUpPolicy ?? 'skip_missed',
      maxCatchUpRuns: input.maxCatchUpRuns ?? 3,
      timezone: input.timezone ?? 'UTC',
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
    ...withTriggerProvider(s),
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
  harness?: HarnessId;
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
  if (filter.harness) conditions.push(eq(runs.harness, filter.harness));
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
      // Initial-state default in the query layer (inert DB backstop equals this).
      status: input.status ?? 'queued',
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
  return updateRun(id, { status: 'running', startedAt, statusReason: null });
}

/** Why a scheduled fire waits: a move holds its message (P3 re-check). */
export const HELD_BY_MOVE = 'held_by_move';

/**
 * A scheduled fire whose message a move holds: back to `queued`, waiting,
 * with nothing started. The move delivers it as this run once it settles
 * (`heldFireFor`). Only a run still under way.
 */
export function markRunHeld(id: string): RunRecord | null {
  return (
    getDb()
      .update(runs)
      .set({ status: 'queued', statusReason: HELD_BY_MOVE, startedAt: null })
      .where(and(eq(runs.id, id), inArray(runs.status, ['queued', 'running'])))
      .returning()
      .get() ?? null
  );
}

/** The scheduled fire a held message is, while it still waits for the move to deliver it. */
export function heldFireFor(eventId: string): RunRecord | null {
  return (
    getDb()
      .select()
      .from(runs)
      .where(and(eq(runs.sourceEventId, eventId), eq(runs.status, 'queued'), eq(runs.statusReason, HELD_BY_MOVE)))
      .get() ?? null
  );
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
 * Mark a run cancelled — used when a human (or agent) stops a running agent
 * turn as part of a coordinated "stop workstream and change task". A cancelled
 * turn must never be recorded as a successful completion. Guarded to only affect
 * a queued/running run, so it never overwrites a run that already finished.
 */
export function markRunCancelled(id: string, reason: string | null = null): RunRecord | null {
  const current = getRun(id);
  if (!current) return null;
  if (current.status !== 'queued' && current.status !== 'running') return current;
  const completedAt = new Date().toISOString();
  const durationMs = current.startedAt
    ? Math.max(0, new Date(completedAt).getTime() - new Date(current.startedAt).getTime())
    : null;
  return updateRun(id, {
    status: 'cancelled',
    completedAt,
    durationMs,
    statusReason: reason,
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
 *
 * A run on a connected device is kept when a send was saved for it: its
 * turn didn't die with this process, or it's still waiting to be delivered,
 * and the worker reports how it ends. One with no send is a dispatch this
 * process was still preparing when it stopped. No worker ever heard of it,
 * so it's reaped like any other (docs/homes-build.md, P2 review fixes).
 *
 * A scheduled fire a move holds is kept too: its message is saved with the
 * move, which delivers it as the run once it settles (P3 re-check).
 */
export function reapStaleRunningRuns(): number {
  const db = getDb();
  const now = new Date().toISOString();
  const active = db
    .select({ id: runs.id, chatSessionId: runs.chatSessionId, status: runs.status, statusReason: runs.statusReason })
    .from(runs)
    .where(inArray(runs.status, ['queued', 'running']))
    .all();
  const ghosts = active
    .filter((r) => !(r.status === 'queued' && r.statusReason === HELD_BY_MOVE))
    .filter((r) => !r.chatSessionId || getChatDeviceId(r.chatSessionId) === null || !hasSendForRun(r.id))
    .map((r) => r.id);
  if (ghosts.length === 0) return 0;
  const result = db
    .update(runs)
    .set({
      status: 'failed',
      errorCode: 'process_restart',
      errorMessage: 'Process restarted while this run was active.',
      completedAt: now,
    })
    .where(and(inArray(runs.id, ghosts), inArray(runs.status, ['queued', 'running'])))
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
    .where(and(eq(runs.executionId, executionId), activeRun()))
    .get();
}

/**
 * Under way, for the concurrency gate: running, or a fire a move holds,
 * which runs once the move settles. Later fires then wait behind it rather
 * than pile up behind a stuck move (P3 re-check).
 */
function activeRun(): SQL {
  return or(eq(runs.status, 'running'), and(eq(runs.status, 'queued'), eq(runs.statusReason, HELD_BY_MOVE)))!;
}

/**
 * The run currently in flight in a chat, if any: the scheduled or webhook fire
 * that owns the chat's current turn. Manual chat sends create no run, so this
 * is null for them. Newest first, in case a stale row was left `running` by a
 * crash before boot recovery reaped it.
 */
export function findActiveRunForChatSession(chatSessionId: string): RunRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.chatSessionId, chatSessionId), inArray(runs.status, ['queued', 'running'])))
    .orderBy(desc(runs.createdAt))
    .get();
}

/**
 * Record entities a run changed, merged into `runs.artifactRefs` and deduped
 * by (kind, id). Read-merge-write inside one IMMEDIATE transaction, so two
 * writers (the server's MCP route and a CLI process in the harness's shell)
 * can't drop each other's refs. Returns the merged list, or null when the run
 * is gone.
 */
export function appendRunArtifactRefs(runId: string, refs: RunArtifactRef[]): RunArtifactRef[] | null {
  if (refs.length === 0) return getRun(runId)?.artifactRefs ?? null;
  const db = getDb();
  const merge = (): RunArtifactRef[] | null => {
    const current = db.select({ artifactRefs: runs.artifactRefs }).from(runs).where(eq(runs.id, runId)).get();
    if (!current) return null;
    const merged = new Map<string, RunArtifactRef>();
    for (const ref of [...(current.artifactRefs ?? []), ...refs]) merged.set(`${ref.kind}:${ref.id}`, ref);
    const next = [...merged.values()];
    db.update(runs).set({ artifactRefs: next }).where(eq(runs.id, runId)).run();
    return next;
  };
  // Already inside a caller's transaction: its lock covers us.
  if (getRawDb().inTransaction) return merge();
  return db.transaction(merge, { behavior: 'immediate' });
}

/** Per-trigger concurrency check (distinct from the execution mutex). */
export function findActiveRunForTrigger(triggerId: string): RunRecord | undefined {
  const db = getDb();
  return db
    .select()
    .from(runs)
    .where(and(eq(runs.triggerId, triggerId), activeRun()))
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

// ─── Notifications (docs/integrations-email-and-notifier-spec.md §2) ──────────────
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
    .values({ ...input, id: input.id ?? uuidv7(), enabled: input.enabled ?? true, createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now })
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

export function getWebPushSubscriptionByEndpoint(userId: string, endpoint: string): WebPushSubscriptionRecord | undefined {
  return getDb().select().from(webPushSubscriptions).where(and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.endpoint, endpoint))).get();
}

/** Explicit browser registration and channel creation commit together. Repairing
 * one browser never changes the user's existing channel or event preferences. */
export function registerWebPushSubscription(input: CreateWebPushSubscriptionInput & { userId: string }, events: string[]): boolean {
  const db = getDb();
  return db.transaction(() => {
    const existing = db.select().from(webPushSubscriptions).where(eq(webPushSubscriptions.endpoint, input.endpoint)).get();
    if (existing && existing.userId !== input.userId) return false;
    upsertWebPushSubscription(input);
    if (!listNotificationChannels({ userId: input.userId }).some(channel => channel.kind === 'web_push')) {
      createNotificationChannel({ userId: input.userId, kind: 'web_push', config: {}, events, enabled: true });
    }
    return true;
  }, { behavior: 'immediate' });
}

/** Browser-facing removal is scoped to its authenticated notification subject.
 * The provider adapter's expiry cleanup retains its endpoint-only helper. */
export function deleteWebPushSubscriptionForUser(userId: string, endpoint: string): boolean {
  return getDb().delete(webPushSubscriptions).where(and(eq(webPushSubscriptions.userId, userId), eq(webPushSubscriptions.endpoint, endpoint))).run().changes > 0;
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
    .values({ ...input, id: input.id ?? uuidv7(), status: input.status ?? 'pending', createdAt: input.createdAt ?? now, updatedAt: input.updatedAt ?? now })
    .onConflictDoNothing({ target: [notificationDeliveries.dedupeKey, notificationDeliveries.channelId] })
    .run();
  return result.changes > 0;
}

/** Deliveries still pending since before `before`: queued, committed, and never sent. */
export function listStrandedDeliveries(before: string): NotificationDeliveryRecord[] {
  return getDb()
    .select()
    .from(notificationDeliveries)
    .where(and(eq(notificationDeliveries.status, 'pending'), lt(notificationDeliveries.createdAt, before)))
    .all();
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

/** Delivery history for a user, with stable newest-first ordering. */
export function listNotificationDeliveries(userId: string, limit = 100): NotificationDeliveryRecord[] {
  return getDb()
    .select()
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.userId, userId))
    .orderBy(desc(notificationDeliveries.createdAt), desc(notificationDeliveries.id))
    .limit(limit)
    .all();
}

/** One deterministic local desktop destination per installation. Creating it
 * is explicit. A concurrent enable request preserves the user's event choices. */
export function enableDesktopNotificationChannel(id: string, userId: string, events: string[]): NotificationChannelRecord {
  const existing = getNotificationChannel(id);
  if (existing && (existing.userId !== userId || existing.kind !== 'in_app' || existing.config.surface !== 'desktop')) throw new Error('This desktop notification destination belongs to another channel.');
  const now = new Date().toISOString();
  return getDb().insert(notificationChannels).values({
    id, userId, kind: 'in_app', config: { surface: 'desktop' }, events, enabled: true,
    createdAt: now, updatedAt: now,
  }).onConflictDoUpdate({ target: notificationChannels.id, set: { enabled: true, updatedAt: now } }).returning().get();
}

/** Claim before crossing the OS boundary. A lost response or crashed presenter
 * has an unknown outcome and is deliberately never auto-replayed. This avoids
 * duplicate alerts across reconnects and overlapping desktop processes. */
export function claimDesktopNotificationDelivery(channelId: string, userId: string, since: string): NotificationDeliveryRecord | undefined {
  const db = getDb();
  return db.transaction(() => {
    const channel = getNotificationChannel(channelId);
    if (!channel?.enabled || channel.userId !== userId || channel.kind !== 'in_app' || channel.config.surface !== 'desktop') return;
    const now = new Date().toISOString();
    db.update(notificationDeliveries).set({ status: 'skipped', updatedAt: now, lastError: 'This desktop alert expired while the app was closed.' })
      .where(and(eq(notificationDeliveries.channelId, channelId), eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.status, 'pending'), lt(notificationDeliveries.createdAt, since))).run();
    const row = db.select().from(notificationDeliveries).where(and(
      eq(notificationDeliveries.channelId, channelId), eq(notificationDeliveries.userId, userId), eq(notificationDeliveries.status, 'pending'),
    )).orderBy(asc(notificationDeliveries.createdAt), asc(notificationDeliveries.id)).limit(1).get();
    if (!row) return;
    return db.update(notificationDeliveries).set({
      status: 'skipped', providerMessageId: `desktop:${uuidv7()}`, updatedAt: now,
      attempts: sql`${notificationDeliveries.attempts} + 1`,
      lastError: 'Desktop presentation was interrupted or has not been acknowledged. It will not be repeated automatically.',
      rendered: { title: row.event.title.slice(0, 160), body: row.event.body.slice(0, 1000), url: row.event.url.slice(0, 2048) },
    }).where(and(eq(notificationDeliveries.id, row.id), eq(notificationDeliveries.status, 'pending'))).returning().get();
  });
}

export function acknowledgeDesktopNotificationDelivery(input: {
  channelId: string; userId: string; id: string; receipt: string; status: 'sent' | 'failed' | 'skipped'; error?: string;
}): boolean {
  const now = new Date().toISOString();
  const changed = getDb().update(notificationDeliveries).set({
    status: input.status, providerMessageId: `ack:${input.receipt}`, updatedAt: now, ...(input.status === 'sent' ? { sentAt: now } : {}),
    lastError: input.status === 'sent' ? null : (input.error ?? 'The operating system did not confirm notification delivery.').slice(0, 1000),
  }).where(and(eq(notificationDeliveries.id, input.id), eq(notificationDeliveries.channelId, input.channelId),
    eq(notificationDeliveries.userId, input.userId), eq(notificationDeliveries.providerMessageId, input.receipt), eq(notificationDeliveries.status, 'skipped'))).run();
  return changed.changes > 0;
}

/** History is bounded and restricted to this native destination. It lets a
 * restarted Mac reattach safe click handlers to its OS notification history. */
export function desktopNotificationHistory(channelId: string, userId: string, since: string): NotificationDeliveryRecord[] {
  return getDb().select().from(notificationDeliveries).where(and(
    eq(notificationDeliveries.channelId, channelId), eq(notificationDeliveries.userId, userId),
    gte(notificationDeliveries.createdAt, since), isNotNull(notificationDeliveries.providerMessageId),
  )).orderBy(desc(notificationDeliveries.createdAt)).limit(50).all();
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

// ─── Skill chats ──────────────────────────────────────────────
//
// A skill's builder chat and try chats are content chats tagged with the
// skill's ref (`surfaceRef`, see src/lib/skills/locations.ts).

/** The content-chat kinds that belong to one skill: its builder chat and its try chats. */
export const SKILL_SURFACE_KINDS = ['skill', 'skill-try'] as const;

/** Move a skill's builder and try chats to its new ref (a rename or a move). */
export function renameSkillChats(fromRefs: readonly string[], toRef: string): void {
  if (fromRefs.length === 0) return;
  getDb()
    .update(chatSessions)
    .set({ surfaceRef: toRef })
    .where(and(
      eq(chatSessions.type, 'content'),
      inArray(chatSessions.surfaceKind, [...SKILL_SURFACE_KINDS]),
      inArray(chatSessions.surfaceRef, [...fromRefs]),
    ))
    .run();
}

/**
 * Whether anything was said in a skill's builder or try chats, archived ones
 * included. A blank draft nobody has talked about is safe to hand out again
 * as the next new skill.
 */
export function skillHasChatHistory(ref: string): boolean {
  const row = getDb()
    .select({ id: chatEvents.id })
    .from(chatEvents)
    .innerJoin(chatSessions, eq(chatEvents.sessionId, chatSessions.id))
    .where(and(
      eq(chatSessions.type, 'content'),
      inArray(chatSessions.surfaceKind, [...SKILL_SURFACE_KINDS]),
      eq(chatSessions.surfaceRef, ref),
    ))
    .limit(1)
    .get();
  return row !== undefined;
}

/** Active builder and try chats for a skill, newest first. */
export function listSkillChats(ref: string): ChatSessionRecord[] {
  return getDb()
    .select()
    .from(chatSessions)
    .where(and(
      eq(chatSessions.type, 'content'),
      inArray(chatSessions.surfaceKind, [...SKILL_SURFACE_KINDS]),
      eq(chatSessions.surfaceRef, ref),
      eq(chatSessions.status, 'active'),
    ))
    .orderBy(desc(chatSessions.createdAt))
    .all();
}

/** Recently viewed entities, projected for the launcher. */
export function getRecentEntities(limit = 10) {
  const db = getDb();
  // Fetch recently viewed tasks
  const recentTasks = db
    .select({
      id: tasks.id,
      title: tasks.title,
      entityType: sql<'task'>`'task'`.as('entityType'),
      lastViewedAt: tasks.lastViewedAt,
      hasBody: sql<boolean>`(length(trim(${tasks.body})) > 0)`.as('hasBody'),
    })
    .from(tasks)
    .where(isNotNull(tasks.lastViewedAt))
    .orderBy(desc(tasks.lastViewedAt))
    .limit(limit)
    .all();

  // Fetch recently viewed notes
  const recentNotes = db
    .select({
      id: notes.id,
      title: sql<string>`COALESCE(${notes.title}, substr(${notes.body}, 1, 60))`.as('title'),
      entityType: sql<'note'>`'note'`.as('entityType'),
      lastViewedAt: notes.lastViewedAt,
      hasBody: sql<boolean>`(length(trim(${notes.body})) > 0)`.as('hasBody'),
    })
    .from(notes)
    .where(isNotNull(notes.lastViewedAt))
    .orderBy(desc(notes.lastViewedAt))
    .limit(limit)
    .all();

  // Merge and sort by lastViewedAt, take top N
  const merged = [...recentTasks, ...recentNotes]
    .sort((a, b) => (b.lastViewedAt ?? '').localeCompare(a.lastViewedAt ?? ''))
    .slice(0, limit);

  return merged.map(item => ({ ...item, hasBody: Boolean(item.hasBody) }));
}

export function listDecks(limit = 10): DeckRecord[] {
  return getDb().select().from(decks).orderBy(desc(decks.createdAt)).limit(limit).all();
}

// ─── Work view (docs/work-view.md) ──────────────────────────────
//
// Read-only. The work ledger (src/lib/work/ledger.ts) walks chat_events by
// rowid, so it reads only rows added since its last pass, an imported
// transcript's old timestamps included.

export interface WorkEventRow {
  rowid: number;
  sessionId: string;
  createdAt: string;
  source: string;
  senderSessionId: string | null;
  /** Message text, only for user and agent rows (word counts). */
  text: string | null;
}

const WORK_EVENT_SOURCES_SQL =
  "('user','agent','tool_call','tool_result','thinking','result','approval_request','approval_response','error')";

// The columns the ledger reads. `sender_session_id` sits after `raw` in the
// row, so it's read only for user rows: reading it for every row can pull
// in each big row's overflow pages (AGENTS.md, "Query cost").
const WORK_EVENT_COLUMNS = `rowid, session_id AS sessionId, created_at AS createdAt, source,
  CASE WHEN source = 'user' THEN sender_session_id END AS senderSessionId,
  CASE WHEN source IN ('user', 'agent') THEN content END AS text`;

/** Bounded by the rowid itself: a range search from the cursor (plan pinned in a test). */
export const WORK_EVENTS_AFTER_ROWID_SQL = `SELECT ${WORK_EVENT_COLUMNS}
  FROM chat_events
  WHERE rowid > ? AND source IN ${WORK_EVENT_SOURCES_SQL}
  ORDER BY rowid
  LIMIT ?`;

/** One chat, by `idx_chat_events_session_created` (plan pinned in a test). */
export const WORK_EVENTS_FOR_SESSION_SQL = `SELECT ${WORK_EVENT_COLUMNS}
  FROM chat_events
  WHERE session_id = ? AND source IN ${WORK_EVENT_SOURCES_SQL}
  ORDER BY created_at, id`;

/** Work events after a rowid, oldest insert first. */
export function listWorkEventsAfterRowid(afterRowid: number, limit: number): WorkEventRow[] {
  return getRawDb().prepare(WORK_EVENTS_AFTER_ROWID_SQL).all(afterRowid, limit) as WorkEventRow[];
}

/** Every work event of one chat, by time (to rebuild its blocks after an import). */
export function listWorkEventsForSession(sessionId: string): WorkEventRow[] {
  return getRawDb().prepare(WORK_EVENTS_FOR_SESSION_SQL).all(sessionId) as WorkEventRow[];
}

export interface WorkSessionMetaRow {
  id: string;
  workspaceId: string | null;
  executionId: string | null;
  type: string;
  surfaceKind: string | null;
  createdByRunId: string | null;
  label: string | null;
  executionLabel: string | null;
}

/** What the work view needs about each chat: its agent, title and origin. */
export function listWorkSessionMeta(ids: readonly string[]): WorkSessionMetaRow[] {
  if (ids.length === 0) return [];
  const out: WorkSessionMetaRow[] = [];
  const stmt = getRawDb().prepare(
    `SELECT s.id, s.workspace_id AS workspaceId, s.execution_id AS executionId, s.type,
            s.surface_kind AS surfaceKind, s.created_by_run_id AS createdByRunId,
            s.label, x.label AS executionLabel
     FROM chat_sessions s
     LEFT JOIN executions x ON x.id = s.execution_id
     WHERE s.id IN (SELECT value FROM json_each(?))`,
  );
  // json_each keeps one statement for any number of ids. Chunked to bound the JSON.
  for (let i = 0; i < ids.length; i += 500) {
    out.push(...(stmt.all(JSON.stringify(ids.slice(i, i + 500))) as WorkSessionMetaRow[]));
  }
  return out;
}

/** Tasks completed in [from, to), ISO instants. */
export function listTasksCompletedBetween(from: string, to: string): Array<{ id: string; title: string; completedAt: string }> {
  return getRawDb()
    .prepare(
      `SELECT id, title, completed_at AS completedAt FROM tasks
       WHERE status = 'done' AND completed_at >= ? AND completed_at < ?
       ORDER BY completed_at`,
    )
    .all(from, to) as Array<{ id: string; title: string; completedAt: string }>;
}

/** Executions archived (finished) in [from, to), ISO instants. */
export function listExecutionsArchivedBetween(
  from: string,
  to: string,
): Array<{ id: string; label: string | null; workspaceId: string; archivedAt: string }> {
  return getRawDb()
    .prepare(
      `SELECT id, label, workspace_id AS workspaceId, archived_at AS archivedAt FROM executions
       WHERE archived_at >= ? AND archived_at < ?
       ORDER BY archived_at`,
    )
    .all(from, to) as Array<{ id: string; label: string | null; workspaceId: string; archivedAt: string }>;
}
