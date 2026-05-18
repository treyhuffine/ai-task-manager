DROP INDEX `idx_chat_events_queued`;--> statement-breakpoint
ALTER TABLE `chat_events` DROP COLUMN `queued_at`;