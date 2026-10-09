CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`removed_at` text,
	`creation_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_members_status` ON `members` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_members_creation` ON `members` (`creation_id`) WHERE "members"."creation_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `team_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`member_id` text,
	`role` text,
	`created_by_member_id` text,
	`expires_at` text NOT NULL,
	`redeemed_at` text,
	`redeemed_by_api_key_id` text,
	`revoked_at` text,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_by_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_grants_hash_unique` ON `team_grants` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_team_grants_kind` ON `team_grants` (`kind`,`redeemed_at`,`revoked_at`);--> statement-breakpoint
CREATE INDEX `idx_team_grants_member` ON `team_grants` (`member_id`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `member_id` text REFERENCES members(id);--> statement-breakpoint
CREATE INDEX `idx_api_keys_member` ON `api_keys` (`member_id`);--> statement-breakpoint
ALTER TABLE `entity_versions` ADD `actor_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `notes` ADD `body_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `task_status_changes` ADD `actor_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `assignee_member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `body_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_tasks_assignee` ON `tasks` (`assignee_member_id`);