-- Lifecycle foundation (schema-only). Makes the canonical
-- `consider | todo | in_progress | done | archived` model representable and
-- adds the lifecycle-command ledger. NO task data is rewritten here — existing
-- `status` bytes (including legacy `active`) are preserved verbatim and
-- normalized at the read boundary until scripts/backfill-task-lifecycle.ts
-- rewrites them. The status enum is type-level only in SQLite (no CHECK), so
-- the new values need no DDL.
--
-- HAND-EDITED away from drizzle's default table-rebuild. `tasks` is the
-- external content source of the `tasks_fts` FTS5 index (content='tasks',
-- content_rowid='rowid', see src/lib/db/index.ts). A DROP+recreate rebuild
-- reassigns rowids and desyncs that FTS index (breaking keyword search), which
-- the lifecycle spec explicitly forbids. The only real changes are additive
-- columns, done with ALTER TABLE ADD COLUMN so rowids — and therefore FTS —
-- are untouched. The column default flips to `todo` at the application insert
-- path (createTask); SQLite cannot alter a column default without a rebuild, so
-- the SQL-level default is intentionally left as-is and is never relied upon
-- (every insert path supplies an explicit status).

CREATE TABLE `task_lifecycle_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`task_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`command` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`revision` integer NOT NULL,
	`actor_source` text DEFAULT 'human' NOT NULL,
	`actor_session_id` text,
	`execution_id` text,
	`run_id` text,
	`reason` text,
	`result` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_task_lifecycle_commands_task_key` ON `task_lifecycle_commands` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_task_lifecycle_commands_task` ON `task_lifecycle_commands` (`task_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `lifecycle_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD COLUMN `lifecycle_state_since` text;
