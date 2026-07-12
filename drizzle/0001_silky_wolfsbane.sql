CREATE TABLE `agent_harness_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`harness` text NOT NULL,
	`operation` text NOT NULL,
	`upstream_provider_id` text NOT NULL,
	`status` text NOT NULL,
	`replacement_harness` text,
	`replacement_model` text,
	`last_error_code` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_harness_operations_status` ON `agent_harness_operations` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `agent_harness_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`harness` text NOT NULL,
	`enabled_models` text DEFAULT '[]' NOT NULL,
	`default_model` text,
	`default_variant` text,
	`default_effort` text,
	`catalog_refreshed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_harness_settings_harness_unique` ON `agent_harness_settings` (`harness`);--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `model_variant` text;