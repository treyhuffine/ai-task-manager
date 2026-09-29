CREATE TABLE `device_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`device_id` text,
	`device_name` text,
	`created_by_api_key_id` text,
	`expires_at` text NOT NULL,
	`redeemed_at` text,
	`redeemed_by_api_key_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`redeemed_by_api_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_grants_hash_unique` ON `device_grants` (`hash`);--> statement-breakpoint
CREATE INDEX `idx_device_grants_device` ON `device_grants` (`device_id`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`platform` text,
	`hostname` text,
	`status` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text,
	`worker_key_id` text,
	`worker_protocol` integer,
	`worker_version` text,
	`harnesses` text,
	`reported_state` text,
	`acked_event_seq` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`worker_key_id`) REFERENCES `api_keys`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_devices_status` ON `devices` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_devices_worker_key` ON `devices` (`worker_key_id`);--> statement-breakpoint
CREATE TABLE `execution_placements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`device_id` text NOT NULL,
	`generation` integer NOT NULL,
	`worktree_path` text,
	`checkpoint_sha` text,
	`start_reason` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_placements_generation` ON `execution_placements` (`execution_id`,`generation`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_placements_open` ON `execution_placements` (`execution_id`) WHERE "execution_placements"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX `idx_execution_placements_device` ON `execution_placements` (`device_id`);--> statement-breakpoint
CREATE TABLE `execution_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`from_device_id` text NOT NULL,
	`to_device_id` text NOT NULL,
	`from_generation` integer NOT NULL,
	`to_generation` integer,
	`stage` text NOT NULL,
	`state` text NOT NULL,
	`include_untracked` text DEFAULT '[]' NOT NULL,
	`held_event_ids` text DEFAULT '[]' NOT NULL,
	`conversation_checkpoint_event_id` text,
	`branch` text,
	`remote` text,
	`checkpoint_sha` text,
	`target_worktree_path` text,
	`handoff` text,
	`failed_stage` text,
	`error` text,
	`finished_at` text,
	`requested_by_api_key_id` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_execution_transfers_execution` ON `execution_transfers` (`execution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_transfers_active` ON `execution_transfers` (`execution_id`) WHERE "execution_transfers"."state" = 'active';--> statement-breakpoint
CREATE TABLE `folder_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`device_id` text NOT NULL,
	`reference_folder_id` text NOT NULL,
	`path` text,
	`found` integer,
	`checked_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reference_folder_id`) REFERENCES `reference_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_folder_links_device_reference` ON `folder_links` (`device_id`,`reference_folder_id`);--> statement-breakpoint
CREATE INDEX `idx_folder_links_reference` ON `folder_links` (`reference_folder_id`);--> statement-breakpoint
CREATE TABLE `home` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`host_device_id` text NOT NULL,
	FOREIGN KEY (`host_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `native_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`chat_session_id` text NOT NULL,
	`device_id` text,
	`placement_id` text,
	`harness` text NOT NULL,
	`native_session_id` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`end_reason` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`placement_id`) REFERENCES `execution_placements`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_native_sessions_chat` ON `native_sessions` (`chat_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_native_sessions_open` ON `native_sessions` (`chat_session_id`) WHERE "native_sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `review_checkouts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`device_id` text NOT NULL,
	`source_device_id` text,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`commit_sha` text NOT NULL,
	`dirty` integer NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_review_checkouts_execution_device` ON `review_checkouts` (`execution_id`,`device_id`);--> statement-breakpoint
CREATE TABLE `worker_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`device_id` text NOT NULL,
	`seq` integer,
	`execution_id` text,
	`chat_session_id` text,
	`generation` integer,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`actor` text NOT NULL,
	`state` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`sent_at` text,
	`delivered_at` text,
	`finished_at` text,
	`result` text,
	`error` text,
	`source_event_id` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_worker_commands_source_event` ON `worker_commands` (`source_event_id`) WHERE "worker_commands"."source_event_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_worker_commands_device_seq` ON `worker_commands` (`device_id`,`seq`) WHERE "worker_commands"."seq" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_worker_commands_device_state` ON `worker_commands` (`device_id`,`state`);--> statement-breakpoint
CREATE INDEX `idx_worker_commands_chat` ON `worker_commands` (`chat_session_id`);--> statement-breakpoint
CREATE TABLE `workspace_setups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`workspace_id` text NOT NULL,
	`device_id` text NOT NULL,
	`source_path` text NOT NULL,
	`found` integer,
	`references` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`problem` text,
	`reported_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspace_setups_workspace_device` ON `workspace_setups` (`workspace_id`,`device_id`);--> statement-breakpoint
CREATE INDEX `idx_workspace_setups_device` ON `workspace_setups` (`device_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_reference_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`workspace_id` text,
	`alias` text NOT NULL,
	`path` text,
	`target_workspace_id` text,
	`description` text,
	`position` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_reference_folders`("id", "created_at", "updated_at", "workspace_id", "alias", "path", "target_workspace_id", "description", "position", "status", "archived_at") SELECT "id", "created_at", "updated_at", "workspace_id", "alias", "path", "target_workspace_id", "description", "position", "status", "archived_at" FROM `reference_folders`;--> statement-breakpoint
DROP TABLE `reference_folders`;--> statement-breakpoint
ALTER TABLE `__new_reference_folders` RENAME TO `reference_folders`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_reference_folders_workspace` ON `reference_folders` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reference_folders_target` ON `reference_folders` (`target_workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_global_alias` ON `reference_folders` (`alias`) WHERE "reference_folders"."workspace_id" IS NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_workspace_alias` ON `reference_folders` (`workspace_id`,`alias`) WHERE "reference_folders"."workspace_id" IS NOT NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
DROP INDEX `external_session_imports_source_uq`;--> statement-breakpoint
ALTER TABLE `external_session_imports` ADD `device_id` text REFERENCES devices(id);--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_remote_source_uq` ON `external_session_imports` (`device_id`,`provider_type`,`external_session_id`) WHERE "external_session_imports"."device_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_source_uq` ON `external_session_imports` (`provider_type`,`external_session_id`) WHERE "external_session_imports"."device_id" IS NULL;--> statement-breakpoint
ALTER TABLE `api_keys` ADD `device_id` text REFERENCES devices(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_api_keys_device` ON `api_keys` (`device_id`);--> statement-breakpoint
/* Every key belongs to a device (docs/homes-build.md, "Devices"). A key paired
   before devices gets a device of its own, named as the key is, of the type the
   key was given, with the key's id. The home's own keys (`host`) are left for
   the home's identity at first start, which gives them the home's device
   (`giveHostItsKeys`). Written by hand: the type is read before it's dropped. */
INSERT INTO `devices` (`id`, `created_at`, `updated_at`, `name`, `kind`, `status`, `revoked_at`)
  SELECT `id`, `created_at`, `updated_at`, `name`,
    CASE WHEN `device_type` IN ('computer', 'phone', 'tablet', 'service') THEN `device_type` ELSE 'other' END,
    CASE WHEN `revoked_at` IS NULL THEN 'active' ELSE 'revoked' END,
    `revoked_at`
  FROM `api_keys` WHERE `device_type` <> 'host';--> statement-breakpoint
UPDATE `api_keys` SET `device_id` = `id` WHERE `device_type` <> 'host';--> statement-breakpoint
ALTER TABLE `api_keys` DROP COLUMN `device_type`;--> statement-breakpoint
ALTER TABLE `chat_events` ADD `part_revision` integer;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `device_id` text REFERENCES devices(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `runs` ADD `source_event_id` text;--> statement-breakpoint
CREATE INDEX `idx_runs_source_event` ON `runs` (`source_event_id`);--> statement-breakpoint
ALTER TABLE `workspaces` ADD `default_device_id` text REFERENCES devices(id) ON DELETE set null;