CREATE TABLE `stream_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`stream_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`relation` text NOT NULL,
	`decision_id` text,
	FOREIGN KEY (`stream_id`) REFERENCES `stream`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `triage_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stream_links_stream` ON `stream_links` (`stream_id`);--> statement-breakpoint
CREATE INDEX `idx_stream_links_entity` ON `stream_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `triage_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`pass_id` text,
	`stream_item_ids` text NOT NULL,
	`disposition` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`draft` text,
	`confidence` real,
	`rationale` text,
	`state` text NOT NULL,
	`corrected_disposition` text,
	`actor` text NOT NULL,
	`decided_at` text,
	`undone_at` text,
	`entity_version_id` text,
	FOREIGN KEY (`pass_id`) REFERENCES `triage_passes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_triage_decisions_pass` ON `triage_decisions` (`pass_id`);--> statement-breakpoint
CREATE INDEX `idx_triage_decisions_state` ON `triage_decisions` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_triage_decisions_disposition` ON `triage_decisions` (`disposition`,`state`);--> statement-breakpoint
CREATE TABLE `triage_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`session_id` text,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`auto_applied` integer DEFAULT 0 NOT NULL,
	`proposed` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`completed_at` text,
	`digest_seen_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_triage_passes_status` ON `triage_passes` (`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `stream` ADD `resurface_at` text;--> statement-breakpoint
ALTER TABLE `stream` DROP COLUMN `promoted_to_type`;--> statement-breakpoint
ALTER TABLE `stream` DROP COLUMN `promoted_to_id`;--> statement-breakpoint
ALTER TABLE `stream` DROP COLUMN `promoted_at`;--> statement-breakpoint
ALTER TABLE `stream` DROP COLUMN `promotion_pass`;--> statement-breakpoint
ALTER TABLE `user_state` ADD `stream_autonomy` text;