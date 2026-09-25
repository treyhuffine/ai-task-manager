CREATE TABLE `worker_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`computer_id` text NOT NULL,
	`seq` integer,
	`execution_id` text,
	`chat_session_id` text,
	`generation` integer,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`actor` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`delivered_at` text,
	`finished_at` text,
	`result` text,
	`error` text,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_worker_commands_computer_seq` ON `worker_commands` (`computer_id`,`seq`) WHERE "worker_commands"."seq" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_worker_commands_computer_state` ON `worker_commands` (`computer_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_worker_commands_chat` ON `worker_commands` (`chat_session_id`);--> statement-breakpoint
ALTER TABLE `chat_events` ADD `part_revision` integer;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `computer_id` text REFERENCES computers(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `computers` ADD `acked_event_seq` integer DEFAULT 0 NOT NULL;