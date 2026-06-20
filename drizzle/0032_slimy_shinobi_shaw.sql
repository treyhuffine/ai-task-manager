CREATE TABLE `entity_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`source` text DEFAULT 'human' NOT NULL,
	`actor_session_id` text,
	`summary` text,
	`reverted_from_version_id` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`actor_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_entity_versions_entity` ON `entity_versions` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_entity_versions_actor_session` ON `entity_versions` (`actor_session_id`);