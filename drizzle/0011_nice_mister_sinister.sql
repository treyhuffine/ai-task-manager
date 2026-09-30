CREATE TABLE `folder_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`computer_id` text NOT NULL,
	`reference_folder_id` text NOT NULL,
	`path` text,
	`found` integer,
	`checked_at` text,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_folder_id`) REFERENCES `reference_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_folder_links_computer_reference` ON `folder_links` (`computer_id`,`reference_folder_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_links_reference` ON `folder_links` (`reference_folder_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reference_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`workspace_id` text,
	`alias` text NOT NULL,
	`path` text,
	`target_workspace_id` text,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reference_folders`("id", "created_at", "updated_at", "workspace_id", "alias", "path", "target_workspace_id", "description", "position", "status", "archived_at") SELECT "id", "created_at", "updated_at", "workspace_id", "alias", "path", "target_workspace_id", "description", "position", "status", "archived_at" FROM `reference_folders`;--> statement-breakpoint
DROP TABLE `reference_folders`;--> statement-breakpoint
ALTER TABLE `__new_reference_folders` RENAME TO `reference_folders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_reference_folders_workspace` ON `reference_folders` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reference_folders_target` ON `reference_folders` (`target_workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_global_alias` ON `reference_folders` (`alias`) WHERE "reference_folders"."workspace_id" IS NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_workspace_alias` ON `reference_folders` (`workspace_id`,`alias`) WHERE "reference_folders"."workspace_id" IS NOT NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
ALTER TABLE `agent_setups` ADD `found` integer;