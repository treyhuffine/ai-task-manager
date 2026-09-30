CREATE TABLE `agent_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`workspace_id` text NOT NULL,
	`computer_id` text NOT NULL,
	`source_path` text NOT NULL,
	`config_revision` text,
	`references` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`problem` text,
	`reported_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`computer_id`) REFERENCES `computers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_setups_agent_computer` ON `agent_setups` (`workspace_id`,`computer_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_setups_computer` ON `agent_setups` (`computer_id`);--> statement-breakpoint
ALTER TABLE `api_keys` ADD `computer_id` text REFERENCES computers(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_api_keys_computer` ON `api_keys` (`computer_id`);