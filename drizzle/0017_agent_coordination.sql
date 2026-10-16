CREATE TABLE `agent_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`request_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text NOT NULL,
	`delivered_to_session_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`error` text,
	FOREIGN KEY (`request_id`) REFERENCES `agent_requests`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_deliveries_key` ON `agent_deliveries` (`request_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `idx_agent_deliveries_pending` ON `agent_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_deliveries_event` ON `agent_deliveries` (`event_id`);--> statement-breakpoint
CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_session_id` text NOT NULL,
	`source_address` text NOT NULL,
	`target_address` text NOT NULL,
	`target_session_id` text,
	`request_key` text NOT NULL,
	`parent_request_id` text,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`options` text,
	`status` text NOT NULL,
	`message_event_id` text NOT NULL,
	`run_id` text,
	`response_event_id` text,
	`response` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`error` text,
	FOREIGN KEY (`source_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_request_id`) REFERENCES `agent_requests`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_requests_key` ON `agent_requests` (`source_session_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `idx_agent_requests_dispatch` ON `agent_requests` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_requests_target` ON `agent_requests` (`target_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_requests_source` ON `agent_requests` (`source_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_requests_run` ON `agent_requests` (`run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_requests_message` ON `agent_requests` (`message_event_id`);