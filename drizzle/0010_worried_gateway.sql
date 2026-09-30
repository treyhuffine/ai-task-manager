ALTER TABLE `runs` ADD `source_event_id` text;--> statement-breakpoint
CREATE INDEX `idx_runs_source_event` ON `runs` (`source_event_id`);