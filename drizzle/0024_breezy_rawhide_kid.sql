CREATE TABLE `member_chat_views` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`member_id` text NOT NULL,
	`chat_session_id` text NOT NULL,
	`last_viewed_at` text,
	`unread_marker_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_member_chat_view` ON `member_chat_views` (`member_id`,`chat_session_id`);--> statement-breakpoint
CREATE TABLE `member_execution_views` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`member_id` text NOT NULL,
	`execution_id` text NOT NULL,
	`pinned_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_member_execution_view` ON `member_execution_views` (`member_id`,`execution_id`);--> statement-breakpoint
CREATE TABLE `member_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`member_id` text NOT NULL,
	`voice_auto_send` integer,
	`voice_model` text,
	`current_main_chats` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_member_preferences` ON `member_preferences` (`member_id`);--> statement-breakpoint
CREATE TABLE `personal_area_defaults` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`team_id` text NOT NULL,
	`source_area_id` text,
	`area_id` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_personal_area_default_team` ON `personal_area_defaults` (`team_id`) WHERE "personal_area_defaults"."source_area_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_personal_area_default_source` ON `personal_area_defaults` (`team_id`,`source_area_id`) WHERE "personal_area_defaults"."source_area_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `reference_area_choices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`choice` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_area_choice` ON `reference_area_choices` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `team_activity` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`workspace_id` text NOT NULL,
	`member_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`kind` text NOT NULL,
	`resource` text NOT NULL,
	`operation` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_team_activity_workspace_created` ON `team_activity` (`workspace_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `created_by_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `executions` ADD `created_by_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `runs` ADD `requested_by_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `runs` ADD `result_operation_message_id` text GENERATED ALWAYS AS (CASE WHEN json_valid(trigger_payload) THEN json_extract(trigger_payload, '$.resultOperation.messageId') END) VIRTUAL;--> statement-breakpoint
CREATE INDEX `idx_runs_result_operation_message` ON `runs` (`result_operation_message_id`);--> statement-breakpoint
ALTER TABLE `team_chat_turns` ADD `requesting_api_key_id` text REFERENCES api_keys(id);--> statement-breakpoint
ALTER TABLE `work_result_ai_reviews` ADD `actor_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `work_result_ai_reviews` ADD `requesting_api_key_id` text REFERENCES api_keys(id);--> statement-breakpoint
ALTER TABLE `work_result_decisions` ADD `actor_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `work_results` ADD `actor_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `created_by_member_id` text REFERENCES members(id);