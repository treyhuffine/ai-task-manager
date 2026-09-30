DROP INDEX `external_session_imports_source_uq`;--> statement-breakpoint
ALTER TABLE `external_session_imports` ADD `computer_id` text REFERENCES computers(id);--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_remote_source_uq` ON `external_session_imports` (`computer_id`,`provider_type`,`external_session_id`) WHERE "external_session_imports"."computer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `external_session_imports_source_uq` ON `external_session_imports` (`provider_type`,`external_session_id`) WHERE "external_session_imports"."computer_id" IS NULL;