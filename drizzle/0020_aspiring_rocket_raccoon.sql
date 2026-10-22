ALTER TABLE `chat_sessions` ADD `service_tier` text;--> statement-breakpoint
ALTER TABLE `harness_settings` ADD `default_service_tier` text;--> statement-breakpoint
ALTER TABLE `triggers` ADD `service_tier` text;--> statement-breakpoint
ALTER TABLE `user_state` ADD `default_service_tier` text;