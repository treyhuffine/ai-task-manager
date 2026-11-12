CREATE TABLE `hub_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`app_id` text NOT NULL,
	`call_key` text NOT NULL,
	`action_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`risk` text NOT NULL,
	`preview` text,
	`account` text,
	`session_id` text,
	`started_by` text NOT NULL,
	`status` text NOT NULL,
	`decided_at` text,
	`expires_at` text,
	FOREIGN KEY (`app_id`) REFERENCES `hub_apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_hub_approvals_app_status` ON `hub_approvals` (`app_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_hub_approvals_key` ON `hub_approvals` (`call_key`);