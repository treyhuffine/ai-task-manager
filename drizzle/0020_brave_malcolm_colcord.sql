CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text,
	`workspace_id` text,
	`execution_id` text,
	`chat_session_id` text,
	`agent_id` text NOT NULL,
	`trigger` text NOT NULL,
	`trigger_payload` text,
	`scheduled_for` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`status_reason` text,
	`queued_at` text DEFAULT (datetime('now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	`duration_ms` integer,
	`model` text,
	`input_tokens` integer DEFAULT 0,
	`output_tokens` integer DEFAULT 0,
	`cached_input_tokens` integer DEFAULT 0,
	`cache_creation_input_tokens` integer DEFAULT 0,
	`cost_usd` real DEFAULT 0,
	`summary` text,
	`artifact_refs` text,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `schedules`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_runs_schedule_status` ON `runs` (`schedule_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_runs_status_started` ON `runs` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_trigger_started` ON `runs` (`trigger`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_execution_status` ON `runs` (`execution_id`,`status`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`agent_id` text NOT NULL,
	`workspace_id` text,
	`target_kind` text NOT NULL,
	`prompt` text NOT NULL,
	`skill_hints` text,
	`kind` text NOT NULL,
	`cron_expression` text,
	`interval_seconds` integer,
	`run_at` text,
	`timezone` text DEFAULT 'UTC',
	`active_hours_start` text,
	`active_hours_end` text,
	`concurrency_policy` text DEFAULT 'coalesce_if_active' NOT NULL,
	`catch_up_policy` text DEFAULT 'skip_missed' NOT NULL,
	`max_catch_up_runs` integer DEFAULT 3 NOT NULL,
	`owning_execution_id` text,
	`webhook_public_id` text,
	`webhook_secret_hash` text,
	`model` text,
	`effort` text,
	`timeout_seconds` integer DEFAULT 900 NOT NULL,
	`next_run_at` text,
	`last_fired_at` text,
	`last_run_id` text,
	`last_run_status` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`disabled_reason` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owning_execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_schedules_brain_name` ON `schedules` (`name`) WHERE "schedules"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_schedules_workspace_name` ON `schedules` (`workspace_id`,`name`) WHERE "schedules"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_schedules_enabled_next_run` ON `schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_schedules_webhook_public_id` ON `schedules` (`webhook_public_id`) WHERE "schedules"."webhook_public_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_schedules_workspace_status` ON `schedules` (`workspace_id`,`enabled`);--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `created_by_run_id` text REFERENCES runs(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `user_state` ADD `monthly_budget_usd` real;