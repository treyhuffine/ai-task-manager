ALTER TABLE `chat_events` ADD `queued_at` text;--> statement-breakpoint
CREATE INDEX `idx_chat_events_queued` ON `chat_events` (`session_id`,`queued_at`) WHERE "chat_events"."queued_at" IS NOT NULL;