CREATE TABLE `scratchpad` (
	`id` integer PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`body` text NOT NULL
);
