CREATE TABLE `app_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`name` text NOT NULL,
	`folder` text,
	`git_url` text,
	`notes` text,
	`created_by_ri` integer NOT NULL,
	`personal_app_id` text,
	`url` text,
	`change_folder` text,
	`change_branch` text
);
