CREATE TABLE `computers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`platform` text,
	`hostname` text,
	`status` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_computers_status` ON `computers` (`status`);--> statement-breakpoint
CREATE TABLE `home` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`host_computer_id` text NOT NULL,
	FOREIGN KEY (`host_computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE no action
);
