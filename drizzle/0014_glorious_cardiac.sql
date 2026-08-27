CREATE TABLE `entity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_entity_links_target` ON `entity_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_source` ON `entity_links` (`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_links_edge_uq` ON `entity_links` (`source_type`,`source_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `entity_projection_state` (
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_revision` integer DEFAULT 0 NOT NULL,
	`links_projected_revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`source_type`, `source_id`)
);
