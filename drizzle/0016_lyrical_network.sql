CREATE TABLE `execution_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`output_event_id` text NOT NULL,
	`disposition` text NOT NULL,
	`actor_source` text DEFAULT 'human' NOT NULL,
	`actor_session_id` text,
	`note` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_execution_reviews_execution` ON `execution_reviews` (`execution_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_execution_reviews_output` ON `execution_reviews` (`output_event_id`);--> statement-breakpoint
CREATE TABLE `execution_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`task_id` text NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_tasks_pair` ON `execution_tasks` (`execution_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_tasks_task` ON `execution_tasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_tasks_execution` ON `execution_tasks` (`execution_id`);--> statement-breakpoint
CREATE TABLE `task_status_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`task_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`command` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`status_changed_count` integer NOT NULL,
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
CREATE UNIQUE INDEX `uniq_task_status_changes_task_key` ON `task_status_changes` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_task_status_changes_task` ON `task_status_changes` (`task_id`,`created_at`);--> statement-breakpoint
-- HAND-EDITED away from drizzle's table rebuild. drizzle rebuilds the whole
-- `tasks` table for the status DEFAULT change (active -> todo) AND folds the new
-- columns into that rebuild — but the rebuild reassigns rowids (desyncing the
-- external-content tasks_fts index) and its INSERT..SELECT even references the
-- new columns from the pre-migration table that lacks them. Instead we do:
--   1. the two new lifecycle columns as additive ADD COLUMN (rowid-safe), and
--   2. the DEFAULT change via a rowid-safe column swap (RENAME/ADD/UPDATE/DROP),
--      which SQLite performs in place without reassigning rowids.
-- Existing status values are copied verbatim (scripts/backfill-task-lifecycle.ts
-- maps legacy active -> todo). The two status indexes are recreated because
-- they are dropped together with the old column.
ALTER TABLE `tasks` ADD `status_changed_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `status_changed_at` text;--> statement-breakpoint
ALTER TABLE `tasks` RENAME COLUMN `status` TO `status_old`;--> statement-breakpoint
ALTER TABLE `tasks` ADD `status` text DEFAULT 'todo' NOT NULL;--> statement-breakpoint
UPDATE `tasks` SET `status` = `status_old`;--> statement-breakpoint
DROP INDEX `idx_tasks_status`;--> statement-breakpoint
DROP INDEX `idx_tasks_status_sort`;--> statement-breakpoint
ALTER TABLE `tasks` DROP COLUMN `status_old`;--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status_sort` ON `tasks` (`status`,`sort_key`);