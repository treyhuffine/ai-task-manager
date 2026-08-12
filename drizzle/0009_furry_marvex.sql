CREATE TABLE `skill_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_usage_name_unique` ON `skill_usage` (`name`);