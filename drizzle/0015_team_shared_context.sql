CREATE TABLE `shared_operation_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`member_id` text NOT NULL,
	`api_key_id` text,
	`action` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`intent_hash` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`outcome` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_shared_operation_receipts_key` ON `shared_operation_receipts` (`member_id`,`action`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_shared_operation_receipts_entity` ON `shared_operation_receipts` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `team_ai_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`enabled` integer NOT NULL,
	`harness` text NOT NULL,
	`provider` text NOT NULL,
	`model` text,
	`credential_label` text,
	`credential_set_at` text,
	`main_chat_session_id` text,
	`last_error` text,
	`last_error_at` text,
	`last_ok_at` text,
	`updated_by_member_id` text,
	FOREIGN KEY (`main_chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `team_chat_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`chat_session_id` text NOT NULL,
	`member_id` text NOT NULL,
	`client_send_id` text NOT NULL,
	`message_event_id` text NOT NULL,
	`seq` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	`error` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_team_chat_turns_send` ON `team_chat_turns` (`chat_session_id`,`member_id`,`client_send_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_team_chat_turns_seq` ON `team_chat_turns` (`chat_session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_team_chat_turns_status` ON `team_chat_turns` (`status`,`chat_session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_team_chat_turns_message` ON `team_chat_turns` (`chat_session_id`,`message_event_id`);--> statement-breakpoint
ALTER TABLE `chat_events` ADD `author_member_id` text;--> statement-breakpoint
CREATE INDEX `idx_chat_events_session_cursor` ON `chat_events` (`session_id`);--> statement-breakpoint
ALTER TABLE `notes` ADD `kind` text;--> statement-breakpoint
CREATE INDEX `idx_notes_kind_status` ON `notes` (`kind`,`status`);