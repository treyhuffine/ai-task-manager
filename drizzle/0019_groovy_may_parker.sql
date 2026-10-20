CREATE TABLE `mcp_tool_results` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`chat_session_id` text NOT NULL,
	`server_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`source_ref` text NOT NULL,
	`tool` text NOT NULL,
	`resource_uri` text NOT NULL,
	`input` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`chat_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_tool_results_chat_session` ON `mcp_tool_results` (`chat_session_id`);