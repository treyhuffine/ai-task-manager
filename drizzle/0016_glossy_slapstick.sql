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
ALTER TABLE `executions` ADD `task_id` text REFERENCES tasks(id);--> statement-breakpoint
CREATE INDEX `idx_executions_task` ON `executions` (`task_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `lifecycle_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `lifecycle_state_since` text;