CREATE TABLE `team_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`member_id` text NOT NULL,
	`member_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`last_error_at` text
);
--> statement-breakpoint
ALTER TABLE `notes` ADD `source_team_id` text REFERENCES team_connections(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `source_note_id` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `source_state` text;--> statement-breakpoint
ALTER TABLE `notes` ADD `source` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_notes_source` ON `notes` (`source_team_id`,`source_note_id`) WHERE "notes"."source_team_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_team_id` text REFERENCES team_connections(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_task_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_state` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_tasks_source` ON `tasks` (`source_team_id`,`source_task_id`) WHERE "tasks"."source_team_id" IS NOT NULL;