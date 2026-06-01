CREATE TABLE `preview_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`service` text,
	`preview_name` text NOT NULL,
	`port` integer,
	`start_command` text,
	`pinned` integer DEFAULT false NOT NULL,
	`last_viewed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_preview_targets_execution` ON `preview_targets` (`execution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_preview_targets_exec_default` ON `preview_targets` (`execution_id`) WHERE "preview_targets"."service" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_preview_targets_exec_service` ON `preview_targets` (`execution_id`,`service`) WHERE "preview_targets"."service" IS NOT NULL;--> statement-breakpoint
ALTER TABLE `executions` ADD `preview_urls` text DEFAULT '[]' NOT NULL;