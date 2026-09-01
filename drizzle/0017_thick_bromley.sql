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
ALTER TABLE `executions` ADD `task_id` text REFERENCES tasks(id);--> statement-breakpoint
CREATE INDEX `idx_executions_task` ON `executions` (`task_id`);