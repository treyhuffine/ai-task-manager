# Eon Filesystem Prototype — PRD

A plain-file, zero-dependency prototype of Eon managed entirely by a general-purpose AI agent. The AI reads/writes JSON files as the data store. No database, no app server, no UI — just files and an AI that reasons about them.

## Why This Version

Validate the core data model and AI reasoning before building infrastructure. A general-purpose AI agent (Claude, ChatGPT, etc.) can be the "app" — the user talks to it, and it manages the filesystem directly. This tests whether the entity model, status buckets, and AI reasoning patterns actually work for real daily use.

---

## Data Storage

**One JSON file per entity type** in a `data/` directory:

```
eon/
├── data/
│   ├── areas.json        # Array of area objects
│   ├── tasks.json        # Array of task objects
│   ├── notes.json        # Array of note objects
│   ├── goals.json        # Array of goal objects
│   └── people.json       # Array of person objects
├── memory/
│   ├── user.md           # AI's long-term understanding of this user
│   └── daily/            # One markdown file per day
│       ├── 2026-03-03.md
│       └── ...
└── README.md             # System instructions for the AI agent
```

### Why JSON, Not Markdown

- AI can parse/write JSON natively and reliably
- Structured fields (status, dates, IDs) stay typed and queryable
- An AI agent can load an entire file into context — a single user's tasks won't exceed a few hundred items, so "querying" is just reasoning over the full array
- No joins needed — IDs reference across files, and the AI resolves them by reading both files

### Why Not SQLite

- Adds a dependency and tooling requirement
- A general-purpose AI agent can't execute SQL directly (it would need a runtime)
- For prototype scale (< 500 items per entity), loading the full JSON file IS the query
- If the dataset grows, we can always migrate later — the schema is the same

### How the AI Searches and Filters

The AI loads the relevant JSON file(s) into context and reasons directly. For a single user's data, this is fine — tasks.json at 200 items is ~50KB, well within any model's context window.

For more complex operations (e.g., "show me all tasks in the Bounce area that are in `next` status with `deep` energy"), the AI can:
1. Read the file and reason about it directly (preferred, simplest)
2. Write a JavaScript snippet to filter/sort if it wants precision (optional)
3. Use `jq` on the command line if available (optional)

The AI should **not** need to be told how to filter. It reads the data, understands the schema, and reasons. That's the whole point.

---

## Entity Schemas

### Areas

Stable life/work domains. Typically 3-7 active.

```json
{
  "id": "area_01",
  "name": "Bounce",
  "description": "B2B SaaS product — main startup",
  "notes": "Pivoting to B2B. Current ARR: $X. Focus this quarter: reduce churn.",
  "status": "active",
  "created_at": "2026-03-01T00:00:00Z",
  "updated_at": "2026-03-01T00:00:00Z"
}
```

**Fields:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique identifier (e.g., `area_01` or UUID) |
| `name` | string | Short name |
| `description` | string | What this area is |
| `notes` | string | Strategic context, current state, important info |
| `status` | enum | `active \| paused \| someday \| archived` |
| `created_at` | ISO datetime | |
| `updated_at` | ISO datetime | |

### Tasks

The core entity. A task is the atomic unit of actionable work.

```json
{
  "id": "task_01",
  "parent_id": null,
  "area_id": "area_01",
  "title": "Build the auth flow for Bounce",
  "body": "Using OAuth2 with Google. Need to handle token refresh.\n\n- [x] Set up OAuth client\n- [ ] Token refresh logic\n- [ ] Error handling",
  "user_context": "Blocks the launch. Need this before we can onboard beta users.",
  "ai_context": "Connected to 'Launch Bounce' goal. User started this 5 days ago, made progress on OAuth client. Token refresh is the remaining deep work.",
  "raw_input": "build the auth flow for bounce, blocks launch",
  "task_type": "task",
  "energy": "deep",
  "status": "now",
  "waiting_on": null,
  "hard_deadline": null,
  "tags": ["coding", "deep-work"],
  "person_id": null,
  "recurrence": null,
  "completions": [],
  "times_deferred": 0,
  "created_at": "2026-02-26T00:00:00Z",
  "updated_at": "2026-03-03T00:00:00Z",
  "completed_at": null
}
```

**Fields:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique identifier |
| `parent_id` | string? | References another task. A task with children = "project" |
| `area_id` | string? | References an area. Null = orphan (that's fine) |
| `raw_input` | string | Exactly what the user typed/said. Preserved for audit and correction. |
| `title` | string | Clean, verb-first summary (AI-generated from raw_input) |
| `body` | string? | Markdown workspace — checklists, notes, progress. THE workspace for this task. |
| `user_context` | string? | User tells the AI what matters: timing, priority, blockers. Natural language. |
| `ai_context` | string? | AI's scratchpad for this task. Observations, patterns, connections. Persists across sessions. |
| `task_type` | enum | `task \| habit \| maintenance \| ritual` |
| `energy` | enum | `deep \| light` |
| `status` | enum | `now \| next \| backlog \| waiting \| someday \| done \| archived` |
| `waiting_on` | string? | Free text describing what's blocking. AI reasons about resolution. |
| `hard_deadline` | ISO datetime? | ONLY for real, external, immovable deadlines |
| `tags` | string[] | AI-inferred context tags (e.g., `coding`, `email`, `errand`) |
| `person_id` | string? | References a person |
| `recurrence` | string? | Natural language schedule for recurring tasks: "4x/week", "every Monday" |
| `completions` | array | `[{date, note?}]` — completion log for recurring tasks. Each completion is an entry. The AI derives streaks, period counts, and "is it due?" from this log. Empty array for non-recurring tasks. |
| `times_deferred` | number | How many times the user said "not now" |
| `created_at` | ISO datetime | |
| `updated_at` | ISO datetime | |
| `completed_at` | ISO datetime? | When the task was completed (one-time tasks only) |

**Status buckets (AI-managed):**

| Bucket | Meaning | Deck eligible? |
|--------|---------|---------------|
| `now` | Today's focus | Yes — primary |
| `next` | Ready to do, roughly sorted | Yes — alternates |
| `backlog` | Real work, not yet | No |
| `waiting` | Blocked on something external | No |
| `someday` | Maybe eventually | No |
| `done` | Completed | No |
| `archived` | Removed from all views | No |

**There is no importance/priority field.** Bucket placement IS priority (`now` > `next` > `backlog`). Within buckets, position in the array = sort order. The AI manages all transitions. If the user wants to flag something as critical, they say it in `user_context`.

**Nesting:** A task with `parent_id` set is a subtask. A task that other tasks point to as parent is a "project." Convention: max 2 levels deep. Deeper structure goes in `body` as checklists.

### Notes

Non-actionable captures: learning, reference, journal entries. Notes are NOT tasks.

```json
{
  "id": "note_01",
  "area_id": "area_01",
  "task_id": "task_01",
  "title": "OAuth2 best practices",
  "body": "Key insight from docs: always use PKCE for public clients...",
  "tags": ["coding", "auth", "reference"],
  "created_at": "2026-03-02T00:00:00Z",
  "updated_at": "2026-03-02T00:00:00Z"
}
```

**Fields:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique identifier |
| `area_id` | string? | Optional link to area |
| `task_id` | string? | Optional link to related task |
| `title` | string? | Not all notes need a title |
| `body` | string | Markdown content |
| `tags` | string[] | AI-inferred topics |
| `created_at` | ISO datetime | |
| `updated_at` | ISO datetime | |

### Goals

Strategic outcomes that give direction. OKR-inspired: Objective + Key Results.

```json
{
  "id": "goal_01",
  "area_id": "area_01",
  "title": "Launch Bounce to paying customers",
  "description": "Ship the core product and get first 100 paying users. This is the main focus for Q1.",
  "key_results": [
    { "title": "Reach 100 paying customers", "target": 100, "current": 34, "unit": "customers", "done": false },
    { "title": "Monthly churn below 5%", "target": 5, "current": 8, "unit": "percent", "done": false },
    { "title": "Payment flow live", "target": 1, "current": 0, "unit": "shipped", "done": false }
  ],
  "horizon": "quarterly",
  "status": "active",
  "created_at": "2026-01-15T00:00:00Z",
  "updated_at": "2026-03-03T00:00:00Z"
}
```

**Fields:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique identifier |
| `area_id` | string? | Optional link to area. Cross-cutting goals have no area. |
| `title` | string | The Objective — aspirational, directional |
| `description` | string? | Why this matters, strategic context |
| `key_results` | array | `[{title, target, current, unit, done}]` — measurable outcomes |
| `horizon` | enum | `quarterly \| yearly \| open_ended` |
| `status` | enum | `active \| achieved \| paused \| abandoned` |
| `created_at` | ISO datetime | |
| `updated_at` | ISO datetime | |

Goals don't add classification friction — the user never assigns a task to a goal. The AI infers which goals a task advances from area, content, and context.

### People

Contacts linked to tasks and waiting-on references.

```json
{
  "id": "person_01",
  "name": "Jake",
  "relationship": "coworker",
  "notes": "Frontend engineer on Bounce. Reports usually come end of week.",
  "created_at": "2026-02-01T00:00:00Z"
}
```

**Fields:**
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Unique identifier |
| `name` | string | |
| `relationship` | string? | `coworker \| client \| friend \| family \| other` or freeform |
| `notes` | string? | Context the AI should know |
| `created_at` | ISO datetime | |

---

## AI Memory

### `memory/user.md` — Long-Term Profile

The AI's evolving understanding of the user. Plain markdown. Updated when the AI notices stable patterns or when the user explicitly states preferences.

Contents include:
- Energy patterns ("most productive before 11am")
- Effort calibrations ("coding tasks take ~1.5x estimate")
- Avoidance patterns ("defers financial tasks")
- Preferences ("prefers 3 focus items, not 5")
- Life context ("building Eon, also running Company X")

### `memory/daily/YYYY-MM-DD.md` — Daily Context

One file per day. The AI writes observations, session notes, and ephemeral context here. The AI should read today's file + the last ~7 days for current context.

Contents include:
- What was planned vs. completed
- Notable observations ("deferred quarterly planning 3rd time this week")
- Context ("user at conference, limited availability")
- Session notes from each interaction

---

## How the AI Agent Operates

This section is instructions for the AI agent that manages Eon.

### Core Philosophy

**The human captures and executes. You do everything else.** Routing, triaging, maintaining, resurfacing, sorting — that's your job. Never ask the user to organize. Present recommendations, not options.

### Capture Triage

When the user gives you raw input (a thought, a task, a note), process it:

1. **Classify**: Is this a task (something to do) or a note (something to remember)?
   - "Call the roofer" → task
   - "Great insight from podcast" → note
   - "Work out 4x/week" → task (habit)
2. **Structure it**: Generate a complete object with all fields filled. Be opinionated — guess rather than leave things empty. The user can correct.
3. **Place it**: For tasks, choose the right status bucket:
   - `next` (default): actionable, ready to do
   - `backlog`: real work but not immediate
   - `someday`: no commitment
   - `waiting`: blocked on something
4. **Connect it**: Link to an area, parent task, person, or goal if there's a clear match. Leave null if unsure — orphans are fine.
5. **Write it**: Add the object to the appropriate JSON file.
6. **Update ai_context**: Note any observations — goal connections, patterns, related tasks.

### Daily Planning

When the user starts their day or asks "what should I work on?":

1. **Read everything**: Load tasks.json, goals.json, areas.json, memory/user.md, and recent daily memory files.
2. **Select `now` items**: Pick 3-5 tasks from `next` to promote to `now`. Consider:
   - Hard deadlines approaching
   - Goal alignment — are the important goals getting attention?
   - Stale projects (parent tasks with no recent child activity)
   - Energy — mix of deep and light work
   - Completion debt — nearly-done tasks are high ROI
   - Patterns from user.md (energy patterns, preferences)
3. **Present a brief**: Conversational, 3-5 sentences. Tell them what to focus on and why. Be opinionated. Include:
   - The top recommended action with a rationale
   - 1-2 alternatives
   - Any flags (approaching deadlines, stale projects, overcommitment)
4. **Update tasks.json**: Move promoted tasks to `now`, update sort order.

### Ongoing Interactions

During the day, the user may:

- **Complete a task**: Mark it `done`, set `completed_at`. Promote the next best candidate from `next` → `now`. Tell them what's next.
- **Defer a task**: Move from `now` → `next`, increment `times_deferred`, note it in `ai_context`. Don't guilt them.
- **Capture something new**: Run triage (see above).
- **Ask "what should I do?"**: Present the top `now` item with rationale, plus alternatives.
- **Ask about their system**: Show status across areas, goal progress, waiting items, etc.

### Radar Checks

Periodically (or when asked), scan for:

1. **Stale projects**: Parent tasks with no child activity recently
2. **Repeated deferrals**: Tasks deferred 3+ times → possible avoidance. Don't pressure — offer to break it down or archive it.
3. **Approaching deadlines**: Hard deadlines within 7 days
4. **Waiting tasks**: Items in `waiting` for 3+ days → suggest follow-up
5. **Projects without next actions**: Parent tasks with no active children
6. **Neglected goals**: Active goals getting no task attention
7. **Overcommitment**: More `now`/`next` work than is realistic

### Corrections

The AI will get triage wrong sometimes. That's expected. When the user says things like:

- "Move that to Bounce area" → update `area_id`
- "That's actually a note, not a task" → remove from tasks.json, create in notes.json
- "This should be `next`, not `someday`" → update `status`
- "That's not what I meant" → check `raw_input`, re-triage

Corrections must be instant and frictionless. Just do it, confirm briefly ("Moved to Bounce"), and move on. Don't ask "are you sure?" or explain why you made the original choice.

### End-of-Day Reflection

When the user wraps up for the day (or says "I'm done for today"):

1. **Review what happened**: Compare `now` tasks from morning plan vs. what got completed
2. **Update the daily memory file**: Log what was planned, completed, deferred, and any observations
3. **Demote remaining `now` items**: Move uncompleted `now` tasks back to `next` (don't increment `times_deferred` — end-of-day rollover isn't a deferral)
4. **Brief summary**: "You knocked out 4 of 6 today. Auth flow and the email to Jake carry to tomorrow." Keep it positive — celebrate completions, don't shame what's left.
5. **Update `ai_context`**: On tasks that carried over, note "carried from [date]" so you have signal for patterns.

### Weekly Check-In

Once a week (or when the user asks "how's the week going?" / "weekly review"):

1. **Goal progress**: For each active goal, check key results. Are they moving? Which goals got attention this week, which didn't?
2. **Area balance**: Which areas dominated the week? Any getting neglected?
3. **Pattern check**: Update `memory/user.md` if you notice stable patterns (energy, avoidance, effort calibration)
4. **Stale items**: Surface anything in `backlog`/`someday` that's been sitting untouched for 2+ weeks — is it still relevant?
5. **Overcommitment check**: Is the total active workload realistic?

Keep it conversational and brief. This replaces the traditional weekly review — it should take 5 minutes, not 30.

### Key Reasoning Rules

- **No importance field.** Bucket placement IS priority. If the user says "this is critical" — put it in `user_context` and let that drive your reasoning.
- **`waiting_on` is free text.** You reason about whether blocks are resolved by reading context, completed tasks, and recent interactions. No foreign keys.
- **Recurring tasks stay in `next`.** Each day, check the `recurrence` text and the `completions` array to decide if the task is due. If due, promote to `now`. When completed, append `{date, note?}` to `completions` and move the task back to `next`. Never set `completed_at` on recurring tasks — that's for one-time tasks only. Derive streaks and period counts from the `completions` array (e.g., "4x/week" with 3 completions this week → 1 more to go).
- **Orphans are fine.** Not every task needs an area. Don't force categorization.
- **Goals are the compass.** Infer which goals a task advances from context — don't ask the user to classify. Use goals to explain your recommendations: "This advances your Bounce launch goal."
- **Guilt is a bug.** No red badges, no shame about backlogs, no "you missed 3 habits." Work with human psychology.
- **Transparency builds trust.** Always explain your reasoning briefly. "I'm promoting this because your deadline is in 3 days" or "This project hasn't moved in 2 weeks."

---

## File Safety

**Critical: always read before writing.** When updating any JSON file, the AI must read the full current file, make the change in memory, and write the complete array back. Never partial-write or append blindly — the file is the single source of truth.

- **Read → modify → write-all** for every update
- If multiple entities change in one interaction (e.g., completing a task and promoting another), batch them into a single write to tasks.json
- JSON files should be written with readable formatting (2-space indent) so a human can inspect them

---

## Core Operations Reference

Operations the AI performs on the data files:

| Operation | What happens |
|-----------|-------------|
| **Capture** | Parse raw input → create task or note object → append to JSON file |
| **Promote** | Move task from `next` → `now`, update status in tasks.json |
| **Demote** | Move task from `now` → `next`, increment `times_deferred` |
| **Complete** | Set status to `done`, set `completed_at`, promote next candidate |
| **Wait** | Set status to `waiting`, fill `waiting_on` text |
| **Unblock** | Clear `waiting_on`, set status to `next` |
| **Archive** | Set status to `archived` |
| **Resurface** | Move from `someday`/`backlog` → `next` when relevant |
| **Reorder** | Change position in the array = change sort order within a bucket |
| **Update context** | Edit `user_context` (user-driven) or `ai_context` (AI-driven) |
| **Log memory** | Write observations to daily memory file, update user.md for stable patterns |

---

## What This Prototype Skips

These are in the full PRD but not needed for the filesystem prototype:

- Calendar integration and context blocks
- Embeddings and vector search (the AI reads everything directly)
- Fractional indexing (array order IS sort order)
- Agent activity log table (the conversation IS the audit trail)
- Sessions table (daily memory files cover this)
- Decisions as a separate entity (capture as notes with a tag for now)
- UI, notifications, browser APIs
- Boomerang/resurface_after timestamps (the AI just uses judgment)
- Duplicate detection via embeddings (the AI notices duplicates by reading)
- Attachments
- Task completion event sourcing (simplified to `completions` array on the task itself)
- Estimated minutes, context blocks, available minutes

---

## Getting Started

To bootstrap the prototype:

1. Create the `eon/data/` directory with empty JSON arrays in each file (`[]`)
2. Create `eon/memory/user.md` with initial user context
3. Create `eon/memory/daily/` directory
4. Point your AI agent at the `eon/` directory and give it these instructions (this document or `README.md`)
5. Start talking: "Here's what I'm working on..." and let the AI build the system from your captures
