CREATE TABLE `finance_attachment_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`evidence_id` text NOT NULL,
	`file_name` text NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `finance_evidence`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_attachment_ref_unique` ON `finance_attachment_refs` (`evidence_id`,`file_name`);--> statement-breakpoint
CREATE INDEX `finance_attachment_file` ON `finance_attachment_refs` (`file_name`);--> statement-breakpoint
CREATE TABLE `finance_copies` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_ids` text NOT NULL,
	`destination` text NOT NULL,
	`reference` text,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`item_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`environment` text NOT NULL,
	`liabilities_enabled` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_items_itemId_unique` ON `finance_items` (`item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `finance_items_connectionId_unique` ON `finance_items` (`connection_id`);--> statement-breakpoint
CREATE TABLE `finance_mailboxes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`initial_start_on` text NOT NULL,
	`query` text NOT NULL,
	`monitoring` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_mailboxes_accountId_unique` ON `finance_mailboxes` (`account_id`);--> statement-breakpoint
CREATE TABLE `finance_setup_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`connection_id` text NOT NULL,
	`environment` text NOT NULL,
	`expires_at` text NOT NULL,
	`item_id` text,
	`consumed` integer NOT NULL
);
