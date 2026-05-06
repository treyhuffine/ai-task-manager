CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`harness` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_agents_kind` ON `agents` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_agents_status` ON `agents` (`status`);--> statement-breakpoint
CREATE TABLE `chat_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`session_id` text NOT NULL,
	`kind` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`storage_kind` text NOT NULL,
	`file_path` text,
	`blob` blob,
	`url` text,
	`content_hash` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `chat_events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_attachments_session` ON `chat_attachments` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_attachments_hash` ON `chat_attachments` (`content_hash`);--> statement-breakpoint
CREATE TABLE `chat_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`content` text,
	`tool_name` text,
	`tool_input` text,
	`tool_is_error` integer,
	`tool_exit_code` integer,
	`raw` text,
	`external_event_id` text,
	`external_message_id` text,
	`external_turn_id` text,
	`external_tool_call_id` text,
	`external_parent_tool_call_id` text,
	`source_part_index` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_events_external_uq` ON `chat_events` (`session_id`,`external_event_id`,`source_part_index`) WHERE "chat_events"."external_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_chat_events_session_created` ON `chat_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_events_tool_call_id` ON `chat_events` (`external_tool_call_id`);--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`agent_id` text NOT NULL,
	`type` text NOT NULL,
	`surface_kind` text,
	`surface_ref` text,
	`status` text DEFAULT 'active' NOT NULL,
	`label` text,
	`refs` text DEFAULT '{}' NOT NULL,
	`workspace_id` text,
	`worktree_path` text,
	`branch_name` text,
	`base_sha` text,
	`last_outcome_event_at` text,
	`last_viewed_at` text,
	`external_session_id` text,
	`external_transcript_path` text,
	`external_sync_offset` integer,
	`external_sync_last_event_id` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_external_session_id_uq` ON `chat_sessions` (`external_session_id`) WHERE "chat_sessions"."external_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_status` ON `chat_sessions` (`workspace_id`,`status`,`last_outcome_event_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_agent_status` ON `chat_sessions` (`agent_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_type_status` ON `chat_sessions` (`type`,`status`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`emoji` text,
	`cwd` text NOT NULL,
	`is_git` integer DEFAULT false NOT NULL,
	`base_branch` text,
	`remote_name` text DEFAULT 'origin',
	`worktree_root` text,
	`area_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`collapsed` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_status_position` ON `workspaces` (`status`,`position`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_area_id` ON `workspaces` (`area_id`);