CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`context` text,
	`context_tags` text DEFAULT '[]',
	`framing` text,
	`items` text DEFAULT '[]' NOT NULL,
	`alternatives` text DEFAULT '[]' NOT NULL,
	`search_context` text,
	`model` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL
);
