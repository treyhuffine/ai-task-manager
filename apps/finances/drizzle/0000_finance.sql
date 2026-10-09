CREATE TABLE `finance_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`currency` text NOT NULL,
	`connection_id` text,
	`source_id` text NOT NULL,
	`access` text NOT NULL,
	`balance_minor` integer,
	`balance_includes_pending` integer NOT NULL,
	`history_start` text,
	`as_of` text,
	`card_obligations` text,
	`sync_status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_accounts_source` ON `finance_accounts` (`provider`,`source_id`);--> statement-breakpoint
CREATE INDEX `finance_accounts_connection` ON `finance_accounts` (`connection_id`);--> statement-breakpoint
CREATE TABLE `finance_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`evidence_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`item_id` text,
	`decision` text NOT NULL,
	`confidence` real NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`evidence_id`) REFERENCES `finance_evidence`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_allocation_pair` ON `finance_allocations` (`evidence_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `finance_allocation_transaction` ON `finance_allocations` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `finance_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`plan` text NOT NULL,
	`account_ids` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`source_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`occurred_on` text NOT NULL,
	`data` text NOT NULL,
	`attachments` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`human_reviewed` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_evidence_source` ON `finance_evidence` (`account_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `finance_evidence_fingerprint` ON `finance_evidence` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `finance_evidence_account_date` ON `finance_evidence` (`account_id`,`occurred_on`);--> statement-breakpoint
CREATE TABLE `finance_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`evidence_id` text,
	`transaction_ids` text DEFAULT '[]' NOT NULL,
	`state` text NOT NULL,
	`snoozed_until` text,
	`due_on` text,
	`amount_minor` integer,
	`handoff_id` text,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_id`) REFERENCES `finance_evidence`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_findings_key` ON `finance_findings` (`account_id`,`key`);--> statement-breakpoint
CREATE INDEX `finance_findings_state` ON `finance_findings` (`state`,`account_id`);--> statement-breakpoint
CREATE TABLE `finance_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`principal` text NOT NULL,
	`account_id` text NOT NULL,
	`operations` text NOT NULL,
	`revoked` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_grants_principal_account` ON `finance_grants` (`principal`,`account_id`);--> statement-breakpoint
CREATE TABLE `finance_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`transaction_id` text NOT NULL,
	`category` text,
	`kind` text,
	`obligation_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`transaction_id`) REFERENCES `finance_transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_overrides_transaction` ON `finance_overrides` (`transaction_id`);--> statement-breakpoint
CREATE TABLE `finance_recurring` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`key` text NOT NULL,
	`merchant` text NOT NULL,
	`category` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`cadence` text NOT NULL,
	`next_on` text,
	`status` text NOT NULL,
	`transaction_ids` text DEFAULT '[]' NOT NULL,
	`evidence_ids` text DEFAULT '[]' NOT NULL,
	`previous_amount_minor` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_recurring_key` ON `finance_recurring` (`account_id`,`key`);--> statement-breakpoint
CREATE TABLE `finance_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision` integer NOT NULL,
	`before` text,
	`after` text,
	`operation` text NOT NULL,
	`mutation_key` text NOT NULL,
	`principal` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_revisions_mutation` ON `finance_revisions` (`principal`,`mutation_key`);--> statement-breakpoint
CREATE INDEX `finance_revisions_entity` ON `finance_revisions` (`entity_type`,`entity_id`,`revision`);--> statement-breakpoint
CREATE TABLE `finance_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`merchant` text NOT NULL,
	`category` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_rules_merchant` ON `finance_rules` (`account_id`,`merchant`);--> statement-breakpoint
CREATE TABLE `finance_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`budget_id` text NOT NULL,
	`base_revision` integer NOT NULL,
	`name` text NOT NULL,
	`changes` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`budget_id`) REFERENCES `finance_budgets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `finance_scenarios_budget` ON `finance_scenarios` (`budget_id`);--> statement-breakpoint
CREATE TABLE `finance_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`enabled` integer NOT NULL,
	`restore_reviewed` integer NOT NULL,
	`currency` text NOT NULL,
	`timezone` text NOT NULL,
	`start_day` integer NOT NULL,
	`generation` integer DEFAULT 0 NOT NULL,
	`auto_tasks` integer NOT NULL,
	`thresholds` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`cursor` text,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_on` text NOT NULL,
	`lease_until` text,
	`last_error` text,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_sync_account` ON `finance_sync` (`account_id`);--> statement-breakpoint
CREATE INDEX `finance_sync_due` ON `finance_sync` (`state`,`next_on`);--> statement-breakpoint
CREATE TABLE `finance_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` text NOT NULL,
	`source_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`posted_on` text NOT NULL,
	`authorized_on` text,
	`merchant` text NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`pending_source_id` text,
	`obligation_id` text,
	`refund_of` text,
	`source_revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `finance_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_transactions_source` ON `finance_transactions` (`account_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_account_date` ON `finance_transactions` (`account_id`,`posted_on`,`id`);--> statement-breakpoint
CREATE INDEX `finance_transactions_pending` ON `finance_transactions` (`account_id`,`pending_source_id`);--> statement-breakpoint
CREATE TABLE `finance_views` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`definition` text NOT NULL,
	`scope` text NOT NULL,
	`scenario_id` text,
	`origin_chat_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`mode` text NOT NULL,
	`as_of` text NOT NULL,
	FOREIGN KEY (`scenario_id`) REFERENCES `finance_scenarios`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `finance_views_updated` ON `finance_views` (`updated_at`,`id`);--> statement-breakpoint
CREATE TABLE `finance_webhook_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`provider` text NOT NULL,
	`digest` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finance_webhook_digest` ON `finance_webhook_receipts` (`provider`,`digest`);