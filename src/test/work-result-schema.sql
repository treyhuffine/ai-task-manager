-- Test-only fixture DDL for the pending handoff schema. This is not a release migration.

CREATE TABLE IF NOT EXISTS "work_results" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  "user_id" text NOT NULL DEFAULT 'local',
  "actor_source" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text,
  "source_chat_session_id" text,
  "source_execution_id" text,
  "source_event_id" text,
  "request_hash" text NOT NULL,
  "title" text,
  "body" text NOT NULL,
  "attention" text,
  "attachments" text NOT NULL DEFAULT '[]',
  "links" text NOT NULL DEFAULT '[]',
  "code_revision" text,
  "supersedes_id" text,
  FOREIGN KEY ("actor_session_id") REFERENCES "chat_sessions" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("source_chat_session_id") REFERENCES "chat_sessions" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("source_execution_id") REFERENCES "executions" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("source_event_id") REFERENCES "chat_events" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("supersedes_id") REFERENCES "work_results" ("id") ON UPDATE no action ON DELETE restrict,
  CONSTRAINT "results_no_self_supersession" CHECK ("work_results"."supersedes_id" IS NULL OR "work_results"."supersedes_id" <> "work_results"."id")
);

CREATE INDEX IF NOT EXISTS "idx_work_results_source_chat" ON "work_results" ("source_chat_session_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "idx_work_results_source_execution" ON "work_results" ("source_execution_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "idx_work_results_user" ON "work_results" ("user_id", "created_at", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_work_results_successor" ON "work_results" ("supersedes_id") WHERE "work_results"."supersedes_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "work_result_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  "result_id" text NOT NULL,
  "task_id" text NOT NULL,
  FOREIGN KEY ("result_id") REFERENCES "work_results" ("id") ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_work_result_tasks_pair" ON "work_result_tasks" ("result_id", "task_id");

CREATE INDEX IF NOT EXISTS "idx_work_result_tasks_task" ON "work_result_tasks" ("task_id", "result_id");

CREATE TABLE IF NOT EXISTS "work_result_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  "user_id" text NOT NULL DEFAULT 'local',
  "result_id" text NOT NULL,
  "request_hash" text NOT NULL,
  "disposition" text NOT NULL,
  "actor_source" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text,
  "note" text,
  "attachments" text NOT NULL DEFAULT '[]',
  "context" text,
  "feedback_session_id" text,
  "feedback_message_id" text,
  FOREIGN KEY ("result_id") REFERENCES "work_results" ("id") ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY ("actor_session_id") REFERENCES "chat_sessions" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("feedback_session_id") REFERENCES "chat_sessions" ("id") ON UPDATE no action ON DELETE set null
);

CREATE INDEX IF NOT EXISTS "idx_work_result_decisions_result" ON "work_result_decisions" ("result_id", "created_at", "id");

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_work_result_decision_feedback" ON "work_result_decisions" ("feedback_session_id", "feedback_message_id") WHERE "work_result_decisions"."feedback_session_id" IS NOT NULL AND "work_result_decisions"."feedback_message_id" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "work_result_ai_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "created_at" text NOT NULL DEFAULT (datetime('now')),
  "updated_at" text NOT NULL DEFAULT (datetime('now')),
  "user_id" text NOT NULL DEFAULT 'local',
  "result_id" text NOT NULL,
  "actor_source" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text,
  "request_hash" text NOT NULL,
  "focus" text,
  "brief" text,
  "selection" text NOT NULL,
  "scope" text NOT NULL,
  "provenance" text NOT NULL,
  "reviewer_session_id" text,
  "run_id" text,
  "report_result_id" text,
  "status" text NOT NULL,
  "status_reason" text,
  FOREIGN KEY ("result_id") REFERENCES "work_results" ("id") ON UPDATE no action ON DELETE restrict,
  FOREIGN KEY ("actor_session_id") REFERENCES "chat_sessions" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("reviewer_session_id") REFERENCES "chat_sessions" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("run_id") REFERENCES "runs" ("id") ON UPDATE no action ON DELETE set null,
  FOREIGN KEY ("report_result_id") REFERENCES "work_results" ("id") ON UPDATE no action ON DELETE restrict,
  CONSTRAINT "result_ai_review_distinct_report" CHECK ("work_result_ai_reviews"."report_result_id" IS NULL OR "work_result_ai_reviews"."report_result_id" <> "work_result_ai_reviews"."result_id"),
  CONSTRAINT "result_ai_review_completed_report" CHECK ("work_result_ai_reviews"."status" <> 'completed' OR "work_result_ai_reviews"."report_result_id" IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS "work_result_ai_reviews_reportResultId_unique" ON "work_result_ai_reviews" ("report_result_id");

CREATE INDEX IF NOT EXISTS "idx_work_result_ai_reviews_result" ON "work_result_ai_reviews" ("result_id", "created_at", "id");

CREATE INDEX IF NOT EXISTS "idx_work_result_ai_reviews_session" ON "work_result_ai_reviews" ("reviewer_session_id");

CREATE INDEX IF NOT EXISTS "idx_work_result_ai_reviews_run" ON "work_result_ai_reviews" ("run_id");

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_work_result_ai_review_active" ON "work_result_ai_reviews" ("result_id") WHERE "work_result_ai_reviews"."status" IN ('queued', 'running');
