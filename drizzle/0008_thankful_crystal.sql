DROP TABLE `chat_attachments`;--> statement-breakpoint
ALTER TABLE `chat_events` ADD `attachments` text DEFAULT '[]';