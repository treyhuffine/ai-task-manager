CREATE TABLE `computer_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`computer_id` text,
	`computer_name` text,
	`created_by_api_key_id` text,
	`expires_at` text NOT NULL,
	`redeemed_at` text,
	`redeemed_by_api_key_id` text,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_by_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `computer_grants_hash_unique` ON `computer_grants` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_computer_grants_computer` ON `computer_grants` (`computer_id`);--> statement-breakpoint
CREATE TABLE `worker_enrollments` (
	`api_key_id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`computer_id` text NOT NULL,
	`grant_id` text,
	FOREIGN KEY (`api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `computer_grants`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_worker_enrollments_computer` ON `worker_enrollments` (`computer_id`);--> statement-breakpoint
ALTER TABLE `computers` ADD `worker_protocol` integer;--> statement-breakpoint
ALTER TABLE `computers` ADD `worker_version` text;--> statement-breakpoint
ALTER TABLE `computers` ADD `harnesses` text;--> statement-breakpoint
ALTER TABLE `computers` ADD `reported_state` text;