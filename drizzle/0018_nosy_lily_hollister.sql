CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`workspace_id` text NOT NULL,
	`label` text,
	`worktree_path` text,
	`branch_name` text,
	`base_sha` text,
	`pr_number` integer,
	`setup_error` text,
	`setup_started_at` text,
	`takeover_started_at` text,
	`takeover_base_sha` text,
	`takeover_branch` text,
	`takeover_token` text,
	`takeover_token_expires_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_executions_workspace_status` ON `executions` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_executions_takeover_token` ON `executions` (`takeover_token`) WHERE "executions"."takeover_token" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `execution_id` text REFERENCES executions(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_execution_status_activity` ON `chat_sessions` (`execution_id`,`status`,`last_outcome_event_at`);