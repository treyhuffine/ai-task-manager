# Eon Roadmap

A condensed view of what we're building and when. See `prd.md` for full details.

---

## Architectural Foundation

These principles apply across all phases:

- **Protocol-first design.** Eon's capture and routing interfaces are open protocols. The app is the reference implementation — any agent framework, UI, or integration can plug in via well-defined endpoints: `capture`, `route`, `delegate`, `report`.
- **Repository abstraction.** All data access goes through TypeScript interfaces (`TaskRepository`, `NoteRepository`, etc.) — never raw SQL. We will actively test SQLite vs markdown vs hybrid backends. Swap is trivial by design.
- **Model-agnostic.** Users bring their own API keys (direct from Anthropic/OpenAI/Google, or OpenRouter, or local via Ollama). Each AI job maps to a capability tier (fast, standard, capable, embedding). The user assigns models to tiers once; Mastra routes accordingly.
- **Audit everything.** Every AI inference → `ai_inferences`. Every system action → `agent_activity`. Non-negotiable for trust.
- **Five-layer agent architecture.** Agents → Workflows → Tools → Services → Repositories. Each layer depends only on the one below it.

---

## MVP (Phases 1–7)

### Phase 1: Foundation + Capture + Triage
Dump things in, they get auto-organized.

**Infrastructure:**
- SQLite schema + migrations: areas, tasks, task_completions, notes, goals, people, decisions, calendar_events, user_state, sessions, agent_activity, temporal_memory, ai_inferences, vec_embeddings
- FTS5 indexes on tasks and notes for keyword search
- `sqlite-vec` extension for vector similarity search
- Repository interfaces + SQLite implementation (data access abstraction from day one)
- Mastra instance configuration + model routing from user config
- Settings UI: API key config, model-to-tier mapping, embedding model selection
- `~/.eon/` data directory: `data.db`, `USER.md`, `attachments/`

**Mastra tools:** `createTask`, `updateTask`, `getTasks`, `getTask`, `createNote`, `updateNote`, `getNotes`, `getNote`, `createArea`, `updateArea`, `getAreas`, `createDecision`, `updateDecision`, `getDecisions`, `createPerson`, `updatePerson`, `getPeople`, `search`, `findSimilar`, `logActivity`, `getRecentActivity`

**Mastra workflows:** `capture-triage` (embed → dedup → classify as task/note/decision → create → log)

**Mastra agents:** Chat agent with access to Phase 1 tools only (multi-step reasoning, streaming)

**Mastra skills:** `triage.skill.md`, `decisions.skill.md`

**Features:**
- Capture input UI (global text box, Cmd+K shortcut)
- AI triage pipeline: raw text → embedding → duplicate detection (cosine via `sqlite-vec`) → LLM classify → create task, note, or decision → log activity
- Semantic search: FTS5 keyword + vector similarity, merged and ranked
- Chat agent for natural language interaction (capture via chat, search, basic task management)
- Basic task list grouped by area, with orphan section
- Basic notes list grouped by area, with orphan section
- Area CRUD (manual, with status: active/paused/someday)
- People CRUD (contacts linked to tasks)
- Decision handling (triage classifies decision language, creates pending decisions)
- One-tap correction chips on capture confirmation (including flip between task/note/decision)
- Agent activity log (write-only — browsable view comes in Phase 7)

### Phase 2: The Now Deck + Notifications
Open the app, immediately know what to do.

**New tools:** `moveTask`, `getUserState`, `updateUserState`

**New workflows:** `deck-generate` (rule-based, no LLM), `task-complete` (one-time vs recurring, parent update, deck refill)

**New services:** NotificationService

**Features:**
- `deck-generate` workflow: rule-based multi-factor ranking (deadline proximity, energy match, time fit, sort_key, streak urgency, goal alignment), deterministic top 3 (1 primary + 2 alternates)
- Scope pill (All | Area | Project) + energy toggle (Deep | Light)
- Cross-mode alternate: deep work always shows a light quick win; light work always shows next deep option
- Deck actions: Done, Snooze (1d/3d/1w/custom), Not Today, Waiting On, Reassign
- `task-complete` workflow: handles one-time completion vs recurring (logCompletion, period check, streak update, parent progress, deck refill)
- Boomerang resurfacing (`resurface_after` triggers)
- Parent task as "project" display (tasks with children show project-like UI)
- NotificationService: browser Notification API via `reminder_at` (one-shot, nulled after firing). AI auto-sets reminders from time-specific capture language.
- File attachments: stored in `~/.eon/attachments/{task_id}/`, rendered inline in task body

### Phase 3: AI-Powered Deck + Daily Brief + Memory
The AI becomes your chief of staff and starts learning.

**New tools:** `createGoal`, `updateGoal`, `getGoals`, `getGoal`, `getCurrentSession`, `createSession`, `updateSession`, `getUserProfile`, `updateUserProfile`, `getTemporalMemory`, `upsertTemporalMemory`

**New workflows:** `deck-rerank`, `daily-brief`, `memory-update`

**New skills:** `planning.skill.md`, `memory.skill.md`

**Features:**
- Goals CRUD with OKR-inspired structure (objective + key results JSON). AI nudges toward concrete KRs. Goals guide deck rationale, daily brief, and radar.
- `deck-rerank` workflow: LLM reranks candidates (1 primary + 2 alternates + one-line rationale per card, goal-aware)
- `daily-brief`: **build both a workflow version and an agent version, test and compare.** Workflow follows fixed 10-step sequence; agent reasons autonomously through the plan. Compare on quality, edge-case handling, cost, latency.
- Today view: plan + context blocks timeline + deck + chat
- Context blocks stored as structured JSON in `sessions.ai_plan` (deep/light labeled, regenerated on each replan including midday)
- Session recording (planned vs. completed)
- Adaptive capacity & tone: user state signals (engagement, capacity, recent patterns) injected into all LLM prompts. 6 behavioral signals trigger tone/volume adaptation (low engagement, high deferral, all-meetings day, health/crisis, capture flood, high completion). Tone directives: standard | gentle | minimal.
- Dynamic `now` sizing (1-2 items when overwhelmed, 5-7 when in flow)
- **Temporal memory**: AI writes daily observations to `temporal_memory` table during interactions. Reads USER.md + today + last 7 days for context. Each row gets a vector embedding for semantic retrieval beyond the 7-day window.
- **`memory-update` workflow** (weekly cron): synthesizes `temporal_memory` rows into USER.md long-term patterns (override analysis, effort calibration, deferral patterns, session analysis, contradiction detection). Explicit user declarations ("I prefer mornings") bypass the weekly cycle and go straight to USER.md.

### Phase 4: Calendar Integration
Recommendations fit your real day.

**New tools:** `getCalendarEvents`, `getAvailableGaps`, `getAvailableMinutes`

**New services:** CalendarSyncService

**Features:**
- CalendarSyncService: Google Calendar OAuth (read-only, cached locally to `calendar_events` table)
- Calendar tools: gap computation, available minutes between events
- Deck filtered by gap size (never suggest 2hr task when you have 15 min)
- Context blocks overlaid on calendar view
- Energy toggle auto-switches based on current context block (deep in long gaps, light between meetings)
- Meeting prep/follow-up suggestions (basic)
- Overcommitment detection ("you have 45 min of real work time today")

### Phase 5: Radar + Intelligence Layer
The system catches what you miss.

**New workflows:** `radar-scan`

**New skills:** `avoidance.skill.md`

**Features:**
- `radar-scan` workflow (daily, rule-based queries + optional LLM enrichment):
  - Stale parent tasks (missed heartbeat cadence)
  - Repeated deferrals (3+ times — possible avoidance)
  - Approaching hard deadlines (within 7 days, not yet worked on)
  - Missing next actions (parent tasks with zero active children)
  - Near-complete tasks (AI infers from body checkboxes and age, no `completion_pct` field)
  - Waiting follow-ups (in waiting state > 3 days)
  - Backlog boomerangs (ready to promote to `next`)
  - Overcommitment signals
  - Neglected goals (no related work in review cadence period)
- Radar UI with action buttons (Revive, Snooze, Someday, Archive, Break Down)
- Avoidance detection and gentle response: don't escalate pressure, offer to break down, gently name the pattern, offer an out
- Heartbeat logic for parent tasks (project pulse — resurface if no child progress in N days)
- Backlog pulse surfacing for long-unseen tasks
- Gentle decay for old low-intent captures
- Block resolution check: LLM reads `waiting_on` text, cross-references completed tasks/captures/calendar/People to check if blocks are resolved
- "What I've Learned" view: renders `~/.eon/USER.md` directly (user can also open in any editor)
- Memory injection into all AI prompts (USER.md + recent temporal_memory — foundation laid in Phase 3, fully integrated here)

### Phase 6: Recurring Tasks + Weekly Pulse
Full daily and weekly rhythm.

**New tools:** `logCompletion`, `getCompletions`

**New workflows:** `recurring-check`, `weekly-pulse`

**New skills:** `recurring.skill.md`

**Features:**
- Recurring task support with three types (all on the tasks table, no separate entity):
  - **Habit**: consistency-based (workout, meditate). Forgiving streaks, minimum viable completion (even 5 min counts)
  - **Maintenance**: obligation-based (pay rent, water plants). Window-based nudges ("it's been X days")
  - **Ritual**: time-anchored (weekly 1:1, family dinner). Calendar-integrated with prep/follow-up
- `recurring-check` workflow: reads natural language `recurrence` text, queries `task_completions` for current period, promotes due tasks to `now`, recomputes streaks from completion log
- Event-sourced completion tracking via `task_completions` table (immutable rows, period counts/streaks derived)
- Recurring tasks integrated into `daily-brief` and context blocks
- Routines view (filtered lens on tasks with recurrence)
- Gentle consistency visualization (no guilt, no red badges)
- `weekly-pulse` workflow: retrospective + forward look, goal KR progress, pattern recognition ("you've skipped workouts all week — overloaded?"). Also triggers memory-update.

### Phase 7: Polish + Trust
Earn long-term trust.

**Features:**
- Agent Activity view (full, browsable, with one-tap override actions)
- Undo for all actions (backed by activity log)
- Everything view (searchable, filterable safety valve — all tasks across all statuses)
- Decisions view: pending at top (grouped by area, shows which tasks they block), made below (searchable)
- Kanban view: tasks by bucket in column layout, drag between columns = bucket transitions
- Status overview: counts by bucket, counts by area, active goals with KR progress, pending decisions, waiting tasks with duration
- Completed task history (browsable, groupable by day/week/area/project)
- Keyboard shortcuts throughout (Cmd+K capture, arrow keys, enter to complete)
- Dark mode
- Empty state handling and first-time experience
- Error handling for AI failures (graceful degradation, retry logic)
- Performance optimization (deck < 1s, capture < 500ms excluding AI)

---

## Post-MVP

### Phase 8: Templates + Pipeline Views
- Task templates with predefined child tasks, instantiate with one action
- Template-on-cadence (recurring templates — weekly blog post, monthly report)
- Pipeline view for projects (group parent tasks by stage in kanban layout)
- Batch mode for the deck (repetitive process work — filtered queue of similar tasks)

### Phase 9: Teams + Collaboration
- Federated model (each person owns their Eon, shared areas for coordination)
- Task delegation with linked tasks across instances
- Shared goals with distributed KRs
- Agent-as-team-member (AI agents in the routing model)
- Managed AI hosting (no API key setup for non-technical users)
- Mobile app

---

## Future Enhancements (Unscheduled)

Tracked for planning. No phase assigned yet — will be slotted as priorities become clear.

### Views & Navigation
- **Saved / smart filters** — user-defined filtered views ("all deep-work in Bounce")
- **Eisenhower matrix view** — 2x2 grid of `now` + `next` tasks (urgency × importance derived from existing signals). Override via drag. Post-MVP visualization, no schema changes.
- **Project sections / headings** — logical groupings within an area

### Planning & Focus
- **Visual planning canvas** — drag-and-drop daily/weekly planning surface. AI pre-populates based on priorities, energy, calendar gaps. User drags to rearrange, confirms plan, deck follows it. Schema already supports via `sessions.ai_plan` + `sort_key`.
- **Drag-to-schedule (time blocking)** — drag tasks onto internal calendar for time slots
- **Pomodoro / focus timer** — built-in timer paired with current deck card
- **2-minute rule prompt** — "This is quick — do it now?" during triage for <2 min tasks

### Analytics & History
- **Habit heatmap** — GitHub-style contribution grid for recurring tasks
- **Productivity analytics dashboard** — weekly/monthly: tasks completed, deep work time, velocity
- **Completion counts in weekly pulse** — "You completed 23 tasks this week, 8 were deep work"

### Data & Editing
- **Cross-cutting links** — polymorphic `links(from_kind, from_id, to_kind, to_id)` between any two items (note↔note, note↔task, task↔task, item↔area, etc.). Replaces tags as the cross-cutting layer; AI proposes links at write-time, human accepts. Hubs emerge naturally (book item, person item, recurring meeting). See PRD §5.2 → "Cross-Cutting Links (Planned)" for full reasoning. Wiki-style `[[title]]` syntax is one viable input affordance.
- **Bulk edit operations** — multi-select to move, re-bucket, archive in batch
- **Import agent** — convert external sources into Eon (see below)
- **Natural language commands** — "Archive everything in someday older than 6 months"

---

## Deep Dives

### Import Agent

An AI agent that iterates through any external task source and converts items into Eon's schema.

**Supported sources (planned):**
- Todoist JSON/CSV export
- Asana CSV export
- Apple Reminders (via Shortcuts or export)
- Things 3 JSON export
- Linear CSV export
- Plain text / markdown lists
- Google Tasks export

**How it works:**
1. User provides an export file or points to a source.
2. The agent parses the source format and maps fields to Eon's schema (title → `title`, description → `body`, project → area, due date → `hard_deadline` or `resurface_after` depending on context, tags → notes, priority → `ai_context`).
3. For each item, the agent runs a lightweight triage: assigns bucket, energy, area, and checks for duplicates against existing tasks.
4. Results are presented as a preview: "47 tasks found. 3 potential duplicates. Review before import?"
5. User confirms, adjusts, or filters. Import executes.

**Not a one-time migration.** The agent handles incremental imports — run it again after a week of parallel use and it deduplicates against what's already in Eon. This makes the transition from an old system gradual and low-risk.
