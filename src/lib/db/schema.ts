import { sqliteTable, text, integer, blob, index, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── Attachments ──────────────────────────────────────────────
// Generic file reference stored on any entity that can carry uploads.
// Files live in `<brain>/attachments/<file_name>`. See
// `src/lib/attachments/save.ts` for the write path and
// `src/lib/attachments/derive.ts` for the body→manifest sync.

export interface Attachment {
  /** UUIDv7-based storage filename, e.g. `01HXYZ.png`. Immutable. */
  file_name: string;
  /** Human-facing name from upload time, e.g. `Screenshot 2026-04-21.png`. */
  original_name: string;
  /** Normalized MIME type, e.g. `image/png`, `audio/webm`. */
  mime_type: string;
  /** File size in bytes. */
  size: number;
  /** ISO timestamp captured when the file was written to disk. */
  uploaded_at: string;
}

// ─── User State ────────────────────────────────────────────────

export const userState = sqliteTable('user_state', {
  id: integer('id').primaryKey(),
  name: text('name'),
  active_area_id: text('active_area_id').references(() => areas.id),
  active_parent_task_id: text('active_parent_task_id'),
  active_energy: text('active_energy', { enum: ['deep', 'light'] }),
  available_minutes: integer('available_minutes'),
  description: text('description').notNull().default(''),
  voice_auto_send: integer('voice_auto_send', { mode: 'boolean' }).notNull().default(true),
  voice_model: text('voice_model').notNull().default('local/parakeet-tdt-0.6b-v3'),
  default_agent_harness: text('default_agent_harness', { enum: ['claude', 'codex'] }),
  default_agent_model: text('default_agent_model'),
  onboarded_at: text('onboarded_at'),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ─── Areas ────────────────────────────────────────────────────

export const areas = sqliteTable('areas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  emoji: text('emoji'),
  attachments: text('attachments', { mode: 'json' }).$type<Attachment[]>().default([]),
  notes: text('notes'),
  user_context: text('user_context'),
  status: text('status', { enum: ['active', 'inactive', 'archived'] }).notNull().default('active'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ─── Stream ───────────────────────────────────────────────────

export const stream = sqliteTable('stream', {
  id: text('id').primaryKey(),
  raw_text: text('raw_text').notNull(),
  /** Which in-app surface/flow produced the item. Decoupled from media type. */
  source: text('source', { enum: ['capture', 'chat', 'webhook'] }).notNull().default('capture'),
  /** Original media format. Voice/image items were transcribed/OCR'd into `raw_text`. */
  media: text('media', { enum: ['text', 'voice', 'image'] }).notNull().default('text'),
  /** How the item entered the system. `internal` = user action in the app. */
  origin: text('origin', { enum: ['internal', 'webhook', 'api'] }).notNull().default('internal'),
  /** External system that sent it (e.g. `pocket`). Null when origin='internal'. */
  external_source: text('external_source'),
  /** Upstream id for dedupe on at-least-once deliveries. Null when origin='internal'. */
  external_id: text('external_id'),
  /** Full inbound payload for audit/replay. Null when origin='internal'. */
  external_payload: text('external_payload'),
  status: text('status', { enum: ['pending', 'promoted', 'dismissed'] }).notNull().default('pending'),
  dismissed_by: text('dismissed_by'),
  promoted_to_type: text('promoted_to_type'),
  promoted_to_id: text('promoted_to_id'),
  promoted_at: text('promoted_at'),
  promotion_pass: text('promotion_pass'),
  /** Files attached to this stream item (e.g. raw audio when transcription
   *  failed or no STT provider was available). Derived on write from any
   *  references present in `raw_text`. */
  attachments: text('attachments', { mode: 'json' }).$type<Attachment[]>().default([]),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('stream_external_id_idx').on(table.external_source, table.external_id),
]);

// ─── Tasks ────────────────────────────────────────────────────

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  parent_id: text('parent_id').references((): AnySQLiteColumn => tasks.id),
  area_id: text('area_id').references(() => areas.id),
  raw_input: text('raw_input').notNull(),
  stream_item_id: text('stream_item_id').references(() => stream.id),
  title: text('title').notNull(),
  description: text('description'),
  body: text('body'),
  user_context: text('user_context'),
  ai_context: text('ai_context'),
  outcome: text('outcome'),
  heartbeat_days: integer('heartbeat_days'),
  last_progress_at: text('last_progress_at'),
  energy: text('energy', { enum: ['deep', 'light'] }),
  effort: text('effort', { enum: ['trivial', 'small', 'medium', 'large', 'epic'] }),
  estimated_minutes: integer('estimated_minutes'),
  context_tags: text('context_tags', { mode: 'json' }).$type<string[]>().default([]),
  hard_deadline: text('hard_deadline'),
  reminder_at: text('reminder_at'),
  resurface_after: text('resurface_after'),
  attachments: text('attachments', { mode: 'json' }).$type<Attachment[]>().default([]),
  status: text('status', { enum: ['active', 'done', 'archived'] }).notNull().default('active'),
  sort_key: text('sort_key'),
  blocked_on: text('blocked_on'),
  blocked_since: text('blocked_since'),
  recurrence: text('recurrence'),
  next_recurrence_at: text('next_recurrence_at'),
  target_frequency: integer('target_frequency'),
  times_deferred: integer('times_deferred').notNull().default(0),
  last_surfaced_at: text('last_surfaced_at'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  completed_at: text('completed_at'),
  last_viewed_at: text('last_viewed_at'),
}, (table) => [
  index('idx_tasks_status').on(table.status),
  index('idx_tasks_area_id').on(table.area_id),
  index('idx_tasks_parent_id').on(table.parent_id),
  index('idx_tasks_sort_key').on(table.sort_key),
  index('idx_tasks_status_sort').on(table.status, table.sort_key),
]);

// ─── Task Completions ─────────────────────────────────────────

export const taskCompletions = sqliteTable('task_completions', {
  id: text('id').primaryKey(),
  task_id: text('task_id').notNull().references(() => tasks.id),
  completed_at: text('completed_at').notNull().default(sql`(datetime('now'))`),
  note: text('note'),
}, (table) => [
  index('idx_task_completions_task_id').on(table.task_id),
]);

// ─── Decks ────────────────────────────────────────────────────

export const decks = sqliteTable('decks', {
  id: text('id').primaryKey(),
  context: text('context'),
  context_tags: text('context_tags', { mode: 'json' }).$type<string[]>().default([]),
  framing: text('framing'),
  items: text('items', { mode: 'json' }).$type<DeckItem[]>().notNull().default([]),
  alternatives: text('alternatives', { mode: 'json' }).$type<DeckAlternative[]>().notNull().default([]),
  search_context: text('search_context'),
  model: text('model'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
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
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  device_type: text('device_type', {
    enum: ['host', 'computer', 'phone', 'tablet', 'service', 'other'],
  }).notNull().default('other'),
  prefix: text('prefix').notNull(),
  suffix: text('suffix').notNull(),
  hash: text('hash').notNull().unique(),
  env: text('env', { enum: ['live', 'test'] }).notNull().default('live'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  expires_at: text('expires_at'),
  last_used_at: text('last_used_at'),
  last_used_ip: text('last_used_ip'),
  last_used_user_agent: text('last_used_user_agent'),
  revoked_at: text('revoked_at'),
  revoked_reason: text('revoked_reason'),
}, (table) => [
  index('idx_api_keys_hash').on(table.hash),
  index('idx_api_keys_prefix').on(table.prefix),
  index('idx_api_keys_revoked').on(table.revoked_at),
]);

// ─── Workspaces ───────────────────────────────────────────────
// A workspace is a folder on disk the user organizes around. For git
// workspaces, every execution session gets its own worktree so concurrent
// sessions don't step on each other. Non-git workspaces share `cwd`.

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  emoji: text('emoji'),
  attachments: text('attachments', { mode: 'json' }).$type<Attachment[]>().default([]),
  cwd: text('cwd').notNull(),
  is_git: integer('is_git', { mode: 'boolean' }).notNull().default(false),
  base_branch: text('base_branch'),
  remote_name: text('remote_name').default('origin'),
  worktree_root: text('worktree_root'),
  // Globs to copy from `cwd` into each new session's worktree at creation
  // time. Picomatch dialect, dot-aware. `.env*` is the default so secrets
  // travel with the worktree without symlinking back to source.
  files_to_copy: text('files_to_copy', { mode: 'json' }).$type<string[]>().notNull().default(['.env*']),
  area_id: text('area_id').references(() => areas.id, { onDelete: 'set null' }),
  position: integer('position').notNull().default(0),
  collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
}, (table) => [
  index('idx_workspaces_status_position').on(table.status, table.position),
  index('idx_workspaces_area_id').on(table.area_id),
]);

// ─── Agents ───────────────────────────────────────────────────
// First-class definition for an agent persona. One row per executor
// (Claude, Codex, ...) or orchestrator. Sessions are instances of an agent
// running on something. `config` is harness-specific JSON.

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().default('local'),
  kind: text('kind', { enum: ['orchestrator', 'executor'] }).notNull(),
  name: text('name').notNull(),
  role: text('role'),
  harness: text('harness').notNull(),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
}, (table) => [
  index('idx_agents_kind').on(table.kind),
  index('idx_agents_status').on(table.status),
]);

// ─── Chat Sessions ────────────────────────────────────────────
// One row per chat thread. `type` discriminates: orchestration (main thread),
// content (scoped to a task/note), execution (CLI-backed work). Execution
// sessions populate workspace_id + worktree_path + base_sha and may carry
// external_session_id when bound to a CLI session.

export const chatSessions = sqliteTable('chat_sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().default('local'),
  agent_id: text('agent_id').notNull().references(() => agents.id),
  type: text('type', { enum: ['orchestration', 'content', 'execution'] }).notNull(),
  surface_kind: text('surface_kind'),
  surface_ref: text('surface_ref'),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  label: text('label'),
  refs: text('refs', { mode: 'json' })
    .$type<{ task_ids?: string[]; note_ids?: string[]; area_ids?: string[] }>()
    .notNull()
    .default({}),

  // Execution-specific fields.
  workspace_id: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  worktree_path: text('worktree_path'),
  branch_name: text('branch_name'),
  base_sha: text('base_sha'),

  // Review derivation (timestamp-only, no state column).
  last_outcome_event_at: text('last_outcome_event_at'),
  last_viewed_at: text('last_viewed_at'),

  // CLI-backed tracking; null for in-app sessions.
  external_session_id: text('external_session_id'),
  external_transcript_path: text('external_transcript_path'),
  external_sync_offset: integer('external_sync_offset'),
  external_sync_last_event_id: text('external_sync_last_event_id'),

  // How tool permission requests are handled for this session. `bypass` is
  // the default — no flag passed to Claude, callback auto-allows everything.
  // `default | accept_edits | plan` map to Claude's --permission-mode flag
  // (default | acceptEdits | plan); the callback then surfaces prompts via
  // the pending-input UI. AskUserQuestion always surfaces regardless of mode.
  permission_mode: text('permission_mode', {
    enum: ['bypass', 'default', 'accept_edits', 'plan'],
  }).notNull().default('bypass'),

  // Per-session model + effort overrides. Null = use the harness default.
  // For Claude these map to --model / --effort. For Codex --model only;
  // effort is ignored. Changing either recycles the cached AgentSession
  // so the next dispatch picks up the new flag.
  //
  // Effort enum values mirror Claude's `--effort` flag — `xhigh` and
  // `max` are the literal CLI values, not display strings.
  model: text('model'),
  effort: text('effort', { enum: ['low', 'medium', 'high', 'xhigh', 'max'] }),

  // When entering plan mode we stash the prior permission_mode here so
  // ExitPlanMode can revert. Mirrors Claude Code's `prePlanMode` on
  // ToolPermissionContext. Cleared when a non-plan mode is set directly.
  pre_plan_mode: text('pre_plan_mode', {
    enum: ['bypass', 'default', 'accept_edits', 'plan'],
  }),

  started_at: text('started_at').notNull().default(sql`(datetime('now'))`),
  archived_at: text('archived_at'),
}, (table) => [
  uniqueIndex('chat_sessions_external_session_id_uq')
    .on(table.external_session_id)
    .where(sql`${table.external_session_id} IS NOT NULL`),
  index('idx_chat_sessions_workspace_status')
    .on(table.workspace_id, table.status, table.last_outcome_event_at),
  index('idx_chat_sessions_agent_status').on(table.agent_id, table.status),
  index('idx_chat_sessions_type_status').on(table.type, table.status),
]);

// ─── Chat Events ──────────────────────────────────────────────
// One row per atomic thing that happened in a chat. Source enum
// distinguishes user/agent/thinking/tool_call/tool_result/system/result/etc.
// External_event_id makes idempotent upsert possible across retries.

export const chatEvents = sqliteTable('chat_events', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  source: text('source').notNull(),
  content: text('content'),
  tool_name: text('tool_name'),
  tool_input: text('tool_input', { mode: 'json' }),
  tool_is_error: integer('tool_is_error', { mode: 'boolean' }),
  tool_exit_code: integer('tool_exit_code'),
  raw: text('raw', { mode: 'json' }),
  external_event_id: text('external_event_id'),
  external_message_id: text('external_message_id'),
  external_turn_id: text('external_turn_id'),
  external_tool_call_id: text('external_tool_call_id'),
  external_parent_tool_call_id: text('external_parent_tool_call_id'),
  source_part_index: integer('source_part_index').notNull().default(0),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  // Idempotent upsert key for CLI-backed events. Claude (JSONL uuid) and
  // Codex v2 (globally-unique item.id) both supply distinct external_event_id
  // values per row, so turn_id isn't needed for uniqueness here.
  uniqueIndex('chat_events_external_uq')
    .on(table.session_id, table.external_event_id, table.source_part_index)
    .where(sql`${table.external_event_id} IS NOT NULL`),
  index('idx_chat_events_session_created').on(table.session_id, table.created_at),
  index('idx_chat_events_tool_call_id').on(table.external_tool_call_id),
]);

// ─── Chat Attachments ─────────────────────────────────────────
// Multimodal content references (images, audio, video, files). Stored on
// disk for large items; small ones can fall back to inline blob.

export const chatAttachments = sqliteTable('chat_attachments', {
  id: text('id').primaryKey(),
  event_id: text('event_id').notNull().references(() => chatEvents.id, { onDelete: 'cascade' }),
  session_id: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  mime_type: text('mime_type'),
  size_bytes: integer('size_bytes'),
  storage_kind: text('storage_kind').notNull(),
  file_path: text('file_path'),
  blob: blob('blob'),
  url: text('url'),
  content_hash: text('content_hash'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_chat_attachments_session').on(table.session_id),
  index('idx_chat_attachments_hash').on(table.content_hash),
]);

// ─── Notes ────────────────────────────────────────────────────

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  area_id: text('area_id').references(() => areas.id),
  task_id: text('task_id').references(() => tasks.id),
  title: text('title'),
  body: text('body').notNull(),
  url: text('url'),
  attachments: text('attachments', { mode: 'json' }).$type<Attachment[]>().default([]),
  status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
  context_tags: text('context_tags', { mode: 'json' }).$type<string[]>().default([]),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
  last_viewed_at: text('last_viewed_at'),
}, (table) => [
  index('idx_notes_area_id').on(table.area_id),
  index('idx_notes_task_id').on(table.task_id),
  index('idx_notes_status').on(table.status),
]);
