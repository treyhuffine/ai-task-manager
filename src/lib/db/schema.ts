import { sqliteTable, text, integer, real, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
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
  // Monthly spend ceiling in USD for scheduled + manual runs combined.
  // Null means no budget enforced. When `currentMonthSpend()` crosses
  // thresholds, dispatch behavior changes: <75% no-op, 75–99% warn in
  // TopHud, ≥100% scheduled runs auto-pause (`schedules.disabledReason =
  // 'budget_exceeded'`) and manual sends require an explicit confirm.
  // See docs/async-agents-v1.md §4.7.
  monthlyBudgetUsd: real(),
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
  // travel with the worktree without symlinking back to source. (Beamd's
  // gitignored `.beamd.local` is also copied — see `ALWAYS_COPY_TO_WORKTREE`.)
  filesToCopy: text({ mode: 'json' }).$type<string[]>().notNull().default(['.env*']),
  // Worktree lifecycle scripts (all optional). Flow runs each as `sh -lc` in
  // the execution's worktree, with $FLOW_SOURCE_CHECKOUT_PATH /
  // $FLOW_WORKTREE_PATH / $FLOW_BRANCH_NAME exported. Flow stays
  // strategy-agnostic — the project decides what these do (install deps, copy
  // caches, run migrations, codegen, …).
  //   setupCommand    — runs once after the worktree is created (post file-copy).
  //   teardownCommand — runs on archive, before the worktree is removed.
  setupCommand: text(),
  teardownCommand: text(),
  // The dev command that *starts* the worktree's server for previews. Flow runs
  // it in the worktree, auto-assigns a stable port (injected as `PORT`), and
  // confirms it's listening. How a preview is *reached* (localhost vs a remote
  // provider) is a global setting, not a per-workspace mode — see
  // `preview_targets` + docs/preview-system-spec.md. (Renamed from
  // `previewCommand`; matches `preview_targets.startCommand`.)
  startCommand: text(),
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

  // Setup *script* state (the workspace's `setupCommand`). Runs in the
  // BACKGROUND once the worktree is ready, so chat is available immediately —
  // distinct from the (faster) worktree provisioning above. `setupScriptStatus`
  // drives the "Running setup script…" indicator; `setupScriptError` holds the
  // last failure's output tail. Null status = no script / not started.
  setupScriptStatus: text({ enum: ['running', 'done', 'failed'] }),
  setupScriptError: text(),

  // "Take over locally" lifecycle — lifted from chat_sessions. In takeover
  // iff `takeover_started_at IS NOT NULL`; all six clear together on
  // resume/cancel. The token authenticates the local CLI without the bearer
  // token and expires after one hour.
  //
  // `takeoverChatSessionId` records the chat that initiated the takeover
  // so the resume handoff lands in the exact chat the user started in —
  // a workspace execution can have multiple sibling chats (scheduled
  // fires accumulate them) and "most-recently-active" can pick the
  // wrong one once that happens. ON DELETE SET NULL keeps the
  // execution-side state valid if the initiating chat is ever hard-
  // deleted. Legacy executions with NULL fall back to the old "most-
  // recent active chat" heuristic in `findChatSessionByTakeoverToken`.
  takeoverStartedAt: text(),
  takeoverBaseSha: text(),
  takeoverBranch: text(),
  takeoverToken: text(),
  takeoverTokenExpiresAt: text(),
  takeoverChatSessionId: text().references((): AnySQLiteColumn => chatSessions.id, { onDelete: 'set null' }),

  // Manually-pasted preview URLs (BYO tunnel — ngrok/cloudflared/whatever).
  // The user runs their own tunnel and pastes the URL; Flow stores it and
  // the ManualProvider serves it for the preview. A small list so a
  // multi-service worktree can carry one URL per service (`service: null`
  // is the default/only service). See docs/preview-system-spec.md §6 and
  // the `PreviewUrl` shape below.
  previewUrls: text({ mode: 'json' }).$type<PreviewUrl[]>().notNull().default([]),

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

/**
 * One manually-pasted preview URL on an execution. `service` scopes it to a
 * named service in a multi-service worktree (`null` = the default/only app).
 * `label` is optional human text for the picker ("staging", "ngrok").
 */
export interface PreviewUrl {
  service: string | null;
  url: string;
  label: string | null;
}

// ─── Preview Targets ──────────────────────────────────────────
// The per-worktree (per-execution, optionally per-service) *desired-state*
// record for the preview system: how to (re)start the dev server, the
// stable port it should listen on, and the DNS label its tunnel is named
// after. This is the source of truth for "what should be running" — only
// Flow knows the start command, and a tunnel to a dead port is a useless
// URL, so Flow owns desired state and beamd stays stateless about it.
//
//   - The start command comes from the workspace (`workspaces.startCommand`):
//     one source of truth, so lazy revival can always (re)launch the server.
//   - `port` is stable: a restart reuses it, so the URL stays stable. Null
//     until first allocation.
//   - `previewName` is the single DNS label (`<worktree>[-<service>]`) the
//     beamd/portless tunnel is named after (see src/lib/preview/preview-name).
//   - `pinned` opts a target into eager bring-up on host boot (the
//     restore-set). Default false — never bring up everything or you melt
//     the host.
//   - `lastViewedAt` drives idle-evict: stop the server + close the tunnel
//     after N idle minutes; the name/URL stays reserved so it cold-starts
//     again on next view.
//
// See docs/preview-system-spec.md §2.

export const previewTargets = sqliteTable('preview_targets', {
  id: text().primaryKey(),

  // The worktree this preview is for. CASCADE: deleting the execution
  // (e.g. via workspace deletion) drops its preview targets.
  executionId: text()
    .notNull()
    .references(() => executions.id, { onDelete: 'cascade' }),

  // Named service within a multi-service worktree. Null = the default/only
  // app. The (executionId, service) pair is unique — enforced by two
  // partial indexes because SQLite treats NULLs as distinct in a plain
  // unique index (so UNIQUE(executionId, service) would allow duplicate
  // default rows).
  service: text(),

  previewName: text().notNull(),
  port: integer(),
  pinned: integer({ mode: 'boolean' }).notNull().default(false),

  lastViewedAt: text(),

  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_preview_targets_execution').on(table.executionId),
  uniqueIndex('uniq_preview_targets_exec_default')
    .on(table.executionId)
    .where(sql`${table.service} IS NULL`),
  uniqueIndex('uniq_preview_targets_exec_service')
    .on(table.executionId, table.service)
    .where(sql`${table.service} IS NOT NULL`),
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

  // Provenance: the run that created this chat. NULL for chats the user
  // opened directly without a run kicking them off (manual chat send from
  // the composer, scratch sessions, etc.). Subsequent runs against this
  // chat are tracked via `runs.chatSessionId` — this field is set once at
  // chat creation and never mutated. ON DELETE SET NULL preserves the
  // chat if the originating run is ever deleted. See
  // docs/async-agents-v1.md §4.3.
  createdByRunId: text().references((): AnySQLiteColumn => runs.id, { onDelete: 'set null' }),

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

// ─── Schedules ────────────────────────────────────────────────
// A schedule is "fire under these conditions." User-editable. The 60s
// scheduler tick (src/lib/scheduler/runner.ts) reads `nextRunAt <= now`,
// advances it first (at-most-once), then dispatches a run. Cost,
// transcripts, and outcome live on `runs` and `chatSessions`; this row
// just describes the trigger.
//
// Dispatch behavior is derived from `kind` + `targetKind` (no
// session_strategy enum) — see docs/executions-spec.md §6 and
// docs/async-agents-v1.md §4.3.

export const schedules = sqliteTable('schedules', {
  id: text().primaryKey(),
  userId: text().notNull().default('local'),
  name: text().notNull(),
  description: text(),
  enabled: integer({ mode: 'boolean' }).notNull().default(true),

  // What runs and where. `agentId` is required at the row level; the form
  // defaults it from the workspace's bound executor or the orchestrator
  // agent depending on targetKind.
  agentId: text().notNull().references(() => agents.id),
  workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
  targetKind: text({ enum: ['workspace', 'orchestrator'] }).notNull(),

  // The thing to do when fired.
  prompt: text().notNull(),
  // V2 — stored but NOT honored at runtime today. The executor adapter
  // currently passes ALL discovered skills via `skillDirs` (see
  // resolveSkillDirsForSession in src/lib/executor/skills.ts), so the
  // agent's auto-loader already has full inventory and `skillHints`
  // would be redundant. The column lives so the create surface can
  // accept it without a migration once we add runtime use (e.g.
  // filtering skillDirs to only the listed names, or surfacing the
  // intent in the agent's prompt envelope).
  skillHints: text({ mode: 'json' }).$type<string[]>(),

  // Trigger kind. Exactly one of cron_expression / interval_seconds /
  // run_at / (webhook_public_id + webhook_secret_hash) is populated for
  // the matching kind. Validated in the orchestrator action layer (see
  // task #19 / src/lib/scheduler/cron.ts validateCronExpression).
  // 'manual' = no automatic firing; only the "Run now" button + the
  // `run_schedule` action invoke it. nextRunAt stays null forever for
  // manual rows so the tick query never picks them up. Lets a user
  // save a "scheduled task" without committing to a cadence — they
  // can fire it ad-hoc, or convert to a real schedule later by
  // editing the kind.
  kind: text({ enum: ['manual', 'at', 'every', 'cron', 'webhook'] }).notNull(),
  cronExpression: text(),
  intervalSeconds: integer(),
  runAt: text(),
  timezone: text().default('UTC'),

  // Optional "only fire during business hours" window. `HH:MM` strings
  // interpreted in `timezone`. Tick skips dispatch when current time in
  // tz is outside the window. Heartbeat (V2) will lean on this heavily.
  activeHoursStart: text(),
  activeHoursEnd: text(),

  // When a previous run for THIS schedule is still active.
  // skip_if_running        — record this fire as 'skipped', reason 'schedule_busy'
  // coalesce_if_active     — (default) append prompt to the active run's chat
  // allow_concurrent       — spawn a new run alongside the existing one
  // Distinct from the execution-level mutex (cross-schedule, same
  // execution); see docs/executions-spec.md §5.
  concurrencyPolicy: text({
    enum: ['skip_if_running', 'coalesce_if_active', 'allow_concurrent'],
  }).notNull().default('coalesce_if_active'),

  // V2 — stored but NOT honored at runtime today. The runner currently
  // fires a missed slot at most once on the next tick regardless of
  // policy (behaves like `skip_missed`). The column ships so the
  // create surface can accept it without a migration once the runner
  // grows a catch-up loop. See src/lib/scheduler/runner.ts.
  //
  // skip_missed (default)  — drop missed slots, set nextRunAt to next future fire
  // run_all (V2)           — fire once per missed window, capped at maxCatchUpRuns
  catchUpPolicy: text({
    enum: ['skip_missed', 'run_all'],
  }).notNull().default('skip_missed'),
  maxCatchUpRuns: integer().notNull().default(3),

  // Schedule → execution ownership. The FK lives on the schedule (not on
  // executions) so many schedules can point at one execution — morning-
  // triage + evening-summary writing into the same workspace artifact
  // falls out without a unique-constraint workaround. ON DELETE SET
  // NULL: archiving/deleting the execution doesn't break the schedule;
  // next fire creates a fresh execution. See docs/executions-spec.md
  // §2.3. NULL for one-off (`kind='at'`) and orchestrator schedules.
  owningExecutionId: text().references(() => executions.id, { onDelete: 'set null' }),

  // Webhook intake (kind='webhook' only). publicId is the path segment
  // at /api/triggers/<publicId>; secretHash is bcrypt'd HMAC key.
  // Verified via HMAC-SHA256 over the raw request body.
  webhookPublicId: text(),
  webhookSecretHash: text(),

  // Per-run overrides applied to the dispatched session. Null = inherit
  // the harness default.
  model: text(),
  effort: text({ enum: ['low', 'medium', 'high', 'xhigh', 'max'] }),
  // Optional hard cap on wall-clock runtime per fire. NULL = no
  // timeout (the default for new schedules); positive int = seconds.
  // The honest signal for "is this run stuck" lives in the observe-
  // run primitive (`src/lib/runs/observe.ts`) — wall-clock timeouts
  // are a blunt safety net for the rare case where the user
  // explicitly wants to cap a misbehaving schedule. Existing rows
  // with the legacy 900s default keep their behavior until edited.
  timeoutSeconds: integer(),

  // Scheduler bookkeeping. nextRunAt is advanced atomically by the tick
  // BEFORE dispatch — that's the at-most-once guarantee. lastRunStatus
  // captures the most recent outcome for fast list rendering without
  // joining runs.
  nextRunAt: text(),
  lastFiredAt: text(),
  lastRunId: text(),
  lastRunStatus: text({
    enum: ['completed', 'failed', 'skipped'],
  }),
  // Bumped on failed run, reset to 0 on completed. >= 3 surfaces a
  // banner; no auto-pause (silent failure is worse than surfaced
  // failure). See task #25.
  consecutiveFailures: integer().notNull().default(0),
  // Why the schedule is disabled. Populated only when `enabled=false`
  // and the source was automatic (budget guard, manual pause leaves
  // null). Used by the schedule detail view to render context.
  disabledReason: text(),

  createdAt: text().notNull().default(sql`(datetime('now'))`),
  updatedAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  // Name uniqueness — two PARTIAL unique indexes (not one composite).
  // SQLite treats NULLs in unique indexes as distinct, so a plain
  // UNIQUE(workspaceId, name) would silently allow duplicate
  // brain-level (workspaceId IS NULL) names.
  uniqueIndex('uniq_schedules_brain_name')
    .on(table.name)
    .where(sql`${table.workspaceId} IS NULL`),
  uniqueIndex('uniq_schedules_workspace_name')
    .on(table.workspaceId, table.name)
    .where(sql`${table.workspaceId} IS NOT NULL`),
  // Hot path for the tick: enabled schedules due to fire.
  index('idx_schedules_enabled_next_run').on(table.enabled, table.nextRunAt),
  // Webhook intake lookup by public id.
  uniqueIndex('uniq_schedules_webhook_public_id')
    .on(table.webhookPublicId)
    .where(sql`${table.webhookPublicId} IS NOT NULL`),
  index('idx_schedules_workspace_status').on(table.workspaceId, table.enabled),
]);

// ─── Runs ─────────────────────────────────────────────────────
// A run is "this execution happened (or is happening)." UNIFIED across
// all dispatch sources: every executor.dispatch() call creates a row,
// whether the dispatch came from the scheduler tick, a webhook, or a
// user chat send. Without this, manual chat is invisible to spend
// tracking and the budget guardrail lies. See docs/async-agents-v1.md
// §4.3.

export const runs = sqliteTable('runs', {
  id: text().primaryKey(),
  // Which schedule fired this (null for manual chat sends).
  scheduleId: text().references(() => schedules.id, { onDelete: 'set null' }),
  // Denormalized FKs for cheap rollups. workspaceId is null for
  // orchestrator-target runs; executionId follows the chat's executionId
  // (null for orchestration/content chats).
  workspaceId: text().references(() => workspaces.id, { onDelete: 'set null' }),
  executionId: text().references(() => executions.id, { onDelete: 'set null' }),
  // The chat where the transcript lives.
  chatSessionId: text().references(() => chatSessions.id, { onDelete: 'set null' }),
  // The agent that ran. Carried for grouping/spend-by-agent without a
  // join through chatSessions.
  agentId: text().notNull().references(() => agents.id),

  // What kicked this off. 'manual' = user chat send, the rest are
  // scheduler-driven.
  trigger: text({
    enum: ['manual', 'cron', 'every', 'at', 'webhook'],
  }).notNull(),
  // Verbatim payload for webhook triggers (so the prompt can reference
  // it via context), kept as JSON for any future structured triggers.
  triggerPayload: text({ mode: 'json' }).$type<Record<string, unknown> | string | null>(),
  // For scheduler-driven runs, the wall-clock time the slot fired (the
  // tick's idea of "now"). Null for manual + webhook.
  scheduledFor: text(),

  // Simple status enum — no awaiting_input/blocked vocabulary in V1
  // (multi-state action protocol is V2+). statusReason captures
  // structured codes for skip/fail flavors.
  status: text({
    enum: ['queued', 'running', 'completed', 'failed', 'skipped'],
  }).notNull().default('queued'),
  statusReason: text(),

  // Lifecycle timestamps. queuedAt is always set; startedAt fires when
  // the run transitions queued → running; completedAt + durationMs
  // populate together at terminal.
  queuedAt: text().notNull().default(sql`(datetime('now'))`),
  startedAt: text(),
  completedAt: text(),
  durationMs: integer(),

  // Usage rollup from @agentex/agent's `result` event. costUsd prefers
  // the SDK's reported value when present (Anthropic) and falls back to
  // the in-repo pricing table (src/lib/pricing/models.ts) for providers
  // that don't supply one.
  model: text(),
  inputTokens: integer().default(0),
  outputTokens: integer().default(0),
  cachedInputTokens: integer().default(0),
  cacheCreationInputTokens: integer().default(0),
  costUsd: real().default(0),

  // Auto-extracted from the last assistant message at terminal (task
  // #15). NULL when the run failed before any assistant turn.
  summary: text(),
  // Inferred from successful mutating action calls during the run (task
  // #14). `[{kind:'task', id:'...'}, {kind:'note', id:'...'}, ...]`.
  // Deduped by (kind, id).
  artifactRefs: text({ mode: 'json' }).$type<RunArtifactRef[]>(),

  // Failure metadata. errorCode for stable program-readable categories
  // (process_restart, timeout, agent_error, ...), errorMessage for the
  // human-readable detail.
  errorCode: text(),
  errorMessage: text(),

  createdAt: text().notNull().default(sql`(datetime('now'))`),
}, (table) => [
  // Per-schedule history.
  index('idx_runs_schedule_status').on(table.scheduleId, table.status),
  // "what's currently running" + "today's spend" lookups.
  index('idx_runs_status_started').on(table.status, table.startedAt),
  // Filter pills on the runs view.
  index('idx_runs_trigger_started').on(table.trigger, table.startedAt),
  // Execution-level run mutex check — at most one workspace run per
  // execution may be `status='running'` at any time. The mutex is the
  // reason this index exists; it's the hot path. See
  // docs/executions-spec.md §5.
  index('idx_runs_execution_status').on(table.executionId, table.status),
]);

/**
 * Entity reference accumulated into `runs.artifactRefs` when a run's
 * orchestrator successfully calls a mutating action. Kind matches the
 * entity surface in the action registry; id is the row id of the
 * affected entity (or a sentinel like `MEMORY.md` for the memory file).
 */
export interface RunArtifactRef {
  kind: 'task' | 'note' | 'workspace' | 'memory';
  id: string;
}
