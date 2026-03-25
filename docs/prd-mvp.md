# Eon — MVP PRD

## What We're Building

A task management app where the AI does the organizing and the human does the work. You capture freely, the AI triages, and you always know what to work on next.

This MVP scopes down the full Eon vision to one thing done well: **AI-powered task management with zero maintenance tax.**

---

## What's In (MVP)

### Core Loop

1. **Capture** — type or voice a thought, it lands in the stream
2. **AI triage** — the AI classifies, prioritizes, and organizes in the background
3. **Execute** — open the app, see your top task, do it, mark done, get the next one
4. **Repeat** — the AI manages the queue so you never stare at a list wondering what to do

### Entities

- **Tasks** — the atomic unit of work. AI-managed status buckets: `now`, `next`, `backlog`, `waiting`, `someday`, `done`, `archived`
- **Notes** — non-actionable captures: thinking, reference, context. Linked to tasks or free-floating
- **Areas** — stable life/work domains (e.g., "Bounce", "Health", "Personal"). Tasks can belong to an area or be orphans

### Task Properties (AI-inferred, user-adjustable)

- `title` — clean, verb-first summary
- `body` — markdown workspace for progress tracking, checklists, context
- `status` — GTD-inspired buckets, AI-managed
- `energy` — deep | light
- `effort` — trivial | small | medium | large | epic
- `hard_deadline` — only for real, external, immovable deadlines (rare)
- `resurface_after` — boomerang resurfacing, no guilt
- `user_context` — user tells the AI what matters ("blocks the launch", "need before board meeting")
- `ai_context` — AI's scratchpad ("deferred 3x, possible avoidance")
- `parent_id` — nesting: a task with children IS a project (no separate entity)
- `area_id` — optional area assignment
- `waiting_on` — free text describing what's blocking

### Capture (The Stream)

- Global text input — always visible, Cmd+K style
- Voice input via speech-to-text
- Brain dump mode — larger text area, batch processing on close
- Every capture lands in the stream first, then gets promoted to task/note or dismissed
- AI detects urgency immediately; everything else marinates for batch processing
- Three exits: promoted (became entity), dismissed (handled/irrelevant), elevated (surfaced for user's call)

### AI Functions

**Urgency detection** (immediate, on capture)

- Scans for time-specific language, deadlines, urgency signals
- Processes immediately if urgent; lets it marinate if not

**Triage** (batch, ~2-3 min after capture burst settles + daily sweep)

- Classifies stream items as task or note
- Infers title, energy, effort, area, status bucket
- Detects duplicates against existing tasks
- Groups related fragments into thinking threads (notes)

**Deck generation** (morning + after completions)

- Selects 3-7 tasks for the `now` bucket
- Provides rationale for each recommendation
- Considers deadlines, energy, effort, area balance, deferral history
- Cross-mode alternate: always shows one task from the opposite energy type

**Radar** (continuous background)

- Stale projects (no progress in N days)
- Repeated deferrals (possible avoidance)
- Approaching deadlines
- Projects without a next action
- Near-complete tasks worth finishing
- Waiting-on items due for follow-up

### UI Layout (Building to Existing Design)

**Main field (center)**

- Focus card: the #1 recommended task with rationale
- Light/Deep energy toggle
- Project scope filter
- Strategic queue: remaining tasks, opacity-faded by priority
- Command input at the bottom (capture bar)

**Shelf (right panel)**

- Tabs: Tasks, Stream, Notes
- Tasks tab: all tasks, filterable/sortable
- Stream tab: recent captures with status annotations
- Notes tab: all notes

**Top HUD**

- Date, greeting, theme toggle

**Bottom HUD**

- Status info, quick stats

### What the Agents Sidebar Becomes (MVP)

The left PowerRail with agent workspaces is **not MVP**. In the MVP layout, the left sidebar is either:

- Hidden entirely (more space for task management), or
- Simplified to just area/project navigation

### Data Layer

- Local-first (TBD) SQLLite PostgreSQL via PGLite (lightweight Postgres compiled to WASM, runs in-browser and Node)
- Tables: `areas`, `stream`, `tasks`, `notes`, `agent_activity`
- Behind repository interfaces for future backend swaps
- PGLite gives us full Postgres compatibility (JSONB, arrays, extensions) with zero server setup
- UUIDv7 for all IDs

### AI Provider

- Claude API (primary), with provider abstraction for future flexibility
- Structured output for triage responses
- Streaming for chat-style interactions

---

## What's Out (Post-MVP)

- **Agent workspaces / delegation** — the left sidebar agent system, AI executing tasks
- **Deck experience** — the card-swipe Now Deck UX. MVP uses a simpler focus card + list
- **Goals / OKRs** — strategic layer with key results tracking
- **Decisions entity** — first-class decision tracking
- **People entity** — contact linking and meeting prep
- **Calendar integration** — syncing external calendars, context blocks
- **Habits / Routines / Rituals** — recurring task types with streak tracking
- **Weekly pulse / shutdown summary** — AI-generated retrospectives
- **Onboarding flow** — we'll import Notion data manually for now
- **Embeddings / vector search** — semantic search and duplicate detection via sqlite-vec
- **Multi-device / cloud sync** — local-only for now
- **Notifications / reminders** — browser notification API
- **Temporal memory** — daily observation log with aging

---

## Data Model (MVP Subset)

```sql
CREATE TABLE areas (
  id TEXT PRIMARY KEY,              -- UUIDv7
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | paused | archived
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stream (
  id TEXT PRIMARY KEY,
  raw_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'capture',  -- capture | voice | brain_dump
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | promoted | dismissed
  dismissed_by TEXT,                       -- user | agent
  promoted_to_type TEXT,                   -- task | note | null
  promoted_to_id TEXT,
  promoted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
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

  -- Project fields (when task has children)
  outcome TEXT,
  heartbeat_days INTEGER,
  last_progress_at TIMESTAMPTZ,

  -- Dimensions
  energy TEXT,                       -- deep | light
  effort TEXT,                       -- trivial | small | medium | large | epic

  -- Time
  hard_deadline TIMESTAMPTZ,
  resurface_after TIMESTAMPTZ,

  -- State
  status TEXT NOT NULL DEFAULT 'next',  -- now | next | backlog | waiting | someday | done | archived
  sort_key TEXT,
  waiting_on TEXT,
  waiting_since TIMESTAMPTZ,

  -- Tracking
  times_deferred INTEGER NOT NULL DEFAULT 0,
  last_surfaced_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id),
  task_id TEXT REFERENCES tasks(id),
  stream_item_id TEXT REFERENCES stream(id),

  title TEXT,
  body TEXT NOT NULL,
  is_thread BOOLEAN NOT NULL DEFAULT false,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_activity (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  details JSONB,
  user_overridden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_parent ON tasks(parent_id);
CREATE INDEX idx_tasks_area ON tasks(area_id);
CREATE INDEX idx_tasks_sort ON tasks(status, sort_key);
CREATE INDEX idx_tasks_resurface ON tasks(resurface_after);
CREATE INDEX idx_tasks_deadline ON tasks(hard_deadline);
CREATE INDEX idx_notes_area ON notes(area_id);
CREATE INDEX idx_notes_task ON notes(task_id);
CREATE INDEX idx_agent_activity_entity ON agent_activity(entity_type, entity_id);
```

---

## AI System (MVP Subset)

### 1. Urgency Detection (on capture)

**Trigger:** Each stream item as captured.

**Input:** Raw text + current date/time.

**Output:** `{ urgent: boolean }`. If urgent, also classify and extract structured fields immediately.

Process immediately when: time-specific language, deadline language, urgency signals.
Let marinate when: no time pressure, thinking/riffing, fragments, low-intent, ambiguous.

### 2. Batch Triage (after capture burst settles + daily sweep)

**Trigger:** ~2-3 min after last capture in a burst, or daily sweep.

**Input:** All pending stream items + existing tasks/notes for context.

**Output per item:** Promote to task (with all fields), promote to note, or recommend dismissal.

The AI:

- Generates a clean title
- Infers energy, effort, area
- Places in the right status bucket
- Detects if it relates to an existing task or note
- Groups related fragments into threads

### 3. Deck Generation (morning + after completions)

**Trigger:** App open (morning), after task completion, manual refresh.

**Input:** All tasks in `now` and `next` buckets + area context + user_context/ai_context.

**Output:** Ordered list of 3-7 tasks for `now`, each with a one-line rationale.

The AI:

- Considers deadlines, energy match, effort size, area balance
- Ensures cross-mode alternate (deep work always has a light option visible)
- Provides rationale: "due tomorrow", "quick win, 15 min gap", "this project hasn't moved in 2 weeks"

### 4. Radar Scan (periodic background)

**Trigger:** Daily, or on-demand.

**Input:** All non-done tasks + completion history + area context.

**Output:** List of 3-7 items needing attention with recommended actions.

---

## Product Principles (Carried from Full PRD)

1. **The human captures and executes. The AI does everything else.**
2. **Present recommendations, not options.** Single best action with a reason.
3. **Transparency builds trust.** Every AI recommendation has a brief rationale.
4. **Deadlines are sacred.** Only real deadlines get due dates. Everything else boomerangs.
5. **Guilt is a bug.** No red badges for flexible items. No backlog counter shame.
6. **Minimal state.** AI infers; humans override when needed; corrections are one-tap.

---

## Notion Import (Manual, Pre-MVP)

We'll manually import existing tasks and notes from Notion before launch. This is a one-time script, not a product feature. The script:

- Reads Notion export (CSV or API)
- Maps to Eon task/note schema
- Assigns areas based on Notion database/page structure
- Places everything in `next` or `backlog` for the AI to triage on first run

---

## Success Criteria

The MVP works when:

1. I can capture a thought in under 2 seconds
2. The AI correctly triages ~80% of captures without correction
3. I open the app and know what to do in under 10 seconds
4. I never have to manually organize, tag, or prioritize
5. Tasks from Notion are in the system and surfacing correctly
6. The whole thing runs locally via PGLite and SQLLite with no cloud dependency (except AI API calls)
