import { sqliteTable, text, integer, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { SnakeizeKeys } from '@/lib/case/keys';

// ─── Attachments ──────────────────────────────────────────────
// Generic file reference stored on any entity that can carry uploads.
// Files live in `<brain>/attachments/<fileName>`. See
// `src/lib/attachments/save.ts` for the write path and
// `src/lib/attachments/derive.ts` for the body→manifest sync.
//
// `Attachment` is the camelCase shape the app uses. `StoredAttachment` is
// the snake_case shape on disk in JSON columns — the app never sees this
// directly; `queries.ts` hydrates on read and dehydrates on write via
// `camelizeKeys` / `snakeizeKeys`. Keeping storage snake_case matches the
// SQL column convention so a direct DB inspection looks consistent.

export interface Attachment {
  /** UUIDv7-based storage filename, e.g. `01HXYZ.png`. Immutable. */
  fileName: string;
  /** Human-facing name from upload time, e.g. `Screenshot 2026-04-21.png`. */
  originalName: string;
  /** Normalized MIME type, e.g. `image/png`, `audio/webm`. */
  mimeType: string;
  /** File size in bytes. */
  size: number;
  /** ISO timestamp captured when the file was written to disk. */
  uploadedAt: string;
}

/** On-disk shape of an attachment inside a JSON column. */
export type StoredAttachment = SnakeizeKeys<Attachment>;

// ─── User State ────────────────────────────────────────────────

export const userState = sqliteTable('user_state', {
  id: integer().primaryKey(),
  name: text(),
  activeAreaId: text().references(() => areas.id),
  activeParentTaskId: text(),
  activeEnergy: text({ enum: ['deep', 'light'] }),
  availableMinutes: integer(),
  description: text().notNull().default(''),
  voiceAutoSend: integer({ mode: 'boolean' }).notNull().default(true),
  voiceModel: text().notNull().default('local/parakeet-tdt-0.6b-v3'),
  defaultAgentHarness: text({ enum: ['claude', 'codex'] }),
  defaultAgentModel: text(),
  onboardedAt: text(),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
});

// ─── Areas ────────────────────────────────────────────────────

export const areas = sqliteTable('areas', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  emoji: text(),
  attachments: text({ mode: 'json' }).$type<StoredAttachment[]>().default([]),
  notes: text(),
  userContext: text(),
  status: text({ enum: ['active', 'inactive', 'archived'] }).notNull().default('active'),
  sortOrder: integer().notNull().default(0),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
});

// ─── Stream ───────────────────────────────────────────────────

export const stream = sqliteTable('stream', {
  id: text().primaryKey(),
  rawText: text().notNull(),
  /** Which in-app surface/flow produced the item. Decoupled from media type. */
  source: text({ enum: ['capture', 'chat', 'webhook'] }).notNull().default('capture'),
  /** Original media format. Voice/image items were transcribed/OCR'd into `raw_text`. */
  media: text({ enum: ['text', 'voice', 'image'] }).notNull().default('text'),
  /** How the item entered the system. `internal` = user action in the app. */
  origin: text({ enum: ['internal', 'webhook', 'api'] }).notNull().default('internal'),
  /** External system that sent it (e.g. `pocket`). Null when origin='internal'. */
  externalSource: text(),
  /** Upstream id for dedupe on at-least-once deliveries. Null when origin='internal'. */
  externalId: text(),
  /** Full inbound payload for audit/replay. Null when origin='internal'. */
  externalPayload: text(),
  status: text({ enum: ['pending', 'promoted', 'dismissed'] }).notNull().default('pending'),
  dismissedBy: text(),
  promotedToType: text(),
  promotedToId: text(),
  promotedAt: text(),
  promotionPass: text(),
  /** Files attached to this stream item (e.g. raw audio when transcription
   *  failed or no STT provider was available). Derived on write from any
   *  references present in `raw_text`. */
  attachments: text({ mode: 'json' }).$type<StoredAttachment[]>().default([]),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('stream_external_id_idx').on(table.externalSource, table.externalId),
]);

// ─── Tasks ────────────────────────────────────────────────────

export const tasks = sqliteTable('tasks', {
  id: text().primaryKey(),
  parentId: text().references((): AnySQLiteColumn => tasks.id),
  areaId: text().references(() => areas.id),
  // Canonical workspace this task pertains to. Distinct from `area_id`:
  // areas are user-facing buckets ("Health"), workspaces are codebases
  // on disk. Auto-populated when a task is created from inside an
  // execution session (defaults from `chat_sessions.workspace_id`).
  workspaceId: text().references((): AnySQLiteColumn => workspaces.id, { onDelete: 'set null' }),
  rawInput: text().notNull(),
  streamItemId: text().references(() => stream.id),
  title: text().notNull(),
  description: text(),
  body: text(),
  userContext: text(),
  aiContext: text(),
  outcome: text(),
  heartbeatDays: integer(),
  lastProgressAt: text(),
  energy: text({ enum: ['deep', 'light'] }),
  effort: text({ enum: ['trivial', 'small', 'medium', 'large', 'epic'] }),
  estimatedMinutes: integer(),
  contextTags: text({ mode: 'json' }).$type<string[]>().default([]),
  hardDeadline: text(),
  reminderAt: text(),
  resurfaceAfter: text(),
  attachments: text({ mode: 'json' }).$type<StoredAttachment[]>().default([]),
  foldedHeadings: text({ mode: 'json' }).$type<string[]>().default([]),
  status: text({ enum: ['active', 'done', 'archived'] }).notNull().default('active'),
  sortKey: text(),
  blockedOn: text(),
  blockedSince: text(),
  recurrence: text(),
  nextRecurrenceAt: text(),
  targetFrequency: integer(),
  timesDeferred: integer().notNull().default(0),
  lastSurfacedAt: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
  completedAt: text(),
  lastViewedAt: text(),
}, (table) => [
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_area_id').on(table.areaId),
  index('idx_tasks_workspace_id').on(table.workspaceId),
  index('idx_tasks_parent_id').on(table.parentId),
  index('idx_tasks_sort_key').on(table.sortKey),
  index('idx_tasks_status_sort').on(table.status, table.sortKey),
]);

// ─── Task Completions ─────────────────────────────────────────

export const taskCompletions = sqliteTable('task_completions', {
  id: text().primaryKey(),
  taskId: text().notNull().references(() => tasks.id),
  completedAt: text().notNull().default(sql`(datetime('now'))`),
  note: text(),
}, (table) => [
  index('idx_task_completions_task_id').on(table.taskId),
]);

// ─── Decks ────────────────────────────────────────────────────

export const decks = sqliteTable('decks', {
  id: text().primaryKey(),
  context: text(),
  contextTags: text({ mode: 'json' }).$type<string[]>().default([]),
  framing: text(),
  items: text({ mode: 'json' }).$type<DeckItem[]>().notNull().default([]),
  alternatives: text({ mode: 'json' }).$type<DeckAlternative[]>().notNull().default([]),
  searchContext: text(),
  model: text(),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
});

export interface DeckItem {
  taskId: string;
  rationale: string;
  continuityContext: string | null;
  source: 'ai' | 'user';
}

export interface DeckAlternative {
  taskId: string;
  reason: string;
}

// ─── API Keys ─────────────────────────────────────────────────

export const apiKeys = sqliteTable('api_keys', {
  id: text().primaryKey(),
  name: text().notNull(),
  description: text(),
  deviceType: text({
    enum: ['host', 'computer', 'phone', 'tablet', 'service', 'other'],
  }).notNull().default('other'),
  prefix: text().notNull(),
  suffix: text().notNull(),
  hash: text().notNull().unique(),
  env: text({ enum: ['live', 'test'] }).notNull().default('live'),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
  expiresAt: text(),
  lastUsedAt: text(),
  lastUsedIp: text(),
  lastUsedUserAgent: text(),
  revokedAt: text(),
  revokedReason: text(),
}, (table) => [
  index('idx_api_keys_hash').on(table.hash),
  index('idx_api_keys_prefix').on(table.prefix),
  index('idx_api_keys_revoked').on(table.revokedAt),
]);

// ─── Workspaces ───────────────────────────────────────────────
// A workspace is a folder on disk the user organizes around. For git
// workspaces, every execution session gets its own worktree so concurrent
// sessions don't step on each other. Non-git workspaces share `cwd`.

export const workspaces = sqliteTable('workspaces', {
  id: text().primaryKey(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  emoji: text(),
  attachments: text({ mode: 'json' }).$type<StoredAttachment[]>().default([]),
  cwd: text().notNull(),
  isGit: integer({ mode: 'boolean' }).notNull().default(false),
  baseBranch: text(),
  remoteName: text().default('origin'),
  worktreeRoot: text(),
  // Globs to copy from `cwd` into each new session's worktree at creation
  // time. Picomatch dialect, dot-aware. `.env*` is the default so secrets
  // travel with the worktree without symlinking back to source.
  filesToCopy: text({ mode: 'json' }).$type<string[]>().notNull().default(['.env*']),
  // Preview pane wiring. Nullable across the board so legacy workspaces
  // resolve to "auto-detect command mode" without a backfill.
  //
  // `preview_mode` pins the mode: 'command' = Flow spawns the user's
  // preview_command and supervises it; 'portless' = Flow reads the
  // hostname's route from ~/.portless/routes.json and proxies to its
  // ephemeral port. Null means auto: prefer portless when both the
  // daemon is up and a matching route exists, else command.
  previewMode: text({ enum: ['command', 'portless'] }),
  previewCommand: text(),
  previewPortOverride: integer(),
  portlessHostname: text(),
  areaId: text().references(() => areas.id, { onDelete: 'set null' }),
  position: integer().notNull().default(0),
  collapsed: integer({ mode: 'boolean' }).notNull().default(false),
  status: text({ enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
  archivedAt: text(),
}, (table) => [
  index('idx_workspaces_status_position').on(table.status, table.position),
  index('idx_workspaces_area_id').on(table.areaId),
]);

// ─── Agents ───────────────────────────────────────────────────
// First-class definition for an agent persona. One row per executor
// (Claude, Codex, ...) or orchestrator. Sessions are instances of an agent
// running on something. `config` is harness-specific JSON.

export const agents = sqliteTable('agents', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  kind: text({ enum: ['orchestrator', 'executor'] }).notNull(),
  name: text().notNull(),
  role: text(),
  harness: text().notNull(),
  config: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  status: text({ enum: ['active', 'archived'] }).notNull().default('active'),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  archivedAt: text(),
}, (table) => [
  index('idx_agents_kind').on(table.kind),
  index('idx_agents_status').on(table.status),
]);

// ─── Executions ───────────────────────────────────────────────
// A durable work artifact anchored to a workspace: the worktree, branch,
// base SHA, PR linkage, provisioning state, and "take over locally"
// lifecycle. Distinct from a chat_session, which is a single conversation
// against the artifact — one execution can host many chats over its life
// (e.g. a recurring schedule starts a fresh chat each fire against the
// same worktree). See `docs/executions-spec.md`.
//
// These columns were lifted off `chat_sessions`; a chat now points at its
// execution via `chat_sessions.execution_id` (nullable — orchestration and
// content chats have no execution).

export const executions = sqliteTable('executions', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),

  // What this execution is anchored to. Required — executions are
  // workspace work artifacts. CASCADE: workspace deletion takes its
  // executions with it. The transitive cascade to chats is broken at
  // `chat_sessions.execution_id` (SET NULL) so transcripts survive the
  // workspace deletion as orphaned-but-readable history.
  workspaceId: text()
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),

  // Optional label. Most executions don't need one; recurring schedule
  // executions might be labeled "morning-triage" etc. for the UI.
  label: text(),

  // Durable git state — lifted from chat_sessions. All nullable because
  // executions exist before worktree provisioning completes (and non-git
  // workspaces never get these set — the agent runs from `workspace.cwd`).
  worktreePath: text(),
  branchName: text(),
  baseSha: text(),

  // Explicit PR link override — lifted from chat_sessions. See the column
  // comment on the (now-legacy) chat_sessions.pr_number for semantics.
  prNumber: integer(),

  // Worktree provisioning state — lifted from chat_sessions. `setup_error`
  // holds the last failure (null once the worktree exists); `setup_started_at`
  // anchors the "creating worktree… Ns" counter to the current attempt.
  setupError: text(),
  setupStartedAt: text(),

  // "Take over locally" lifecycle — lifted from chat_sessions. In takeover
  // iff `takeover_started_at IS NOT NULL`; all five clear together on
  // resume/cancel. The token authenticates the local CLI without the bearer
  // token and expires after one hour.
  takeoverStartedAt: text(),
  takeoverBaseSha: text(),
  takeoverBranch: text(),
  takeoverToken: text(),
  takeoverTokenExpiresAt: text(),

  status: text({ enum: ['active', 'archived'] }).notNull().default('active'),

  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
  archivedAt: text(),
}, (table) => [
  index('idx_executions_workspace_status').on(table.workspaceId, table.status),
  uniqueIndex('uniq_executions_takeover_token')
    .on(table.takeoverToken)
    .where(sql`${table.takeoverToken} IS NOT NULL`),
]);

// ─── Chat Sessions ────────────────────────────────────────────
// One row per chat thread. `type` discriminates: orchestration (main thread),
// content (scoped to a task/note), execution (CLI-backed work). Execution
// chats carry workspace_id and point at an `execution_id`; the durable
// git/worktree/PR/takeover state lives on the `executions` row, read back
// through `getChatSessionWithExecution`. They may carry external_session_id
// when bound to a CLI session.

export const chatSessions = sqliteTable('chat_sessions', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  agentId: text().notNull().references(() => agents.id),
  type: text({ enum: ['orchestration', 'content', 'execution'] }).notNull(),
  surfaceKind: text(),
  surfaceRef: text(),
  status: text({ enum: ['active', 'archived'] }).notNull().default('active'),
  label: text(),

  // Free-form scratch space scoped to this session. Markdown text the
  // user jots into during work — observations, error logs, half-formed
  // todos — without polluting global tasks/notes. Hydrated into the
  // agent's turn context when the user `@scratchpad`-mentions it in a
  // message (renders as a `[[scratchpad]]` marker in `chat_events.content`).
  scratchPad: text(),

  // Execution-specific fields.
  workspaceId: text().references(() => workspaces.id, { onDelete: 'set null' }),

  // The durable work artifact this chat belongs to. NULL for orchestration
  // and content chats. NOT NULL for active execution chats (see the
  // invariant in docs/executions-spec.md §2.2). ON DELETE SET NULL: if an
  // execution is ever hard-deleted (workspace deletion cascade), the chat
  // survives as an orphaned-but-readable transcript.
  executionId: text().references((): AnySQLiteColumn => executions.id, { onDelete: 'set null' }),

  // Review derivation (timestamp-only, no state column).
  //
  // `last_viewed_at` is the read receipt — bumped on user interaction
  // with the chat (textarea focus, send, explicit Mark read). Opening
  // the session no longer marks read on its own; the user has to engage
  // for the chat to leave the Unread bucket.
  //
  // `unread_marker_at` is the "Mark as unread" override. When set above
  // `last_viewed_at` it forces the session into Unread even when no new
  // agent outcome has landed. Cleared on the next Mark read / interaction.
  lastOutcomeEventAt: text(),
  lastViewedAt: text(),
  unreadMarkerAt: text(),

  // CLI-backed tracking; null for in-app sessions.
  externalSessionId: text(),
  externalTranscriptPath: text(),
  externalSyncOffset: integer(),
  externalSyncLastEventId: text(),

  // How tool permission requests are handled for this session. `bypass` is
  // the default — no flag passed to Claude, callback auto-allows everything.
  // `default | accept_edits | plan` map to Claude's --permission-mode flag
  // (default | acceptEdits | plan); the callback then surfaces prompts via
  // the pending-input UI. AskUserQuestion always surfaces regardless of mode.
  permissionMode: text({
    enum: ['bypass', 'default', 'accept_edits', 'plan'],
  }).notNull().default('bypass'),

  // Per-session model + effort overrides. Null = use the harness default.
  // For Claude these map to --model / --effort. For Codex --model only;
  // effort is ignored. Changing either recycles the cached AgentSession
  // so the next dispatch picks up the new flag.
  //
  // Effort enum values mirror Claude's `--effort` flag — `xhigh` and
  // `max` are the literal CLI values, not display strings.
  model: text(),
  effort: text({ enum: ['low', 'medium', 'high', 'xhigh', 'max'] }),

  // When entering plan mode we stash the prior permission_mode here so
  // ExitPlanMode can revert. Mirrors Claude Code's `prePlanMode` on
  // ToolPermissionContext. Cleared when a non-plan mode is set directly.
  prePlanMode: text({
    enum: ['bypass', 'default', 'accept_edits', 'plan'],
  }),

  startedAt: text().notNull().default(sql`(datetime('now'))`),
  archivedAt: text(),
}, (table) => [
  uniqueIndex('chat_sessions_external_session_id_uq')
    .on(table.externalSessionId)
    .where(sql`${table.externalSessionId} IS NOT NULL`),
  index('idx_chat_sessions_workspace_status')
    .on(table.workspaceId, table.status, table.lastOutcomeEventAt),
  index('idx_chat_sessions_agent_status').on(table.agentId, table.status),
  index('idx_chat_sessions_type_status').on(table.type, table.status),
  // Primary-chat lookup + per-execution rollups: "most-recently-active
  // non-archived chat for execution E" (docs/executions-spec.md §4).
  index('idx_chat_sessions_execution_status_activity')
    .on(table.executionId, table.status, table.lastOutcomeEventAt),
]);

// ─── Chat Events ──────────────────────────────────────────────
// One row per atomic thing that happened in a chat. Source enum
// distinguishes user/agent/thinking/tool_call/tool_result/system/result/etc.
// External_event_id makes idempotent upsert possible across retries.

export const chatEvents = sqliteTable('chat_events', {
  id: text().primaryKey(),
  sessionId: text().notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text().notNull(),
  source: text().notNull(),
  content: text(),
  toolName: text(),
  toolInput: text({ mode: 'json' }),
  toolIsError: integer({ mode: 'boolean' }),
  toolExitCode: integer(),
  raw: text({ mode: 'json' }),
  externalEventId: text(),
  externalMessageId: text(),
  externalTurnId: text(),
  externalToolCallId: text(),
  externalParentToolCallId: text(),
  sourcePartIndex: integer().notNull().default(0),
  // Files dropped/pasted/uploaded with this message. Same shape as
  // entity attachments (tasks/notes/areas) — references files in
  // <brain>/attachments/<file_name>. Marker tokens in `content`
  // (`[[file:<file_name>]]`) point at entries here so the chip's
  // position in the message is preserved on render.
  attachments: text({ mode: 'json' }).$type<StoredAttachment[]>().default([]),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  // Idempotent upsert key for CLI-backed events. Claude (JSONL uuid) and
  // Codex v2 (globally-unique item.id) both supply distinct external_event_id
  // values per row, so turn_id isn't needed for uniqueness here.
  uniqueIndex('chat_events_external_uq')
    .on(table.sessionId, table.externalEventId, table.sourcePartIndex)
    .where(sql`${table.externalEventId} IS NOT NULL`),
  index('idx_chat_events_session_created').on(table.sessionId, table.createdAt),
  index('idx_chat_events_tool_call_id').on(table.externalToolCallId),
]);

// ─── Notes ────────────────────────────────────────────────────

export const notes = sqliteTable('notes', {
  id: text().primaryKey(),
  areaId: text().references(() => areas.id),
  taskId: text().references(() => tasks.id),
  // Canonical workspace this note pertains to. Same role as
  // `tasks.workspace_id` — distinct from `area_id` and auto-populated
  // when the note is created from inside an execution session.
  workspaceId: text().references(() => workspaces.id, { onDelete: 'set null' }),
  title: text(),
  body: text().notNull(),
  url: text(),
  attachments: text({ mode: 'json' }).$type<StoredAttachment[]>().default([]),
  foldedHeadings: text({ mode: 'json' }).$type<string[]>().default([]),
  status: text({ enum: ['active', 'archived'] }).notNull().default('active'),
  contextTags: text({ mode: 'json' }).$type<string[]>().default([]),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
  lastViewedAt: text(),
}, (table) => [
  index('idx_notes_area_id').on(table.areaId),
  index('idx_notes_task_id').on(table.taskId),
  index('idx_notes_workspace_id').on(table.workspaceId),
  index('idx_notes_status').on(table.status),
]);

// ─── Chat Refs ────────────────────────────────────────────────
// M:N references from chat sessions (and individual events) to other
// entities. Two layers in one table:
//
//   - Session-level pin: `event_id IS NULL`. The entity stays in the
//     session's ambient context for every turn ("📎 pinned" strip).
//   - Per-message mention: `event_id` is set. The entity was named
//     inline in that message (`[[task:<id>]]`/`[[note:<id>]]` marker
//     in `chat_events.content`). The marker is the render token —
//     this row is the relational link so reverse queries ("which
//     messages reference task X?") work without a JSON scan.
//
// `entity_type` discriminates the target. `entity_id` is the target
// row id (or `Attachment.file_name` when `entity_type='file'`, since
// files have no row of their own — they live as JSON attachments on
// their owning entity).
//
// `hydrate` controls whether the orchestrator inlines the entity's
// body into the agent's turn. Default on for inline mentions; off
// is the escape hatch for "pinned for the human, not the agent".

export const chatRefs = sqliteTable('chat_refs', {
  id: text().primaryKey(),
  sessionId: text()
    .notNull()
    .references(() => chatSessions.id, { onDelete: 'cascade' }),
  eventId: text().references(() => chatEvents.id, { onDelete: 'cascade' }),
  // 'scratchpad' is a session-local reference. By convention `entity_id`
  // stores the owning `session_id` so reverse-lookup semantics stay
  // consistent with the other types.
  entityType: text({ enum: ['task', 'note', 'area', 'file', 'scratchpad'] }).notNull(),
  entityId: text().notNull(),
  position: integer().notNull().default(0),
  hydrate: integer({ mode: 'boolean' }).notNull().default(true),
  createdBy: text({ enum: ['user', 'agent'] }).notNull().default('user'),
  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  // Forward: list session pins (event_id IS NULL) or mentions for an event.
  index('idx_chat_refs_session_event').on(table.sessionId, table.eventId),
  // Reverse: where is this entity referenced?
  index('idx_chat_refs_entity').on(table.entityType, table.entityId),
  // One pin per (session, entity). Per-message mentions can repeat freely.
  uniqueIndex('chat_refs_session_pin_uq')
    .on(table.sessionId, table.entityType, table.entityId)
    .where(sql`${table.eventId} IS NULL`),
]);
