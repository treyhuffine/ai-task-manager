ALTER TABLE `agent_harness_operations` RENAME TO `harness_operations`;--> statement-breakpoint
ALTER TABLE `agent_harness_settings` RENAME TO `harness_settings`;--> statement-breakpoint
ALTER TABLE `user_state` RENAME COLUMN "default_agent_harness" TO "default_harness";--> statement-breakpoint
ALTER TABLE `user_state` RENAME COLUMN "default_agent_model" TO "default_model";--> statement-breakpoint
ALTER TABLE `user_state` RENAME COLUMN "default_agent_effort" TO "default_effort";--> statement-breakpoint
DROP INDEX `idx_agent_harness_operations_status`;--> statement-breakpoint
CREATE INDEX `idx_harness_operations_status` ON `harness_operations` (`status`,`updated_at`);--> statement-breakpoint
DROP INDEX `agent_harness_settings_harness_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `harness_settings_harness_unique` ON `harness_settings` (`harness`);--> statement-breakpoint
ALTER TABLE `chat_events` ADD `sender_session_id` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `purpose` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `instructions` text;