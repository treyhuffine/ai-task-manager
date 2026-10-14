ALTER TABLE `chat_sessions` ADD `label_source` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `label_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `executions` ADD `label_revision` integer DEFAULT 0 NOT NULL;