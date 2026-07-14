-- ============================================================
-- FULL ASPIRATIONAL SCHEMA
-- This is the target architecture. Not all tables are implemented yet.
-- Source of truth for current app schema: src/lib/db/schema.ts
-- ============================================================

-- ============================================================
-- AREAS: Stable life/work domains
-- ============================================================
CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  emoji TEXT,                                       -- single emoji character for area icon
  image_url TEXT,
  notes TEXT,                                      -- strategic context, not a task
  user_context TEXT,                               -- natural language about priority, status, intent.
                                                   -- "Primary focus this quarter." "On hold until after the move."
  status TEXT NOT NULL DEFAULT 'active',            -- active | inactive | archived
  sort_order INTEGER NOT NULL DEFAULT 0,            -- UI display order only, does not signal priority to the AI
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- STREAM: The capture primitive. Every externalized thought
-- lands here first. Tasks, notes, and decisions are promotions
-- FROM the stream, not the default output.
-- ============================================================
CREATE TABLE stream (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,                          -- exactly what the user typed/spoke
  source TEXT NOT NULL DEFAULT 'capture',           -- capture | voice | brain_dump | chat
  status TEXT NOT NULL DEFAULT 'pending',           -- pending | promoted | dismissed
                                                    -- pending = marinating, promoted = became entity,
                                                    -- dismissed = removed (goes to recently archived for 30 days)
  dismissed_by TEXT,                               -- user | agent — who dismissed this item.
                                                    -- If AI recommends and user confirms → 'user'.
                                                    -- If auto-decayed by sweep → 'agent'.
                                                    -- Useful for recycle bin: AI-dismissed items warrant closer review.
  promoted_to_type TEXT,                           -- task | note | decision | null (if not promoted)
  promoted_to_id TEXT,                             -- FK to the created entity (if promoted)
  promoted_at TEXT,                                -- when promotion happened
  promotion_pass TEXT,                             -- urgent | batch | sweep (which pass promoted it)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- TASKS: The atomic unit of actionable work
-- A task with children IS a project (UI adapts, no separate table)
-- ============================================================
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id),             -- nesting: child → parent. A task with children = "project"
  area_id TEXT REFERENCES areas(id),               -- optional: orphan tasks are first-class

  -- Raw capture (preserved from stream promotion)
  raw_input TEXT NOT NULL,                         -- exactly what the user typed/said
  stream_item_id TEXT REFERENCES stream(id),       -- link back to originating stream item

  -- AI-processed fields
  title TEXT NOT NULL,                             -- clean, verb-first summary
  description TEXT,                                -- AI-expanded context

  -- User-editable workspace
  body TEXT,                                       -- rich markdown, checklists, context, links.
                                                   -- This is THE workspace. Where you track progress,
                                                   -- jot notes, and always know where you left off.

  -- Context fields (the primary signal for AI reasoning)
  user_context TEXT,                               -- user → AI: natural language about timing, priority, context.
                                                   -- "Need before March board meeting." "Blocks the launch."
                                                   -- "Not urgent, just tracking." Updated anytime by user.
  ai_context TEXT,                                 -- AI → AI: task-level scratchpad that persists across sessions.
                                                   -- "Deferred 3x since Feb, possible avoidance."
                                                   -- "Connected to Q3 launch goal." "User does this type on Fridays."
                                                   -- Updated by AI during triage, daily brief, and radar passes.

  -- Project-like fields (used when task has children)
  outcome TEXT,                                    -- "what does done look like?" for task-as-project
  heartbeat_days INTEGER,                          -- resurface cadence if idle (null = no heartbeat)
  last_progress_at TEXT,                           -- updated when child tasks complete

  -- Dimensions (AI-inferred, user-adjustable)
  energy TEXT,                                     -- deep | light
  effort TEXT,                                     -- trivial | small | medium | large | epic
                                                   -- Relative sizing for how much work a task represents.
                                                   -- "trivial" = a few minutes, no real thought.
                                                   -- "small" = an hour or two, well-scoped.
                                                   -- "medium" = a day or a few focused sessions.
                                                   -- "large" = multiple days, significant thought cycles.
                                                   -- "epic" = a week+ of sustained effort.
                                                   -- AI-inferred at triage. Primary effort signal for deep work tasks
                                                   -- where estimated_minutes doesn't map well.
  estimated_minutes INTEGER,                       -- truly optional. Best for well-defined, time-bounded tasks:
                                                   -- errands, appointments, workouts, defined subtasks.
                                                   -- NOT a primary deck filter. Calendar block size + energy replaces time math.
                                                   -- For open-ended deep work, use effort instead.
  context_tags TEXT DEFAULT '[]',                   -- JSON array: ["coding", "deep-work", "phone"]
                                                   -- AI-inferred, not user-maintained taxonomy

  -- Time
  hard_deadline TEXT,                              -- ISO datetime, ONLY for real immovable deadlines
  reminder_at TEXT,                                -- ISO datetime, triggers OS notification. Separate from
                                                   -- hard_deadline: "pick up kids at 3pm" needs an alert,
                                                   -- not a deadline. AI auto-sets from time-specific language.
  resurface_after TEXT,                            -- ISO datetime, boomerang resurfacing (no guilt)

  -- Attachments
  attachments TEXT DEFAULT '[]',                   -- JSON array: [{filename, path, mime_type, created_at}]
                                                   -- Files stored in ~/.eon/attachments/{task_id}/

  -- State (AI-managed)
  status TEXT NOT NULL DEFAULT 'active',            -- active | done | archived
  sort_key TEXT,                                   -- fractional index for ordering within active tasks (lexicographic)
                                                   -- uses fractional-indexing library. No full resorts needed.
  blocked_on TEXT,                                 -- nullable free text: what's blocking this. Can reference tasks, people,
                                                   -- external events, conditions — anything. The LLM reasons about
                                                   -- resolution during radar passes. No brittle FK that gets out of sync.
                                                   -- Tasks with blocked_on set are still 'active' — the AI factors the
                                                   -- block into sort position (pushes them down).
  blocked_since TEXT,                              -- when the block was set

  -- Recurrence (nullable — only set for recurring tasks)
  -- A task with recurrence IS NOT NULL is recurring. No task_type needed.
  recurrence TEXT,                                   -- natural language schedule: "4x/week, mornings preferred",
                                                     -- "first Thursday of every month", "every 10 days",
                                                     -- "2x per day, morning and afternoon".
                                                     -- Source of truth. LLM interprets period boundaries and timing.
  next_recurrence_at TEXT,                           -- ISO datetime, nullable. When this recurring task should next
                                                     -- enter active consideration. Morning triage queries
                                                     -- WHERE recurrence IS NOT NULL AND next_recurrence_at <= today.
                                                     -- On completion, AI recomputes this value.
  target_frequency INTEGER,                          -- completions per period (e.g., 4 for "4x/week")

  -- Tracking
  times_deferred INTEGER NOT NULL DEFAULT 0,        -- how many times user said "not now"
  last_surfaced_at TEXT,                            -- when AI last showed this to user

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ============================================================
-- TASK COMPLETIONS: Immutable event log for recurring tasks
-- Each completion is a row. Period counts, streaks, and
-- last-completed are derived from this log, not stored as
-- mutable state on the task.
-- ============================================================
CREATE TABLE task_completions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT                                              -- optional context: "only 10 min", "full session"
);

-- ============================================================
-- NOTES: Non-actionable captures (learning, thinking, reference)
-- Notes are NOT tasks. No sort positions, no deadlines, no deck.
-- Any note can be appended to by the AI (thinking threads are just notes the AI keeps adding to).
-- ============================================================
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id),               -- optional: orphan notes are first-class
  task_id TEXT REFERENCES tasks(id),               -- optional: link to related task
  stream_item_id TEXT REFERENCES stream(id),       -- link back to originating stream item (if promoted from stream)
  title TEXT,                                      -- optional: not all notes need a title
  body TEXT NOT NULL,                               -- rich markdown content
  url TEXT,                                        -- optional: if present, note is a "bookmark" in the UI
  status TEXT NOT NULL DEFAULT 'active',            -- active | archived (no 'done' — notes don't complete)
  context_tags TEXT DEFAULT '[]',                   -- AI-inferred tags for search/filtering
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- DECKS: Persisted daily deck plans
-- JSON columns store ranked items and alternatives by task ID.
-- Items track source (ai | user) for manual additions.
-- ============================================================
CREATE TABLE decks (
  id TEXT PRIMARY KEY,
  context TEXT,                                      -- user's free-text input from intake
  context_tags TEXT DEFAULT '[]',                    -- JSON array: chips selected at intake
  framing TEXT,                                      -- AI-generated one-liner about the day's shape
  items TEXT NOT NULL DEFAULT '[]',                  -- JSON array: [{taskId, rationale, continuityContext, source}]
  alternatives TEXT NOT NULL DEFAULT '[]',           -- JSON array: [{taskId, reason}]
  search_context TEXT,                               -- serialised tool-call results from context-gathering phase
  model TEXT,                                        -- which model generated this deck
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- GOALS: Strategic outcomes that give direction
-- ============================================================
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id),               -- optional: cross-cutting goals have no area
  title TEXT NOT NULL,                              -- the Objective: "Launch Bounce to paying customers"
  description TEXT,                                 -- why this matters, strategic context
  key_results TEXT DEFAULT '[]',                    -- JSON array: [{title, target_value, current_value, unit, done}]
                                                    -- e.g. [{"title":"Reach 100 paying customers","target_value":"100","current_value":"34","unit":"customers","done":false}]
  horizon TEXT NOT NULL DEFAULT 'quarterly',        -- quarterly | yearly | open_ended
  status TEXT NOT NULL DEFAULT 'active',            -- active | achieved | paused | abandoned
  review_cadence_days INTEGER NOT NULL DEFAULT 7,   -- how often AI resurfaces for check-in
  last_reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- DECISIONS: First-class entity for pending and made decisions
-- ============================================================
CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id),               -- optional: strategic decisions may be cross-cutting

  -- Core
  title TEXT NOT NULL,                              -- "B2B or B2C?" / "Auth framework choice"
  body TEXT,                                        -- Full context, options considered, analysis
  status TEXT NOT NULL DEFAULT 'pending',            -- pending | made | superseded | revisited

  -- Outcome (populated when status = made)
  outcome TEXT,                                     -- What was decided: "Going with B2B"
  rationale TEXT,                                   -- Why: "Higher ACV, less support volume, better fit for our team"
  decided_at TEXT,                                  -- When the decision was made

  -- AI
  ai_context TEXT,                                  -- AI's working notes on this decision
  context_tags TEXT DEFAULT '[]',                   -- AI-inferred tags

  -- Meta
  raw_input TEXT,                                   -- Original capture text (if from triage)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- CALENDAR: Cached external calendar events
-- ============================================================
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  external_id TEXT,                                 -- provider's event ID
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,                         -- ISO datetime
  end_time TEXT NOT NULL,                           -- ISO datetime
  is_all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  attendees TEXT,                                   -- JSON array of names/emails
  source TEXT NOT NULL DEFAULT 'google',            -- google | apple | manual
  synced_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- USER STATE: Ephemeral current focus/mode + user profile
-- ============================================================
CREATE TABLE user_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),            -- singleton row
  active_area_id TEXT REFERENCES areas(id),
  active_parent_task_id TEXT REFERENCES tasks(id),   -- scoped to a "project" (task with children)
  active_energy TEXT,                                 -- deep | light (energy toggle state)
  available_minutes INTEGER,                          -- inferred from calendar, not user-managed
  description TEXT NOT NULL DEFAULT '',               -- user's personal description/prompt for AI personalization
  voice_auto_send INTEGER NOT NULL DEFAULT 1,          -- boolean: when true, voice input sends immediately;
                                                       -- when false, voice transcription drops into the text box for editing
  voice_model TEXT NOT NULL DEFAULT 'local/parakeet-tdt-0.6b-v3',  -- provider/model format: provider routes the request, model name passes through
                                                       -- local/*: self-hosted at LOCAL_SPEECH_TO_TEXT_URL (parakeet-tdt-0.6b-v3, parakeet-tdt-0.6b-v2, etc.)
                                                       -- groq/*: Groq cloud via GROQ_API_KEY (whisper-large-v3-turbo, etc.)
                                                       -- openai/*: OpenAI cloud via OPENAI_API_KEY (whisper-1, etc.)
                                                       -- web/speech-recognition: browser Speech API, no config needed
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- SESSIONS: Daily planning records
-- Context blocks are stored as structured JSON within ai_plan,
-- not as separate entities. See section 5.3.
-- ============================================================
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  session_type TEXT NOT NULL DEFAULT 'morning',      -- morning | midday | evening | weekly
  ai_plan TEXT,                                      -- JSON: plan + context blocks proposed by AI
  user_adjustments TEXT,                             -- JSON: what user changed
  reflection TEXT,                                   -- optional end-of-day notes
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- AGENT ACTIVITY LOG: AI action audit trail
-- ============================================================
CREATE TABLE agent_activity (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,                         -- task | note | area | goal | decision | session
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,                              -- created | categorized | resurfaced | archived |
                                                     -- sort_changed | flagged_stale | flagged_overcommit |
                                                     -- suggested_next_action | decayed
  description TEXT NOT NULL,                         -- human-readable: "Moved 'Call roofer' to today..."
  details TEXT,                                      -- JSON: full context of the change
  user_overridden INTEGER NOT NULL DEFAULT 0,        -- did the user override this?
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- TEMPORAL MEMORY: Daily observations, context, session notes
-- One row per day. AI reads today + last 7 days.
-- Temporal context ages out naturally (outside read window).
-- ============================================================
CREATE TABLE temporal_memory (
  id TEXT PRIMARY KEY,                               -- UUIDv7
  date TEXT NOT NULL UNIQUE,                         -- YYYY-MM-DD (one row per day)
  content TEXT NOT NULL,                             -- markdown: context, observations, session notes
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- AI INFERENCES: Raw AI output audit trail
-- ============================================================
CREATE TABLE ai_inferences (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,                         -- capture | deck | plan | nudge | radar
  source_id TEXT,                                    -- related entity ID
  model TEXT NOT NULL,                               -- which model was used
  input_summary TEXT,                                -- brief description of what was sent
  output_json TEXT NOT NULL,                         -- raw AI response
  applied INTEGER NOT NULL DEFAULT 0,                -- was this applied to the system?
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_resurface ON tasks(resurface_after);
CREATE INDEX idx_tasks_deadline ON tasks(hard_deadline);
CREATE INDEX idx_tasks_sort ON tasks(status, sort_key);
CREATE INDEX idx_tasks_recurrence ON tasks(next_recurrence_at) WHERE recurrence IS NOT NULL;
CREATE INDEX idx_tasks_blocked ON tasks(blocked_on) WHERE blocked_on IS NOT NULL;
CREATE INDEX idx_completions_task ON task_completions(task_id, completed_at);
CREATE INDEX idx_decisions_status ON decisions(status);
CREATE INDEX idx_decisions_area ON decisions(area_id);
CREATE INDEX idx_notes_area ON notes(area_id);
CREATE INDEX idx_notes_task ON notes(task_id);
CREATE INDEX idx_notes_status ON notes(status);
CREATE INDEX idx_tasks_sort_key ON tasks(sort_key);
CREATE INDEX idx_calendar_time ON calendar_events(start_time, end_time);
CREATE INDEX idx_agent_activity_entity ON agent_activity(entity_type, entity_id);
CREATE INDEX idx_agent_activity_time ON agent_activity(created_at);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_area ON goals(area_id);
CREATE INDEX idx_temporal_memory_date ON temporal_memory(date);

-- Embeddings (via sqlite-vec)
-- Metadata lives in a regular table; embeddings_vec uses the same integer rowid.
CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,              -- 'task', 'note', or 'stream'
  entity_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_embeddings_entity ON embeddings(entity_type, entity_id);

CREATE VIRTUAL TABLE embeddings_vec USING vec0(
  embedding float[1536] distance_metric=cosine
);
