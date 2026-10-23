CREATE TABLE `harness_model_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`harness` text NOT NULL,
	`model` text NOT NULL,
	`last_used_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_harness_model_usage_model` ON `harness_model_usage` (`harness`,`model`);