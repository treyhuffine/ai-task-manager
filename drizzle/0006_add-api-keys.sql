CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`device_type` text DEFAULT 'other' NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`hash` text NOT NULL,
	`env` text DEFAULT 'live' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text,
	`last_used_at` text,
	`last_used_ip` text,
	`last_used_user_agent` text,
	`revoked_at` text,
	`revoked_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_unique` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_hash` ON `api_keys` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_prefix` ON `api_keys` (`prefix`);--> statement-breakpoint
CREATE INDEX `idx_api_keys_revoked` ON `api_keys` (`revoked_at`);