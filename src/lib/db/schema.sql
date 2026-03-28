-- Areas
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  notes TEXT,
  user_context TEXT,
  status TEXT NOT NULL DEFAULT 'active',           -- @type 'active' | 'inactive' | 'archived'
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Stream
CREATE TABLE IF NOT EXISTS stream (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'capture',           -- @type 'capture' | 'voice' | 'brain_dump' | 'chat'
  status TEXT NOT NULL DEFAULT 'pending',           -- @type 'pending' | 'promoted' | 'dismissed'
  dismissed_by TEXT,
  promoted_to_type TEXT,
  promoted_to_id TEXT,
  promoted_at TEXT,
  promotion_pass TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id),
  area_id TEXT REFERENCES areas(id),
  raw_input TEXT NOT NULL,
  stream_item_id TEXT REFERENCES stream(id),
  title TEXT NOT NULL,
  description TEXT,
  body TEXT,
  user_context TEXT,
  ai_context TEXT,
  outcome TEXT,
  heartbeat_days INTEGER,
  last_progress_at TEXT,
  energy TEXT,                                      -- @type 'deep' | 'light'
  effort TEXT,                                      -- @type 'trivial' | 'small' | 'medium' | 'large' | 'epic'
  estimated_minutes INTEGER,
  context_tags TEXT DEFAULT '[]',                   -- @json string[]
  hard_deadline TEXT,
  reminder_at TEXT,
  resurface_after TEXT,
  attachments TEXT DEFAULT '[]',                    -- @json string[]
  status TEXT NOT NULL DEFAULT 'active',            -- @type 'active' | 'done' | 'archived'
  sort_key TEXT,
  blocked_on TEXT,
  blocked_since TEXT,
  recurrence TEXT,
  next_recurrence_at TEXT,
  target_frequency INTEGER,
  times_deferred INTEGER NOT NULL DEFAULT 0,
  last_surfaced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_area_id ON tasks(area_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_sort_key ON tasks(sort_key);
CREATE INDEX IF NOT EXISTS idx_tasks_status_sort ON tasks(status, sort_key);
CREATE INDEX IF NOT EXISTS idx_tasks_blocked ON tasks(blocked_on) WHERE blocked_on IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON tasks(next_recurrence_at) WHERE recurrence IS NOT NULL;

-- Task completions
CREATE TABLE IF NOT EXISTS task_completions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_completions_task_id ON task_completions(task_id);

-- Notes
-- Any note can be appended to by the AI (thinking threads are just notes the AI keeps adding to).
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id),
  task_id TEXT REFERENCES tasks(id),
  stream_item_id TEXT REFERENCES stream(id),
  title TEXT,
  body TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'active',            -- @type 'active' | 'archived'
  context_tags TEXT DEFAULT '[]',                   -- @json string[]
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notes_area_id ON notes(area_id);
CREATE INDEX IF NOT EXISTS idx_notes_task_id ON notes(task_id);
CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);

-- FTS for tasks
CREATE VIRTUAL TABLE IF NOT EXISTS tasks_fts USING fts5(title, description, body, raw_input, content='tasks', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO tasks_fts(rowid, title, description, body, raw_input) VALUES (NEW.rowid, NEW.title, NEW.description, NEW.body, NEW.raw_input);
END;
CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, body, raw_input) VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.body, OLD.raw_input);
END;
CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO tasks_fts(tasks_fts, rowid, title, description, body, raw_input) VALUES ('delete', OLD.rowid, OLD.title, OLD.description, OLD.body, OLD.raw_input);
  INSERT INTO tasks_fts(rowid, title, description, body, raw_input) VALUES (NEW.rowid, NEW.title, NEW.description, NEW.body, NEW.raw_input);
END;

-- FTS for notes
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, body, content='notes', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, body) VALUES (NEW.rowid, NEW.title, NEW.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
END;
CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES ('delete', OLD.rowid, OLD.title, OLD.body);
  INSERT INTO notes_fts(rowid, title, body) VALUES (NEW.rowid, NEW.title, NEW.body);
END;

-- FTS for stream
CREATE VIRTUAL TABLE IF NOT EXISTS stream_fts USING fts5(raw_text, content='stream', content_rowid='rowid');

CREATE TRIGGER IF NOT EXISTS stream_ai AFTER INSERT ON stream BEGIN
  INSERT INTO stream_fts(rowid, raw_text) VALUES (NEW.rowid, NEW.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS stream_ad AFTER DELETE ON stream BEGIN
  INSERT INTO stream_fts(stream_fts, rowid, raw_text) VALUES ('delete', OLD.rowid, OLD.raw_text);
END;
CREATE TRIGGER IF NOT EXISTS stream_au AFTER UPDATE ON stream BEGIN
  INSERT INTO stream_fts(stream_fts, rowid, raw_text) VALUES ('delete', OLD.rowid, OLD.raw_text);
  INSERT INTO stream_fts(rowid, raw_text) VALUES (NEW.rowid, NEW.raw_text);
END;

-- Embeddings metadata
CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  text_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id);

-- Embeddings vector index (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_vec USING vec0(embedding float[1536]);
