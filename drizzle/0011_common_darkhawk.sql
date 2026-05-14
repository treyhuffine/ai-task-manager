ALTER TABLE `chat_sessions` ADD `takeover_started_at` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `takeover_base_sha` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `takeover_branch` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `takeover_token` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `takeover_token_expires_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `chat_sessions_takeover_token_uq` ON `chat_sessions` (`takeover_token`) WHERE "chat_sessions"."takeover_token" IS NOT NULL;