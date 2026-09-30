CREATE TABLE `skill_scopes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`workspace_ids` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_scopes_name_unique` ON `skill_scopes` (`name`);