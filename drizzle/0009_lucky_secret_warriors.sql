CREATE TABLE `execution_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`from_computer_id` text NOT NULL,
	`to_computer_id` text NOT NULL,
	`from_generation` integer NOT NULL,
	`to_generation` integer,
	`stage` text NOT NULL,
	`state` text NOT NULL,
	`include_untracked` text DEFAULT '[]' NOT NULL,
	`held_event_ids` text DEFAULT '[]' NOT NULL,
	`conversation_checkpoint_event_id` text,
	`branch` text,
	`remote` text,
	`checkpoint_sha` text,
	`target_worktree_path` text,
	`handoff` text,
	`failed_stage` text,
	`error` text,
	`finished_at` text,
	`requested_by_api_key_id` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_execution_transfers_execution` ON `execution_transfers` (`execution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_transfers_active` ON `execution_transfers` (`execution_id`) WHERE "execution_transfers"."state" = 'active';--> statement-breakpoint
CREATE TABLE `native_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`chat_session_id` text NOT NULL,
	`computer_id` text,
	`placement_id` text,
	`harness` text NOT NULL,
	`native_session_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`placement_id`) REFERENCES `execution_placements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_native_sessions_chat` ON `native_sessions` (`chat_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_native_sessions_open` ON `native_sessions` (`chat_session_id`) WHERE "native_sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `review_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`computer_id` text NOT NULL,
	`source_computer_id` text,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`commit_sha` text NOT NULL,
	`dirty` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_review_checkouts_execution_computer` ON `review_checkouts` (`execution_id`,`computer_id`);