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
	`status` text DEFAULT 'importing' NOT NULL,
	`last_scanned_at` text,
	`last_synced_at` text,
	`last_error` text,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_chatSessionId_unique` ON `external_session_imports` (`chat_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_source_uq` ON `external_session_imports` (`provider_type`,`external_session_id`);--> statement-breakpoint
CREATE INDEX `external_session_imports_status_idx` ON `external_session_imports` (`status`);--> statement-breakpoint
DROP INDEX `chat_sessions_external_session_id_uq`;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `external_provider_type` text;--> statement-breakpoint
-- Move prototype historical imports out of the live CLI binding columns.
-- The deterministic id makes this safe if the data migration is inspected or
-- replayed manually during development.
INSERT OR IGNORE INTO `external_session_imports` (
	`id`, `created_at`, `updated_at`, `chat_session_id`, `provider_type`,
	`external_session_id`, `source_kind`, `source_path`, `source_size`,
	`sync_offset`, `sync_last_event_id`, `history_checkpoint`, `source_updated_at`,
	`status`, `last_scanned_at`, `last_synced_at`
)
SELECT
	'legacy:' || cs.`id`, cs.`created_at`, cs.`updated_at`, cs.`id`,
	COALESCE(
		NULLIF(cs.`surface_ref`, ''),
		CASE a.`harness`
			WHEN 'claude_code' THEN 'claude'
			WHEN 'claude' THEN 'claude'
			WHEN 'codex' THEN 'codex'
			WHEN 'cursor' THEN 'cursor'
			WHEN 'opencode' THEN 'opencode'
			ELSE a.`harness`
		END
	),
	cs.`external_session_id`,
	CASE WHEN cs.`external_history_checkpoint` IS NOT NULL THEN 'service' ELSE 'file' END,
	cs.`external_transcript_path`, cs.`external_sync_offset`,
	COALESCE(cs.`external_sync_offset`, 0), cs.`external_sync_last_event_id`,
	cs.`external_history_checkpoint`, cs.`updated_at`, 'current', cs.`updated_at`, cs.`updated_at`
FROM `chat_sessions` cs
JOIN `agents` a ON a.`id` = cs.`agent_id`
WHERE cs.`surface_kind` = 'imported_agent'
	AND cs.`external_session_id` IS NOT NULL;--> statement-breakpoint

UPDATE `chat_sessions`
SET `external_session_id` = NULL,
	`external_transcript_path` = NULL,
	`external_sync_offset` = NULL,
	`external_sync_last_event_id` = NULL,
	`external_history_checkpoint` = NULL,
	`external_provider_type` = NULL
WHERE `surface_kind` = 'imported_agent';--> statement-breakpoint

-- Existing live bindings predate the provider column. Derive their provider
-- from the owning executor so future ids are unique per harness, not globally.
UPDATE `chat_sessions`
SET `external_provider_type` = (
	SELECT CASE a.`harness`
		WHEN 'claude_code' THEN 'claude'
		WHEN 'claude' THEN 'claude'
		WHEN 'codex' THEN 'codex'
		WHEN 'cursor' THEN 'cursor'
		WHEN 'opencode' THEN 'opencode'
		ELSE a.`harness`
	END
	FROM `agents` a
	WHERE a.`id` = `chat_sessions`.`agent_id`
)
WHERE `external_session_id` IS NOT NULL
	AND `external_provider_type` IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX `chat_sessions_external_provider_session_uq` ON `chat_sessions` (`external_provider_type`,`external_session_id`) WHERE "chat_sessions"."external_provider_type" IS NOT NULL AND "chat_sessions"."external_session_id" IS NOT NULL;
