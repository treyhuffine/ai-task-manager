ALTER TABLE `decks` ADD `calendar_snapshot` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_state` ADD `workday_start` text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_state` ADD `workday_end` text DEFAULT '18:00' NOT NULL;