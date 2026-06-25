CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`kind` text NOT NULL,
	`provider_id` text,
	`connection_id` text,
	`config` text DEFAULT '{}' NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_channels_user_enabled` ON `notification_channels` (`user_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_notification_channels_connection` ON `notification_channels` (`connection_id`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`event_type` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`event` text NOT NULL,
	`rendered` text,
	`provider_message_id` text,
	`last_error` text,
	`next_attempt_at` text,
	`sent_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_notification_deliveries_dedupe_channel` ON `notification_deliveries` (`dedupe_key`,`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_user_status` ON `notification_deliveries` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_next_attempt` ON `notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `web_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_push_subscriptions_endpoint_unique` ON `web_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_web_push_subscriptions_user` ON `web_push_subscriptions` (`user_id`);--> statement-breakpoint
ALTER TABLE `schedules` ADD `deliver_result_to` text DEFAULT '[]' NOT NULL;