PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`area_id` text,
	`task_id` text,
	`title` text,
	`body` text NOT NULL,
	`url` text,
	`status` text DEFAULT 'active' NOT NULL,
	`context_tags` text DEFAULT '[]',
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`last_viewed_at` text,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_notes`("id", "area_id", "task_id", "title", "body", "url", "status", "context_tags", "created_at", "updated_at", "last_viewed_at") SELECT "id", "area_id", "task_id", "title", "body", "url", "status", "context_tags", "created_at", "updated_at", "last_viewed_at" FROM `notes`;--> statement-breakpoint
DROP TABLE `notes`;--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_notes_area_id` ON `notes` (`area_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_task_id` ON `notes` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_status` ON `notes` (`status`);