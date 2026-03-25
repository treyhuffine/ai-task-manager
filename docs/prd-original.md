# Eon — Product Requirements Document

## Why

Helping people live deliberately instead of accidentally.

## The Pain

I somehow felt simultaneously burned out and unproductive. Every tool that was meant to help made it worse — organizing, prioritizing, rearranging, reviewing — until the system itself felt like a second job. So you abandon it, go back to your head or simple notes, and things start slipping. The anxiety builds. Either way, you lose. The tools built to help you focus are the ones draining you.

---

## 1. Why This Exists

Eon is the work operating system for a human+agent future. It routes your attention to the highest-leverage action — so you spend your time on judgment and execution, not organizing.

We are living through the biggest shift in personal productivity since the invention of the to-do list. AI has created massive leverage — people can now ship in hours what used to take weeks. But this leverage has exposed a bottleneck that no tool has solved: **deciding what to work on is now harder than doing the work.**

The average knowledge worker juggles multiple projects, parallel AI-assisted workflows, fragmented calendars, and a blend of work and life obligations. They open their task manager, stare at a list of 50 items, and spend 30 minutes deciding what matters — then do 20 minutes of actual work before the next meeting. The productivity tool has become the productivity problem.

Every task management system ever built puts the human in two roles: **the worker** and **the system administrator**. You do the work _and_ you maintain the system that tracks the work. Tagging, prioritizing, reordering, weekly reviews, bumping due dates — this is overhead that compounds until the system collapses under its own weight. When life gets busy (when you need the system most), maintenance is the first thing dropped.

**The opportunity:** AI can now parse, categorize, prioritize, schedule, resurface, and prune. The human's only jobs should be: **capture freely, decide when asked, and execute what's presented.**

Eon is not a to-do list. It is not a project management tool. It is an **attention routing engine** — an active logistics network that ingests raw thoughts, understands the full context of your life, and surfaces the single highest-leverage thing you can do right now, with a clear reason why. In Stage 1, it routes your attention to tasks. In Stage 2, it routes work to AI agents and surfaces their output for your review. In Stage 3, it orchestrates humans and agents together — and the human's job is purely judgment, creativity, and decisions.

---

## 2. The Three Stages

The architecture is designed to evolve through three stages as AI capabilities expand. Each stage builds on the previous one without structural rewrites — the same entities, the same routing engine, the same trust model. Understanding the endgame is essential context for every design decision that follows.

### Stage 1: AI Advises, Human Executes (MVP)

This is what we're building first. The AI triages captures, generates the daily brief, runs the radar, and learns your patterns. But the human does the work. Every task is something YOU do.

The key constraint: the human is both the decision-maker and the executor. The AI reduces the decision load (from "what should I work on?" to "is this the right recommendation?"), but execution is still 100% human.

### Stage 2: AI Executes, Human Oversees

As AI agents become capable of taking action — drafting emails, writing code, scheduling meetings, conducting research — Eon's routing engine evolves from "what should you do?" to "what should be done, and by whom?"

**What changes:**

- **Task delegation.** Tasks gain an `agent_delegated` status and an assignee concept. "Email the accountant about quarterly taxes" → the AI drafts and sends it. "Research competitor pricing" → the AI does the research and presents a summary. Delegated tasks move into a "Running Jobs" panel. When the agent finishes, the task surfaces for human review. The deck shifts to showing things that need your _judgment_, not your _labor_.
- **Ambient capture.** Capture becomes passive. AI watches meeting transcripts, email threads, Slack channels, and auto-captures action items. Tasks gain a `source` field tracking origin (manual, meeting, email, slack).
- **Deeper memory.** With more data (email tone, meeting context, communication patterns), the AI builds a richer model of how you work, communicate, and decide.
- **Proactive nudges.** Push notifications when the AI detects something important.
- **Multi-device.** Cloud sync, mobile app, watch app for capture.

**What stays the same:** Areas, tasks, notes, the deck, the radar, the daily brief. The entity model doesn't change. The routing engine just has a new output: "delegate to agent" alongside "present to human."

### Stage 3: AI Orchestrates, Human Decides

Eon becomes the operating system for your work. Multiple AI agents operate under Eon's coordination — a coding agent, a communication agent, a research agent, a scheduling agent. The human's role is purely strategic: set priorities, make judgment calls, approve high-stakes actions.

**What changes:**

- **Multi-agent orchestration.** Eon routes tasks to the right agent, monitors progress, handles handoffs, and escalates to the human only when needed. The deck becomes a decision queue, not a task queue.
- **Auto-scheduling.** The AI writes to external calendars. Context blocks become real calendar events.
- **Federated team layer.** Each person keeps their own Eon. Shared areas enable coordination. Delegation creates linked tasks across instances. An agent is just another team member in the routing model. Team goals with distributed KRs.
- **Natural language everything.** "Cancel all my meetings tomorrow and block the day for the launch" → AI executes across systems.
- **Predictive planning.** The AI anticipates what's coming: "Based on your Bounce launch timeline, you'll need to start the marketing site by next week to stay on track."

**What stays the same:** The fundamental model. Areas are still life domains. Tasks are still actionable work. Notes are still context. The routing engine still answers "what deserves attention right now?" — it just has more options for who or what handles the answer.

### Why This Architecture Survives

1. **The entity model is minimal.** Areas, tasks, notes, people. Adding `assignee`, `source`, or `delegated_status` fields is a migration, not a rewrite.
2. **The AI functions are modular.** Each job (triage, deck, brief, radar, memory) is a separate function. Adding "delegate to agent" is a new function, not a refactor.
3. **The audit trail is built in.** Agent activity and AI inferences log everything. When AI agents start executing, the same trust infrastructure applies.
4. **The routing engine is the product.** Whether it routes to a human, an AI agent, or a team — it's still a routing engine for attention. The core value proposition doesn't change; it just gets more powerful.
5. **The protocol is open.** Eon's capture and routing interfaces are designed as open protocols. The app is the reference implementation. Any agent framework, any UI, any integration can plug into the routing engine.

The endgame: Eon knows your work, your calendar, your energy patterns, your goals, and your relationships — and it orchestrates your entire workflow so you spend 95% of your time on judgment, creativity, and the things only humans can do.

---

## 3. Core Problems We Solve

These are the fundamental truths about why task management fails, and the design constraints they impose on Eon. Each problem has been validated through first-principles analysis and real-world experience.

### 3.1 The Maintenance Tax

Traditional systems require constant housekeeping — tagging, reordering, weekly reviews, moving items between states. The system itself becomes work. When life gets busy, maintenance is the first thing dropped, and the system collapses.

**Design constraint:** Maintenance must be near-zero and continuous — amortized into tiny moments (one-tap corrections), not a weekly ceremony. The human captures and executes. The AI routes, maintains, resurfaces, and prunes.

### 3.2 Work Is a Topology, Not a Queue

Real work is multi-dimensional and parallel. What you should do next depends on time available, energy, environment, urgency, deadlines, dependencies, and strategic goals — simultaneously. These shift throughout the day. Modern AI-assisted workflows make this worse: people run 2-3 active threads, waiting on code generation, builds, reviews, and other people. Flat lists and kanban boards can't represent this, so users do the real prioritization in their head.

**Design constraint:** The system must model tasks across multiple dimensions, support active parallel threads and wait states, and dynamically match work to the user's current constraints — not force them to collapse reality into a single ordering.

### 3.3 The Blank Page Problem

The most draining moment is opening a list of 50 items and deciding what's most valuable. Decision fatigue leads to freezing or "productive procrastination" — doing easy, low-value tasks to feel busy. The cognitive cost of choosing often exceeds the cost of doing.

**Design constraint:** The system should present a strong recommendation with a short rationale, plus a couple of alternatives. The user should sit down and immediately know what to do and why — not browse a menu.

### 3.4 The Snooze Loop

People assign due dates not because something is actually due, but to avoid forgetting. When the date arrives and they're not ready, they bump it. This compounds — 20 fake deadlines to dismiss daily — generating guilt, alert fatigue, and destroyed trust. "Overdue" loses all meaning.

**Design constraint:** Hard deadlines (external, immovable) and resurfacing (internal, flexible) are fundamentally different needs. Most items shouldn't have due dates. They need a "boomerang" — a point at which the AI checks back in, silently, without guilt or red badges.

### 3.5 Context and Calendar Blindness

Task lists don't know you're on your phone, at a doctor's office, mentally depleted, or that you have 12 minutes before the next meeting. People don't have "8 hours of work time" — they have fragmented gaps around meetings, commutes, and commitments. Without awareness of calendar, time, energy, and environment, every suggestion is a guess and every plan is fiction.

Meetings are also one of the largest sources of new work — prep, decisions, follow-ups — and almost none of it gets captured reliably.

**Design constraint:** The calendar is the constraint layer. The system must compute real available capacity, factor in buffers and transitions, filter suggestions to what's actually doable now, and close the meeting loop (prep -> decisions -> follow-ups).

### 3.6 Over-Commitment Is Invisible Until Failure

Most systems let users pile on unlimited work without modeling load versus capacity. People can't see the mismatch until deadlines slip and stress spikes. Task tools enable wishful planning instead of enforcing tradeoffs.

**Design constraint:** The system must model total commitments against real capacity and surface explicit choices: "You have more committed work than available time this week. What are we cutting, deferring, or renegotiating?"

### 3.7 Blocked Work Creates Noise

Work is often blocked — on other people, prerequisite tasks, approvals, or external events. Blocked items shouldn't appear in the active execution view, but they need tracking and follow-up. Most systems treat "waiting" and "blocked" as afterthoughts.

**Design constraint:** "Waiting on" and "blocked by" must be first-class states — auto-suppressed from execution, with follow-up timing, and automatic resurfacing when relevant (e.g., before a meeting with the person you're waiting on, or when a prerequisite task completes).

### 3.8 Projects Drift Without Next Actions

A project can be "high priority" indefinitely while making zero progress because no one has defined the concrete next step. Most tools treat projects as containers, not outcomes requiring a maintained next action. Projects stall silently.

**Design constraint:** Every active project needs a maintained next action. If none exists, the project is effectively blocked — whether or not anyone has labeled it that way. The system must detect and flag this.

### 3.9 Slow-Burn Projects Have No Home

Some meaningful work progresses in tiny increments over months or years — open-sourcing a library, writing a book, learning a skill. Current systems either bury it forever in a backlog (lost) or surface it daily alongside urgent work (noise). There is no middle ground between "forgotten" and "nagging."

**Design constraint:** Slow-burn work needs a periodic heartbeat that resurfaces it on an appropriate cadence (weekly, monthly) for a check-in, without treating it as overdue or competing with today's urgent items.

### 3.10 Completion Debt Is Invisible

Items that are 80-90% done sit unfinished because the remaining work is boring, hard, or ambiguous. Starting something new feels more productive, but value is captured at completion, not initiation. This creates a growing pile of almost-done work that represents significant wasted investment.

**Design constraint:** The system should detect near-complete items and actively prioritize them: "30 minutes finishes this" paired with a concrete finishing step. The ROI of completing is almost always higher than the ROI of starting.

### 3.11 Emotional Avoidance Masquerades as Low Priority

Some tasks get deferred repeatedly not because they're unimportant but because they trigger discomfort — hard conversations, financial paperwork, irreversible decisions. Systems treat every deferral identically and respond by adding pressure (red badges, urgency escalation), which makes avoidance worse.

**Design constraint:** Repeated deferral of a non-trivial item should trigger a different response: break it down, reduce scope, suggest the smallest possible first step, or gently name the pattern. Handle the psychology, not just the logistics.

### 3.12 Habits, Routines, and Rituals Aren't Tasks

Recurring activities get crammed into task lists where they don't belong, and they're not all the same thing:

- **Habits** are things you do for their own sake — workout, meditate, read. The value is consistency. Missing one day isn't failure; missing a week is a signal. They need forgiving tracking and "minimum viable completion" (even 10 minutes counts).
- **Routines** are recurring obligations that have real consequences if skipped — pay bills, do laundry, water plants. They need flexible windows and "it's been X days" nudges.
- **Rituals** are time-anchored commitments, often involving others — weekly 1:1s, family dinner, therapy. These are calendar events with prep and follow-up needs.

**Design constraint:** All three need logic appropriate to their type, but they should not require a separate entity or classification decision at capture time. A task with a cadence IS a routine. None of them should flood the daily task queue or generate guilt when missed.

### 3.13 The Capture Paradox

Two opposing forces kill task systems at the input layer:

- **Too much friction:** If adding an item requires choosing a project, setting priority, adding tags, and picking a date, people revert to keeping things in their head.
- **Too little friction:** If capture is truly effortless, inventory explodes without intelligent separation, and the system becomes a monument to everything you haven't done.

And when the AI processes input, it will sometimes get it wrong. If fixing a miscategorization takes more than a second, users stop trusting the system entirely.

**Design constraint:** Capture must be raw-thought-first — structure inferred by AI, never required upfront. But the system must also classify low-intent captures separately, support gentle decay, enable batch dismissal, and make corrections one-tap. The backlog should feel like a resource, not an indictment.

### 3.14 Cross-Domain Blending

Life doesn't respect boundaries between work and personal. You need to sign your kid up for camp during work hours because registration closes at noon. You think of a work idea at the gym. Systems that force rigid domain separation fail because users live in blended schedules.

**Design constraint:** One system must hold all life contexts without forcing the user to maintain separate views or switch modes. Scope should be easy to switch and often inferred, not enforced.

### The Meta-Problem

All of these failures share a root cause: **current task systems put the human in the role of both the worker and the system administrator.** The overhead of administration eventually exceeds the value of organization, and people revert to keeping everything in their heads — which is where they started.

---

## 4. Product Principles

These are the non-negotiable design rules that govern every feature decision.

1. **The human captures and executes. The AI does everything else.** Routing, triaging, maintaining, resurfacing, pruning — this is the AI's job. The moment the system asks the user to "organize," it has failed.

2. **Present recommendations, not options.** The default experience is a single best action with a reason. Alternatives are available but secondary. The user should sit down and know what to do in under 10 seconds.

3. **Transparency builds trust.** Every AI recommendation needs a brief, honest rationale — "due tomorrow," "quick win, you have 15 min," "this project hasn't moved in 3 weeks." No black boxes. Trust compounds through repeated accurate calls.

4. **Minimal state survives contact with real users.** The fewer fields humans touch, the longer the system lives. AI infers; humans override when needed; corrections are one-tap with undo.

5. **Default to filtered, allow the firehose.** The daily view shows only what's actionable now. But "show me everything" must always be one tap away. Users need the safety valve to trust the filter.

6. **Deadlines are sacred.** Only real, external, consequential deadlines get due dates. Everything else uses boomerang resurfacing. "Overdue" means something failed — it should be rare and alarming, not wallpaper.

7. **Guilt is a bug, not a feature.** No red badges for flexible items. No backlog counter shaming you. No "you missed 3 habits today" notifications. The system works _with_ human psychology, not against it.

8. **Simple under the hood.** If a user looks at the data model, it shouldn't be brittle or over-engineered. The concepts should be simple, clear, and scalable. Complexity lives in the AI reasoning, not the schema.

9. **Adapt to the human, not the other way around.** The system should detect the user's current capacity and emotional state from behavioral signals (engagement frequency, deferral patterns, area context) and adjust its tone, volume, and expectations accordingly. A new parent getting 3 hours of sleep sees a smaller `now` set and gentler language. An executive in back-to-back meetings gets light-task-only suggestions. Someone dealing with a health crisis gets "when you're ready" phrasing, not productivity pressure. The AI reads the room.

---

## 5. Core Concepts

### 5.1 The Three Loops

Eon operates through three continuous loops:

**Capture Loop** (seconds): Thought -> Raw input -> AI triage -> Structured task. The user's job is to dump. The AI's job is to parse, categorize, and file.

**Execution Loop** (**seconds** to minutes): Open app -> See recommendation -> Act on it or adjust -> Next. The user's job is to do. The AI's job is to decide what's next.

**Maintenance Loop** (continuous, amortized): AI triages new captures, resurfaces stale tasks, decays low-intent ideas, detects drifting projects, flags overcommitment, and prunes. The user's job is micro-corrections when the AI gets something wrong (one tap). There is no weekly review.

### 5.2 Entity Model

The system has three primary entities: **Areas**, **Tasks**, and **Notes**. That's it. No projects table — a task with children IS a project. No routines table — a task with a cadence IS a routine. Every classification decision that can be eliminated, has been.

#### Areas

Stable domains of life and responsibility. These are the coarse partitions of your life that you navigate between. Examples: "Bounce," "InsiderFinance," "Life," "Entrepreneurship & Building," "Health."

Areas have **status**: `active | paused | someday | archived`. The daily experience only shows active areas (typically 3-7). But you can have 25 total — side projects, future ideas, seasonal concerns. Paused and someday areas exist with full context but don't compete for daily attention. The AI manages lifecycle: "You haven't touched OSS Finder in 6 months — still on your radar?" or "You've added 4 tasks to this area — want to activate it?"

Areas have a `notes` field for strategic context that isn't a task: "Bounce: pivoting to B2B, current ARR is $X, main focus this quarter is churn." Areas also carry a rough `allocation_weight` expressing how much attention they deserve — used as a bias for the AI, not a rigid constraint.

**Areas are optional.** Tasks and notes can exist without an area. These "orphans" are first-class citizens — they appear in the deck, they're searchable, the AI surfaces them. Not everything needs a home. Forcing things into areas creates junk drawers. When an orphan does find its natural area, reassignment is one tap.

#### Tasks

The atomic unit of actionable work. A task starts as raw text. The AI processes it into structured data. The user never has to decide classification upfront; the AI infers it.

Tasks have:

- A user-editable `body` field — the primary workspace. Rich markdown, checklists, context, links. This is where you track progress, jot notes as you work ("talked to Jake, he's sending the contract Friday"), and always know where things left off.
- A `user_context` field — the user tells the AI what matters about this task. "Need before March board meeting." "This is THE blocker for Bounce launch." "Not urgent, just don't want to lose it." Natural language, updated anytime. This is the richest signal the AI gets for priority and timing — richer than any enum.
- An `ai_context` field — the AI's scratchpad for this task. Observations that persist across sessions: "Deferred 3x since Feb, possible avoidance." "Connected to Q3 launch goal — user mentioned in daily brief." "User typically does this type of work Friday afternoons." Updated during triage, daily brief, and radar passes.
- An optional `parent_id` pointing to another task — this is how tasks nest. A task with children is a "project" in the UI (shows progress, has a heartbeat, gets "stale project" nudges). But it's the same entity. "Is this a project or a task?" is a question that no longer exists.
- An optional `area_id` — tasks can belong to an area or float free as orphans.

**Status is a GTD-inspired bucket, managed by the AI:**

| Bucket     | Meaning                              | Size      | Deck eligible?        |
| ---------- | ------------------------------------ | --------- | --------------------- |
| `now`      | Today's focus, set by morning triage | 3-7       | Primary               |
| `next`     | Ready to do, roughly sorted          | 15-30     | Alternates / overflow |
| `backlog`  | Real work, just not yet              | Long tail | No                    |
| `waiting`  | Blocked on external                  | Varies    | No                    |
| `someday`  | Maybe eventually, no commitment      | Unlimited | No                    |
| `done`     | Completed                            | —         | No                    |
| `archived` | Removed from all views               | —         | No                    |

The user never picks a status from a dropdown. The AI manages all transitions:

- Capture → AI places in `next`, `backlog`, or `someday` based on language
- Morning triage → AI promotes from `next` → `now` with rationale
- Complete → AI promotes next candidate from `next` → `now`
- "Not today" → AI moves from `now` → `next`, notes the deferral
- Boomerang → pops from `someday`/`backlog` → `next` when `resurface_after` hits
- In Stage 2, AI-executed tasks get an `agent_delegated` status that pulls them from the deck into a separate "Running Jobs" panel.

**No `importance` field.** Bucket placement IS the priority signal — `now` > `next` > `backlog`. Within buckets, the AI sorts by reasoning from rich natural language context (`user_context`, `ai_context`, goals, deadlines, calendar, patterns). This is more accurate than a 4-level enum and eliminates a field the AI would frequently get wrong. If the user wants to flag something as critical, they say it in `user_context`: "This is critical, blocks the launch." The AI reads it and acts on it.

**Nesting is shallow.** Convention (enforced by AI nudges, not hard limits) keeps it to 2 levels max. Deeper structure lives in the task body as checklists and notes, not as deeper nesting.

**Task types** distinguish behavior:

- **`task`** (default): One-time actionable work. "Build the auth system," "Email the accountant."
- **`habit`**: Recurring, consistency-based. Has a cadence. Completing means "done for this period." Tracks streaks. Minimum viable completion (even 5 minutes counts). Missing once isn't failure.
- **`maintenance`**: Recurring obligations with consequences. "Pay rent," "water plants." Window-based nudges, "it's been X days."
- **`ritual`**: Recurring, time-anchored, often social. "Weekly 1:1," "family dinner." Calendar-integrated with prep/follow-up.

The user captures "work out 4x/week" and the AI sets `task_type: habit`, `recurrence: "4x per week"`, `target_frequency: 4`, `recurrence_interval_days: 2`. No classification decision at capture time.

**How recurring tasks work with buckets:** Habits and maintenance tasks live permanently in `next`. Each morning triage, the AI reads each task's `recurrence` text, queries `task_completions` for recent completions, and determines which tasks are due for the current period. Due tasks are promoted to `now` alongside one-time tasks. When completed, a row is logged to `task_completions`. If completions for the current period equal `target_frequency`, the task stays in `next` until the next period. If completions are still below target (e.g., 1 of 2 daily email checks done), the task remains promotable. Streaks are recomputed from the completion log. Rituals are anchored to calendar events and surface via meeting prep, not bucket promotion.

#### Notes

Non-actionable captures: learning, thinking, reference material, journal entries. Notes are **not tasks** — they don't have priority buckets, deadlines, energy classification, or deck eligibility. They're content that exists in the system for the AI to reference and the user to search.

Examples: "Key insight from AI podcast: agents work better with explicit tool definitions." "Quarterly reflection on Bounce strategy." "Interview questions I like."

Notes can belong to an area, link to a task, or float free as orphans. A note about OAuth2 best practices while working on auth → linked to the auth task. A note on startup strategy → under the "Entrepreneurship & Building" area. A random insight from a walk → orphan. All are first-class.

**Decisions are a first-class note type.** When a note contains decision language ("we decided," "I'm going with," "the plan is"), the AI auto-tags it with a `decision` context tag and extracts participants and rationale into structured fields. Decisions surface in the weekly pulse ("3 decisions made this week"), in project context ("last decision on auth: go with OAuth2"), and as routing context ("you decided to focus on churn — I'm weighting retention tasks"). Both the human and the AI can write decision notes — the human captures "decided to go with Stripe" during a meeting, the AI captures "user chose to defer the redesign in favor of launch prep" from a planning session.

The AI uses notes as context for routing and planning: "You noted last week that Bounce should focus on churn — I'm prioritizing retention-related tasks."

#### Goals

The strategic layer that gives everything direction. Goals answer "what am I working toward?" — without them, the AI optimizes for productivity without purpose.

Goals follow an **OKR-inspired structure**: each goal has an **Objective** (the aspiration) and **Key Results** (how you measure progress and know when you're done).

Examples:

- **Objective:** "Launch Bounce to paying customers"
  - KR: Reach 100 paying customers (current: 34)
  - KR: Monthly churn below 5%
  - KR: Payment flow live and processing
- **Objective:** "Get back to a healthy weight"
  - KR: Work out 4x/week consistently for 3 months
  - KR: Reach 180 lbs (current: 195)
- **Objective:** "Build Eon into my daily driver"
  - KR: Use it every workday for 2 consecutive weeks
  - KR: Capture rate > 90% (stop using other tools)

Goals have:

- A `title` — the Objective. Aspirational, directional.
- A `description` — why this matters, strategic context.
- `key_results` — a JSON array of measurable outcomes. Each has a title, optional target/current values, unit, and completion flag. This is where "how will I know?" lives.
- A `horizon` (quarterly, yearly, open-ended)
- An optional primary `area_id` — "Launch Bounce" belongs to the Bounce area. "Be more focused" has no area — it's cross-cutting. Single area, not many-to-many — the AI infers cross-cutting connections from context, so a junction table would add classification tax for no routing value.
- A `review_cadence` — how often the AI resurfaces the goal for check-in (default weekly)

**AI nudges toward concreteness.** When a user creates a vague goal ("get healthier", "grow the business"), the AI doesn't reject it — but it gently asks: _"What would tell you this is working? A specific number, a milestone, a habit you'd maintain? Goals with concrete key results are easier to track and more likely to lead to progress. I can help you refine this anytime."_ If the user declines, the goal stands as-is — a vague goal is better than no goal. The AI periodically resurfaces the nudge during review cycles until key results are added or the user explicitly says "leave it." When key results are provided, the AI can track progress, detect stalls, and celebrate milestones.

**How goals guide the AI:**

- **Deck rationale**: "This task advances your Q3 launch goal" — goals give the AI a _reason_ to recommend something beyond urgency and staleness.
- **Daily brief**: "Today's focus aligns with your Bounce launch goal — you're working on the last blocker before payments."
- **Weekly pulse**: "80% of your work this week went toward Bounce. Personal health goals got 0 attention. Want to adjust?"
- **KR progress tracking**: During review cycles, the AI checks key result progress: "Your Bounce launch goal: 2 of 3 key results on track. Churn is still at 8% vs. your 5% target — want to add a task to investigate?"
- **Completion detection**: When all key results are met, the AI suggests marking the goal achieved: "All 3 key results for your Bounce launch hit. Time to celebrate and set the next horizon for Bounce?"
- **Radar / blind spot detection**: "You have 4 active goals but all your tasks serve 2 of them. Learning about AI and family time are drifting."
- **Overcommitment check**: "You have 6 active goals but your calendar says you have ~25 hours of real work time this week. Something has to give."

Goals don't add classification friction — you never assign a task to a goal. The AI infers which goals your work advances from context (area, content, notes). Goals are reviewed periodically, not managed daily. They're the compass, not the map.

#### People

Contacts linked to tasks. Enables the AI to surface waiting-on tasks before meetings, track commitments across relationships, and close the follow-up loop.

### 5.3 Key Mechanisms

#### The Now Deck

The primary execution interface. Instead of browsing a list, the user sees:

- **1 recommended action** with a one-line rationale
- **2 alternatives** — one from the same energy mode, one cross-mode (so you always have a quick win visible during deep work pauses, or a deep option during light work)

The deck reads from pre-sorted buckets (`now` and `next`), filtered by the user's current energy toggle (Deep | Light), scope, and calendar context. The AI pre-sorts during morning triage and after completions — the deck itself is a fast read, not a live computation.

#### Boomerang Resurfacing

For tasks without hard deadlines, the system uses a `resurface_after` timestamp. When the time arrives, the task reappears in context — no red badge, no guilt. The user can act on it, snooze it forward, or dismiss it. If snoozed repeatedly, the AI gently asks if it should be archived or broken down.

#### The Radar

A curated feed of things that need attention but aren't "do right now" items:

- Projects that missed their heartbeat (no progress in N days)
- Tasks deferred repeatedly (possible avoidance)
- Approaching hard deadlines
- Waiting-on tasks due for follow-up
- Projects without a next action
- Near-complete tasks worth finishing
- Overcommitment warnings

#### Context Blocks (Internal Calendar)

An internal day view that combines:

- Real meetings/events synced from external calendar (read-only)
- AI-proposed work blocks based on priorities and available gaps
- Protected time for recurring tasks (habits, rituals)
- Buffer and transition time

This is not pushed to Google Calendar — it lives inside Eon. The user sees their day as a unified view of commitments + recommended work, and can adjust by conversing with the AI.

Context blocks are generated as part of the daily brief and stored as structured JSON within the session record — not as separate database entities. Each block is labeled with its energy type: **deep** (1hr+ uninterrupted gaps for focused work) or **light** (shorter gaps, fragmented time, between-meetings windows). The energy toggle auto-switches based on which block you're currently in. Blocks are regenerated on each replan — including midday replans when the afternoon looks different than expected. If we later need to track block-level completion, we can add persistence then.

#### Agent Activity Log

A transparent log of every action the AI takes — categorizations, resurfacings, priority changes, archive decisions, project flags. The user can see what the AI did, why, and override anything directly from the log. This builds trust and makes the AI feel like a colleague, not a black box.

---

## 6. User Experience

The entire UX exists to deliver three emotional outcomes. Everything else is plumbing.

1. **Clarity at the start.** "I know exactly what to work on and why."
2. **Flow in the middle.** "I always know what's next. I never stare."
3. **Closure at the end.** "Today mattered. Everything is captured. I can stop."

### 6.1 The Three Moments

#### Moment 1: Start of Work — "What should I jump into?" (2-3 minutes)

You open Eon. The AI doesn't show you a list of 50 tasks. It shows you **Today's Projects** — the 2-3 projects that deserve your attention today, ranked, with a one-liner on where each stands:

> **Today's Focus**
>
> 1. **Bounce — Auth System** (deep)
>    _Last session: Got OAuth flow working. Next: Wire up token refresh endpoint._
>    _Jake mentioned the API key format is changing — check before you start._
> 2. **InsiderFinance — Billing Bug** (deep)
>    _Customer reported Monday. 3 days old — worth knocking out today._
>
> **Light tasks for gaps:** Reply to Jake about partnership terms, approve InsiderFinance PR, call tile supplier about kitchen samples
>
> **Your day:** 2 deep blocks (8-10am, 11am-1pm), meetings at 10am and 1pm, fragmented afternoon for light tasks. Gym after 4pm.

You react: thumbs up, swap something, say "not today on the kitchen" or "add Project X." The AI adjusts. You start working.

The key insight: **you pick from projects, not tasks.** The tasks flow from the project. "Where did I leave off?" is answered by the project context (notes, last completed task, AI summary of recent activity). You're never staring at a flat list wondering where to begin.

#### Moment 2: During Work — "What's next?" (seconds per interaction)

Once you're working on a project, the **Now Deck** takes over. It shows the next task for your active project, with context from your notes and the AI's understanding of the project state.

- You complete a task -> Tap "Done" -> Optionally jot a note ("token refresh working, need to test error cases") -> The deck serves the next task for this project.
- You hit a wall (waiting on AI code gen, blocked on a person) -> Tap "Waiting" -> The deck instantly pivots. If you have time for deep work, it suggests your other focus project. If you have a short gap, it serves a quick win.
- You finish a deep work block or your energy dips -> The system suggests: "You've been on Bounce for 2 hours. Your afternoon is fragmented — switch to light tasks?" The energy toggle (Deep | Light) drives this — it auto-switches based on context blocks but you can override anytime.
- You have a thought -> Type or speak it into capture -> It disappears. You trust it'll come back.
- A meeting is coming up -> Eon surfaces prep tasks 15-30 minutes before.
- A meeting just ended -> Eon prompts: "Any decisions or follow-ups to capture?"

**On messages and context switching:** The system helps indirectly. You drift into Slack/email because there's a vacuum — you don't know what to do, so messages fill the gap. When the deck always has a clear "do this next" with a reason, the pull weakens. The system can also batch "respond to messages" as an explicit task with a time window ("reply to messages, 15 min, during your 2pm gap"), making it intentional rather than reactive. But ultimately, the best defense against message drift is never having a moment where you don't know what you should be doing.

#### Moment 3: End of Work — "Was today valuable?" (1-2 minutes)

This is the most emotionally important moment of the day. The system generates a **shutdown summary** — not a checklist, but a narrative that connects your work to outcomes:

> **Today's Wrap-Up**
>
> You completed 5 tasks across 2 projects.
>
> **Bounce:** Finished the token refresh endpoint and error handling. The auth system is now feature-complete — next session is integration testing. This unblocks the payment flow, which is the last piece before launch.
>
> **Home:** Followed up with the tile supplier. They're sending samples Thursday. Nothing else needed until then.
>
> **Quick wins:** Replied to Jake, approved the PR.
>
> **Didn't get to:** The open-source docs for Remi. That's fine — it wasn't in today's plan. I'll suggest it later this week if you have a gap.
>
> Everything is captured. You're done.

That last line — "Everything is captured. You're done." — is the sentence that lets your brain stop spinning. The system gives you permission to shut off by proving it's holding everything and will bring it back when it matters.

Optionally, you jot a quick reflection or update ("feeling good about Bounce, might push launch to next week though"). The AI absorbs this context for future planning.

### 6.2 The Weekly Pulse (optional, 5 minutes)

- The AI generates a retrospective: what moved forward, what stalled, what's coming up
- Project-level view: "Bounce made major progress. Kitchen reno is waiting on suppliers. Remi hasn't been touched in 3 weeks — still on your radar?"
- Goal-level check-in with KR progress: "Your Bounce launch goal: 2 of 3 key results on track (churn still above target). Health goal hasn't gotten attention in 2 weeks — no KR progress since last review."
- Slow-burn projects get their heartbeat check-in
- You adjust project/goal priorities if needed
- This replaces the traditional weekly review — it's a conversation, not a ceremony

### 6.3 Capture Experience

Capture must feel like texting a friend, not filling out a form.

**Input methods:**

- Global text input (always visible, Cmd+K or spotlight-style)
- Voice input (speech-to-text -> same pipeline)
- Chat interface ("remind me to call the roofer next week")
- Quick actions from meetings/calendar context

**What happens after capture:**

1. Raw text is stored immediately (capture is instant, never blocked by AI processing)
2. AI triage runs (can be async — show a brief "processing" indicator)
3. Confirmation toast: "Task: '[Title]' → [Area / orphan] — [bucket], [energy]" or "Note saved → [Area / orphan]"
4. Toast includes one-tap correction chips: Reassign area, Change parent, Change deadline/snooze, Mark waiting, Flip to note/task, Edit
5. If the AI is uncertain about something critical (hard deadline vs. reminder), it asks one clarifying question — never more

**Capture principles:**

- Zero required fields beyond the raw text
- The AI errs on the side of action: default to creating a task with a boomerang, not asking questions
- Low-confidence categorizations are applied anyway — correcting is cheaper than asking
- If the raw input implies a new project, the AI can suggest creating a parent task
- Orphan captures (no area) are fine — don't force-assign to avoid junk drawers

### 6.4 The Now Deck (Execution Interface)

The Now Deck is the heart of Eon. It answers the question "what should I do right now?" in under 10 seconds.

**Layout:**

- One primary card (prominent, center): the recommended next action
- Two smaller alternate cards: one from the same energy mode, one cross-mode. During deep work, you always see a light quick win for natural pauses. During light work, you always see the next deep work option.
- Each card shows: title, project badge, one-line rationale
- Actions per card: Done, Snooze (1d/3d/1w/custom), Not Today, Waiting On, Reassign

**Deck action flows** (exact tool chain for each action):

**Done (one-time task):**
1. `updateTask(id, { status: 'done', completed_at: now })`
2. If task has a `parent_id` → `updateTask(parentId, { last_progress_at: now })`
3. If `now` bucket is thin (< 2 tasks remaining) → run `deck-generate` to refill from `next`
4. `logActivity` — record completion

**Done (recurring task):**
1. `logCompletion(taskId, note?)` — immutable event log
2. Query `getCompletions(taskId)` for current period count
3. If completions for this period >= `target_frequency` → `moveTask` to `next` (done for this period, stays until next period)
4. If completions < `target_frequency` → task stays in `now` (still due this period)
5. Recompute `streak_current` and `streak_best` from completion log → `updateTask` cached values
6. `logActivity`

**Snooze:**
1. User picks duration (1d / 3d / 1w / custom)
2. `updateTask(id, { resurface_after: now + duration, times_deferred: +1 })`
3. `moveTask(id, 'next')` — remove from `now`
4. `logActivity` — record deferral (used by radar for avoidance detection)

**Not Today:**
1. `moveTask(id, 'next')` — demote from `now` to `next`
2. `updateTask(id, { sort_key: bottom_of_next })` — pushed to end of `next` so it doesn't immediately re-promote
3. `logActivity`

**Waiting On:**
1. UI prompts for free text: "What are you waiting on?"
2. `updateTask(id, { status: 'waiting', waiting_on: text, waiting_since: now })`
3. Task disappears from deck, enters `waiting` bucket
4. `logActivity`

**Reassign:**
1. UI shows area/project picker
2. `updateTask(id, { area_id: newAreaId })` and/or `updateTask(id, { parent_id: newParentId })`
3. `logActivity`

**Top controls:**

- **Scope pill**: All | [Area name] | [Project name] — filters the deck to an area or parent task
- **Energy toggle**: Deep | Light — filters by work type. Default is inferred from the current context block (deep work block → Deep, gap between meetings → Light). User can override anytime.

Changing any control instantly reshuffles the deck. The energy toggle and scope pill are the only filters — no time pill (estimated_minutes is optional and unreliable for most tasks), no multi-mode selector. Two dimensions: what domain (scope) and what type of work (energy).

**How the deck is computed:**

The deck reads from pre-sorted buckets. The AI has already sorted tasks during morning triage and after completions — reading the deck is a fast query, not a live computation.

1. **Structured filter**: Read `now` bucket filtered by scope and energy, ordered by `sort_key`
2. **Cross-mode alternate**: Always include one card from the opposite energy mode (deep work pauses always have a light option; light work always shows the next deep option)
3. **Overflow from `next`**: If `now` is thin, pull from the top of `next` (same filters)

The LLM sorts tasks during specific moments (morning triage, after completion, midday replan), not on every deck read. See Section 8.2 for the full two-layer system.

**Fallback (no LLM / offline):** Show `now` tasks in cached `sort_key` order. If `now` is empty, show `next` sorted by hard_deadline proximity then created_at. Degraded but functional.

### 6.5 The Radar (Resurfacing Feed)

The Radar replaces the weekly review with a continuous, curated drip of things that need attention.

**What appears in Radar:**

- **Stale projects**: Parent tasks that missed their heartbeat cadence (no child task progress in N days). Action: Revive (generate next action), Snooze, Move to Someday.
- **Repeated deferrals**: Tasks snoozed 3+ times. Action: Break down, Reduce scope, Archive. The AI may gently name the avoidance pattern.
- **Approaching deadlines**: Hard deadlines within 7 days that haven't been worked on.
- **Missing next actions**: Parent tasks (projects) with zero active child tasks.
- **Near-complete tasks**: Tasks with most body checkboxes done that have stalled.
- **Waiting follow-ups**: Items in "waiting on" state for longer than the follow-up cadence.
- **Overcommitment signals**: More committed work than available capacity this week.
- **Neglected goals**: Active goals where no related work has happened in the review cadence period.
- **Backlog pulse**: Items that haven't been surfaced in 2+ weeks that the AI thinks are still relevant.

**Radar is not a list of everything.** It's a curated feed of 3-7 things that need a decision, presented one at a time or in a short scrollable view. Each entry has clear action buttons.

### 6.6 Projects View

Projects aren't a separate entity — this view is a **filtered lens** on tasks that have children.

- List of all "project" tasks (tasks with children) grouped by area, plus orphan projects with no area
- Each shows: name, status, last progress date, next action (first active child), child task count
- Click into a project to see: outcome, body/notes, all child tasks by status (now, next, backlog, waiting, someday, done), heartbeat cadence
- "Generate next actions" button: AI proposes 1-3 concrete next steps based on project context and body
- Drag-to-reorder project priority within an area (or let AI suggest ordering)
- Any task can become a project — just add a child task. Any project can become a task — resolve or remove all children.

### 6.7 Routines View

- Filtered view of tasks with `task_type` in (habit, maintenance, ritual) — not a separate entity, just a lens
- Today's recurring tasks with completion windows and status
- "Minimum viable done" button (10 minutes of reading counts as reading)
- Gentle consistency visualization (streaks or heatmap, never punitive)
- AI insight: "You've been consistent with workouts but journaling dropped off — want to adjust the goal?"

### 6.8 Calendar View

- Day/week agenda with real events from synced calendar
- Highlighted gaps between events with available minutes shown
- Context blocks overlaid: AI-suggested work blocks, habit time, buffers
- Tap a gap -> "Fill this gap" opens a filtered deck for that time window

### 6.9 Everything View (Safety Valve)

- Searchable, filterable list of all tasks across all projects
- Filters: area, parent task (project), status, task type, context tags, effort, date range, person
- Sort: by bucket (now > next > backlog > someday), by sort_key within bucket, by date created, alphabetical
- This view exists for trust and control — the user can always see the full picture
- But it should NOT be the daily driver. The daily driver is the deck.

### 6.10 Agent Activity View

- Chronological log of all AI actions: categorizations, resurfacings, priority adjustments, archive decisions, project flags, decay events
- Each entry shows what was changed, why, and allows one-tap override
- "The AI moved 'Call roofer' to today because rain is forecast this weekend" — user can tap to undo or adjust
- This builds transparency and trust. The AI is a visible collaborator, not a hidden algorithm.

---

## 7. Data Model

### Design Philosophy

Store facts and user overrides. Derive everything else. Keep manual state minimal. The schema should be simple enough that switching storage engines (SQLite -> Postgres, or even markdown flat files) is straightforward.

### Schema

**ID generation:** All `id` columns use UUIDv7 (`uuidv7` npm package). UUIDv7 embeds a timestamp, so IDs sort chronologically by creation time. This gives us globally unique, time-ordered identifiers without a separate `created_at` index for ordering.

**Config:** User configuration (API keys, model-to-tier mapping, preferences) lives in `.env` at the project root.

```sql
-- ============================================================
-- AREAS: Stable life/work domains
-- ============================================================
CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  notes TEXT,                                      -- strategic context, not a task
  allocation_weight REAL NOT NULL DEFAULT 1.0,     -- relative attention bias
  status TEXT NOT NULL DEFAULT 'active',            -- active | paused | someday | archived
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- TASKS: The atomic unit of actionable work
-- A task with children IS a project (UI adapts, no separate table)
-- ============================================================
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id),             -- nesting: child → parent. A task with children = "project"
  area_id TEXT REFERENCES areas(id),               -- optional: orphan tasks are first-class

  -- Raw capture
  raw_input TEXT NOT NULL,                         -- exactly what the user typed/said

  -- AI-processed fields
  title TEXT NOT NULL,                             -- clean, verb-first summary
  description TEXT,                                -- AI-expanded context
  task_type TEXT NOT NULL DEFAULT 'task',           -- task | habit | maintenance | ritual

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
  estimated_minutes INTEGER,                       -- truly optional. Only set when duration is genuinely known.
                                                   -- NOT a primary deck filter. Calendar block size + energy replaces time math.
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

  -- State (GTD-inspired buckets, AI-managed)
  status TEXT NOT NULL DEFAULT 'next',              -- now | next | backlog | waiting | someday | done | archived
  sort_key TEXT,                                   -- fractional index for ordering within bucket (lexicographic)
                                                   -- uses fractional-indexing library. No full resorts needed.
  waiting_on TEXT,                                 -- free text: what's blocking this. Can reference tasks, people,
                                                   -- external events, conditions — anything. The LLM reasons about
                                                   -- resolution during radar passes. No brittle FK that gets out of sync.
  waiting_since TEXT,                              -- when it entered waiting state

  -- People
  person_id TEXT REFERENCES people(id),

  -- Recurrence (nullable — only set for habits/maintenance/rituals)
  recurrence TEXT,                                   -- natural language schedule: "4x/week, mornings preferred",
                                                     -- "first Thursday of every month", "every 10 days",
                                                     -- "2x per day, morning and afternoon".
                                                     -- Source of truth. LLM interprets period boundaries and timing.
  recurrence_interval_days INTEGER,                  -- AI-estimated rough days between occurrences.
                                                     -- Only for SQL pre-filtering (radar, staleness detection).
                                                     -- Not source of truth — recurrence text is.
  target_frequency INTEGER,                          -- completions per period (e.g., 4 for "4x/week")
  target_minutes INTEGER,                            -- ideal duration per session
  minimum_minutes INTEGER,                           -- minimum viable completion (even 5 min counts)
  streak_current INTEGER NOT NULL DEFAULT 0,         -- cached, recomputed by AI from task_completions during triage
  streak_best INTEGER NOT NULL DEFAULT 0,            -- all-time best streak (cached)

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
-- Notes are NOT tasks. No buckets, no deadlines, no deck.
-- ============================================================
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  area_id TEXT REFERENCES areas(id),               -- optional: orphan notes are first-class
  task_id TEXT REFERENCES tasks(id),               -- optional: link to related task
  title TEXT,                                      -- optional: not all notes need a title
  body TEXT NOT NULL,                               -- rich markdown content
  url TEXT,                                        -- optional: if present, note is a "bookmark" in the UI
  context_tags TEXT DEFAULT '[]',                   -- AI-inferred tags for search/filtering
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
-- PEOPLE: Contacts linked to tasks
-- ============================================================
CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  relationship TEXT,                                -- coworker | client | friend | family | other
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
-- USER STATE: Ephemeral current focus/mode
-- ============================================================
CREATE TABLE user_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),            -- singleton row
  active_area_id TEXT REFERENCES areas(id),
  active_parent_task_id TEXT REFERENCES tasks(id),   -- scoped to a "project" (task with children)
  active_energy TEXT,                                 -- deep | light (energy toggle state)
  available_minutes INTEGER,                          -- inferred from calendar, not user-managed
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
  entity_type TEXT NOT NULL,                         -- task | note | area | goal | session
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,                              -- created | categorized | resurfaced | archived |
                                                     -- bucket_changed | flagged_stale | flagged_overcommit |
                                                     -- suggested_next_action | decayed
  description TEXT NOT NULL,                         -- human-readable: "Moved 'Call roofer' to today..."
  details TEXT,                                      -- JSON: full context of the change
  user_overridden INTEGER NOT NULL DEFAULT 0,        -- did the user override this?
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- AI MEMORY: Learned patterns, preferences, and calibrations
-- Distilled from behavioral signals. Injected into AI prompts.
-- ============================================================
CREATE TABLE ai_memory (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,                            -- preference | pattern | calibration | observation
  key TEXT NOT NULL,                                 -- machine-readable identifier
  content TEXT NOT NULL,                             -- natural language description (injected into prompts)
  value_json TEXT,                                   -- optional structured data for programmatic use
  confidence REAL NOT NULL DEFAULT 0.5,              -- 0-1, how confident is the AI in this observation
  evidence_count INTEGER NOT NULL DEFAULT 1,         -- observations supporting this memory
  source TEXT,                                       -- what generated this (override_analysis, completion_patterns, etc.)
  is_user_confirmed INTEGER NOT NULL DEFAULT 0,      -- user explicitly confirmed or edited this
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(category, key)
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
CREATE INDEX idx_tasks_type ON tasks(task_type);
CREATE INDEX idx_tasks_recurrence ON tasks(recurrence_interval_days) WHERE recurrence IS NOT NULL;
CREATE INDEX idx_completions_task ON task_completions(task_id, completed_at);
CREATE INDEX idx_notes_area ON notes(area_id);
CREATE INDEX idx_notes_task ON notes(task_id);
CREATE INDEX idx_calendar_time ON calendar_events(start_time, end_time);
CREATE INDEX idx_agent_activity_entity ON agent_activity(entity_type, entity_id);
CREATE INDEX idx_agent_activity_time ON agent_activity(created_at);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_area ON goals(area_id);
CREATE INDEX idx_ai_memory_category ON ai_memory(category);

-- Embeddings (via sqlite-vec)
-- Stores vector embeddings for semantic search, duplicate detection, and clustering.
-- All entities that need similarity search get an embedding row.
CREATE VIRTUAL TABLE vec_embeddings USING vec0(
  entity_type TEXT NOT NULL,              -- 'task', 'note', 'area', 'memory'
  entity_id TEXT NOT NULL,
  embedding float[1536],                  -- dimension matches model (1536 for text-embedding-3-small)
  +model TEXT NOT NULL,                   -- which embedding model generated this
  +updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Key Schema Decisions

1. **Three entities: Areas, Tasks, Notes.** No projects table — a task with children IS a project (the UI adapts). No routines table — a task with a cadence IS a routine. Notes are separate from tasks because they're fundamentally different: no status buckets, no deadlines, no deck eligibility. The AI classifies captures into tasks or notes at triage time. The user never decides.

2. **No projects table.** "Is this a project or a task?" is a question that no longer exists. A task with children behaves like a project in the UI — it gets heartbeat tracking, stale nudges, progress visualization. But it's the same entity. Project-like fields (`outcome`, `heartbeat_days`, `last_progress_at`) live on the tasks table as nullable columns. Promotion/demotion is invisible — add a child task and it becomes a project; remove all children and it's just a task.

3. **Orphans are first-class.** Tasks and notes can exist without an area. They appear in the deck, they're searchable, the AI surfaces them. Not everything needs a home. Forcing things into areas creates junk drawers. When an orphan finds its natural area, reassignment is one tap.

4. **Area status.** Areas have `active | paused | someday | archived` status. Active areas (3-7 typically) drive the daily experience. But total areas can be unlimited — side projects, future ideas, seasonal concerns live as paused/someday. The AI manages lifecycle transitions.

5. **`body` field is the primary workspace.** Rich markdown, checklists, context, links. This is where you track progress, jot notes as you work, and always know where you left off. Distinct from `raw_input` (original capture) and `description` (AI-generated context).

6. **`hard_deadline` vs `resurface_after`**: Two distinct fields, two distinct semantics. `hard_deadline` is rare and sacred. `resurface_after` is common and guilt-free. Tasks with only `resurface_after` never show "overdue."

7. **GTD-inspired buckets replace importance.** Status is `now | next | backlog | waiting | someday | done | archived`. Bucket placement IS the priority signal — the AI manages all transitions, the user never picks from a dropdown. No `importance` field exists. Within buckets, the AI sorts by reasoning from natural language context (`user_context`, `ai_context`, goals, deadlines, calendar, patterns). This eliminates a field the AI would frequently misclassify and removes a source of maintenance tax.

8. **`sort_key` uses fractional indexing.** A lexicographic string (via `fractional-indexing` library) that orders tasks within their bucket. Inserting between two items never requires renumbering other rows. The AI sets sort_key during morning triage and after completions. Between AI updates, the cached order serves the deck instantly.

9. **`user_context` and `ai_context` are the primary priority signals.** `user_context` is the user telling the AI what matters: "blocks the launch," "need before board meeting." `ai_context` is the AI's scratchpad: "deferred 3x, possible avoidance," "connected to Q3 launch goal." These natural language fields give the AI richer signal than any enum and persist across sessions.

10. **`context_tags` as AI-inferred JSON arrays** on both tasks and notes. Flexible, no taxonomy to manage. The AI applies tags; the user can filter by them. Common tags: `coding`, `deep-work`, `quick-win`, `phone`, `email`, `errand`, `review`, `creative`, `administrative`, `financial`, `health`, `social`. Tags complement vector search — tags are for explicit filtering ("show me all coding tasks"), vectors are for fuzzy discovery ("find things related to the API rewrite").

11. **Recurring work lives in the tasks table.** `task_type` includes `habit | maintenance | ritual`. Recurrence schedule, streak tracking, and minimum viable completion are nullable columns. NULLs are free in SQLite. No separate routines entity, no "is this a habit or a task?" decision.

12. **No `completion_pct`.** Completion debt detection relies on AI inference from task age, activity signals, and body content — not a maintained percentage.

13. **No `context_blocks` table.** Context blocks are generated as structured JSON within the daily brief and stored in `sessions.ai_plan`. Regenerated on each replan.

14. **No `importance` field.** Priority is expressed through bucket placement (`now` > `next` > `backlog`) and sort order within each bucket. The AI reasons about priority from natural language context, not stored labels. This eliminates a field that would be wrong often enough to erode trust.

15. **`agent_activity` table**: Complete audit trail of AI decisions. Powers the Agent Activity View and builds user trust.

16. **Singleton `user_state`**: Ephemeral focus state (current scope, mode, available time). Drives the deck filter.

17. **Goals are the compass, OKR-inspired.** Each goal has an Objective (title) and Key Results (`key_results` JSON array). The AI nudges users toward concrete, measurable KRs but never forces them — a vague goal beats no goal. The AI infers which goals a task advances from context — no `goal_id` FK on tasks, no classification decision at capture. KR progress is tracked and surfaced during review cycles. When all KRs are met, the AI suggests marking the goal achieved. Goals surface in weekly pulse, daily brief rationale, deck rerank, and radar (neglected goals / stalled KRs). They answer the question traditional task managers ignore: "Am I working on the right things?"

18. **`ai_memory` table**: Distilled behavioral observations that persist across sessions. The AI gets smarter over time — not just from better prompts, but from accumulated knowledge of this specific user. Memories are transparent (viewable, editable, deletable) and logged in agent_activity.

19. **`waiting_on` is free text, not a foreign key.** Blocking conditions are described in natural language: "Waiting for Jake to review the PR and for the design team to finalize mockups." This can reference other tasks, people, external events, or compound conditions — anything. No `blocked_by_task_id` FK exists. The LLM reasons about whether blocks are resolved during radar passes and after task completions. This is simpler, more flexible, and avoids brittle FKs that get out of sync when tasks are restructured. The `waiting` status bucket gates blocked tasks from the deck; `waiting_on` text explains what; `waiting_since` tracks duration.

20. **`reminder_at` is separate from `hard_deadline`.** A reminder is "alert me at this time" (pick up kids at 3pm). A deadline is "this must be done by this date" (tax filing). Most tasks with time-specific language need a reminder, not a deadline. The AI auto-sets `reminder_at` from capture language ("at 3pm", "before the meeting"). Implemented via browser Notification API — no server infrastructure needed.

21. **Duplicate detection at triage.** Every capture is checked against existing task embeddings via cosine similarity (`sqlite-vec`). If a near-match exceeds the similarity threshold, the user sees "Similar task exists" with options to merge, create anyway, or view existing. This prevents inventory bloat that erodes trust. Vector similarity catches semantic duplicates that keyword matching would miss ("call the dentist" vs. "schedule dentist appointment").

22. **Attachments are local files.** Binary attachments (photos, screenshots, files) stored in `~/.eon/attachments/{task_id}/`. The `attachments` JSON field on tasks tracks metadata. Rendered inline in the task body. File storage is local — no cloud dependency.

23. **Embeddings via `sqlite-vec` for semantic search.** Every task and note gets a vector embedding generated during triage (or on significant edit). Stored in `vec_embeddings` virtual table — stays in the same SQLite file, no external vector DB. Powers three things: (1) **semantic search** — "find marketing tasks" returns "campaign launch" and "ad copy" without keyword match, (2) **duplicate detection** — new captures are compared against existing embeddings by cosine similarity before creating, (3) **context retrieval** — when building AI prompts (daily brief, radar, deck rerank), pull the most _relevant_ tasks/notes as context, not just the most recent. Embedding model follows the same provider abstraction — defaults to cheapest available (OpenAI `text-embedding-3-small`, or local via Ollama `nomic-embed-text`). Dimension is model-dependent (1536 for `text-embedding-3-small`). FTS5 handles keyword search alongside vectors — they're complementary, not redundant.

24. **UUIDv7 for all IDs.** Every `id TEXT PRIMARY KEY` uses UUIDv7 (via `uuidv7` npm package). UUIDv7 embeds a millisecond timestamp, so IDs sort chronologically. This gives globally unique, time-ordered identifiers without needing a separate sequence or auto-increment.

25. **Recurring task completions are event-sourced.** Each completion is logged as an immutable row in `task_completions`. Period counts, last-completed timestamps, and streak data are derived from this log — not stored as mutable state on the task. The `recurrence` field is natural language (same pattern as `waiting_on`) because cadence patterns are too varied to model structurally: "first Thursday of every month," "every 10 days," "4x/week mornings preferred," "2x per day, morning and afternoon." The LLM interprets period boundaries from recurrence text during morning triage. `recurrence_interval_days` exists solely as a rough SQL pre-filter for radar/staleness detection. `streak_current` and `streak_best` are cached on the task for display and recomputed by the AI during triage.

---

## 8. AI System Design

The AI has several distinct jobs, each implemented as a separate function/prompt so they can be tuned independently.

### 8.1 Capture Triage

**Trigger:** Every time raw input is captured.

**Input:** Raw text + active areas + existing parent tasks (projects) + known people + current date/time.

**Output:** Either a structured task or a note, depending on whether the capture is actionable.

```
System: You are the triage engine for a personal productivity system.
The user has just captured a raw thought. Your job is to determine if this
is actionable (task) or non-actionable (note), then extract structured data.
Be opinionated — make your best guess for every field. The user can correct
easily, so it's better to guess than to leave fields empty.

First, decide: is this a TASK (something to do) or a NOTE (something to remember)?
- "Call the roofer" → task
- "Great insight from podcast: agents need explicit tools" → note
- "Work out 4x/week" → task (habit)
- "Bounce strategy: pivot to B2B" → note

For TASKS:
- title: Short, verb-first if actionable. "Call the roofer about shingles"
- task_type: task (default) | habit | maintenance | ritual
- status: Bucket placement based on language and intent:
  - "next" (default): actionable, ready to do
  - "backlog": real work but not immediate ("I should eventually...")
  - "someday": no commitment, idle thought ("Maybe someday I'll...")
  - "waiting": blocked on someone/something
- ai_context: Your initial observations about this task. Note any patterns,
  goal connections, or context the user might not have stated explicitly.
  Example: "Financial task. Recurring quarterly obligation." or
  "Related to Bounce launch goal — user_context on auth task says this is a blocker."
- hard_deadline: ONLY set this if the text implies a real, external,
  consequential deadline. "Registration closes Friday" = hard deadline.
  "I should do this soon" = NOT a hard deadline.
- resurface_after: For anything that isn't immediately actionable, set a
  reasonable resurface date. Default 2-7 days for next items, 14-30 days
  for someday items.
- area_id: Match to existing area if confident. Leave null if unsure —
  orphan tasks are fine.
- parent_id: Match to existing parent task ("project") if confident.
  Leave null if unsure.
- context_tags: Infer from the nature of the work.
- energy: deep (focused, uninterrupted thinking) | light (admin, comms, errands, quick tasks)
- estimated_minutes: Only set if duration is genuinely knowable. Round to 5/15/30/60/120. Leave null for open-ended deep work — calendar block size + energy handles time fit.
- For habits/maintenance/rituals: set recurrence, target_frequency, recurrence_interval_days, etc.

For NOTES:
- title: Optional short summary
- body: The content
- area_id: Match to area if relevant. Leave null if cross-cutting.
- task_id: Link to related task if relevant.
- context_tags: Infer topics for search/filtering.

Active areas: {areas with descriptions}
Parent tasks (projects): {tasks that have children, with context}
Known people: {people list}
Current datetime: {now}

Raw input: "{user text}"
```

The triage should be fast. Use the user's configured "fast" tier model for triage and reserve their "capable" tier model for planning and deck generation. See Section 8.8 for the model strategy.

### 8.2 How the Deck Works

The deck is built on a two-layer system: **structured filtering** (fast, deterministic) narrows candidates, then **LLM reasoning** (rich, contextual) sorts and explains.

**Layer 1 — Structured filtering (instant, no LLM):**

The deck reads from pre-sorted buckets. The AI has already placed tasks in `now`, `next`, `backlog`, etc. during morning triage and after completions. Reading the deck is a simple query:

```sql
-- Primary deck: today's focus, pre-sorted by AI
SELECT t.* FROM tasks t
WHERE t.status = 'now'
  AND (t.area_id = :active_area_id OR :active_area_id IS NULL)
  AND (t.parent_id = :active_parent_task_id OR :active_parent_task_id IS NULL)
  AND (t.estimated_minutes <= :available_minutes OR :available_minutes IS NULL)
  AND (t.energy = :active_energy OR :active_energy IS NULL)
ORDER BY t.sort_key
LIMIT 5;

-- Alternates: next up, for when user wants options
SELECT t.* FROM tasks t
WHERE t.status = 'next'
  AND (t.resurface_after IS NULL OR t.resurface_after <= datetime('now'))
  AND t.waiting_on IS NULL
  AND (t.area_id = :active_area_id OR :active_area_id IS NULL)
  AND (t.estimated_minutes <= :available_minutes OR :available_minutes IS NULL)
  AND (t.energy = :active_energy OR :active_energy IS NULL)
ORDER BY t.sort_key
LIMIT 10;
```

This is instant — it's reading pre-computed state, not ranking 500 tasks.

**Layer 2 — LLM sorting (runs during triage and promotion, not on every deck read):**

The LLM sorts tasks within buckets during specific moments:

1. **Morning triage** (daily): Selects `now` from `next`, sorts both. The main orchestration moment.
2. **After completion**: When `now` thins out, promotes from `next`.
3. **Mid-day capture**: Urgent new tasks may go straight to `now`.
4. **Radar pass** (daily): Scans `backlog` for promotions to `next`.

The LLM doesn't compute a score — it looks at the candidate list and returns an ordered array with rationale. This is what LLMs are good at.

```
System: You are an executive assistant deciding the priority order
for tasks today.

Given the user's context and candidate tasks, return them in priority
order. For the top 3, provide a one-line rationale (max 15 words)
explaining WHY. Reference concrete facts: deadline proximity, goal
alignment, time fit, dependency unblocking, or patterns you notice.

Context:
- Current time: {time}
- Calendar: {today's events and gaps}
- Energy: {deep | light}
- Scope: {area / parent task, if set}
- Active goals: {goals with key results and progress}
- Stale parent tasks: {projects that missed heartbeat}
- AI memories: {relevant patterns, preferences, calibrations}
- Yesterday: {what was planned vs. completed}

Candidates (from `next` bucket):
{tasks with: title, user_context, ai_context, body summary,
 area, parent task, energy, estimated_minutes, hard_deadline,
 context_tags, times_deferred, created_at}

Return: ordered task IDs + rationale for top 3.
Which tasks should be `now` (today's focus)?
Which stay in `next`?
Any that should move to `backlog` or `someday`?
```

**Energy filter mapping** (applied as SQL filters on the deck query):

| Energy | What it shows                                        | Context tags typical                                        |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| Deep   | Focused, uninterrupted work                          | coding, creative, writing, research, architecture, analysis |
| Light  | Everything else — admin, comms, errands, quick tasks | email, admin, communication, errand, review, financial      |

The AI sets `energy` at triage time based on task content. The user can override per task via `user_context` ("this email is actually deep work — I need to think carefully about the response").

**Fallback (no LLM):** Show `now` tasks in cached sort_key order. If `now` is empty, show `next` sorted by hard_deadline proximity then created_at. Degraded but functional — the user can still see their tasks and pick one.

### 8.3 Daily Brief Generation

**Trigger:** User opens app for the first time each day or explicitly requests a plan.

**Input:**

- Today's calendar events (from cache)
- Available time gaps computed from calendar
- All `next` tasks (the candidate pool) with user_context, ai_context, and key fields
- Today's recurring tasks (habits, maintenance, rituals)
- Yesterday's session (planned vs. completed)
- Stale parent tasks (projects that missed heartbeat) and upcoming deadlines
- Area-level notes for context
- Active goals with key results, progress, and horizons
- Relevant AI memories (patterns, calibrations, preferences)
- User state signals (engagement level, capacity, recent patterns — see Section 8.6)

**Output:** Natural language daily brief + structured context blocks.

```
System: You are the user's AI chief of staff. Generate their daily plan.

Be conversational, warm, and direct — like a sharp chief of staff, not a
robotic scheduler. Be opinionated: tell them what you think they should
focus on, don't just list options. But be brief.

Adapt to user state:
- If engagement is low or returning_after_gap: keep it short. 1-2 focus items
  max. "Welcome back" framing. No guilt about what was missed.
- If capacity is meetings_only: light tasks only. Acknowledge the day is packed.
- If pattern is overloaded: fewer items, explicit permission to defer.
- If tone is gentle: no productivity pressure. "When you're ready" framing.
- If pattern is productive_flow: stay concise. They know what they're doing.

Structure:
1. Start with a quick read of the day (meetings, capacity)
2. Anchor recurring tasks (habits/routines) into appropriate gaps
3. Assign the primary deep work focus
4. Queue quick wins for short gaps
5. Surface 1-2 backlog tasks as "worth a look" if time allows
6. Flag overcommitment if total work > available time

Return:
- "summary": A conversational plan (3-8 sentences)
- "now_tasks": Ordered task IDs to promote to `now` (1-7 tasks, sized to capacity)
- "next_order": Sorted remaining `next` task IDs
- "promotions": Any `backlog` tasks to promote to `next` (with reason)
- "blocks": Array of context blocks (deep/light) mapped to calendar gaps
- "overcommitted": boolean
- "deferred": tasks that won't fit today
```

**The daily brief is the key orchestration moment.** This is where the AI moves tasks between buckets, sorts `now` and `next`, assigns sort_keys, and gives the user a clear plan. The user reacts conversationally ("swap X for Y", "not today on Z"). The AI adjusts. This replaces the weekly review with a daily, conversational, 2-3 minute triage.

**Midday replanning** can happen anytime — after a meeting that changes everything, after a burst of new captures, or when the user asks "re-plan my afternoon." The same pipeline runs, scoped to the remaining day.

### 8.4 Radar Generation

**Trigger:** Daily (can run with daily brief) or on-demand.

**Approach:** Mostly rule-based queries with optional LLM enrichment for suggested actions.

```
Radar items come from:

1. SELECT t.* FROM tasks t
   WHERE t.id IN (SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL)
   AND t.status IN ('now', 'next', 'backlog')
   AND t.heartbeat_days IS NOT NULL
   AND (t.last_progress_at IS NULL
        OR julianday('now') - julianday(t.last_progress_at) > t.heartbeat_days)
   -- Stale "projects" (parent tasks that missed their heartbeat)

2. SELECT t.* FROM tasks t
   WHERE t.times_deferred >= 3 AND t.status IN ('now', 'next', 'backlog')
   -- Repeatedly deferred (possible avoidance)

3. SELECT t.* FROM tasks t
   WHERE t.hard_deadline IS NOT NULL
   AND julianday(t.hard_deadline) - julianday('now') <= 7
   AND t.status IN ('now', 'next', 'backlog')
   -- Approaching deadlines

4. SELECT t.* FROM tasks t
   WHERE t.id IN (SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL)
   AND t.status IN ('now', 'next', 'backlog')
   AND t.id NOT IN (
     SELECT parent_id FROM tasks
     WHERE status IN ('now', 'next', 'backlog') AND parent_id IS NOT NULL
   )
   -- "Projects" with no active child tasks (missing next action)

5. SELECT t.* FROM tasks t
   WHERE t.status = 'waiting'
   AND julianday('now') - julianday(t.waiting_since) > 3
   -- Waiting tasks due for follow-up

6. SELECT t.* FROM tasks t
   WHERE t.status = 'backlog'
   AND (t.resurface_after IS NOT NULL AND t.resurface_after <= datetime('now'))
   -- Backlog boomerangs ready to promote to `next`
```

For avoidance detection (query 2), optionally send to LLM to generate a gentle suggestion: "This has been pushed back 4 times. Would it help to break it into a smaller first step? What's the 5-minute version?"

**Block resolution check:** For waiting tasks (query 5), the LLM reads each task's `waiting_on` text and checks whether the blocking condition has been resolved — by cross-referencing completed tasks, recent captures, calendar events, and People interactions. If the LLM determines the block is likely resolved, it surfaces the task for the user to confirm: "You were waiting on Jake to review the PR. He completed a review task yesterday — is this unblocked?" This replaces a brittle FK with flexible, natural language reasoning.

### 8.5 Avoidance Detection & Response

When a task has been deferred 3+ times and is non-trivial (estimated_minutes > 15):

1. **Don't escalate pressure.** No red badges, no urgency inflation.
2. **Offer to break it down.** AI suggests the smallest possible first step.
3. **Gently name the pattern** (optional, after 5+ deferrals): "This keeps slipping. That's often a sign the task feels bigger than it is. Want me to find a 5-minute way in?"
4. **Offer an out.** "Is this still worth doing? It's okay to archive it."

### 8.6 Adaptive Capacity & Tone

The AI adjusts its behavior based on the user's current state — detected from behavioral signals, not explicit settings. This is not a mode the user toggles; it's the AI reading the room.

**Signals the AI reads:**

| Signal                                            | What it suggests              | AI response                                                                                                                                          |
| ------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low engagement (hasn't opened app in 2+ days)     | Overwhelmed or disengaged     | Smaller `now` set (1-2 items). Gentler tone: "Welcome back. Here's the one thing that matters most today."                                           |
| High deferral rate (>50% of `now` deferred today) | Overloaded or misaligned plan | Offer to replan: "Looks like today didn't go as planned. Want me to re-sort based on what's actually possible?"                                      |
| All-meetings day (calendar shows <30 min of gaps) | No execution capacity         | Switch to light-only deck. Daily brief acknowledges: "Your day is wall-to-wall. I've queued only quick tasks for gaps. Deep work moves to tomorrow." |
| Health/crisis area active with recent captures    | Difficult life period         | Softer language throughout. No productivity framing. "When you're ready" instead of "you should." Smaller `now` sets.                                |
| New area with flood of captures (20+ in a day)    | Onboarding or life transition | Batch triage mode. "You've captured a lot for [area]. Want me to organize these into a rough plan, or just file them for now?"                       |
| Consistent high completion rate                   | In flow, system is working    | Stay out of the way. Minimal commentary. Quick deck transitions.                                                                                     |

**How it's implemented:** These signals are computed from existing data (sessions, agent_activity, calendar_events, task completion patterns) and injected into LLM prompts as user state context. The daily brief, deck rerank, and radar prompts all receive a `user_state_signals` block that the LLM uses to calibrate tone and volume. No new schema needed — the intelligence lives in the prompt, not the database.

**Tone adaptation in prompts:** All LLM prompts include a tone directive derived from user state:

```
User state signals:
- Engagement: {high | normal | low | returning_after_gap}
- Today's capacity: {full_day | fragmented | meetings_only | unknown}
- Recent pattern: {productive_flow | overloaded | disengaged | life_transition}
- Tone: {standard | gentle | minimal}

Adjust your language and recommendations to match the tone signal.
"gentle" = shorter suggestions, no productivity pressure, "when you're ready" framing.
"minimal" = bare facts, no commentary, just the next action.
```

### 8.7 Memory & Learning

The AI gets smarter over time by distilling behavioral signals into persistent memories. Memories are natural language observations (injected into prompts as context) with optional structured data (used programmatically by the ranking algorithm).

**What the AI learns:**

| Category        | Example                                                                                                                 | How It's Used                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Calibration** | "User underestimates coding tasks by ~50%. 30 min estimate usually takes 45."                                           | Adjust estimated_minutes in deck ranking. Daily brief accounts for the bias.                   |
| **Pattern**     | "User does best deep work before noon. Coding after 3pm rarely happens."                                                | Daily brief schedules deep work in AM. Deck deprioritizes high-energy tasks in late afternoon. |
| **Preference**  | "User prefers to batch financial/admin tasks. Suggest grouping on Friday afternoons."                                   | Deck groups similar admin tasks. Daily brief clusters them.                                    |
| **Observation** | "User says Bounce is top priority but 60% of completions are InsiderFinance. Stated allocation doesn't match behavior." | Surface in weekly pulse for reflection. Adjust allocation bias.                                |

**How memories are created:**

1. **Override analysis.** When the user corrects AI triage (reassigns area, flips task/note, changes bucket/energy), log the correction. After 3+ corrections of the same pattern, create a memory: "User prefers tasks about X to go under area Y."
2. **Effort calibration.** Compare estimated_minutes to actual completion time (derived from task created_at/started vs. completed_at). After 10+ data points, generate a calibration factor per context_tag.
3. **Deferral patterns.** When tasks of a certain type are consistently deferred, note the pattern: "Financial tasks are deferred 3x more than average. Consider batching or scheduling at a specific time."
4. **Session analysis.** Compare daily brief to end-of-day reality. Detect chronic overcommitment: "User plans 6 hours of tasks but completes 3.5 hours on average."
5. **Explicit user input.** User tells the AI something: "I prefer to code in the morning" → direct memory entry with `is_user_confirmed = 1`.

**How memories are used:**

Relevant memories are injected into AI prompts as context. The triage prompt gets preference memories. The daily brief gets pattern and calibration memories. The deck rerank gets all of them. Example injection:

```
User patterns (learned over time):
- Best deep work: before noon (confidence: 0.8, based on 25 sessions)
- Effort calibration: coding tasks take ~1.5x estimated time
- Tends to defer financial tasks — batch on Fridays if possible
- Prefers Bounce work on Monday/Tuesday
```

**Memory lifecycle:**

- Memories start at low confidence (0.5) and increase with evidence
- The user can view, edit, or delete any memory (visible in Agent Activity or a dedicated "What I've Learned" section)
- Memories that the user overrides are suppressed (confidence → 0)
- Memories decay if counter-evidence accumulates (user starts coding in the afternoon regularly → morning-coding memory confidence drops)
- Memory updates appear in the Agent Activity log: "Learned: You tend to underestimate design tasks. I'll add 30% buffer to estimates."

### 8.8 Model Strategy

Eon is **model-agnostic**. Users bring their own API keys (direct provider keys or OpenRouter) and choose which models power each job. The table below defines the **capability tier** each job requires — the user maps their preferred models to these tiers in settings.

| Job               | Tier Required       | Rationale                                            | Default Mapping                                  |
| ----------------- | ------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Capture triage    | Fast (cheapest)     | High volume, needs to be instant, structured output  | Haiku, GPT-4o-mini, Flash                        |
| Embedding         | Embedding model     | Runs on every capture + edit, must be cheap and fast | text-embedding-3-small, nomic-embed-text (local) |
| Deck ranking      | Rule-based (no LLM) | Deterministic, fast, runs on every deck request      | N/A                                              |
| Deck rerank       | Standard            | Needs reasoning but bounded scope, structured output | Sonnet, GPT-4o, Pro                              |
| Daily brief       | Capable (best)      | Conversational quality matters, runs once/day        | Opus, o3, Pro                                    |
| Radar suggestions | Standard            | Needs nuance for avoidance/psychology, runs daily    | Sonnet, GPT-4o, Pro                              |
| Weekly pulse      | Capable (best)      | Retrospective quality matters, runs once/week        | Opus, o3, Pro                                    |
| Chat agent        | Standard            | Interactive, needs reasoning + tool use, user is waiting (streaming) | Sonnet, GPT-4o, Pro                 |

**Provider support:** Anthropic (Claude), OpenAI, Google (Gemini), OpenRouter (access to all models), and local models (Ollama, LM Studio) for offline/privacy. The provider abstraction means adding new providers is a single adapter, not a rewrite.

**Cost control:** The user sees estimated cost per operation in settings (based on their chosen models). The system defaults to the cheapest viable tier per job. Power users can upgrade specific jobs to better models. The rule-based deck ranking (no LLM) ensures the core execution loop is always free.

---

## 9. Technical Architecture

### Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** SQLite via better-sqlite3 (local file, no server). FTS5 for full-text keyword search. `sqlite-vec` extension for vector similarity search. The storage backend is abstracted behind repository interfaces — the app never touches SQL directly. This makes it straightforward to experiment with markdown files, Postgres, or a hybrid (SQLite for indexes/queries/embeddings, markdown for human-readable content) without changing application code.
- **Embeddings:** `sqlite-vec` stores embeddings alongside entities in the same SQLite file. Embedding models accessed via the same provider abstraction (OpenAI `text-embedding-3-small`, Voyage, or local via Ollama `nomic-embed-text`). Embeddings power semantic search, duplicate detection, and clustering. Generated on capture triage and updated on significant edits.
- **Agentic framework:** [Mastra](https://mastra.ai) for agent orchestration, tool definitions, and workflow composition. All AI operations — triage, deck generation, daily brief, radar, chat — are defined as Mastra tools, workflows, and agents. This gives us structured tool calling with Zod schemas, multi-step workflow orchestration, and a chat agent with autonomous tool use out of the box.
- **AI:** Model-agnostic provider abstraction (via Mastra's model routing). Users bring their own API keys — direct (Anthropic, OpenAI, Google) or via OpenRouter for access to all models. Local models supported via Ollama/LM Studio for offline use. Keys stored in `.env`.
- **Calendar:** Google Calendar API (OAuth, read-only). Events cached to `calendar_events` table.
- **State management:** React Server Components for data fetching. Client-side state (Zustand or similar) for interactive elements (deck, user state, chat).
- **No auth** — single-user local app for MVP

### Architecture Principles

1. **Data access layer abstracted.** All database operations go through TypeScript repository interfaces (`TaskRepository`, `NoteRepository`, `AreaRepository`, etc.). The app imports interfaces, never concrete implementations. A factory function creates the right implementation based on config. This makes it trivial to swap or mix backends:
   - **SQLite** (default): better-sqlite3 with FTS5 + sqlite-vec. Best for structured queries, embeddings, and performance.
   - **Markdown**: Tasks as `.md` files with YAML frontmatter. Human-readable, version-controllable, Obsidian-compatible.
   - **Hybrid**: SQLite for indexes/queries/embeddings, markdown for content (`body` field). Best of both.
   - **Postgres**: For future cloud/team scenarios.

   The embedding store is separately abstracted (`EmbeddingStore` interface) since vector storage has unique requirements — the SQLite implementation uses `sqlite-vec`, a Postgres implementation would use `pgvector`, a markdown backend might use sqlite-vec as a sidecar index. Mastra tools consume repository interfaces, never storage internals.

2. **AI operations as tools, workflows, and agents (via Mastra).** Every AI operation is defined using Mastra's primitives:
   - **Tools** (atomic): Single operations with Zod-validated input/output schemas. CRUD, search, calendar queries, user state, memory.
   - **Workflows** (composite): Multi-step orchestrations that chain tools with LLM reasoning. Triage, deck generation, daily brief, radar, weekly pulse.
   - **Agents** (autonomous): Mastra agents with tool access and multi-step reasoning. The chat agent can call any tool or workflow, observe results, and decide next steps.

   Prompts are stored as templates, not inline strings. Each workflow has its own prompt template, input schema, and output schema so they can be tuned independently.

3. **Offline-capable.** The app works without an internet connection for capture and basic deck (deterministic scoring). LLM features degrade gracefully — show a "using local scoring" indicator.

4. **Audit everything.** Every AI inference is logged to `ai_inferences`. Every system action is logged to `agent_activity`. This is non-negotiable for trust.

5. **One model config, used everywhere.** The user configures their API keys and model preferences once (in a config file or settings UI). Mastra's model routing uses this config for all AI operations — triage, deck, brief, radar, chat, embeddings. Each AI job maps to a capability tier (fast, standard, capable, embedding). The user assigns their preferred model to each tier. Prompts are provider-agnostic. Supported providers: Anthropic, OpenAI, Google, OpenRouter, Ollama/LM Studio (local).

6. **Graceful degradation.** When an LLM call fails, the embedding API is down, or any AI operation errors — the app continues working. Triage falls back to basic keyword matching for dedup and manual field entry. The deck falls back to cached `sort_key` ordering. The daily brief shows "AI unavailable" with a simple task list. No workflow should crash the app or block the user. Log the failure to `agent_activity`, retry once, then degrade.

7. **Protocol-first design.** Eon's capture and routing interfaces are designed as open protocols, not just internal APIs. The app is the reference implementation. Any agent framework, any UI, any integration can plug into the routing engine via well-defined endpoints: capture (ingest a thought), route (get the next best action), delegate (assign to an agent), and report (return results). This means Eon can become the routing layer for an ecosystem of AI agents and tools — not just a standalone app.

### Agent Architecture

The system has five layers. Each layer depends only on the layer below it.

```
┌─────────────────────────────────────────────────────┐
│  Agents         Chat agent (multi-step reasoning)   │
├─────────────────────────────────────────────────────┤
│  Workflows      Triage, Deck, Brief, Radar, Pulse   │
├─────────────────────────────────────────────────────┤
│  Tools          CRUD, Search, Calendar, State, etc.  │
├─────────────────────────────────────────────────────┤
│  Services       Calendar sync, Notifications, Embed  │
├─────────────────────────────────────────────────────┤
│  Repositories   TaskRepo, NoteRepo, EmbeddingStore   │
└─────────────────────────────────────────────────────┘
```

#### Atomic Tools (Mastra Tools)

Single operations with Zod-validated schemas. These are the building blocks that workflows and agents compose.

**Data — Tasks**
| Tool | Description |
|---|---|
| `getTasks` | Query tasks by status, area, type, parent, energy, tags |
| `getTask` | Single task by ID |
| `createTask` | Create task with all fields |
| `updateTask` | Partial update on any fields |
| `moveTask` | Change bucket (status transition) with sort_key update |
| `logCompletion` | Log row to `task_completions` |
| `getCompletions` | Query completion history for a task |

**Data — Notes, Areas, Goals, People**
| Tool | Description |
|---|---|
| `getNotes` / `getNote` / `createNote` / `updateNote` | Note CRUD, filtered by area/task/tags |
| `getAreas` / `getArea` / `createArea` / `updateArea` | Area CRUD, filtered by status |
| `getGoals` / `getGoal` / `createGoal` / `updateGoal` | Goal CRUD, including KR progress |
| `getPeople` / `getPerson` / `createPerson` / `updatePerson` | People CRUD |

**Search & Similarity**
| Tool | Description |
|---|---|
| `search` | Hybrid FTS5 + vector search across tasks and notes. Merged and ranked by reciprocal rank fusion. |
| `findSimilar` | Vector cosine similarity for a text string against existing embeddings. Used for dedup and "related tasks." |

**Calendar & Time**
| Tool | Description |
|---|---|
| `getCalendarEvents` | Events for a given date |
| `getAvailableGaps` | Available time gaps between events |
| `getAvailableMinutes` | Total available minutes for a date |

**State & Memory**
| Tool | Description |
|---|---|
| `getUserState` | Current scope, energy, available time |
| `updateUserState` | Update focus state |
| `getMemories` | Query AI memories by category |
| `createMemory` / `updateMemory` | Memory CRUD (confidence, content) |

**Activity & Sessions**
| Tool | Description |
|---|---|
| `logActivity` | Write to `agent_activity` |
| `getRecentActivity` | Read recent activity with filters |
| `getCurrentSession` / `createSession` / `updateSession` | Day session management |

#### Workflows (Mastra Workflows)

Multi-step orchestrations that chain atomic tools with LLM reasoning. Workflows can be invoked directly by the app (e.g., morning triage) or by the chat agent as composite tools.

**1. `capture-triage`** — Raw text → structured task or note
1. Generate embedding for raw text
2. `findSimilar` — check for duplicates above similarity threshold
3. If duplicate found → return match for user confirmation, halt
4. LLM classifies: task or note? Extracts all structured fields (see Section 8.1 prompt)
5. `createTask` or `createNote` + store embedding
6. `logActivity` — record triage decision
7. Return result with correction chip data

**2. `deck-generate`** — State + candidates → ranked deck (rule-based, no LLM)
1. `getUserState` — scope, energy, available time
2. `getTasks` where status = `now`, filtered by energy/scope/time
3. `getCalendarEvents` + `getAvailableGaps`
4. Rule-based multi-factor ranking (deadline proximity, energy match, time fit, sort_key, streak urgency, goal alignment)
5. Return top 3 (1 primary + 2 alternates)

**3. `deck-rerank`** — Rule-based deck → LLM-reranked with rationale
1. Get output from `deck-generate`
2. `getMemories` — relevant patterns, preferences
3. `getGoals` — active goals
4. `getRecentActivity` — recent deferrals, completions
5. LLM reranks candidates, provides one-line rationale per card (see Section 8.2 prompt)
6. `logActivity` — record rerank decision

**4. `daily-brief`** — Morning orchestration → plan + promotions + context blocks

**Build both a workflow version and an agent version. Test each and compare.**

**Workflow version** (deterministic, cheaper, predictable):
1. `getCalendarEvents` + `getAvailableGaps`
2. `getTasks` across now/next/waiting statuses
3. Run `recurring-check` workflow (nested) for recurring tasks due today
4. `getGoals` — active goals with KR progress
5. `getMemories` — energy patterns, preferences, calibrations
6. `getCurrentSession` (yesterday) — planned vs. completed
7. LLM generates: brief, now_tasks, context blocks, overcommitment flag (see Section 8.3 prompt)
8. For promoted tasks: `moveTask` to `now` + set sort_key
9. `createSession` for today
10. `logActivity`

**Agent version** (autonomous reasoning, adapts to edge cases):
A focused Mastra agent with the same tools as the workflow, but it reasons through the plan in multiple steps rather than following a fixed sequence. It has a system prompt scoped to daily planning (see Section 8.3) and access to: `getCalendarEvents`, `getAvailableGaps`, `getTasks`, `getGoals`, `getMemories`, `getCurrentSession`, `moveTask`, `createSession`, `logActivity`, and the `recurring-check` workflow as a composite tool.

The agent decides *what to look at* based on what it sees. Examples of where this produces better results:
- Sees a packed calendar → skips deep work planning entirely, focuses only on quick wins for gaps
- Notices a task deferred 4 days in a row → checks memories for avoidance pattern before promoting
- Sees user returning after 3-day gap → autonomously scopes down to 1-2 items, "welcome back" framing
- Finds conflicting priorities across goals → reasons about tradeoffs and presents the choice

**How to compare:** Give both versions the same inputs (same tasks, calendar, memories, history). Compare: plan quality, adaptiveness to edge cases, LLM cost, latency, predictability. The workflow is the baseline. The agent should beat it on edge cases or the extra cost isn't worth it.

**5. `radar-scan`** — Detect stale projects, deferrals, approaching deadlines, etc.
1. `getTasks` — all non-done/archived
2. Rule-based queries (see Section 8.4): stale projects, 3+ deferrals, approaching deadlines, missing next actions, waiting follow-ups, backlog boomerangs
3. For waiting tasks: LLM reads `waiting_on` text, cross-references recent completions/captures to check if blocks are resolved
4. For avoidance candidates (3+ deferrals): LLM generates gentle suggestions
5. `logActivity` — record all radar items

**6. `weekly-pulse`** — Retrospective + forward look
1. `getCompletions` + completed tasks for the week
2. `getRecentActivity` — week's patterns
3. `getGoals` — progress on KRs
4. `getMemories` — existing patterns
5. LLM generates: retrospective, wins, patterns, forward priorities
6. `createMemory` or `updateMemory` if new patterns detected
7. `logActivity`

**7. `recurring-check`** — Check recurrence tasks, promote due ones, update streaks
1. `getTasks` where recurrence IS NOT NULL
2. For each: `getCompletions` in current period
3. LLM reads recurrence text + completions, determines which tasks are due
4. If due and completions < target_frequency → `moveTask` to `now`
5. If completions >= target_frequency → keep in `next`
6. Recompute streaks from completion log → `updateTask` cached values

**8. `memory-update`** — Analyze corrections/patterns, create/update memories
1. `getRecentActivity` — corrections, overrides, deferrals
2. `getMemories` — existing memories
3. LLM analyzes: new patterns? confidence adjustments? decayed memories?
4. `createMemory` or `updateMemory` as needed
5. `logActivity`

**9. `task-complete`** — Handle task completion (triggered by "Done" action or chat agent)
1. `getTask(id)` — determine if one-time or recurring (`recurrence` field)
2. **If one-time:**
   a. `updateTask(id, { status: 'done', completed_at: now })`
   b. If task has `parent_id` → `updateTask(parentId, { last_progress_at: now })`
   c. If parent's active children count is now 0 → surface parent in next radar pass (missing next action)
3. **If recurring:**
   a. `logCompletion(taskId, note?)` — immutable event
   b. `getCompletions(taskId)` for current period
   c. If completions >= `target_frequency` → `moveTask` to `next` (done for this period)
   d. If completions < `target_frequency` → task stays in `now` (still due)
   e. Recompute `streak_current` and `streak_best` from completion log → `updateTask` cached values
4. If `now` bucket is thin (< 2 tasks remaining) → run `deck-generate` to refill from `next`
5. `logActivity` — record completion

#### Services (Background Processes)

Deterministic processes that run on schedules or triggers. Not AI agents — they don't make decisions. For local deployment, these likely run on a separate Node process with cron scheduling. Implementation details will be refined as we build.

| Service | Trigger | What it does |
|---|---|---|
| **CalendarSyncService** | Periodic (configurable) | Pulls events from Google Calendar API, caches to `calendar_events`, recomputes available gaps |
| **NotificationService** | Periodic | Queries `reminder_at <= now`, fires browser Notification API, nulls `reminder_at` after firing (one-shot). Also checks `hard_deadline` within warning threshold. |
| **EmbeddingService** | On capture + significant edits | Generates embeddings via configured provider, stores in `vec_embeddings`. Called by the triage workflow, not independently scheduled. |

#### The Chat Agent

The chat is a **full Mastra agent with multi-step reasoning**, not a 1-shot tool caller. It can observe tool results, reason about what to do next, and chain actions autonomously.

**System prompt includes:**
- User state (scope, energy, available time, engagement level)
- Today's plan summary (from current session)
- Relevant AI memories (top N by confidence)
- Recent activity summary

**Tool access:** All atomic tools + all workflows exposed as composite tools. From the agent's perspective, `triageCapture(rawText)` is a single tool call that runs the full triage pipeline under the hood.

**Multi-step reasoning examples:**
- "What do I need to prep for my meeting with Jake?" → `getCalendarEvents` (find Jake meeting) → `search` ("Jake" + related project) → `getTasks` (waiting_on mentions Jake) → synthesize prep list
- "Move all Bounce tasks to next week" → `search` ("Bounce") → show preview of matched tasks → on confirmation, batch `updateTask` with new `resurface_after`
- "I'm feeling low energy today" → `updateUserState` (energy = light) → run `deck-generate` filtered to light → present updated deck
- "Add a task: call the dentist tomorrow" → invoke `capture-triage` workflow → return result

**Guardrails:**
- Destructive actions (delete, archive, bulk move) require user confirmation before executing
- Bulk operations show a preview: "Found 12 Bounce tasks. Move all to next week?"
- All agent actions are logged to `agent_activity` — the user can see exactly what the chat did and undo any action
- The agent explains its reasoning: "I searched for tasks mentioning Jake and found 3 waiting items and 2 related notes."

**Model tier:** Standard (needs reasoning but user is waiting — must be fast with streaming). See Section 8.8.

### File Structure

```
/app                              -- Next.js routes
  /page.tsx                       -- Today view (deck + plan + chat)
  /projects/page.tsx              -- Projects view (filtered lens on tasks with children)
  /notes/page.tsx                 -- Notes view (browse/search all notes)
  /routines/page.tsx              -- Routines view (filtered lens on recurring tasks)
  /everything/page.tsx            -- Everything view (safety valve)
  /calendar/page.tsx              -- Calendar view
  /activity/page.tsx              -- Agent activity log
  /settings/page.tsx              -- Settings (API keys, model tier mapping, preferences)
  /api/                           -- API routes
    /capture/route.ts             -- Capture endpoint (invokes capture-triage workflow)
    /deck/route.ts                -- Deck generation (invokes deck-generate workflow)
    /plan/route.ts                -- Daily brief (invokes daily-brief workflow)
    /radar/route.ts               -- Radar generation (invokes radar-scan workflow)
    /chat/route.ts                -- Chat agent endpoint (streaming)
    /tasks/route.ts               -- Task CRUD
    /notes/route.ts               -- Note CRUD
    /routines/route.ts            -- Recurring task queries (filtered view)

/lib
  /db/
    index.ts                      -- Database connection + migrations + FTS5 + sqlite-vec
    schema.ts                     -- Schema definitions
    interfaces/                   -- Repository interfaces (backend-agnostic)
      types.ts                    -- Shared types (CreateTaskInput, UpdateTaskInput, etc.)
      task-repository.ts          -- TaskRepository interface
      note-repository.ts          -- NoteRepository interface
      area-repository.ts          -- AreaRepository interface
      goal-repository.ts          -- GoalRepository interface
      session-repository.ts       -- SessionRepository interface
      activity-repository.ts      -- ActivityRepository interface
      embedding-store.ts          -- EmbeddingStore interface
    sqlite/                       -- SQLite implementation of all interfaces
      tasks.ts
      notes.ts
      areas.ts
      goals.ts
      sessions.ts
      activity.ts
      embeddings.ts
    factory.ts                    -- createRepositories(config) → concrete implementations
    // Future: /markdown, /postgres — alternative backend implementations

  /mastra/
    index.ts                      -- Mastra instance configuration + model routing
    tools/                        -- Atomic tools (Mastra tool definitions with Zod schemas)
      tasks.ts                    -- getTasks, getTask, createTask, updateTask, moveTask, etc.
      notes.ts                    -- Note CRUD tools
      areas.ts                    -- Area CRUD tools
      goals.ts                    -- Goal CRUD tools
      search.ts                   -- search (hybrid FTS5 + vector), findSimilar
      calendar.ts                 -- getCalendarEvents, getAvailableGaps, getAvailableMinutes
      user-state.ts               -- getUserState, updateUserState
      memory.ts                   -- getMemories, createMemory, updateMemory
      activity.ts                 -- logActivity, getRecentActivity
      sessions.ts                 -- getCurrentSession, createSession, updateSession
      completions.ts              -- logCompletion, getCompletions
    workflows/                    -- Multi-step workflows (Mastra workflow definitions)
      capture-triage.ts           -- Raw text → task/note (embed → dedup → classify → create)
      task-complete.ts            -- Handle completion (one-time vs recurring, parent update, deck refill)
      deck-generate.ts            -- State → ranked deck (rule-based, no LLM)
      deck-rerank.ts              -- Rule-based deck → LLM-reranked with rationale
      daily-brief.ts              -- Morning orchestration → plan + promotions + context blocks
      radar-scan.ts               -- Detect stale projects, deferrals, deadlines, etc.
      weekly-pulse.ts             -- Retrospective + forward look
      recurring-check.ts          -- Check recurrence, promote due tasks, update streaks
      memory-update.ts            -- Pattern detection → memory CRUD
    agents/
      chat.ts                     -- Chat agent definition (system prompt, all tools, guardrails)
    prompts/                      -- Prompt templates (used by workflows, provider-agnostic)
      triage.ts
      deck-rerank.ts
      daily-brief.ts
      radar.ts
      weekly-pulse.ts

  /services/
    calendar-sync.ts              -- Google Calendar periodic sync + caching
    notifications.ts              -- Browser Notification API + reminder_at checking
    embeddings.ts                 -- Embedding generation + storage (called by triage workflow)

  /calendar/
    oauth.ts                      -- Google Calendar OAuth flow
    gaps.ts                       -- Available time gap computation

  /types/
    index.ts                      -- Shared TypeScript types

/components
  /capture/                   -- Capture input, toasts, correction chips
  /deck/                      -- Now deck cards, actions
  /plan/                      -- Daily brief, context blocks timeline
  /radar/                     -- Radar feed entries
  /projects/                  -- Project list, detail, next actions
  /routines/                  -- Recurring task list, streaks, consistency
  /calendar/                  -- Calendar view, gap highlights
  /activity/                  -- Agent activity log
  /chat/                      -- Chat interface
  /settings/                  -- API key config, model tier mapping, preferences
  /shared/                    -- Layout, sidebar, pills, badges
```

---

## 10. Distribution & Pricing Model

### Open Source, Local-First

Eon is **open source and local-first**. All data lives on the user's machine. All features are available to everyone. There is no freemium gate, no feature lock, no account required. This is a deliberate strategic choice:

1. **Trust demands it.** Eon holds your goals, habits, AI-learned behavioral patterns, and entire life context. This is the most personal data imaginable. Local-first removes the "who has my data?" objection entirely.
2. **The audience expects it.** Early adopters are productivity-obsessed builders who use AI daily. They choose open source by default and bring tools into their companies later.
3. **The ecosystem is the moat.** An open routing engine for human attention invites integrations, custom AI prompts, alternative UIs, and community-built extensions. The protocol wins, not the walled garden.

### The User Pays for Inference

Eon does not absorb AI costs. The user brings their own API keys — direct from providers (Anthropic, OpenAI, Google) or via OpenRouter for access to all models. This is the same model as OpenClaw and other local-first AI tools: the software is free, the intelligence is yours to provision.

**Why this works:**

- **Honest economics.** AI inference is expensive. Hiding it in a subscription creates misaligned incentives (the company wants you to use less AI). BYO keys means you get exactly the AI you pay for.
- **Model freedom.** Users choose their own models. Privacy-conscious users run local models (Ollama). Cost-conscious users choose cheaper models. Quality-maximizers use the best available. Eon's provider abstraction makes switching trivial.
- **No billing infrastructure.** The MVP has zero payment processing, zero subscription management, zero pricing debates. Ship the product, prove the value.

**Cost control features:**

- Each AI job maps to a capability tier (fast, standard, capable). Users assign models to tiers.
- The app shows estimated cost per operation based on the user's configured models.
- The core execution loop (deck ranking) is rule-based and free — no LLM required.
- Local models (Ollama, LM Studio) provide a zero-cost fallback for all jobs.
- Triage defaults to the cheapest model. Expensive models are only used for once-a-day and once-a-week jobs (daily brief, weekly pulse).

### Future Revenue Opportunities

The open-source local-first model is the growth engine. Revenue comes later from services, not from gating features:

- **Cloud sync & backup** (Obsidian model): Paid tier for syncing across devices, cloud backup, mobile access. The data is still yours — the service is convenience.
- **Managed AI hosting**: A hosted version where users don't need to manage API keys. "It just works" is worth paying for.
- **Enterprise**: Team routing, shared areas/goals, SSO, compliance, admin controls. Individuals bring Eon into their companies. This is a 2-3 year horizon.
- **Marketplace / ecosystem**: Community-built integrations, prompt packs, workflow templates.

The priority is proving the routing engine, building community, and earning trust. Monetization follows adoption.

---

## 11. Build Phases

### Phase 1: Foundation + Capture + Triage

**Goal:** You can dump things in and they get auto-organized. This alone is valuable.

**Build order:** Schema → repository interfaces + SQLite implementation → Mastra setup + atomic tools → `capture-triage` workflow → chat agent (with Phase 1 tools only) → API routes → UI

**Infrastructure:**
- SQLite schema setup with migrations (areas, tasks, notes, people, support tables). FTS5 indexes on tasks and notes for keyword search. `sqlite-vec` extension loaded for vector search.
- Repository interfaces + SQLite implementation (data access abstraction from day one)
- Mastra instance configuration + model routing from user config
- Settings UI (API key config, model-to-tier mapping, embedding model selection)

**Mastra tools introduced:** `createTask`, `updateTask`, `getTasks`, `getTask`, `createNote`, `updateNote`, `getNotes`, `getNote`, `createArea`, `updateArea`, `getAreas`, `search`, `findSimilar`, `logActivity`, `getRecentActivity`

**Mastra workflows introduced:** `capture-triage`

**Mastra agents introduced:** Chat agent — with access to only the tools and workflows that exist in this phase. Additional tools are added as phases land.

**Features:**
- Capture input UI (global text box, Cmd+K shortcut)
- `capture-triage` workflow: raw text → embedding → duplicate check → LLM classify → create task or note → log activity
- Semantic search: search bar queries both FTS5 (keyword) and `vec_embeddings` (semantic), merged and ranked by relevance
- Chat agent for natural language interaction (capture via chat, search, basic task management)
- Basic task list grouped by area, with orphan section
- Basic notes list grouped by area, with orphan section
- One-tap correction chips on capture confirmation (including flip task/note)
- Area CRUD (manual for now, with status: active/paused/someday)
- Agent activity log (write-only for now)

**Success:** Capture feels instant and magical. Tasks/notes land in the right place (or are comfortably orphaned) 80%+ of the time. Duplicates are caught before they create noise.

### Phase 2: The Now Deck + Notifications

**Goal:** You open the app and immediately know what to do. Time-sensitive tasks alert you.

**New tools:** `moveTask`, `getUserState`, `updateUserState`

**New workflows:** `deck-generate`, `task-complete`

**New services:** NotificationService

**Features:**
- `deck-generate` workflow: rule-based multi-factor ranking, deterministic top 3
- Scope pill + energy toggle (Deep | Light)
- Deck card actions: Done, Snooze, Not Today, Waiting On
- Boomerang resurfacing logic (tasks reappear after resurface_after)
- Parent task as "project" display (tasks with children show project-like UI)
- User state management (singleton row)
- NotificationService: browser Notification API triggered by `reminder_at`. AI auto-sets reminders from time-specific capture language ("at 3pm", "before the meeting").
- File attachments: attach photos, files, screenshots to tasks. Stored in `~/.eon/attachments/`. Rendered inline in task body.

**Success:** The deck serves useful recommendations without LLM. Time-to-start-work < 10 seconds. "Pick up kids at 3pm" actually alerts you at 3pm.

### Phase 3: AI-Powered Deck + Daily Brief

**Goal:** The AI becomes your chief of staff, not just a scorer.

**New tools:** `createGoal`, `updateGoal`, `getGoals`, `getGoal`, `getCurrentSession`, `createSession`, `updateSession`, `createMemory`, `updateMemory`, `getMemories`

**New workflows:** `deck-rerank`, `daily-brief`, `memory-update`

**Features:**
- Goals CRUD and review flow
- `deck-rerank` workflow: LLM rerank (1 primary + 2 alternates + rationale, goal-aware)
- `daily-brief` workflow: natural language brief + context blocks, goal-aware
- Today view with plan + timeline + deck + chat
- Session recording (what was planned vs. completed)
- Adaptive capacity & tone: user state signals injected into all LLM prompts (engagement, capacity, patterns)
- Dynamic `now` sizing (1-2 items when overwhelmed, 5-7 when in flow)
- `memory-update` workflow: override analysis begins logging correction patterns, effort calibration

**Success:** Daily briefing takes 2-3 minutes. The AI's rationale builds trust. The AI reads the room and adapts. The AI starts learning.

### Phase 4: Calendar Integration (Essential)

**Goal:** Recommendations fit your real day. Without calendar awareness, every suggestion is a guess.

**New tools:** `getCalendarEvents`, `getAvailableGaps`, `getAvailableMinutes`

**New services:** CalendarSyncService

**Features:**
- CalendarSyncService: Google Calendar OAuth + event sync (read-only, cached locally)
- Calendar tools: gap computation (available minutes between events)
- Deck filtered by gap size
- Context blocks overlaid on calendar view
- Meeting prep/follow-up suggestions (basic)
- Overcommitment detection ("you have 45 min of real work time today")

**Success:** The deck never suggests a 2-hour task when you have 15 minutes before a meeting.

### Phase 5: Radar + Intelligence Layer

**Goal:** The system catches what you miss.

**New workflows:** `radar-scan`

**Features:**
- `radar-scan` workflow: stale parent tasks, repeated deferrals, approaching deadlines, missing next actions, completion debt, waiting follow-ups
- Radar UI with action buttons (Revive, Snooze, Someday, Archive)
- Avoidance detection and gentle response
- Heartbeat logic for tasks with children (project pulse)
- Backlog pulse surfacing for long-unseen tasks
- Gentle decay for old low-intent captures
- `memory-update` workflow expanded: full pattern detection (deferral patterns, session analysis, time-of-day preferences)
- "What I've Learned" view where user can see, edit, and delete learned observations
- Memory injection into all AI prompts (triage, deck, daily brief, radar)

**Success:** The weekly review is replaced by a continuous radar drip. Nothing important gets lost. The AI visibly gets smarter over time.

### Phase 6: Recurring Tasks + Weekly Pulse

**Goal:** Full daily and weekly rhythm managed by AI.

**New tools:** `logCompletion`, `getCompletions`

**New workflows:** `recurring-check`, `weekly-pulse`

**Features:**
- Recurring task support (tasks with recurrence: habit, maintenance, ritual types)
- `recurring-check` workflow: period-based completion tracking via `task_completions`, streak updates
- Minimum viable completion ("10 min counts")
- Recurring tasks integrated into `daily-brief` workflow and context blocks
- Routines view (filtered lens on tasks with recurrence)
- Gentle consistency visualization (no guilt)
- `weekly-pulse` workflow: retrospective + forward look
- AI pattern recognition ("you've skipped workouts all week — overloaded?")

**Success:** Habits are protected, not punished. The weekly pulse replaces the weekly review.

### Phase 7: Polish + Trust

**Goal:** The system earns long-term trust.

- Agent Activity view (full, browsable, with override actions)
- Undo for all actions (backed by activity log)
- Everything view (searchable, filterable safety valve)
- Completed task history: browsable view filtered by `status = 'done'`, sorted by `completed_at`, groupable by day/week/area/project. Proof of progress.
- Keyboard shortcuts throughout (Cmd+K capture, arrow keys, enter to complete)
- Dark mode
- Empty state handling (first-time experience, project suggestions)
- Error handling for AI failures (graceful degradation, retry logic)
- Performance optimization (deck < 1s, capture < 500ms excluding AI)

**Success:** Users trust the system enough to stop keeping things in their head.

### Phase 8: Templates + Pipeline Views

**Goal:** Support repeatable processes and high-volume workflows.

- Task templates: define a parent task with predefined child tasks, instantiate with one action
- Template-on-cadence: recurring content creation (weekly blog post, monthly report) that generates a new task from template each period
- Pipeline view for projects: group parent tasks by stage (custom status or tag on parent) in a kanban-style layout
- Batch mode for the deck: when doing repetitive process work, show a filtered queue of similar tasks instead of 1+2 cards

**Success:** Users with repeatable processes (accountants, marketers, client-facing roles) can use Eon as their primary system.

### Phase 9: Teams + Collaboration

**Goal:** Eon expands from individual routing to team coordination.

- Federated model: each person has their own Eon, shared areas enable coordination
- Task delegation: assign to a person, creates linked task in their Eon, tracks acknowledgment
- Shared goals with distributed KRs across team members
- Team visibility: see teammate progress on shared area tasks (filtered to what's relevant)
- Agent-as-team-member: AI agents receive delegated tasks, output goes to review queue
- Managed AI hosting: "it just works" tier for non-technical users (no API key setup)
- Mobile app for capture and deck on the go

**Success:** Small teams (2-10 people) can coordinate through Eon. Non-technical users can onboard without API key configuration.

---

## 12. Success Metrics

### Behavioral Signals

| Metric                               | Target                                          | Why It Matters                            |
| ------------------------------------ | ----------------------------------------------- | ----------------------------------------- |
| Time to capture                      | < 5 seconds median                              | Capture friction → system abandonment     |
| Time to start work                   | < 10 seconds after opening                      | The blank page problem is solved          |
| Deck hit rate                        | > 60% of sessions, user acts directly from deck | AI recommendations are useful             |
| Fake deadline ratio                  | Approaches 0%                                   | Snooze loop is eliminated                 |
| Weekly active usage without "review" | Sustained                                       | Zero-maintenance promise holds            |
| Tasks captured per week              | Steady or growing                               | User trusts the system as universal inbox |
| Overdue count                        | Near zero (only real deadlines)                 | "Overdue" means something                 |

### Trust Signals

| Signal                                      | What It Means                |
| ------------------------------------------- | ---------------------------- |
| User override rate decreasing over time     | AI is learning and improving |
| Agent activity viewed but rarely overridden | AI decisions are trusted     |
| "Show everything" view accessed < 1x/week   | User trusts the filter       |
| Capture correction rate decreasing          | Triage accuracy improving    |

---

## 13. Non-Goals (MVP)

These are explicitly out of scope to maintain focus:

- **Multi-user / team collaboration.** This is a single-player tool. "Waiting on" is free text, not a shared assignment system. (Note: shared household lists are a simpler problem than full team collaboration and may be addressed before Phase 9.)
- **Email / Slack / doc ingestion.** Capture is manual (text/voice) only. Integrations come later.
- **Cloud sync / multi-device.** Data lives on one machine. Mobile access comes later. (Note: this is the #1 barrier to becoming the universal inbox. Should be addressed as early as feasible.)
- **Auto-scheduling / calendar writes.** The internal calendar is a recommendation, not a committed schedule. We read external calendars, we don't write to them.
- **Natural language processing for commands.** Chat is AI-powered but the MVP doesn't need to parse "delete all my home tasks." Simple actions have buttons.
- **Time tracking.** We estimate effort but don't track actual time spent. This may come later.
- **Integrations ecosystem.** No Slack, GitHub, Figma, etc. connections in MVP. Protocol-first design enables these later.

---

## 14. Risks and Mitigations

| Risk                                  | Impact                                        | Mitigation                                                                                                                                                                                                                             |
| ------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI triage accuracy < 70%**          | Users stop trusting capture, revert to manual | One-tap correction chips. Log all corrections to improve prompts. Start with conservative defaults (ask when unsure about deadline vs. reminder).                                                                                      |
| **LLM latency makes deck feel slow**  | Breaks the "10 second" promise                | Show deterministic deck instantly, refine with LLM async. Cache recent deck.                                                                                                                                                           |
| **Overcapture anxiety**               | System feels like a guilt ledger              | Gentle decay for old tasks. Clear "someday/ideas" separation. Batch dismiss in Radar. No backlog counter.                                                                                                                              |
| **AI hallucinated JSON**              | Broken pipeline                               | Strict JSON schema validation. Retry with "fix JSON" prompt. Store raw outputs for debugging.                                                                                                                                          |
| **Calendar OAuth complexity**         | Blocks Phase 4                                | Calendar is optional. App works fully without it. Manual event entry as fallback.                                                                                                                                                      |
| **Cold start (no data)**              | First experience feels empty                  | Guided onboarding: "Tell me about your projects." Seed with common areas. Make first capture feel magical.                                                                                                                             |
| **User doesn't trust "black box" AI** | Ignores recommendations, uses as dumb list    | Agent Activity view. Rationale on every card. "Why this?" expandable on deck cards. Override everything.                                                                                                                               |
| **AI inference costs add up**         | Users surprised by API bills                  | Users bring their own keys and choose models per tier. Show estimated cost per operation in settings. Default to cheapest viable model. Rule-based deck ranking keeps the core loop free. Local models (Ollama) as zero-cost fallback. |

---

## 15. Open Questions

These are safe to defer but worth tracking:

1. **How explicit should area setup be?** Should the user define areas upfront, or should the AI infer them from captured tasks? (Recommendation: light onboarding to seed 3-5 active areas. Total areas can be unlimited — most start as someday/paused. AI suggests promoting or creating areas over time.)

2. **How aggressive should decay/archiving be?** When should old low-intent tasks auto-archive? (Recommendation: 90 days untouched in someday -> archive. AI asks first.)

3. **Voice-first or text-first?** Should voice capture be a primary path? (Recommendation: text-first for MVP. Voice is a nice-to-have using browser speech-to-text.)

4. **Chat as primary interface or supplementary?** How central is the chat vs. the structured UI? (Recommendation: structured UI (deck, radar) is primary. Chat is supplementary for capture and adjustments. The chat doesn't replace the visual plan.)

5. **How to represent "active threads"?** When the user is working on 3 things in parallel, how does the UI show this? (Recommendation: the deck is always the "what to do next" answer. Active threads are implicit via recent tasks. No explicit thread entity for MVP.)

6. **Task templates for repeatable processes?** When should we add template support (tax returns, client onboarding, campaign launches)? (Recommendation: post-MVP. The current capture + AI triage handles individual tasks. Templates become valuable when users have repeatable multi-step processes. Add alongside pipeline/kanban views.)

7. **Data portability promise?** Should we commit to a specific export format? (Recommendation: SQLite IS the export format. It's a file. Add JSON export later.)

8. **Should recurrence evolve toward RRULE?** Calendar systems (iCal/RFC 5545) use structured recurrence rules with exception dates. Our natural language `recurrence` field is more expressive ("4x/week, mornings preferred") and the AI + completion log handles rigid schedules fine. RRULE would only matter for calendar interop (Phase 4+). If needed, we can generate RRULEs _from_ the natural language at export time. No reason to store in that format.

9. **Should reminders become a separate table?** The current `reminder_at` column is a one-shot trigger (AI-set, nulled after firing, not used for recurring tasks). A `reminders` table would enable multiple reminders per task, offset-based reminders ("30 min before deadline"), and recurring reminder patterns. This is a clean additive migration if users need it — doesn't require touching the tasks table. Defer until post-MVP usage signals demand.

---

## 16. Future Enhancements (Post-MVP)

These are valuable features identified through competitive analysis but intentionally deferred from MVP. They are tracked here for roadmap planning.

**Views & Navigation**

- **Saved / smart filters.** User-defined filtered views ("all deep-work tasks in Bounce," "everything waiting on Jake"). Enables power-user workflows without cluttering the default experience.
- **Kanban / board view.** Column-based view of tasks by bucket (`now`, `next`, `backlog`, etc.) or by area. Useful for users coming from Trello/Linear who think spatially.
- **Project sections / headings.** Grouping tasks within an area into logical sections (e.g., "Launch Prep," "Post-Launch") without creating sub-areas.

**Planning & Focus**

- **Drag-to-schedule (time blocking).** Drag tasks onto the internal calendar to assign them to specific time slots. AI pre-populates suggestions; human adjusts.
- **Pomodoro / focus timer.** Built-in timer that pairs with the current deck card. Tracks focus sessions per task. Optional — some users swear by it, others ignore it.
- **2-minute rule prompt.** During triage, if AI estimates a task at < 2 minutes, prompt: "This is quick — do it now?" Reduces backlog accumulation for trivial items.

**Analytics & History**

- **Habit heatmap.** GitHub-style contribution grid for recurring tasks. Visual streak tracking and consistency patterns over time.
- **Productivity analytics dashboard.** Weekly/monthly views: tasks completed, time in deep work, areas of focus, completion velocity, energy patterns.
- **Completion counts in weekly pulse.** "You completed 23 tasks this week, 8 were deep work" — adds a sense of progress to the existing radar pulse.

**Data & Editing**

- **Note-to-note linking.** Wiki-style `[[note title]]` links between notes. Builds a knowledge graph over time. Useful for decision trails and project context.
- **Bulk edit operations.** Multi-select tasks to move, re-bucket, re-assign area, or archive in batch. Essential once task count exceeds ~100.
- **Import agent.** An agent that can iterate through any external source (Todoist export, Asana CSV, Apple Reminders, Things 3 JSON, plain text lists) and convert items into Eon's schema. Not a one-time migration — the agent should handle incremental imports and deduplication against existing tasks.

**Interaction**

- **Visual planning canvas.** A drag-and-drop daily/weekly planning surface where the AI pre-populates a suggested schedule based on priorities, energy, and calendar gaps. The user drags to rearrange, confirms the plan, and the deck follows it. Think of it as the bridge between "AI recommends" and "I commit to a sequence." Schema supports this via `sessions.ai_plan` (JSON block plan) and task `sort_key` for ordering.
- **Natural language commands.** "Move all my Bounce tasks to next week" or "Archive everything in someday older than 6 months." Power-user shortcut layer on top of the chat interface.

---

## 17. The Vision Beyond MVP

The MVP proves the core loop: capture → AI triage → deck → execute. But the architecture is designed to evolve through three stages as AI capabilities expand. Each stage builds on the previous one without requiring structural rewrites — the same entities, the same routing engine, the same trust model. This will eventually expand to a team paradigm where it could ingest or replace other team task software. It should also flow through to teams with AI agents as "employees" as well.

### Stage 1: AI Advises, Human Executes (MVP)

This is what we're building first. The AI triages captures, generates the deck, creates daily briefs, runs the radar, and learns your patterns. But the human does the work. Every task is something YOU do.

The key constraint: the human is both the decision-maker and the executor. The AI reduces the decision load (from "what should I work on?" to "is this the right recommendation?"), but execution is still 100% human.

### Stage 2: AI Executes, Human Oversees

As AI agents become capable of taking action — drafting emails, writing code, scheduling meetings, conducting research — Eon's routing engine evolves from "what should you do?" to "what should be done, and by whom?"

**What changes:**

- **Task delegation.** Tasks gain an `agent_delegated` status and an assignee concept. "Email the accountant about quarterly taxes" → the AI drafts and sends it. "Research competitor pricing" → the AI does the research and presents a summary. Delegated tasks are pulled from the deck and moved into a "Running Jobs" panel — the user checks in when they want, not when interrupted. When the agent finishes, the task either auto-completes or surfaces for human review. The deck shifts to showing things that need your _judgment_, not your _labor_.
- **Ambient capture.** Capture becomes passive. AI watches meeting transcripts, email threads, Slack channels, and auto-captures action items. The human's role shifts from "dump things in" to "confirm or dismiss what the AI found." Tasks gain a `source` field tracking origin (manual, meeting, email, slack).
- **Deeper memory.** With more data (email tone, meeting context, communication patterns), the AI builds a richer user model. It knows not just what you do, but how you communicate, what stresses you, and what energizes you.
- **Proactive nudges.** Push notifications when the AI detects something important: "You have a meeting with Jake in an hour and 3 waiting-on tasks for him." "Registration for the conference closes tomorrow — you've been sitting on this for 2 weeks."
- **Multi-device.** Cloud sync, mobile app, watch app for capture. The system meets you where you are.

**What stays the same:** Areas, tasks, notes, the deck, the radar, the three moments. The entity model doesn't change. The routing engine just has a new output: "delegate to agent" alongside "present to human."

### Stage 3: AI Orchestrates, Human Decides

Eon becomes the operating system for your work. Multiple AI agents operate under Eon's coordination — a coding agent, a communication agent, a research agent, a scheduling agent. The human's role is purely strategic: set priorities, make judgment calls, approve high-stakes actions.

**What changes:**

- **Multi-agent orchestration.** Eon routes tasks to the right agent, monitors progress, handles handoffs, and escalates to the human only when needed. The deck becomes a decision queue, not a task queue.
- **Auto-scheduling.** The AI writes to external calendars when the user confirms a plan. Context blocks become real calendar events. "Block Tuesday morning for deep work on Bounce" → it happens.
- **Federated team layer.** Each person keeps their own Eon. Shared areas enable coordination. Delegation creates linked tasks across instances. An agent is just another team member in the routing model — the engine decides "this needs human judgment" vs. "this can be delegated to an agent" and routes accordingly. Team goals with distributed KRs. Visibility into teammate progress on shared work without overwhelming individual routing.
- **Natural language everything.** "Cancel all my meetings tomorrow and block the day for the launch" → AI executes across systems.
- **Predictive planning.** The AI doesn't just react to what you've captured — it anticipates what's coming. "Based on your Bounce launch timeline, you'll need to start the marketing site by next week to stay on track."

**What stays the same:** The fundamental model. Areas are still life domains. Tasks are still actionable work. Notes are still context. The routing engine still answers the same question — "what deserves attention right now?" — it just has more options for who or what handles the answer.

### Why This Architecture Survives

The MVP schema supports all three stages because:

1. **The entity model is minimal.** Areas, tasks, notes, people. Adding `assignee`, `source`, or `delegated_status` fields is a migration, not a rewrite.
2. **The AI functions are modular.** Each job (triage, deck, plan, radar, memory) is a separate function. Adding "delegate to agent" is a new function, not a refactor.
3. **The audit trail is built in.** Agent activity and AI inferences log everything. When AI agents start executing, the same trust infrastructure applies — the user can see what was done, why, and override it.
4. **The routing engine is the product.** Whether it routes to a human, an AI agent, or a team — it's still a routing engine for attention. The core value proposition doesn't change; it just gets more powerful.

The endgame: Eon knows your work, your calendar, your energy patterns, your goals, and your relationships — and it orchestrates your entire workflow so you spend 95% of your time on judgment, creativity, and the things only humans can do. It's the chief of staff that every ambitious person needs but almost no one can afford — until now.
