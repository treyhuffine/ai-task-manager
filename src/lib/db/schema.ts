import { sqliteTable, text, integer, index, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// ─── User State ────────────────────────────────────────────────

export const userState = sqliteTable('user_state', {
  id: integer('id').primaryKey(),
  active_area_id: text('active_area_id').references(() => areas.id),
  active_parent_task_id: text('active_parent_task_id'),
  active_energy: text('active_energy', { enum: ['deep', 'light'] }),
  available_minutes: integer('available_minutes'),
  description: text('description').notNull().default(''),
  voice_auto_send: integer('voice_auto_send', { mode: 'boolean' }).notNull().default(true),
  voice_model: text('voice_model').notNull().default('local/parakeet-tdt-0.6b-v3'),
  updated_at: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// ─── Areas ────────────────────────────────────────────────────

export const areas = sqliteTable('areas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  emoji: text('emoji'),
  image_url: text('image_url'),
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
  source: text('source', { enum: ['capture', 'voice', 'brain_dump', 'chat'] }).notNull().default('capture'),
  status: text('status', { enum: ['pending', 'promoted', 'dismissed'] }).notNull().default('pending'),
  dismissed_by: text('dismissed_by'),
  promoted_to_type: text('promoted_to_type'),
  promoted_to_id: text('promoted_to_id'),
  promoted_at: text('promoted_at'),
  promotion_pass: text('promotion_pass'),
  created_at: text('created_at').notNull().default(sql`(datetime('now'))`),
});

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
  attachments: text('attachments', { mode: 'json' }).$type<string[]>().default([]),
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

// ─── Notes ────────────────────────────────────────────────────

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  area_id: text('area_id').references(() => areas.id),
  task_id: text('task_id').references(() => tasks.id),
  stream_item_id: text('stream_item_id').references(() => stream.id),
  title: text('title'),
  body: text('body').notNull(),
  url: text('url'),
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
