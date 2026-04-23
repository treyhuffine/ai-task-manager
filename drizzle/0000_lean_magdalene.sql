CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`device_type` text DEFAULT 'other' NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`hash` text NOT NULL,
	`env` text DEFAULT 'live' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`last_used_ip` text,
	`last_used_user_agent` text,
	`revoked_at` text,
	`revoked_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_hash` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_prefix` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_revoked` ON `api_keys` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`emoji` text,
	`attachments` text DEFAULT '[]',
	`notes` text,
	`user_context` text,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`context` text,
	`context_tags` text DEFAULT '[]',
	`framing` text,
	`items` text DEFAULT '[]' NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`search_context` text,
	`model` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text,
	`task_id` text,
	`title` text,
	`body` text NOT NULL,
	`url` text,
	`attachments` text DEFAULT '[]',
	`status` text DEFAULT 'active' NOT NULL,
	`context_tags` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_viewed_at` text,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_notes_area_id` ON `notes` (`area_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_task_id` ON `notes` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_status` ON `notes` (`status`);--> statement-breakpoint
CREATE TABLE `stream` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_text` text NOT NULL,
	`source` text DEFAULT 'capture' NOT NULL,
	`media` text DEFAULT 'text' NOT NULL,
	`origin` text DEFAULT 'internal' NOT NULL,
	`external_source` text,
	`external_id` text,
	`external_payload` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`dismissed_by` text,
	`promoted_to_type` text,
	`promoted_to_id` text,
	`promoted_at` text,
	`promotion_pass` text,
	`attachments` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `stream_external_id_idx` ON `stream` (`external_source`,`external_id`);--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`completed_at` text DEFAULT (datetime('now')) NOT NULL,
	`note` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_completions_task_id` ON `task_completions` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`area_id` text,
	`raw_input` text NOT NULL,
	`stream_item_id` text,
	`title` text NOT NULL,
	`description` text,
	`body` text,
	`user_context` text,
	`ai_context` text,
	`outcome` text,
	`heartbeat_days` integer,
	`last_progress_at` text,
	`energy` text,
	`effort` text,
	`estimated_minutes` integer,
	`context_tags` text DEFAULT '[]',
	`hard_deadline` text,
	`reminder_at` text,
	`resurface_after` text,
	`attachments` text DEFAULT '[]',
	`status` text DEFAULT 'active' NOT NULL,
	`sort_key` text,
	`blocked_on` text,
	`blocked_since` text,
	`recurrence` text,
	`next_recurrence_at` text,
	`target_frequency` integer,
	`times_deferred` integer DEFAULT 0 NOT NULL,
	`last_surfaced_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`last_viewed_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`stream_item_id`) REFERENCES `stream`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_area_id` ON `tasks` (`area_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_parent_id` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_sort_key` ON `tasks` (`sort_key`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status_sort` ON `tasks` (`status`,`sort_key`);--> statement-breakpoint
CREATE TABLE `user_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text,
	`active_area_id` text,
	`active_parent_task_id` text,
	`active_energy` text,
	`available_minutes` integer,
	`description` text DEFAULT '' NOT NULL,
	`voice_auto_send` integer DEFAULT true NOT NULL,
	`voice_model` text DEFAULT 'local/parakeet-tdt-0.6b-v3' NOT NULL,
	`default_agent_harness` text,
	`default_agent_model` text,
	`onboarded_at` text,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`active_area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
