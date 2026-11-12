CREATE TABLE `hub_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`client_id` text NOT NULL,
	`client_key` text NOT NULL,
	`name` text NOT NULL,
	`software_id` text,
	`client_uri` text,
	`purpose` text,
	`requested` text,
	`grant` text NOT NULL,
	`grant_revision` integer DEFAULT 0 NOT NULL,
	`revoked_at` text,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_apps_clientKey_unique` ON `hub_apps` (`client_key`);--> statement-breakpoint
CREATE TABLE `hub_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`app_id` text NOT NULL,
	`tool` text NOT NULL,
	`connection_id` text,
	`status` text NOT NULL,
	`started_by_kind` text NOT NULL,
	`started_by_id` text,
	`started_by_label` text,
	`error` text,
	FOREIGN KEY (`app_id`) REFERENCES `hub_apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_hub_calls_app_created` ON `hub_calls` (`app_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `hub_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`app_id` text NOT NULL,
	`access_hash` text NOT NULL,
	`access_expires_at` text NOT NULL,
	`refresh_hash` text NOT NULL,
	`refresh_expires_at` text NOT NULL,
	`refreshed_at` text,
	`revoked_at` text,
	FOREIGN KEY (`app_id`) REFERENCES `hub_apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_tokens_accessHash_unique` ON `hub_tokens` (`access_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `hub_tokens_refreshHash_unique` ON `hub_tokens` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `idx_hub_tokens_app` ON `hub_tokens` (`app_id`);