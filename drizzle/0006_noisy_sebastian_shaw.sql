CREATE TABLE `execution_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`computer_id` text NOT NULL,
	`generation` integer NOT NULL,
	`worktree_path` text,
	`checkpoint_sha` text,
	`start_reason` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_placements_generation` ON `execution_placements` (`execution_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_placements_open` ON `execution_placements` (`execution_id`) WHERE "execution_placements"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_execution_placements_computer` ON `execution_placements` (`computer_id`);--> statement-breakpoint
ALTER TABLE `worker_commands` ADD `source_event_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_worker_commands_source_event` ON `worker_commands` (`source_event_id`) WHERE "worker_commands"."source_event_id" IS NOT NULL;