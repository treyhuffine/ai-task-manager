CREATE TABLE `agent_harness_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`harness` text NOT NULL,
	`operation` text NOT NULL,
	`upstream_provider_id` text NOT NULL,
	`status` text NOT NULL,
	`replacement_harness` text,
	`replacement_model` text,
	`last_error_code` text
);
--> statement-breakpoint
CREATE INDEX `idx_agent_harness_operations_status` ON `agent_harness_operations` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `agent_harness_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`harness` text NOT NULL,
	`enabled_models` text DEFAULT '[]' NOT NULL,
	`custom_models` text DEFAULT '[]' NOT NULL,
	`known_models` text,
	`default_model` text,
	`default_variant` text,
	`default_effort` text,
	`catalog_refreshed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_harness_settings_harness_unique` ON `agent_harness_settings` (`harness`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`device_type` text NOT NULL,
	`prefix` text NOT NULL,
	`suffix` text NOT NULL,
	`hash` text NOT NULL,
	`env` text NOT NULL,
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
CREATE INDEX `idx_api_keys_revoked` ON `api_keys` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `areas` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`emoji` text,
	`attachments` text DEFAULT '[]',
	`notes` text,
	`user_context` text,
	`status` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_events` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`session_id` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`content` text,
	`tool_name` text,
	`tool_input` text,
	`tool_is_error` integer,
	`tool_exit_code` integer,
	`raw` text,
	`external_event_id` text,
	`external_message_id` text,
	`external_turn_id` text,
	`external_tool_call_id` text,
	`external_parent_tool_call_id` text,
	`source_part_index` integer DEFAULT 0 NOT NULL,
	`attachments` text DEFAULT '[]',
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_events_external_uq` ON `chat_events` (`session_id`,`external_event_id`,`source_part_index`) WHERE "chat_events"."external_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_chat_events_session_created` ON `chat_events` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_events_tool_call_id` ON `chat_events` (`external_tool_call_id`);--> statement-breakpoint
CREATE TABLE `chat_refs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`session_id` text NOT NULL,
	`event_id` text,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`hydrate` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `chat_events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_refs_session_event` ON `chat_refs` (`session_id`,`event_id`);--> statement-breakpoint
CREATE INDEX `idx_chat_refs_entity` ON `chat_refs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chat_refs_session_pin_uq` ON `chat_refs` (`session_id`,`entity_type`,`entity_id`) WHERE "chat_refs"."event_id" IS NULL;--> statement-breakpoint
CREATE TABLE `chat_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`harness` text NOT NULL,
	`type` text NOT NULL,
	`surface_kind` text,
	`surface_ref` text,
	`status` text NOT NULL,
	`label` text,
	`scratch_pad` text,
	`workspace_id` text,
	`execution_id` text,
	`created_by_run_id` text,
	`last_outcome_event_at` text,
	`last_viewed_at` text,
	`unread_marker_at` text,
	`last_activity_at` text,
	`external_provider_type` text,
	`external_session_id` text,
	`external_transcript_path` text,
	`external_sync_offset` integer,
	`external_sync_last_event_id` text,
	`external_history_checkpoint` text,
	`permission_mode` text NOT NULL,
	`model` text,
	`model_variant` text,
	`effort` text,
	`pre_plan_mode` text,
	`tab_sort_key` text,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_external_provider_session_uq` ON `chat_sessions` (`external_provider_type`,`external_session_id`) WHERE "chat_sessions"."external_provider_type" IS NOT NULL AND "chat_sessions"."external_session_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_status` ON `chat_sessions` (`workspace_id`,`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_type_status` ON `chat_sessions` (`type`,`status`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_execution_status_activity` ON `chat_sessions` (`execution_id`,`status`,`last_activity_at`);--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`context` text,
	`context_tags` text DEFAULT '[]',
	`framing` text,
	`items` text DEFAULT '[]' NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`search_context` text,
	`model` text,
	`for_date` text,
	`superseded_at` text,
	`replaces_deck_id` text,
	`origin` text NOT NULL,
	`changes` text DEFAULT '[]' NOT NULL,
	`calendar_snapshot` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_decks_for_date_active` ON `decks` (`for_date`,`superseded_at`);--> statement-breakpoint
CREATE TABLE `entity_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_entity_links_target` ON `entity_links` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_links_source` ON `entity_links` (`source_type`,`source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `entity_links_edge_uq` ON `entity_links` (`source_type`,`source_id`,`target_type`,`target_id`);--> statement-breakpoint
CREATE TABLE `entity_projection_state` (
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_revision` integer DEFAULT 0 NOT NULL,
	`links_projected_revision` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`source_type`, `source_id`)
);
--> statement-breakpoint
CREATE TABLE `entity_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`source` text NOT NULL,
	`actor_session_id` text,
	`summary` text,
	`reverted_from_version_id` text,
	FOREIGN KEY (`actor_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_entity_versions_entity` ON `entity_versions` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_entity_versions_actor_session` ON `entity_versions` (`actor_session_id`);--> statement-breakpoint
CREATE TABLE `execution_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`output_event_id` text NOT NULL,
	`disposition` text NOT NULL,
	`actor_source` text NOT NULL,
	`actor_session_id` text,
	`note` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_execution_reviews_execution` ON `execution_reviews` (`execution_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_execution_reviews_output` ON `execution_reviews` (`output_event_id`);--> statement-breakpoint
CREATE TABLE `execution_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`task_id` text NOT NULL,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_execution_tasks_pair` ON `execution_tasks` (`execution_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_tasks_task` ON `execution_tasks` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_execution_tasks_execution` ON `execution_tasks` (`execution_id`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`workspace_id` text NOT NULL,
	`label` text,
	`worktree_path` text,
	`branch_name` text,
	`base_sha` text,
	`pr_number` integer,
	`setup_error` text,
	`setup_started_at` text,
	`setup_warning` text,
	`setup_script_status` text,
	`setup_script_error` text,
	`takeover_started_at` text,
	`takeover_base_sha` text,
	`takeover_branch` text,
	`takeover_token` text,
	`takeover_token_expires_at` text,
	`takeover_chat_session_id` text,
	`preview_urls` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`archived_at` text,
	`pinned_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`takeover_chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_executions_workspace_status` ON `executions` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_executions_takeover_token` ON `executions` (`takeover_token`) WHERE "executions"."takeover_token" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `external_session_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`chat_session_id` text NOT NULL,
	`provider_type` text NOT NULL,
	`external_session_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_path` text,
	`source_size` integer,
	`source_modified_at_ns` text,
	`source_content_sha256` text,
	`source_updated_at` text,
	`sync_offset` integer DEFAULT 0 NOT NULL,
	`sync_last_event_id` text,
	`history_checkpoint` text,
	`status` text NOT NULL,
	`last_scanned_at` text,
	`last_synced_at` text,
	`last_error` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_chatSessionId_unique` ON `external_session_imports` (`chat_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_source_uq` ON `external_session_imports` (`provider_type`,`external_session_id`);--> statement-breakpoint
CREATE INDEX `external_session_imports_status_idx` ON `external_session_imports` (`status`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`area_id` text,
	`task_id` text,
	`workspace_id` text,
	`title` text,
	`body` text NOT NULL,
	`url` text,
	`attachments` text DEFAULT '[]',
	`folded_headings` text DEFAULT '[]',
	`status` text NOT NULL,
	`context_tags` text DEFAULT '[]',
	`last_viewed_at` text,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_notes_area_id` ON `notes` (`area_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_task_id` ON `notes` (`task_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_workspace_id` ON `notes` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_notes_status` ON `notes` (`status`);--> statement-breakpoint
CREATE TABLE `notification_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`provider_id` text,
	`connection_id` text,
	`config` text DEFAULT '{}' NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`enabled` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_notification_channels_user_enabled` ON `notification_channels` (`user_id`,`enabled`);--> statement-breakpoint
CREATE INDEX `idx_notification_channels_connection` ON `notification_channels` (`connection_id`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`event_type` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`channel_id` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`event` text NOT NULL,
	`rendered` text,
	`provider_message_id` text,
	`last_error` text,
	`next_attempt_at` text,
	`sent_at` text,
	FOREIGN KEY (`channel_id`) REFERENCES `notification_channels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_notification_deliveries_dedupe_channel` ON `notification_deliveries` (`dedupe_key`,`channel_id`);--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_user_status` ON `notification_deliveries` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_notification_deliveries_next_attempt` ON `notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `preview_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`execution_id` text NOT NULL,
	`service` text,
	`preview_name` text NOT NULL,
	`port` integer,
	`pinned` integer NOT NULL,
	`last_viewed_at` text,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_preview_targets_execution` ON `preview_targets` (`execution_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_preview_targets_exec_default` ON `preview_targets` (`execution_id`) WHERE "preview_targets"."service" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_preview_targets_exec_service` ON `preview_targets` (`execution_id`,`service`) WHERE "preview_targets"."service" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `reference_folders` (
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
	FOREIGN KEY (`target_workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reference_folders_one_target" CHECK(("reference_folders"."path" IS NOT NULL) <> ("reference_folders"."target_workspace_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `idx_reference_folders_workspace` ON `reference_folders` (`workspace_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_reference_folders_target` ON `reference_folders` (`target_workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_global_alias` ON `reference_folders` (`alias`) WHERE "reference_folders"."workspace_id" IS NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_reference_folders_workspace_alias` ON `reference_folders` (`workspace_id`,`alias`) WHERE "reference_folders"."workspace_id" IS NOT NULL AND "reference_folders"."status" = 'active';--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`trigger_id` text,
	`workspace_id` text,
	`execution_id` text,
	`chat_session_id` text,
	`harness` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`trigger_payload` text,
	`scheduled_for` text,
	`status` text NOT NULL,
	`status_reason` text,
	`queued_at` text DEFAULT (datetime('now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	`duration_ms` integer,
	`model` text,
	`input_tokens` integer DEFAULT 0,
	`output_tokens` integer DEFAULT 0,
	`cached_input_tokens` integer DEFAULT 0,
	`cache_creation_input_tokens` integer DEFAULT 0,
	`cost_usd` real DEFAULT 0,
	`summary` text,
	`artifact_refs` text,
	`error_code` text,
	`error_message` text,
	FOREIGN KEY (`trigger_id`) REFERENCES `triggers`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_runs_trigger_status` ON `runs` (`trigger_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_runs_status_started` ON `runs` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_trigger_kind_started` ON `runs` (`trigger_kind`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_runs_execution_status` ON `runs` (`execution_id`,`status`);--> statement-breakpoint
CREATE TABLE `skill_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`use_count` integer DEFAULT 0 NOT NULL,
	`score` real DEFAULT 0 NOT NULL,
	`last_used_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skill_usage_name_unique` ON `skill_usage` (`name`);--> statement-breakpoint
CREATE TABLE `stream` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`raw_text` text NOT NULL,
	`source` text NOT NULL,
	`media` text NOT NULL,
	`origin` text NOT NULL,
	`external_source` text,
	`external_id` text,
	`external_payload` text,
	`status` text NOT NULL,
	`dismissed_by` text,
	`resurface_at` text,
	`attachments` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stream_external_id_uq` ON `stream` (`external_source`,`external_id`) WHERE "stream"."external_source" IS NOT NULL AND "stream"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `stream_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`stream_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`relation` text NOT NULL,
	`decision_id` text,
	FOREIGN KEY (`stream_id`) REFERENCES `stream`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decision_id`) REFERENCES `triage_decisions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_stream_links_stream` ON `stream_links` (`stream_id`);--> statement-breakpoint
CREATE INDEX `idx_stream_links_entity` ON `stream_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`task_id` text NOT NULL,
	`completed_at` text DEFAULT (datetime('now')) NOT NULL,
	`note` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_task_completions_task_id` ON `task_completions` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_status_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`task_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`command` text NOT NULL,
	`from_status` text NOT NULL,
	`to_status` text NOT NULL,
	`status_changed_count` integer NOT NULL,
	`actor_source` text NOT NULL,
	`actor_session_id` text,
	`execution_id` text,
	`run_id` text,
	`reason` text,
	`result` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_task_status_changes_task_key` ON `task_status_changes` (`task_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_task_status_changes_task` ON `task_status_changes` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`parent_id` text,
	`area_id` text,
	`workspace_id` text,
	`raw_input` text NOT NULL,
	`stream_item_id` text,
	`title` text NOT NULL,
	`description` text,
	`body` text,
	`user_context` text,
	`ai_context` text,
	`outcome` text,
	`last_progress_at` text,
	`energy` text,
	`effort` text,
	`context_tags` text DEFAULT '[]',
	`hard_deadline` text,
	`reminder_at` text,
	`resurface_after` text,
	`attachments` text DEFAULT '[]',
	`folded_headings` text DEFAULT '[]',
	`status` text NOT NULL,
	`status_changed_count` integer DEFAULT 0 NOT NULL,
	`status_changed_at` text,
	`sort_key` text,
	`blocked_on` text,
	`blocked_since` text,
	`recurrence` text,
	`next_recurrence_at` text,
	`target_frequency` integer,
	`times_deferred` integer DEFAULT 0 NOT NULL,
	`last_surfaced_at` text,
	`completed_at` text,
	`last_viewed_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stream_item_id`) REFERENCES `stream`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tasks_area_id` ON `tasks` (`area_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_workspace_id` ON `tasks` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_parent_id` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_sort_key` ON `tasks` (`sort_key`);--> statement-breakpoint
CREATE INDEX `idx_tasks_status_sort` ON `tasks` (`status`,`sort_key`);--> statement-breakpoint
CREATE TABLE `triage_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`pass_id` text,
	`stream_item_ids` text NOT NULL,
	`disposition` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`draft` text,
	`confidence` real,
	`rationale` text,
	`state` text NOT NULL,
	`corrected_disposition` text,
	`actor` text NOT NULL,
	`decided_at` text,
	`undone_at` text,
	`entity_version_id` text,
	FOREIGN KEY (`pass_id`) REFERENCES `triage_passes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_triage_decisions_pass` ON `triage_decisions` (`pass_id`);--> statement-breakpoint
CREATE INDEX `idx_triage_decisions_state` ON `triage_decisions` (`state`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_triage_decisions_disposition` ON `triage_decisions` (`disposition`,`state`);--> statement-breakpoint
CREATE TABLE `triage_passes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`session_id` text,
	`items_seen` integer DEFAULT 0 NOT NULL,
	`auto_applied` integer DEFAULT 0 NOT NULL,
	`proposed` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`completed_at` text,
	`digest_seen_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_triage_passes_status` ON `triage_passes` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `triggers` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer NOT NULL,
	`harness` text NOT NULL,
	`workspace_id` text,
	`target_kind` text NOT NULL,
	`prompt` text NOT NULL,
	`skill_hints` text,
	`kind` text NOT NULL,
	`cron_expression` text,
	`interval_seconds` integer,
	`run_at` text,
	`timezone` text,
	`active_hours_start` text,
	`active_hours_end` text,
	`concurrency_policy` text NOT NULL,
	`catch_up_policy` text NOT NULL,
	`max_catch_up_runs` integer NOT NULL,
	`owning_execution_id` text,
	`webhook_public_id` text,
	`webhook_secret_hash` text,
	`model` text,
	`effort` text,
	`timeout_seconds` integer,
	`next_run_at` text,
	`last_fired_at` text,
	`last_run_id` text,
	`last_run_status` text,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`disabled_reason` text,
	`deliver_result_to` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owning_execution_id`) REFERENCES `executions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_triggers_brain_name` ON `triggers` (`name`) WHERE "triggers"."workspace_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_triggers_workspace_name` ON `triggers` (`workspace_id`,`name`) WHERE "triggers"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_triggers_enabled_next_run` ON `triggers` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_triggers_webhook_public_id` ON `triggers` (`webhook_public_id`) WHERE "triggers"."webhook_public_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_triggers_workspace_status` ON `triggers` (`workspace_id`,`enabled`);--> statement-breakpoint
CREATE TABLE `user_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text,
	`active_area_id` text,
	`active_parent_task_id` text,
	`active_energy` text,
	`available_minutes` integer,
	`workday_start` text,
	`workday_end` text,
	`timezone` text,
	`description` text DEFAULT '' NOT NULL,
	`voice_auto_send` integer,
	`voice_model` text,
	`default_agent_harness` text,
	`default_agent_model` text,
	`default_agent_effort` text,
	`orchestrator_mode` text,
	`monthly_budget_usd` real,
	`stream_autonomy` text,
	`onboarded_at` text,
	FOREIGN KEY (`active_area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `web_push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`user_id` text DEFAULT 'local' NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_push_subscriptions_endpoint_unique` ON `web_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `idx_web_push_subscriptions_user` ON `web_push_subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`emoji` text,
	`attachments` text DEFAULT '[]',
	`cwd` text NOT NULL,
	`is_git` integer NOT NULL,
	`base_branch` text,
	`remote_name` text,
	`worktree_root` text,
	`files_to_copy` text NOT NULL,
	`connector_scopes` text DEFAULT '[]' NOT NULL,
	`setup_command` text,
	`teardown_command` text,
	`start_command` text,
	`area_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`collapsed` integer NOT NULL,
	`skip_live_confirm` integer NOT NULL,
	`browser_enabled` integer NOT NULL,
	`status` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`area_id`) REFERENCES `areas`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_status_position` ON `workspaces` (`status`,`position`);--> statement-breakpoint
CREATE INDEX `idx_workspaces_area_id` ON `workspaces` (`area_id`);