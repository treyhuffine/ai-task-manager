CREATE TABLE `agent_coordination_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`request_id` text,
	`kind` text NOT NULL,
	`sender_kind` text NOT NULL,
	`source_session_id` text,
	`source_run_id` text,
	`target_address` text NOT NULL,
	`target_session_id` text,
	`event_id` text NOT NULL,
	`source_event_id` text,
	`payload` text NOT NULL,
	`status` text NOT NULL,
	`accepted_by_run_id` text,
	`continuation_run_id` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text,
	`error` text,
	FOREIGN KEY (`request_id`) REFERENCES `agent_coordination_requests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`continuation_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_pending` ON `agent_coordination_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_target` ON `agent_coordination_deliveries` (`target_session_id`,`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_request` ON `agent_coordination_deliveries` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_source` ON `agent_coordination_deliveries` (`source_session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_source_event` ON `agent_coordination_deliveries` (`source_event_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_coordination_deliveries_event` ON `agent_coordination_deliveries` (`event_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_source_run` ON `agent_coordination_deliveries` (`source_run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_accepted_run` ON `agent_coordination_deliveries` (`accepted_by_run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_deliveries_continuation` ON `agent_coordination_deliveries` (`continuation_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_coordination_initial` ON `agent_coordination_deliveries` (`request_id`) WHERE kind = 'request';--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_coordination_terminal` ON `agent_coordination_deliveries` (`request_id`) WHERE kind IN ('answer', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE `agent_coordination_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_session_id` text,
	`source_address` text NOT NULL,
	`target_address` text NOT NULL,
	`target_session_id` text,
	`request_key` text NOT NULL,
	`parent_request_id` text,
	`kind` text NOT NULL,
	`options` text,
	`status` text NOT NULL,
	`run_id` text,
	`response_event_id` text,
	FOREIGN KEY (`source_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_session_id`) REFERENCES `chat_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_request_id`) REFERENCES `agent_coordination_requests`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_agent_coordination_requests_key` ON `agent_coordination_requests` (`source_session_id`,`request_key`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_requests_target` ON `agent_coordination_requests` (`target_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_requests_source` ON `agent_coordination_requests` (`source_session_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_requests_status` ON `agent_coordination_requests` (`status`,`id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_requests_run` ON `agent_coordination_requests` (`run_id`);--> statement-breakpoint
CREATE INDEX `idx_agent_coordination_requests_parent` ON `agent_coordination_requests` (`parent_request_id`,`status`);--> statement-breakpoint
-- Only these two small coordination tables are replaced. Event and run rowids stay intact.
INSERT INTO agent_coordination_requests
(id,created_at,updated_at,source_session_id,source_address,target_address,target_session_id,request_key,parent_request_id,kind,options,status,run_id,response_event_id)
SELECT r.id,r.created_at,r.updated_at,r.source_session_id,r.source_address,r.target_address,r.target_session_id,r.request_key,
CASE WHEN p.kind IN ('question','delegation') THEN r.parent_request_id END,r.kind,r.options,
CASE WHEN r.status='sent' AND EXISTS (SELECT 1 FROM worker_commands w WHERE w.source_event_id=r.message_event_id AND w.state IN ('queued','sent','uncertain')) THEN 'queued' WHEN r.status='sent' THEN 'working' ELSE r.status END,r.run_id,r.response_event_id
FROM agent_requests r LEFT JOIN agent_requests p ON p.id=r.parent_request_id WHERE r.kind <> 'message';
--> statement-breakpoint
INSERT INTO agent_coordination_deliveries
(id,created_at,updated_at,request_id,kind,sender_kind,source_session_id,target_address,target_session_id,event_id,payload,status,accepted_by_run_id,attempts,next_attempt_at,error)
SELECT r.id,r.created_at,r.updated_at,CASE WHEN r.kind <> 'message' THEN r.id END,
CASE WHEN r.kind='message' THEN 'message' ELSE 'request' END,'agent',r.source_session_id,r.target_address,r.target_session_id,r.message_event_id,
json_object('version',1,'content',r.content,'requestKey',r.request_key,'attachments',json((SELECT COALESCE(json_group_array(json_object('fileName',COALESCE(json_extract(value,'$.file_name'),json_extract(value,'$.fileName')),'originalName',COALESCE(json_extract(value,'$.original_name'),json_extract(value,'$.originalName')),'mimeType',COALESCE(json_extract(value,'$.mime_type'),json_extract(value,'$.mimeType')),'size',json_extract(value,'$.size'),'uploadedAt',COALESCE(json_extract(value,'$.uploaded_at'),json_extract(value,'$.uploadedAt')))),'[]') FROM json_each(COALESCE(e.attachments,'[]')))),
'prompt',COALESCE(e.content,'[Ri agent ' || r.kind || '. Request ID: ' || r.id || '. Requesting chat: ' || r.source_session_id || '.]' || char(10) || r.content || char(10) || char(10) || CASE WHEN r.kind='message' THEN 'This is an informational message. No automatic response will be returned. If a separate reply is useful, use message_agent with the requesting chat’s session:<id> address and response:"none".' ELSE 'Answer this request in your final response, or use reply_agent_request with this request ID. Ri returns the answer to the requesting chat automatically. If you need another agent, use message_agent with response:"required" and finish your turn while waiting. Its answer resumes this chat. Keep work and consultations visible in their chats.' END)),
CASE WHEN r.status='completed' THEN 'accepted' WHEN w.state IN ('queued','sent','uncertain') AND e.id IS NOT NULL THEN 'delivered' WHEN r.status IN ('sent','waiting') AND (w.state IS NULL OR w.state NOT IN ('failed','stale','cancelled')) THEN 'accepted' WHEN r.status='cancelled' THEN 'cancelled' WHEN r.status='failed' THEN 'failed' WHEN e.id IS NOT NULL THEN 'delivered' ELSE 'queued' END,
CASE WHEN w.state IN ('queued','sent','uncertain','failed','stale','cancelled') OR r.status NOT IN ('completed','sent','waiting') THEN NULL ELSE r.run_id END,r.attempts,r.next_attempt_at,r.error
FROM agent_requests r LEFT JOIN chat_events e ON e.id=r.message_event_id LEFT JOIN worker_commands w ON w.source_event_id=r.message_event_id;
--> statement-breakpoint
INSERT INTO agent_coordination_deliveries
(id,created_at,updated_at,request_id,kind,sender_kind,source_session_id,target_address,target_session_id,event_id,payload,status,accepted_by_run_id,attempts,next_attempt_at,error)
SELECT d.id,d.created_at,d.updated_at,d.request_id,CASE WHEN d.kind='response' THEN 'answer' ELSE d.kind END,
CASE WHEN r.target_session_id IS NULL THEN 'system' ELSE 'agent' END,r.target_session_id,r.source_address,
destination.id,d.event_id,
json_object('version',1,'content',d.content,'originalRequest',r.content,'attachments',json((SELECT COALESCE(json_group_array(json_object('fileName',COALESCE(json_extract(value,'$.file_name'),json_extract(value,'$.fileName')),'originalName',COALESCE(json_extract(value,'$.original_name'),json_extract(value,'$.originalName')),'mimeType',COALESCE(json_extract(value,'$.mime_type'),json_extract(value,'$.mimeType')),'size',json_extract(value,'$.size'),'uploadedAt',COALESCE(json_extract(value,'$.uploaded_at'),json_extract(value,'$.uploadedAt')))),'[]') FROM json_each(COALESCE(e.attachments,'[]')))),
'prompt',COALESCE(e.content,'[Ri agent request ' || r.id || ': ' || d.kind || '.]' || char(10) || 'Request: ' || r.content || char(10) || 'Responding chat: ' || COALESCE(r.target_session_id,'Ri coordination service (work could not start)') || char(10) || d.content || char(10) || char(10) || CASE WHEN d.kind='blocked' THEN 'Inspect get_pending_input for the responding chat. Answer questions only within the user''s intent. Human-only permission approvals remain with the user.' ELSE 'Continue the original work using this outcome. This is a response to your earlier request, not a new user instruction.' END)),
CASE WHEN d.status='sent' AND w.state IN ('queued','sent','uncertain') THEN 'delivered' WHEN d.status='sent' AND w.state IN ('failed','stale','cancelled') THEN 'failed' WHEN d.status='sent' THEN 'accepted' WHEN d.delivered_to_session_id IS NOT NULL AND destination.id IS NULL THEN 'failed' WHEN d.status='failed' THEN 'failed' WHEN e.id IS NOT NULL THEN 'delivered' ELSE 'queued' END,
CASE WHEN d.status<>'sent' OR w.state IN ('queued','sent','uncertain','failed','stale','cancelled') THEN NULL ELSE (SELECT CASE WHEN count(*)=1 THEN min(id) END FROM runs WHERE source_event_id=d.event_id) END,CASE WHEN d.delivered_to_session_id IS NOT NULL AND destination.id IS NULL THEN max(1,d.attempts) ELSE d.attempts END,d.next_attempt_at,d.error
FROM agent_deliveries d JOIN agent_requests r ON r.id=d.request_id LEFT JOIN chat_events e ON e.id=d.event_id LEFT JOIN chat_sessions destination ON destination.id=COALESCE(d.delivered_to_session_id,e.session_id) LEFT JOIN worker_commands w ON w.source_event_id=d.event_id WHERE r.kind<>'message';
--> statement-breakpoint
DROP TABLE `agent_deliveries`;--> statement-breakpoint
DROP TABLE `agent_requests`;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `agent_coordination_policy` text;--> statement-breakpoint
ALTER TABLE `chat_sessions` ADD `coordination_held_at` text;--> statement-breakpoint
ALTER TABLE `executions` ADD `agent_coordination_policy` text;--> statement-breakpoint
ALTER TABLE `user_state` ADD `agent_coordination_policy` text;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `agent_coordination_policy` text;