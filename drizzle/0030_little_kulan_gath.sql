ALTER TABLE `decks` ADD `for_date` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `superseded_at` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `replaces_deck_id` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `origin` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `changes` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_decks_for_date_active` ON `decks` (`for_date`,`superseded_at`);