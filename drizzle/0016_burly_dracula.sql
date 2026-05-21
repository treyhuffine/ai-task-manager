CREATE TABLE `chat_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`event_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`hydrate` integer DEFAULT true NOT NULL,
	`created_by` text DEFAULT 'user' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `chat_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_refs_session_event` ON `chat_refs` (`session_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_refs_entity` ON `chat_refs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_refs_session_pin_uq` ON `chat_refs` (`session_id`,`entity_type`,`entity_id`) WHERE "chat_refs"."event_id" IS NULL;--> statement-breakpoint
ALTER TABLE `notes` ADD `workspace_id` text REFERENCES workspaces(id);--> statement-breakpoint
CREATE INDEX `idx_notes_workspace_id` ON `notes` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `workspace_id` text REFERENCES workspaces(id);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_id` ON `tasks` (`workspace_id`);--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `refs`;