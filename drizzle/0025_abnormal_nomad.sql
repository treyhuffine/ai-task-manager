ALTER TABLE `workspaces` ADD `setup_command` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `teardown_command` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `start_command` text;--> statement-breakpoint
UPDATE `workspaces` SET `start_command` = `preview_command` WHERE `preview_command` IS NOT NULL;