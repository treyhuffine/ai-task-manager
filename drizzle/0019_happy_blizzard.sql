DROP INDEX `chat_sessions_takeover_token_uq`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `worktree_path`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `branch_name`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `base_sha`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `pr_number`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `setup_error`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `setup_started_at`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `takeover_started_at`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `takeover_base_sha`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `takeover_branch`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `takeover_token`;--> statement-breakpoint
ALTER TABLE `chat_sessions` DROP COLUMN `takeover_token_expires_at`;