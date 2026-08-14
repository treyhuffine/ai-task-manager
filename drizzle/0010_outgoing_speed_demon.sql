DROP INDEX `idx_chat_sessions_workspace_status`;--> statement-breakpoint
DROP INDEX `idx_chat_sessions_execution_status_activity`;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `last_activity_at` text;--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_workspace_status` ON `chat_sessions` (`workspace_id`,`status`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `idx_chat_sessions_execution_status_activity` ON `chat_sessions` (`execution_id`,`status`,`last_activity_at`);--> statement-breakpoint
-- Backfill (hand-added; drizzle-kit only emits the DDL).
--
-- Seeds every existing row so the new sort column is never NULL on a
-- populated database. Without this, `ORDER BY last_activity_at DESC` would
-- sink every pre-migration session below every new one, because SQLite
-- sorts NULL last in DESC.
--
-- Timestamps in this DB come in two formats (see src/lib/utils/timestamps.ts):
-- SQLite `datetime('now')` defaults are "YYYY-MM-DD HH:MM:SS" and app writes
-- are ISO. They do NOT compare correctly as raw strings (' ' < 'T'), so every
-- input is normalized to ISO-with-Z before the MAX. That also means the
-- backfilled value is in the same format every future write uses.
--
-- Note: SQLite's multi-argument max() returns NULL if ANY argument is NULL,
-- hence the COALESCE floors on the three nullable inputs. `started_at` is
-- NOT NULL so it needs none, and it guarantees a non-NULL result.
UPDATE `chat_sessions` SET `last_activity_at` = max(
  CASE WHEN `started_at` LIKE '%Z' THEN `started_at`
       ELSE replace(`started_at`, ' ', 'T') || '.000Z' END,
  coalesce(CASE WHEN `last_outcome_event_at` LIKE '%Z' THEN `last_outcome_event_at`
                ELSE replace(`last_outcome_event_at`, ' ', 'T') || '.000Z' END,
           '1970-01-01T00:00:00.000Z'),
  coalesce(CASE WHEN `unread_marker_at` LIKE '%Z' THEN `unread_marker_at`
                ELSE replace(`unread_marker_at`, ' ', 'T') || '.000Z' END,
           '1970-01-01T00:00:00.000Z'),
  coalesce((SELECT max(CASE WHEN ce.`created_at` LIKE '%Z' THEN ce.`created_at`
                           ELSE replace(ce.`created_at`, ' ', 'T') || '.000Z' END)
            FROM `chat_events` ce WHERE ce.`session_id` = `chat_sessions`.`id`),
           '1970-01-01T00:00:00.000Z')
);