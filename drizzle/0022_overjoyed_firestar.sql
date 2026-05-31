PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_schedules` (
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
	`timeout_seconds` integer,
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
INSERT INTO `__new_schedules`("id", "user_id", "name", "description", "enabled", "agent_id", "workspace_id", "target_kind", "prompt", "skill_hints", "kind", "cron_expression", "interval_seconds", "run_at", "timezone", "active_hours_start", "active_hours_end", "concurrency_policy", "catch_up_policy", "max_catch_up_runs", "owning_execution_id", "webhook_public_id", "webhook_secret_hash", "model", "effort", "timeout_seconds", "next_run_at", "last_fired_at", "last_run_id", "last_run_status", "consecutive_failures", "disabled_reason", "created_at", "updated_at") SELECT "id", "user_id", "name", "description", "enabled", "agent_id", "workspace_id", "target_kind", "prompt", "skill_hints", "kind", "cron_expression", "interval_seconds", "run_at", "timezone", "active_hours_start", "active_hours_end", "concurrency_policy", "catch_up_policy", "max_catch_up_runs", "owning_execution_id", "webhook_public_id", "webhook_secret_hash", "model", "effort", "timeout_seconds", "next_run_at", "last_fired_at", "last_run_id", "last_run_status", "consecutive_failures", "disabled_reason", "created_at", "updated_at" FROM `schedules`;--> statement-breakpoint
DROP TABLE `schedules`;--> statement-breakpoint
ALTER TABLE `__new_schedules` RENAME TO `schedules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_schedules_brain_name` ON `schedules` (`name`) WHERE "schedules"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_schedules_workspace_name` ON `schedules` (`workspace_id`,`name`) WHERE "schedules"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_schedules_enabled_next_run` ON `schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_schedules_webhook_public_id` ON `schedules` (`webhook_public_id`) WHERE "schedules"."webhook_public_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_schedules_workspace_status` ON `schedules` (`workspace_id`,`enabled`);