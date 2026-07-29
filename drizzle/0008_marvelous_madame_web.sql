CREATE TABLE `reference_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`workspace_id` text,
	`alias` text NOT NULL,
	`path` text,
	`target_workspace_id` text,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reference_folders_one_target" CHECK(("reference_folders"."path" IS NOT NULL) <> ("reference_folders"."target_workspace_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_reference_folders_workspace` ON `reference_folders` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reference_folders_target` ON `reference_folders` (`target_workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_global_alias` ON `reference_folders` (`alias`) WHERE "reference_folders"."workspace_id" IS NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_workspace_alias` ON `reference_folders` (`workspace_id`,`alias`) WHERE "reference_folders"."workspace_id" IS NOT NULL AND "reference_folders"."status" = 'active';