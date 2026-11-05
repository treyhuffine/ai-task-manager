CREATE TABLE `conversation_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`provider` text NOT NULL,
	`name` text NOT NULL,
	`workspace_id` text,
	`enabled` integer NOT NULL,
	`external_workspace_id` text NOT NULL,
	`external_agent_id` text NOT NULL,
	`channels` text NOT NULL,
	`error` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_identity` ON `conversation_connections` (`provider`,`external_workspace_id`,`external_agent_id`);--> statement-breakpoint
CREATE TABLE `conversation_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`connection_id` text NOT NULL,
	`api_key_id` text NOT NULL,
	`member_id` text,
	`external_user_id` text,
	`code_hash` text,
	`expires_at` text,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_user` ON `conversation_identities` (`connection_id`,`external_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_code` ON `conversation_identities` (`code_hash`);--> statement-breakpoint
CREATE TABLE `conversation_inputs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`thread_id` text NOT NULL,
	`identity_id` text NOT NULL,
	`external_event_id` text NOT NULL,
	`content` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`event_id` text NOT NULL,
	`error` text,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`identity_id`) REFERENCES `conversation_identities`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_input` ON `conversation_inputs` (`thread_id`,`external_event_id`);--> statement-breakpoint
CREATE INDEX `idx_conversation_input_queue` ON `conversation_inputs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `conversation_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`thread_id` text NOT NULL,
	`key` text NOT NULL,
	`content` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`part` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`error` text,
	FOREIGN KEY (`thread_id`) REFERENCES `conversation_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_output` ON `conversation_outputs` (`thread_id`,`key`);--> statement-breakpoint
CREATE INDEX `idx_conversation_output_queue` ON `conversation_outputs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `conversation_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`connection_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`session_id` text,
	`last_run_id` text,
	`response_event_id` text,
	FOREIGN KEY (`connection_id`) REFERENCES `conversation_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_thread` ON `conversation_threads` (`connection_id`,`channel_id`,`thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_conversation_session` ON `conversation_threads` (`session_id`);