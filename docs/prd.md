# Eon — Product Requirements Document

> **Note:** The deck experience (sections 5.3, 6.1, 6.4) has been redesigned. See [`deck-v2-spec.md`](./deck-v2-spec.md) for the authoritative spec. Key changes: unified priority stack (no deep/light split), no energy toggle, no context blocks in MVP, no review/confirm ceremony, progressive disclosure escape hatches, chat-driven deck modifications. The strategic vision and core problems in this PRD remain current.

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

**Design constraint:** "Blocked on" must be a first-class property — tasks with blocks are auto-suppressed from the deck, with follow-up timing, and automatic resurfacing when relevant (e.g., before a meeting with the person you're blocked on, or when a prerequisite task completes).

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

**Design constraint:** All three need logic appropriate to their nature, but they should not require a separate entity, a `task_type` enum, or a classification decision at capture time. A task with `recurrence IS NOT NULL` is recurring — the AI reasons about behavioral differences (consequences, calendar anchoring, flexibility) from `user_context` and `recurrence` text, not from a type label. None of them should flood the daily task queue or generate guilt when missed.

### 3.13 The Capture Paradox

Two opposing forces kill task systems at the input layer:

- **Too much friction:** If adding an item requires choosing a project, setting priority, adding tags, and picking a date, people revert to keeping things in their head.
- **Too little friction:** If capture is truly effortless, inventory explodes without intelligent separation, and the system becomes a monument to everything you haven't done.

And there's a third force: **not everything needs to become an entity.** When you jot down "check SEO results" and do it 3 minutes later, creating a task with an area, energy level, and effort classification was wasted work. Many externalizations are momentary holds — your brain needs to let go of something briefly, not track it forever.

Trying to classify every input at capture time also requires the AI to read the user's mind about intent — and it can't. "Check SEO results" could be a task or a momentary hold depending entirely on whether the user plans to do it now or tomorrow. The words are identical. The solution isn't better classification; it's **separating capture from processing.** Capture is instant and dumb. Processing happens in the background, on the AI's schedule — immediately for urgent/time-sensitive items, and with patience for everything else, letting transient thoughts self-resolve and related fragments accumulate context.

**Design constraint:** Capture must be raw-thought-first — structure inferred by AI, never required upfront. The system must recognize that not every externalization needs to become a task or note. The AI should not try to classify intent — it should only detect urgency. Everything else marinates until the AI has enough context or the user acts on it themselves. Support gentle decay, enable batch dismissal, and make corrections one-tap. The backlog should feel like a resource, not an indictment.

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

9. **Adapt to the human, not the other way around.** The system should detect the user's current capacity and emotional state from behavioral signals (engagement frequency, deferral patterns, area context) and adjust its tone, volume, and expectations accordingly. A new parent getting 3 hours of sleep sees a smaller focus set and gentler language. An executive in back-to-back meetings gets light-task-only suggestions. Someone dealing with a health crisis gets "when you're ready" phrasing, not productivity pressure. The AI reads the room.

10. **No burial without a human touch point.** Every task gets at least one human touch point before it can leave the working set. The AI never unilaterally buries a task — regardless of its confidence. If something is on a person's brain enough to capture, it deserves to be seen by them at least once more before it drifts. The pipeline: Capture → Stream → Promote → Place in working set → Surface to user → User confirms, adjusts, or defers. Only after that human confirmation can a task move lower or get boomeranged for later.

---

## 5. Core Concepts

### 5.1 The Three Loops

Eon operates through three continuous loops:

**Capture Loop** (seconds): Thought → Stream → captured. The user's job is to externalize. Capture is instant and dumb — no AI processing blocks it. The AI works in the background: urgent/time-sensitive items are processed immediately, everything else marinates until the AI has context (related thoughts accumulate, transient items self-resolve) or the daily sweep catches it.

**Execution Loop** (**seconds** to minutes): Open app -> See recommendation -> Act on it or adjust -> Next. The user's job is to do. The AI's job is to decide what's next.

**Maintenance Loop** (continuous, amortized): AI promotes stream items, resurfaces stale tasks, decays low-intent ideas, detects drifting projects, groups related thinking into notes, flags overcommitment, and prunes. The user's job is micro-corrections when the AI gets something wrong (one tap). There is no weekly review.

### 5.2 Entity Model

The system has three primary entities: **Areas**, **Tasks**, and **Notes**. That's it. No projects table — a task with children IS a project. No routines table — a task with a cadence IS a routine. Every classification decision that can be eliminated, has been.

#### Areas

Stable domains of life and responsibility. These are the coarse partitions of your life that you navigate between. Examples: "Bounce," "InsiderFinance," "Life," "Entrepreneurship & Building," "Health."

Areas have **status**: `active | inactive | archived`. The daily experience only shows active areas (typically 3-7). But you can have 25 total — side projects, future ideas, seasonal concerns. Inactive areas exist with full context but don't compete for daily attention. The AI manages lifecycle: "You haven't touched OSS Finder in 6 months — still on your radar?" or "You've added 4 tasks to this area — want to activate it?"

Areas have a `notes` field for strategic context that isn't a task: "Bounce: pivoting to B2B, current ARR is $X, main focus this quarter is churn." Areas also have a `user_context` field for natural language about the area's priority, status, and intent — "primary focus this quarter," "on hold until after the move," "revisit in September." Area priority and time allocation is described in USER.md as natural language, not as a numeric weight.

**Areas are optional.** Tasks and notes can exist without an area. These "orphans" are first-class citizens — they appear in the deck, they're searchable, the AI surfaces them. Not everything needs a home. Forcing things into areas creates junk drawers. When an orphan does find its natural area, reassignment is one tap.

#### Tasks

The atomic unit of actionable work. A task starts as raw text. The AI processes it into structured data. The user never has to decide classification upfront; the AI infers it.

Tasks have:

- A user-editable `body` field — the primary workspace. Rich markdown, checklists, context, links. This is where you track progress, jot notes as you work ("talked to Jake, he's sending the contract Friday"), and always know where things left off.
- A `user_context` field — the user tells the AI what matters about this task. "Need before March board meeting." "This is THE blocker for Bounce launch." "Not urgent, just don't want to lose it." Natural language, updated anytime. This is the richest signal the AI gets for priority and timing — richer than any enum.
- An `ai_context` field — the AI's scratchpad for this task. Observations that persist across sessions: "Deferred 3x since Feb, possible avoidance." "Connected to Q3 launch goal — user mentioned in daily brief." "User typically does this type of work Friday afternoons." Updated during triage, daily brief, and radar passes.
- An optional `parent_id` pointing to another task — this is how tasks nest. A task with children is a "project" in the UI (shows progress, has a heartbeat, gets "stale project" nudges). But it's the same entity. "Is this a project or a task?" is a question that no longer exists.
- An optional `area_id` — tasks can belong to an area or float free as orphans.

**Status is simple, managed by the AI:**

| Status     | Meaning                              |
| ---------- | ------------------------------------ |
| `active`   | Live work — the AI manages sort position within this pool |
| `done`     | Completed                            |
| `archived` | Removed from all views               |

Active tasks have a `sort_key` maintained by the AI. The deck reads from the top of the sorted active list. Sort position IS the priority — there are no buckets to move between. The AI sorts a "working set" (top ~30-50 tasks) during triage moments. Deeper periodic scans (radar) check if anything below should rise.

The user never picks a status from a dropdown. The AI manages sort position:

- Stream → AI promotes to task with status `active` and places it in the working set using placement heuristics (see Section 8.1). Default is INTO the working set (top ~30-50), not buried below it — every task gets a human touch point before it can drift.
- Morning triage → AI re-sorts the working set, top tasks become today's focus
- Complete → AI re-sorts remaining active tasks
- "Not today" → AI pushes the task down in sort, notes the deferral
- Boomerang → tasks with `resurface_after` that comes due rise in sort position
- In Stage 2, AI-executed tasks get an `agent_delegated` status that pulls them from the deck into a separate "Running Jobs" panel.

**`blocked_on` is a property, not a status.** Tasks with `blocked_on` set are still `active` — the AI factors the block into sort position (pushes them down). The AI checks for block resolution during radar passes.

**No `importance` field.** Sort position IS the priority signal. The AI sorts by reasoning from rich natural language context (`user_context`, `ai_context`, goals, deadlines, calendar, patterns). This is more accurate than a 4-level enum and eliminates a field the AI would frequently get wrong. If the user wants to flag something as critical, they say it in `user_context`: "This is critical, blocks the launch." The AI reads it and acts on it.

**Nesting is shallow.** Convention (enforced by AI nudges, not hard limits) keeps it to 2 levels max. Deeper structure lives in the task body as checklists and notes, not as deeper nesting.

**No `task_type` field.** A task with `recurrence IS NOT NULL` is recurring. A task without it is one-time. This eliminates a classification decision and an enum the AI could get wrong. The AI reasons about the nature of recurring work (consequences, calendar anchoring, flexibility) from `user_context` and `recurrence` text — not from a type label.

The user captures "work out 4x/week" and the AI sets `recurrence: "4x per week"`, `target_frequency: 4`, `next_recurrence_at: <next appropriate date>`. No classification decision at capture time.

**Recurring tasks are a parallel track.** They are NOT mixed into the one-time task sort. Recurring tasks have a `next_recurrence_at` field (datetime, nullable) indicating when this recurring task should next enter active consideration. Morning triage queries `WHERE recurrence IS NOT NULL AND next_recurrence_at <= today` to find due recurring tasks. The AI weaves due recurring tasks into the daily plan alongside top one-time tasks. When completed, a row is logged to `task_completions`. If completions for the current period equal `target_frequency`, the AI recomputes `next_recurrence_at` to the start of the next period. If completions are still below target (e.g., 1 of 2 daily email checks done), the task remains promotable. Last completion time is derived from `task_completions` — no cached field needed.

#### Notes

Non-actionable captures: learning, thinking, reference material, journal entries, and evolving collections of related fragments the AI groups over time. Notes are **not tasks** — they don't have sort positions, deadlines, energy classification, or deck eligibility. They're content that exists in the system for the AI to reference and the user to search.

Examples: "Key insight from AI podcast: agents work better with explicit tool definitions." "Quarterly reflection on Bounce strategy." "Interview questions I like."

Notes can belong to an area, link to a task, or float free as orphans. A note about OAuth2 best practices while working on auth → linked to the auth task. A note on startup strategy → under the "Entrepreneurship & Building" area. A random insight from a walk → orphan. All are first-class.

Notes have **status**: `active | archived`. Active notes are visible by default. Archived notes are hidden but searchable. The AI can archive stale notes during radar sweeps, and the user can archive manually. No `done` status — notes don't complete.

**Any note can be appended to.** When the AI detects related fragments across stream captures (during burst-end or daily sweep passes), it groups them into a single note with timestamped fragments. As the user returns to the topic across hours or days, new fragments get appended to the existing note. When a note reaches critical mass, the AI offers to synthesize the fragments into a structured document. There is no separate "thread" entity or flag — the AI decides when to append vs. create new based on semantic relationships.

The AI uses notes as context for routing and planning: "You noted last week that Bounce should focus on churn — I'm prioritizing retention-related tasks."

#### Decisions

Decisions are a first-class entity — not a task, not a note. A pending decision is a question that requires your judgment. A made decision is context that shapes everything downstream.

**Why decisions need their own entity:**

- A pending decision **blocks work**. Tasks can be `blocked_on: "B2B vs B2C decision"`. Until it's made, an entire area might be stalled.
- A made decision **shapes routing**. "We decided B2B" changes how the AI prioritizes everything in that area.
- Decisions have a unique lifecycle: `pending → made → (superseded | revisited)`. That doesn't map to task statuses or note tags.
- An AI agent may surface a decision it needs from the human: "I can't proceed on the marketing plan until you decide the target audience."

**Scale varies:**

- **Strategic:** "Focus on B2B over B2C" — affects an entire area or the whole system
- **Project-level:** "Use OAuth2 for auth" — affects a specific parent task and its children
- **Tactical:** "Ship the MVP without dark mode" — affects a single task's scope

**How they flow:**

1. Capture detects decision language ("should we," "need to decide," "pick between") → creates a pending decision
2. The AI surfaces pending decisions in the daily brief: "2 pending decisions are blocking progress"
3. The human makes the decision (via chat, via the decisions view, or captured from a meeting note)
4. The AI records the outcome and rationale, marks it `made`, and checks if any `blocked_on` conditions reference it
5. Made decisions feed into AI context permanently: "You decided B2B in January — I'm weighting enterprise tasks"

**Decisions view** in the UI: pending decisions at the top (grouped by area), made decisions below (searchable, filterable). The weekly pulse references both: "2 decisions made this week" and "3 decisions still pending."

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

#### People (Future — CRM)

People and relationship management is a future layer. The vision: a personal CRM that tracks contacts, commitments, follow-ups, and meeting context — deeply integrated with tasks and the AI's reasoning. The current schema does not model people as a separate entity. When the CRM layer is designed, it will go beyond a simple FK on tasks — it needs to model relationships, interaction history, and context across the full system.

### 5.3 Key Mechanisms

#### The Now Deck

The primary execution interface. A short, AI-sorted list of 5-10 tasks — the top of the active list, filtered by energy, scope, and calendar context. The #1 item has a one-line rationale ("this first because deadline is Thursday and you have a deep block now"). The rest are visible and tappable, sorted by AI recommendation.

The deck is a sorted list, not a card picker. Finish a task and the list shifts up — no ceremony, no regeneration. If the top pick is wrong, the right one is probably a few items down. No recovery path needed.

The deck reads from the top of the AI-sorted active list. The AI sorts during morning triage and after completions — the deck itself is a fast read, not a live computation.

#### Boomerang Resurfacing

For tasks without hard deadlines, the system uses a `resurface_after` timestamp. When the time arrives, the task reappears in context — no red badge, no guilt. The user can act on it, snooze it forward, or dismiss it. If snoozed repeatedly, the AI gently asks if it should be archived or broken down.

#### The Radar

A curated feed of things that need attention but aren't "do right now" items:

- Projects that missed their heartbeat (no progress in N days)
- Tasks deferred repeatedly (possible avoidance)
- Approaching hard deadlines
- Blocked tasks due for follow-up
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

### 6.0 App Layout

The app is a three-column layout: a slim execution rail on the left, and two flexible content panels side by side.

```
┌──────────┬─────────────────────┬─────────────────────┐
│          │                     │                     │
│  Agent   │     Panel A         │     Panel B         │
│  Rail    │  ┌─────────────────┐│  ┌─────────────────┐│
│          │  │Deck│Chat│Tasks│…││  │Chat│Deck│Tasks│…││
│  (slim)  │  └─────────────────┘│  └─────────────────┘│
│          │                     │                     │
│          │     [content]       │     [content]       │
│          │                     │                     │
└──────────┴─────────────────────┴─────────────────────┘
              ← draggable divider →
```

**Agent rail (left).** Slim vertical bar showing active AI agents and their status — running workflows, background processing, agent activity. This is the "who's working" view. Also contains primary nav links to dedicated views (Projects, Notes, Routines, Calendar, Decisions, Everything, Settings).

**Panel A and Panel B (center + right).** Two equal-width content panels, each with its own tab bar. Available tabs in each panel: **Deck, Chat, Tasks, Stream, Notes, Projects, Radar.** Each tab can appear in either panel — the user arranges them however they want.

**Default layout: Panel A = Deck, Panel B = Chat.** This is the daily driver — the sorted task list alongside the conversational AI. New users see this and never think about panels. The flexibility is discoverable, not demanded.

**Key behaviors:**

- **Draggable divider.** The panels resize. The deck is compact and might only need 35% width; the chat needs more room for longer responses. Drag the divider. The latest width is saved.
- **Layout persistence.** Panel tab selections and divider position are saved. Close and reopen the app — everything is where you left it.
- **Reset to default.** One action (settings or keyboard shortcut) resets to the default Deck | Chat layout.
- **Shared input bar.** A text input bar spans the bottom of the active chat panel. Captures go to stream. Chat messages go to chat. The input bar is always ready — the user types in one place regardless of layout.

**Common arrangements:**

| Arrangement | When |
|---|---|
| Deck + Chat | Daily driver. Plan, adjust, execute, capture. |
| Deck + Tasks | See the AI's focused list alongside the full picture. |
| Deck + Stream | Review captures, correct promotions, see where things landed. |
| Chat + Tasks | Ask the AI about your tasks while seeing them. |
| Chat + Notes | Reference notes while chatting about planning. |

The layout is a tool, not a feature. It should feel as natural as resizing browser windows — not something you configure, just something you do.

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
- You hit a wall (waiting on AI code gen, blocked on a person) -> Tap "Blocked" -> The deck instantly pivots. If you have time for deep work, it suggests your other focus project. If you have a short gap, it serves a quick win.
- You finish a deep work block or your energy dips -> The system suggests: "You've been on Bounce for 2 hours. Your afternoon is fragmented — switch to light tasks?" The energy toggle (Deep | Light) drives this — it auto-switches based on context blocks but you can override anytime.
- You have a thought → Type or speak it into the stream → It's captured. You trust it'll be promoted or come back to you.
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

### 6.3 Capture Experience — The Stream

Capture must feel like texting yourself, not filling out a form.

#### The Stream

The stream is the primary capture surface — a chronological list of everything you've externalized. It's always accessible, always scannable, always yours. You type into it like texting. No decisions, no forms, no routing choices.

The stream is **not** an activity feed. It contains only things you personally captured — your quick adds, your brain dumps, your voice fragments. Not system events, not AI actions, not "task re-sorted." This is your outbox, slim and personal.

**Input methods:**

- Global text input (always visible, Cmd+K or spotlight-style) → lands in stream
- Voice input (speech-to-text) → lands in stream
- Chat interface ("remind me to call the roofer next week") → lands in stream
- Brain dump mode (Cmd+Shift+K): larger text area for pouring out multiple thoughts at once
- Quick actions from meetings/calendar context → lands in stream

**What happens after capture:**

1. Raw text is stored in the stream immediately (capture is instant, never blocked by AI processing)
2. The AI makes one simple decision in the background: **does this need immediate attention?**
   - **Urgent/time-sensitive** ("pick up kids at 3pm", "registration closes Friday", "call dentist tomorrow") → process immediately: create entity, set reminder or deadline, confirm via toast
   - **Everything else** → let it marinate. The AI doesn't try to classify intent. It waits to see what develops.
3. Marinating items benefit from patience:
   - The user might handle it themselves in 2 minutes and dismiss it (zero cruft)
   - More related thoughts might come in, giving the AI better context for grouping
   - The burst-end batch (~2-3 min after a flurry settles) processes accumulated items together — with full context for grouping, note-append detection, and better classification
   - The daily sweep catches anything still sitting: AI recommends promote, append to note, or dismiss. Items the AI isn't sure about get elevated to the user in the daily brief.
4. For immediately processed items: confirmation toast with one-tap correction chips (reassign area, adjust sort, flip task↔note, edit)

**Every stream item has exactly three exits:**
- **Promoted** — AI creates an entity (task, note, decision, or appended to existing note)
- **Dismissed** — user swipes it away, or it was transient and they handled it themselves
- **Elevated** — AI surfaced it in the daily brief for the user's call

Nothing silently sinks. If the AI didn't handle it and you didn't dismiss it, it comes back to you. If you ignore the elevation too, it decays after ~1 week — but that's a conscious non-action, not a system failure.

**The user's mental model is simple:** "I capture. I can see what I captured. Important things show up in my deck. The rest fades." They don't need to understand passes, batches, or promotion mechanics. The AI handles urgency detection internally; everything else just works in the background.

#### Brain Dump Mode

For intentional brain dumps — after meetings, during planning, clearing mental RAM:

- **Entry:** Cmd+Shift+K, or "Brain dump" button, or chat: "let me dump"
- **Interface:** Larger text area. No formatting. Just blank space. Optional voice dictation.
- **Behavior:** Type/speak freely. No processing until you're done. Hit "Process" or close it.
- **Post-processing:** Summary card with placement context: "From your dump: 3 Bounce tasks (placed in your top 15), 1 personal errand (mid working set), 1 flagged for your review. [Looks right] [Review each]"
- Each item shows what the AI did and where it was placed, with one-tap corrections. Ten seconds — the user confirms or adjusts while the context is fresh.

#### Note Accumulation

Some thoughts develop over hours or days — you capture a fragment on a walk, another angle surfaces at dinner, a connection clicks the next morning. The user never explicitly groups these. The AI notices semantic relationships across recent stream items and existing notes:

- Related fragments within a burst → grouped into a new note with a working title
- New fragment relates to an existing note → appended with a timestamp
- Note reaches critical mass → AI offers to synthesize fragments into a structured document
- If the AI groups wrongly: one-tap "Separate" or "Move to [other note]"

Any note can be appended to — there is no separate "thread" flag or entity. The AI decides when to append vs. create new. No embeddings needed for this. The LLM receives all recent stream items and active note summaries as raw text in the triage context and reasons about relationships directly (see Section 8.1).

#### The Stream as Working Memory (Recent Captures View)

The stream is presented as a **recent captures list** — slim, scannable, always one gesture away. It shows only things the user personally captured, not system activity.

**Visual states per item:**
- **Marinating** — raw text, no annotation yet. The AI hasn't processed it. Just your words.
- **Promoted** — annotation shows what it became: "→ task: Call dentist" or "→ appended to 'Onboarding UX'". Visually distinct (subtle checkmark, lighter text, or similar).
- Items the user has dismissed disappear from the list entirely.

**User actions per item:**
- **Dismiss** — "I handled this" or "don't care." Removes from the list. Not a delete — goes to recently archived.
- **Promote to task** — one tap, opens minimal task creation pre-filled from the raw text.
- **Promote to note** — one tap, creates a note from the raw text.
- **Edit** — tap to modify the raw text before promotion.

**Batch action:**
- **"Process all"** — triggers the batch pass on all marinating items immediately. Power-user shortcut. Optional — if the user never taps it, the batch pass and daily sweep handle everything automatically.

**The list empties naturally.** Promoted items fade after a few hours. Dismissed items disappear. Marinating items get picked up by the batch pass or daily sweep. No badge count. If you never look at this view, everything still flows into the system. It's a lens you can use, not an inbox you must clear.

#### Recently Archived (Safety Net)

When the AI recommends dismissal in the daily sweep, or the user dismisses an item, it moves to **recently archived** — a recycle bin, not a workflow.

- **Not prominent.** Accessible from settings or search, not from the main view. No badge count.
- **Scannable.** Simple list of dismissed/decayed stream items with timestamps. Filterable by `dismissed_by` (user vs. agent) so you can review AI decisions separately.
- **One-tap recoverable.** Promote to task, promote to note, or move back to stream.
- **Full history.** Never auto-purged. Storage is cheap for text rows, and the full capture history is valuable — for the AI's long-term memory, for the user's ability to search old thoughts, and as a trust guarantee. Nothing is ever lost.
- **The AI never truly deletes.** Every thought ever captured remains searchable. The recently archived view surfaces dismissed items, but even without visiting it, search can find anything from the full stream history.

This means: if the user ever thinks "wait, where did that thought go?" — they have a place to look. But they should rarely need to.

**Capture principles:**

- Zero required fields beyond the raw text
- Not every capture needs to become an entity — transient holds are first-class stream citizens
- The AI doesn't try to classify intent — it only detects urgency. Everything else marinates.
- Patience is a feature: letting items sit gives the AI more context and lets transient items self-resolve
- If the raw input implies a new project, the AI can suggest creating a parent task
- Orphan captures (no area) are fine — don't force-assign to avoid junk drawers

### 6.4 The Now Deck (Execution Interface)

The Now Deck is the heart of Eon. It answers the question "what should I do right now?" in under 10 seconds.

**Layout:**

A short, sorted list of 5-10 tasks — the top of the AI-sorted active list. Not a card picker. Not "1 primary + 2 alternates." A ranked list where the AI's opinion is expressed through sort order and a rationale on the #1 item.

- **Top item is prominent** with a one-line rationale: "This first because the deadline is Thursday and you have a deep block now." This is the AI's recommendation — the single strongest signal.
- **Below it: the next 4-9 items**, visible and tappable, sorted by AI recommendation. Each shows: title, project/area badge, energy tag, effort indicator. If the top pick is wrong, the right one is probably a few items down — no recovery path needed, no "show me more."
- **Recently added section** (when present): tasks promoted since the last triage, shown with placement context ("placed near your auth tasks"). Lightweight — disappears after the user acknowledges.
- Actions per item: Done, Snooze (1d/3d/1w/custom), Not Today, Blocked, Reassign
- **"Why this?" expandable** on any item — tap to see the AI's reasoning for that item's position. The rationale is always computed during triage but only shown on-demand for items below #1. This is the safety valve for trusting sort order — the user can always ask "why is this ranked here?" without leaving the deck.

**Why a list, not cards:** Cards create artificial scarcity — showing 3 and hiding the rest makes the user feel they're not in control. A list expresses the same AI opinion (sort order) while keeping recovery effortless. Finish a 5-minute task and the list shifts up — no ceremony, no regeneration. Work through items in flow without the system getting in your way.

**Deck generation is conversational.** The user can provide context before generating or regenerating the deck — via the chat panel or the input bar. "I have a big meeting at 2 and need to prep. Also remembered I need to call the dentist." The AI factors this in: it can re-sort, add new tasks, and give calendar-aware recommendations ("deep block 9-11, I'd focus on X; between your 11am and 2pm, knock out Y and Z"). The deck updates in its panel while the conversation happens in the chat panel — both visible simultaneously.

**Deck action flows** (exact tool chain for each action):

**Done (one-time task):**

1. `updateTask(id, { status: 'done', completed_at: now })`
2. If task has a `parent_id` → `updateTask(parentId, { last_progress_at: now })`
3. AI re-sorts remaining active tasks if top of sort is thin
4. `logActivity` — record completion

**Done (recurring task):**

1. `logCompletion(taskId, note?)` — immutable event log
2. Query `getCompletions(taskId)` for current period count
3. If completions for this period >= `target_frequency` → AI recomputes `next_recurrence_at` to the start of the next period
4. If completions < `target_frequency` → task remains due this period
5. `logActivity`

**Snooze:**

1. User picks duration (1d / 3d / 1w / custom)
2. `updateTask(id, { resurface_after: now + duration, times_deferred: +1 })`
3. AI pushes the task down in sort position — it won't appear in the deck until `resurface_after` passes
4. `logActivity` — record deferral (used by radar for avoidance detection)

**Not Today:**

1. AI pushes the task down in sort position so it doesn't immediately resurface
2. `updateTask(id, { times_deferred: +1 })`
3. `logActivity`

**Blocked:**

1. UI prompts for free text: "What's blocking this?"
2. `updateTask(id, { blocked_on: text, blocked_since: now })`
3. Task remains `active` but AI pushes it down in sort — blocked tasks don't appear in the deck
4. `logActivity`

**Reassign:**

1. UI shows area/project picker
2. `updateTask(id, { area_id: newAreaId })` and/or `updateTask(id, { parent_id: newParentId })`
3. `logActivity`

**Top controls:**

- **Scope pill**: All | [Area name] | [Project name] — filters the deck to an area or parent task
- **Energy toggle**: Deep | Light — filters by work type. Default is inferred from the current context block (deep work block → Deep, gap between meetings → Light). User can override anytime.

Changing any control instantly reshuffles the deck. The energy toggle and scope pill are the only filters — no time pill (estimated_minutes is optional and unreliable for most tasks), no multi-mode selector. Two dimensions: what domain (scope) and what type of work (energy). Effort size (trivial → epic) is visible on items but not a deck filter — the AI uses it during ranking to match task size to available energy and time blocks.

**How the deck is computed:**

The deck reads from the top of the AI-sorted active list. The AI has already sorted tasks during morning triage and after completions — reading the deck is a fast query, not a live computation.

1. **Structured filter**: Read active tasks where `blocked_on IS NULL` and `resurface_after` is null or past, filtered by scope and energy, ordered by `sort_key`, limit 10
2. **Recently added**: Query tasks promoted since last session (via stream `promoted_at`) — included as a lightweight section when present

The query:
```sql
WHERE status = 'active'
  AND blocked_on IS NULL
  AND (resurface_after IS NULL OR resurface_after <= now)
ORDER BY sort_key
LIMIT 10
```

The LLM sorts tasks during specific moments (morning triage, after completion, midday replan), not on every deck read. See Section 8.2 for the full two-layer system.

**Fallback (no LLM / offline):** Show active tasks in cached `sort_key` order, filtered to exclude blocked and snoozed tasks. Sort by hard_deadline proximity then created_at if sort_key is empty. Degraded but functional.

### 6.5 The Radar (Resurfacing Feed)

The Radar replaces the weekly review with a continuous, curated drip of things that need attention.

**What appears in Radar:**

- **Stale projects**: Parent tasks that missed their heartbeat cadence (no child task progress in N days). Action: Revive (generate next action), Snooze, Archive.
- **Repeated deferrals**: Tasks snoozed 3+ times. Action: Break down, Reduce scope, Archive. The AI may gently name the avoidance pattern.
- **Approaching deadlines**: Hard deadlines within 7 days that haven't been worked on.
- **Missing next actions**: Parent tasks (projects) with zero active child tasks.
- **Near-complete tasks**: Tasks with most body checkboxes done that have stalled.
- **Blocked tasks**: Tasks with `blocked_on` set for longer than the follow-up cadence. The AI checks whether the blocking condition has been resolved.
- **Overcommitment signals**: More committed work than available capacity this week.
- **Working set growth**: If the working set exceeds ~50 active tasks, surface the bottom 10-15 for review. "Your working set has grown to 62 tasks. Here are the 10 lowest — defer, archive, or keep?" This prevents the working set from ballooning as captures outpace completions.
- **Neglected goals**: Active goals where no related work has happened in the review cadence period.

**Radar is not a list of everything.** It's a curated feed of 3-7 things that need a decision, presented one at a time or in a short scrollable view. Each entry has clear action buttons.

### 6.6 Projects View

Projects aren't a separate entity — this view is a **filtered lens** on tasks that have children.

- List of all "project" tasks (tasks with children) grouped by area, plus orphan projects with no area
- Each shows: name, status, last progress date, next action (first active child), child task count
- Click into a project to see: outcome, body/notes, all child tasks by status (active, done, archived), heartbeat cadence
- "Generate next actions" button: AI proposes 1-3 concrete next steps based on project context and body
- Drag-to-reorder project priority within an area (or let AI suggest ordering)
- Any task can become a project — just add a child task. Any project can become a task — resolve or remove all children.

### 6.7 Routines View

- Filtered view of tasks where `recurrence IS NOT NULL` — not a separate entity, just a lens on recurring tasks
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
- Filters: area, parent task (project), status, recurring (yes/no), context tags, effort, date range
- Sort: by sort_key, by date created, alphabetical
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

Store facts and user overrides. Derive everything else. Keep manual state minimal. The schema should be simple enough that switching storage engines is straightforward — we will actively test both SQLite and markdown flat files as local-first backends to determine the best model. All data access is behind repository interfaces to make this swap trivial.

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
  user_context TEXT,                               -- natural language about priority, status, intent.
                                                   -- "Primary focus this quarter." "On hold until after the move."
                                                   -- Area priority/time allocation is described in USER.md.
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
CREATE INDEX idx_calendar_time ON calendar_events(start_time, end_time);
CREATE INDEX idx_agent_activity_entity ON agent_activity(entity_type, entity_id);
CREATE INDEX idx_agent_activity_time ON agent_activity(created_at);
CREATE INDEX idx_goals_status ON goals(status);
CREATE INDEX idx_goals_area ON goals(area_id);
CREATE INDEX idx_temporal_memory_date ON temporal_memory(date);

-- Embeddings (via sqlite-vec)
-- Stores vector embeddings for semantic search, duplicate detection, and clustering.
-- All entities that need similarity search get an embedding row.
-- temporal_memory embeddings enable semantic retrieval of relevant past context.
CREATE VIRTUAL TABLE vec_embeddings USING vec0(
  entity_type TEXT NOT NULL,              -- 'task', 'note', 'decision', 'area', 'temporal_memory'
  entity_id TEXT NOT NULL,
  embedding float[1536],                  -- dimension matches model (1536 for text-embedding-3-small)
  +model TEXT NOT NULL,                   -- which embedding model generated this
  +updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Key Schema Decisions

1. **The stream is the capture primitive.** Every externalized thought lands in the `stream` table first. Tasks, notes, and decisions are **promotions** from the stream, not the default output. This decouples the act of capturing from the act of classifying — the user externalizes freely, and the AI promotes selectively through three passes (immediate, batch, daily sweep). Stream items that are transient holds never need to become entities at all.

2. **Four core entities: Areas, Tasks, Notes, Decisions.** Plus Goals and People as supporting entities. No projects table — a task with children IS a project (the UI adapts). No routines table — a task with a cadence IS a routine. Decisions are separate from both tasks and notes: a pending decision blocks work (it's not actionable like a task), a made decision shapes routing (it's not just reference like a note). The AI promotes stream items into tasks, notes, or decisions. The user never classifies.

2. **No projects table.** "Is this a project or a task?" is a question that no longer exists. A task with children behaves like a project in the UI — it gets heartbeat tracking, stale nudges, progress visualization. But it's the same entity. Project-like fields (`outcome`, `heartbeat_days`, `last_progress_at`) live on the tasks table as nullable columns. Promotion/demotion is invisible — add a child task and it becomes a project; remove all children and it's just a task.

3. **Orphans are first-class.** Tasks and notes can exist without an area. They appear in the deck, they're searchable, the AI surfaces them. Not everything needs a home. Forcing things into areas creates junk drawers. When an orphan finds its natural area, reassignment is one tap.

4. **Area status.** Areas have `active | inactive | archived` status. Active areas (3-7 typically) drive the daily experience. But total areas can be unlimited — side projects, future ideas, seasonal concerns live as inactive. The AI manages lifecycle transitions. Areas have a `user_context` field for natural language about priority, status, and intent. Area priority and time allocation is described in USER.md, not as a numeric weight.

5. **`body` field is the primary workspace.** Rich markdown, checklists, context, links. This is where you track progress, jot notes as you work, and always know where you left off. Distinct from `raw_input` (original capture) and `description` (AI-generated context).

6. **`hard_deadline` vs `resurface_after`**: Two distinct fields, two distinct semantics. `hard_deadline` is rare and sacred. `resurface_after` is common and guilt-free. Tasks with only `resurface_after` never show "overdue."

7. **Sort position replaces buckets.** Status is `active | done | archived`. Sort position IS the priority signal — the AI maintains `sort_key` across all active tasks, the user never picks from a dropdown. No `importance` field exists. The AI sorts by reasoning from natural language context (`user_context`, `ai_context`, goals, deadlines, calendar, patterns). The deck reads from the top of the sorted active list. The AI sorts a "working set" (top ~30-50 tasks) during triage moments. Deeper periodic scans (radar) check if anything below should rise. This eliminates bucket transitions as a source of maintenance tax and gives the AI a single, continuous priority ordering instead of discrete buckets.

8. **`sort_key` uses fractional indexing.** A lexicographic string (via `fractional-indexing` library) that orders tasks within the active list. Inserting between two items never requires renumbering other rows. The AI sets sort_key during morning triage and after completions. Between AI updates, the cached order serves the deck instantly.

9. **`user_context` and `ai_context` are the primary priority signals.** `user_context` is the user telling the AI what matters: "blocks the launch," "need before board meeting." `ai_context` is the AI's scratchpad: "deferred 3x, possible avoidance," "connected to Q3 launch goal." These natural language fields give the AI richer signal than any enum and persist across sessions.

10. **`context_tags` as AI-inferred JSON arrays** on both tasks and notes. Flexible, no taxonomy to manage. The AI applies tags; the user can filter by them. Common tags: `coding`, `deep-work`, `quick-win`, `phone`, `email`, `errand`, `review`, `creative`, `administrative`, `financial`, `health`, `social`. Tags complement vector search — tags are for explicit filtering ("show me all coding tasks"), vectors are for fuzzy discovery ("find things related to the API rewrite").

11. **Recurring work lives in the tasks table.** A task with `recurrence IS NOT NULL` is recurring — no `task_type` enum needed. Recurrence schedule and completion tracking are nullable columns. NULLs are free in SQLite. No separate routines entity, no "is this a habit or a task?" decision. The AI reasons about the nature of recurring work (consequences, calendar anchoring, flexibility) from `user_context` and `recurrence` text — not from a type label.

12. **No `completion_pct`.** Completion debt detection relies on AI inference from task age, activity signals, and body content — not a maintained percentage.

13. **No `context_blocks` table.** Context blocks are generated as structured JSON within the daily brief and stored in `sessions.ai_plan`. Regenerated on each replan.

14. **No `importance` field and no buckets.** Priority is expressed entirely through sort position within the active list. The AI reasons about priority from natural language context (`user_context`, `ai_context`, goals, deadlines, calendar, patterns), not stored labels or discrete buckets. This eliminates fields that would be wrong often enough to erode trust and removes bucket transitions as a maintenance burden.

15. **`agent_activity` table**: Complete audit trail of AI decisions. Powers the Agent Activity View and builds user trust.

16. **Singleton `user_state`**: Ephemeral focus state (current scope, mode, available time). Drives the deck filter.

17. **Goals are the compass, OKR-inspired.** Each goal has an Objective (title) and Key Results (`key_results` JSON array). The AI nudges users toward concrete, measurable KRs but never forces them — a vague goal beats no goal. The AI infers which goals a task advances from context — no `goal_id` FK on tasks, no classification decision at capture. KR progress is tracked and surfaced during review cycles. When all KRs are met, the AI suggests marking the goal achieved. Goals surface in weekly pulse, daily brief rationale, deck rerank, and radar (neglected goals / stalled KRs). They answer the question traditional task managers ignore: "Am I working on the right things?"

18. **Two-layer AI memory: file + SQLite.** `~/.eon/USER.md` is the AI's long-term understanding of the user — stable patterns, preferences, calibrations as a plain markdown file. `temporal_memory` (SQLite, one row per day) stores daily observations, context, and session notes. The AI reads USER.md + today's `temporal_memory` + the last 7 days at the start of every interaction. Temporal context ages out naturally — "at a conference this week" falls outside the 7-day read window with no cleanup needed. Temporal memory rows get vector embeddings for semantic retrieval beyond the 7-day window. The `memory-update` workflow (weekly cron) synthesizes `temporal_memory` rows into USER.md updates. Explicit user declarations go straight to USER.md during the conversation. USER.md is the one exception to "everything in SQLite" — it's the single most important transparency artifact, and it deserves to be a plain file any user can open, read, and edit without launching Eon. The "What I've Learned" view just renders this file.

19. **`blocked_on` is free text, not a foreign key.** Blocking conditions are described in natural language: "Waiting for Jake to review the PR and for the design team to finalize mockups." This can reference other tasks, people, external events, or compound conditions — anything. No `blocked_by_task_id` FK exists. The LLM reasons about whether blocks are resolved during radar passes and after task completions. This is simpler, more flexible, and avoids brittle FKs that get out of sync when tasks are restructured. Tasks with `blocked_on` set remain `active` — the AI factors the block into sort position (pushes them down) and filters them from the deck. `blocked_on` text explains what's blocking; `blocked_since` tracks duration.

20. **`reminder_at` is separate from `hard_deadline`.** A reminder is "alert me at this time" (pick up kids at 3pm). A deadline is "this must be done by this date" (tax filing). Most tasks with time-specific language need a reminder, not a deadline. The AI auto-sets `reminder_at` from capture language ("at 3pm", "before the meeting"). Implemented via browser Notification API — no server infrastructure needed.

21. **Duplicate detection at promotion.** When the AI promotes a stream item to a task, it checks against existing task embeddings via cosine similarity (`sqlite-vec`). If a near-match exceeds the similarity threshold, the user sees "Similar task exists" with options to merge, create anyway, or view existing. This prevents inventory bloat that erodes trust. Vector similarity catches semantic duplicates that keyword matching would miss ("call the dentist" vs. "schedule dentist appointment").

22. **Attachments are local files.** Binary attachments (photos, screenshots, files) stored in `~/.eon/attachments/{task_id}/`. The `attachments` JSON field on tasks tracks metadata. Rendered inline in the task body. File storage is local — no cloud dependency.

23. **Embeddings via `sqlite-vec` for semantic search.** Every task and note gets a vector embedding generated during triage (or on significant edit). Stored in `vec_embeddings` virtual table — stays in the same SQLite file, no external vector DB. Powers three things: (1) **semantic search** — "find marketing tasks" returns "campaign launch" and "ad copy" without keyword match, (2) **duplicate detection** — new captures are compared against existing embeddings by cosine similarity before creating, (3) **context retrieval** — when building AI prompts (daily brief, radar, deck rerank), pull the most _relevant_ tasks/notes as context, not just the most recent. Embedding model follows the same provider abstraction — defaults to cheapest available (OpenAI `text-embedding-3-small`, or local via Ollama `nomic-embed-text`). Dimension is model-dependent (1536 for `text-embedding-3-small`). FTS5 handles keyword search alongside vectors — they're complementary, not redundant.

24. **UUIDv7 for all IDs.** Every `id TEXT PRIMARY KEY` uses UUIDv7 (via `uuidv7` npm package). UUIDv7 embeds a millisecond timestamp, so IDs sort chronologically. This gives globally unique, time-ordered identifiers without needing a separate sequence or auto-increment.

25. **Decisions are a first-class entity.** Not a task (you don't "do" a decision), not a note (it has a lifecycle). The `decisions` table tracks status (`pending | made | superseded | revisited`), outcome, and rationale. Pending decisions block tasks via the existing `blocked_on` pattern: tasks reference decisions in free text, the AI resolves blocks when a decision is made. The triage pipeline classifies captures as task, note, OR decision. Decision language: "should we," "need to decide," "pick between," "what's the call on." Made decisions are injected into AI prompts as routing context: "You decided B2B — I'm weighting enterprise tasks."

26. **Temporal memory replaces `ai_working_context`.** Instead of a single text field on `user_state` that the AI must manually maintain, `temporal_memory` stores one row per day with daily observations, context, and session notes. Temporal context ages out naturally — the AI reads today + last 7 days, so "at a conference this week" falls outside the window next week with no cleanup. Temporal memory rows get vector embeddings, enabling semantic retrieval beyond the 7-day window when the AI needs deeper context (e.g., finding a pattern of financial task avoidance across 3 weeks).

27. **Recurring task completions are event-sourced.** Each completion is logged as an immutable row in `task_completions`. Period counts and last-completed timestamps are derived from this log — not stored as mutable state on the task. The `recurrence` field is natural language (same pattern as `blocked_on`) because cadence patterns are too varied to model structurally: "first Thursday of every month," "every 10 days," "4x/week mornings preferred," "2x per day, morning and afternoon." The LLM interprets period boundaries from recurrence text during morning triage. `next_recurrence_at` is the surfacing trigger — morning triage queries `WHERE recurrence IS NOT NULL AND next_recurrence_at <= today` to find due recurring tasks. On completion, the AI recomputes `next_recurrence_at`.

---

## 8. AI System Design

The AI has several distinct jobs, each implemented as a separate function/prompt so they can be tuned independently.

### 8.1 The Stream and Background Processing

Every externalized thought lands in the **stream** — a chronological log of raw captures. The stream is the primitive. Tasks, notes, and decisions are **promotions** from the stream, not the default output. Many externalizations are transient holds that don't need to become entities at all.

**The core AI decision at capture time is not "what is this?" — it's "can this wait?"**

Trying to classify intent ("is this a task or a note?") requires reading the user's mind. But detecting urgency ("does this need attention right now?") is a textual signal the AI can reliably detect. This reframing dramatically shrinks the surface area for errors. The AI only needs to get urgency right — everything else benefits from patience.

#### Urgency Detection (immediate, on capture)

**Trigger:** Each stream item, as it's captured.

**Input:** Raw text + current date/time.

**Decision:** Does this item contain a signal that it **cannot wait** for background processing?

```
System: A user has just captured a thought. Your ONLY job right now is to
determine: does this need immediate processing, or can it marinate?

PROCESS IMMEDIATELY when you detect:
- Time-specific language: "tomorrow", "at 3pm", "before Friday", "this afternoon"
- Deadline language: "registration closes", "due by", "expires"
- Urgency signals: "ASAP", "urgent", "before the meeting", "don't forget to"
- Recurring/habit setup: "4x/week", "every morning", "daily"

LET IT MARINATE (do nothing) when:
- No time pressure: "check SEO results", "buy oat milk", "call the roofer"
- Thinking/riffing: "progressive disclosure for onboarding?"
- Fragments: "agents need explicit tool definitions"
- Low-intent: "maybe I should learn woodworking"
- Anything ambiguous — patience is always safe

When in doubt, let it marinate. The batch pass and daily sweep will catch it.
Nothing is lost by waiting. Things ARE lost by processing wrong.

If PROCESSING IMMEDIATELY: classify and extract structured fields below.
```

When the urgency check triggers immediate processing, the AI classifies as task/note/decision and extracts all structured fields:

```
Decide: is this a TASK, NOTE, or DECISION?

For TASKS:
- title: Short, verb-first if actionable. "Call the roofer about shingles"
- status: always "active" — all new tasks start as active. The AI places the
  task in the working set using the sort placement heuristics below.
- ai_context: Your initial observations about this task. Note any patterns,
  goal connections, or context the user might not have stated explicitly.
- hard_deadline: ONLY set if the text implies a real, external, consequential
  deadline. "Registration closes Friday" = hard deadline.
- reminder_at: Set from time-specific language. "at 3pm" = reminder.
  "pick up kids at 3" = reminder. Most time-specific captures need a reminder.
- resurface_after: For anything not immediately actionable. Default 2-7 days
  for actionable items, 14-30 days for low-priority items.
- area_id: Match to existing area if confident. Leave null if unsure.
- parent_id: Match to existing parent task if confident. Leave null if unsure.
- context_tags: Infer from the nature of the work.
- energy: deep | light
- effort: trivial | small | medium | large | epic
- estimated_minutes: Only set if duration is genuinely knowable.
- For recurring tasks: set recurrence, target_frequency, next_recurrence_at, etc.

For NOTES:
- title: Optional short summary
- body: The content
- area_id: Match to area if relevant. Leave null if cross-cutting.
- task_id: Link to related task if relevant.
- context_tags: Infer topics for search/filtering.

Active areas: {areas with descriptions}
Parent tasks (projects): {tasks that have children, with context}
Current datetime: {now}
```

The urgency check should be fast. Use the user's configured "fast" tier model. See Section 8.8.

#### Sort Placement Heuristics

When a stream item is promoted to a task (whether by immediate processing, batch pass, or daily sweep), the AI places it in the active sort. The goal is not perfect positioning — it's getting the task into the right zone so it surfaces naturally. Morning triage refines.

**The baseline rule: default to the working set range (top ~30-50).** If the user captured it, it matters enough to be in the working set. The only exception is explicit low-intent language. The AI errs toward surfacing too much rather than burying. No task leaves the working set without a human touch point (see Principle 10).

**Heuristic 1 — Urgency detection (top of sort).** Deadline language, time-specific language, "ASAP", "before the meeting" → place near the top of the sort. These tasks should appear in the deck immediately. This is the same urgency detection that triggers immediate stream processing — if it's urgent enough to process immediately, it's urgent enough to place at the top.

**Heuristic 2 — Reference comparison (3-bucket placement).** For non-urgent tasks, the AI grabs a small reference set — a few representative tasks from different ranges of the sort (one from the top, one from the middle, one from the lower working set). It asks: "Is this new task more or less important than these?" Three rough buckets:
- **Above the top reference** → place in the upper working set (top ~10)
- **Between top and middle** → place in the mid working set (~10-25)
- **Below middle** → place in the lower working set (~25-50)

This gives the AI anchors without reasoning about the full list. Cheap, fast, and gets the zone right.

**Heuristic 3 — Goal alignment.** The AI reads the new task against the user's active goals. If the task clearly advances a goal ("write API docs" + goal "Launch Bounce"), it gets placed higher. Goals are one of the strongest non-urgency signals for importance.

**Heuristic 4 — Similarity clustering.** The AI looks for similar existing tasks (via embeddings or title comparison). "Write auth docs" is similar to "Build auth tests" at position #8 → place the new task nearby. Related work naturally groups together. This also catches near-duplicates. If a semantically similar task already exists, surface the match for the user to merge or confirm as separate.

**Heuristic 5 — Low-intent language (the only case for lower placement).** "Maybe", "someday", "would be nice", "eventually" → place in the lower working set. But still IN the working set — not buried below it. The task still gets a human touch point before it can drift further.

**Heuristic 6 — When the AI isn't confident.** If the task is ambiguous and the AI can't determine placement → place it in the mid working set and flag it for the next triage moment. Don't guess wildly. Surfacing is always safer than burying.

These heuristics are used by all three processing passes (immediate, batch, sweep) when creating tasks. The batch pass also ranks new items relative to each other before placing them relative to existing tasks.

#### Background Processing: Batch Pass (minutes)

**Trigger:** After a flurry of captures settles — ~2-3 minutes of inactivity following multiple captures, or when the user explicitly closes brain dump mode.

**Input:** All unprocessed stream items from the current burst + all stream items from the last 48 hours + titles and first ~200 chars of active notes (touched in last 30 days) + active areas and parent tasks.

This is where the AI does the real thinking. It sees multiple captures together, in context, with patience. The batch pass enables:
- **Classification with context:** "Buy oat milk" is clearly a task even without urgency. With no time pressure, the AI classifies it here alongside everything else from the burst.
- **Grouping:** "Three of these fragments are about onboarding UX → create a note that groups them"
- **Append detection:** "This fragment relates to an existing note → append rather than create new"
- **Brain dump processing:** A paragraph-style brain dump gets split and each segment handled
- **Self-resolution detection:** "User captured 'check SEO results' 10 minutes ago and already dismissed it — skip"

This is a small amount of text for one person's life. Hundreds of recent captures and active note summaries fit comfortably in a single LLM call. The LLM reads all of it and reasons about relationships in plain text — no embeddings, no similarity scores, no retrieval pipeline.

**Output per item:** Promote (task/note/decision/append to existing note), or leave for daily sweep.

Uses the "fast" tier model. Batch processing multiple items in one call is cheaper than individual triage calls.

#### Background Processing: Daily Sweep (hours)

**Trigger:** Runs as part of the daily brief (morning) or end-of-day summary. Can also be triggered manually ("process my stream").

**Input:** All remaining unprocessed stream items + full system context.

**Behavior:** The AI reviews every item still sitting in the stream and presents recommendations in the daily brief:
- **Promote** — "This should be a task for tomorrow" → one-tap confirm
- **Append** — "This connects to your notes on [topic]" → one-tap confirm
- **Recommend dismissal** — "This seems transient" → one-tap confirm to archive. The AI never silently dismisses — it recommends, and the user confirms. Dismissed items go to recently archived (recoverable for 30 days).
- **Elevate** — "Not sure about this one. Task, note, or dismiss?" → user decides

This appears in the daily brief as a lightweight section: "3 thoughts from yesterday need your call." One-tap per item. A "dismiss all" option for batch clearing when the AI's recommendations look right.

**Decay:** Items that survive 2+ daily sweeps without any action decay automatically to recently archived (`dismissed_by = 'agent'`). Permanently searchable — never purged. The full stream history is kept forever as both a safety net and a long-term record of the user's thinking.

#### The Guarantee

Every stream item exits through exactly one of three doors:
1. **Promoted** — AI created an entity (task, note, decision, or appended to existing note)
2. **Dismissed** — User removed it, or it was transient and handled
3. **Elevated** — AI surfaced it for the user's decision in the daily brief

Nothing silently sinks. If the AI didn't handle it and you didn't dismiss it, it comes back to you. If you ignore the elevation, it decays after ~1 week — but that's a conscious non-action at that point, not a system failure.

#### Why This Works

The key insight: **the AI's job at capture time is not to classify intent — it's to detect urgency.** This is a much easier problem:

- Urgency has clear textual signals (times, dates, deadlines, "before the meeting")
- Intent is ambiguous ("check SEO results" — task or momentary hold? Impossible to know)
- Getting urgency wrong is low-cost (a non-urgent item processed immediately is fine; just slightly wasteful)
- Getting intent wrong is high-cost (a task misrouted to the wrong area erodes trust)

Everything non-urgent benefits from patience. The user might handle it themselves (zero cruft). More related thoughts might come in (better grouping). The batch pass has full context for smarter classification. The daily sweep is the safety net. The system trades a few minutes of latency for dramatically better accuracy.

### 8.2 How the Deck Works

The deck is built on a two-layer system: **structured filtering** (fast, deterministic) narrows candidates, then **LLM reasoning** (rich, contextual) sorts and explains.

**Layer 1 — Structured filtering (instant, no LLM):**

The deck reads from the top of the AI-sorted active list. The AI has already sorted tasks during morning triage and after completions. Reading the deck is a simple query:

```sql
-- Deck: top of the sorted active list, pre-sorted by AI
SELECT t.* FROM tasks t
WHERE t.status = 'active'
  AND t.blocked_on IS NULL
  AND (t.resurface_after IS NULL OR t.resurface_after <= datetime('now'))
  AND (t.area_id = :active_area_id OR :active_area_id IS NULL)
  AND (t.parent_id = :active_parent_task_id OR :active_parent_task_id IS NULL)
  AND (t.estimated_minutes <= :available_minutes OR :available_minutes IS NULL)
  AND (t.energy = :active_energy OR :active_energy IS NULL)
ORDER BY t.sort_key
LIMIT 10;
```

This is instant — it's reading pre-computed state, not ranking 500 tasks.

**Layer 2 — LLM sorting (runs during triage and promotion, not on every deck read):**

The LLM sorts tasks within the active list during specific moments:

1. **Morning triage** (daily): Sorts the working set (top ~30-50 active tasks). The main orchestration moment.
2. **After completion**: Re-sorts if the top of the list thins out.
3. **Mid-day stream promotion**: Urgent new tasks get placed at an appropriate sort position.
4. **Radar pass** (daily): Scans deeper in the active list for tasks that should rise.

The LLM doesn't compute a score — it looks at the candidate list and returns an ordered array with rationale. This is what LLMs are good at.

```
System: You are an executive assistant deciding the priority order
for tasks today.

Given the user's context and candidate tasks, return them in priority
order. For the #1 task, provide a one-line rationale (max 15 words)
explaining WHY it should be first. Reference concrete facts: deadline
proximity, goal alignment, time fit, dependency unblocking, or patterns.

Context:
- Current time: {time}
- Calendar: {today's events and gaps}
- Energy: {deep | light}
- Scope: {area / parent task, if set}
- Active goals: {goals with key results and progress}
- Stale parent tasks: {projects that missed heartbeat}
- AI memories: {relevant patterns, preferences, calibrations}
- Yesterday: {what was planned vs. completed}

Candidates (from active list, working set):
{tasks with: title, user_context, ai_context, body summary,
 area, parent task, energy, effort, estimated_minutes, hard_deadline,
 context_tags, times_deferred, created_at, blocked_on}

Return: ordered task IDs + rationale for #1.
What sort order should the active working set have?
Which tasks should be at the top (today's focus)?
Which should be pushed lower in sort?
```

**Energy filter mapping** (applied as SQL filters on the deck query):

| Energy | What it shows                                        | Context tags typical                                        |
| ------ | ---------------------------------------------------- | ----------------------------------------------------------- |
| Deep   | Focused, uninterrupted work                          | coding, creative, writing, research, architecture, analysis |
| Light  | Everything else — admin, comms, errands, quick tasks | email, admin, communication, errand, review, financial      |

The AI sets `energy` at triage time based on task content. The user can override per task via `user_context` ("this email is actually deep work — I need to think carefully about the response").

**Fallback (no LLM):** Show active tasks in cached sort_key order, excluding blocked and snoozed tasks. If sort_key is empty, sort by hard_deadline proximity then created_at. Degraded but functional — the user can still see their tasks and pick one.

### 8.3 Daily Brief Generation

**Trigger:** User opens app for the first time each day or explicitly requests a plan.

**Input:**

- Today's calendar events (from cache)
- Available time gaps computed from calendar
- All `active` tasks (the candidate pool) with user_context, ai_context, and key fields
- Recently promoted tasks since last session (tasks where stream `promoted_at > last_session_created_at`) — these get called out with placement context
- Today's recurring tasks (where `recurrence IS NOT NULL AND next_recurrence_at <= today`)
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
2. Call out recently added tasks with placement context:
   "3 tasks added since your last session — here's where I placed them:
   - 'Write auth docs' → near your other auth tasks (top 15)
   - 'Call accountant' → mid-priority, no deadline (#22)
   - 'Research competitor pricing' → lower working set, flagged for your review"
   The user confirms or adjusts. This is the human touch point.
3. Anchor recurring tasks (habits/routines) into appropriate gaps
4. Assign the primary deep work focus
5. Queue quick wins for short gaps
6. Surface 1-2 lower-sorted tasks as "worth a look" if time allows
7. Flag overcommitment if total work > available time
8. If working set exceeds ~50 active tasks, note the growth and suggest
   reviewing the bottom 10-15 for deferral or archival

Return:
- "summary": A conversational plan (3-8 sentences)
- "focus_tasks": Sorted task IDs for today's focus (top of sort, 1-7 tasks, sized to capacity)
- "recently_added": Task IDs added since last session with placement rationale
- "active_sort_order": Full sorted active task IDs (the overall sort for the active list)
- "blocks": Array of context blocks (deep/light) mapped to calendar gaps
- "overcommitted": boolean
- "deferred": tasks that won't fit today
```

**The daily brief is the key orchestration moment.** This is where the AI sorts the active working set, assigns sort_keys, and gives the user a clear plan. The user reacts conversationally ("swap X for Y", "not today on Z"). The AI adjusts. This replaces the weekly review with a daily, conversational, 2-3 minute triage.

#### Three Triage Moments

The daily brief is one of three triage moments that create human touch points for recently added tasks:

**Morning triage (daily brief).** The primary orchestration moment. Sorts the full working set, calls out recently added tasks with placement context, generates the day's plan. This is the most important triage — it ensures every task added in the last 24 hours gets seen.

**Midday replan.** Can happen anytime — after a meeting that changes everything, after a burst of new captures, or when the user asks "re-plan my afternoon." The same pipeline runs, scoped to the remaining day. Tasks promoted during the morning also get a second surfacing opportunity here.

**End-of-day wrap-up.** The shutdown summary (Section 6.1, Moment 3) includes what was added during the day and where it stands. This is the last touch point — if something was captured and promoted but the user hasn't seen it yet, it surfaces here.

Multiple triage moments mean recently added tasks get 2-3 chances to be seen within 24 hours. The "no burial without human touch point" guarantee is enforced by this cadence, not by a single daily ceremony.

### 8.4 Radar Generation

**Trigger:** Daily (can run with daily brief) or on-demand.

**Approach:** Mostly rule-based queries with optional LLM enrichment for suggested actions.

```
Radar items come from:

1. SELECT t.* FROM tasks t
   WHERE t.id IN (SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL)
   AND t.status = 'active'
   AND t.heartbeat_days IS NOT NULL
   AND (t.last_progress_at IS NULL
        OR julianday('now') - julianday(t.last_progress_at) > t.heartbeat_days)
   -- Stale "projects" (parent tasks that missed their heartbeat)

2. SELECT t.* FROM tasks t
   WHERE t.times_deferred >= 3 AND t.status = 'active'
   -- Repeatedly deferred (possible avoidance)

3. SELECT t.* FROM tasks t
   WHERE t.hard_deadline IS NOT NULL
   AND julianday(t.hard_deadline) - julianday('now') <= 7
   AND t.status = 'active'
   -- Approaching deadlines

4. SELECT t.* FROM tasks t
   WHERE t.id IN (SELECT DISTINCT parent_id FROM tasks WHERE parent_id IS NOT NULL)
   AND t.status = 'active'
   AND t.id NOT IN (
     SELECT parent_id FROM tasks
     WHERE status = 'active' AND parent_id IS NOT NULL
   )
   -- "Projects" with no active child tasks (missing next action)

5. SELECT t.* FROM tasks t
   WHERE t.status = 'active'
   AND t.blocked_on IS NOT NULL
   AND julianday('now') - julianday(t.blocked_since) > 3
   -- Blocked tasks due for follow-up

6. SELECT t.* FROM tasks t
   WHERE t.status = 'active'
   AND t.resurface_after IS NOT NULL
   AND t.resurface_after <= datetime('now')
   -- Boomerangs ready to rise in sort position
```

For avoidance detection (query 2), optionally send to LLM to generate a gentle suggestion: "This has been pushed back 4 times. Would it help to break it into a smaller first step? What's the 5-minute version?"

**Block resolution check:** For blocked tasks (query 5), the LLM reads each task's `blocked_on` text and checks whether the blocking condition has been resolved — by cross-referencing completed tasks, recent captures, calendar events, and People interactions. If the LLM determines the block is likely resolved, it surfaces the task for the user to confirm: "You were waiting on Jake to review the PR. He completed a review task yesterday — is this unblocked?" If confirmed, `blocked_on` and `blocked_since` are cleared and the AI re-sorts the task to an appropriate position. This replaces a brittle FK with flexible, natural language reasoning.

### 8.5 Avoidance Detection & Response

When a task has been deferred 3+ times and is non-trivial (effort >= small, or estimated_minutes > 15):

1. **Don't escalate pressure.** No red badges, no urgency inflation.
2. **Offer to break it down.** AI suggests the smallest possible first step.
3. **Gently name the pattern** (optional, after 5+ deferrals): "This keeps slipping. That's often a sign the task feels bigger than it is. Want me to find a 5-minute way in?"
4. **Offer an out.** "Is this still worth doing? It's okay to archive it."

### 8.6 Adaptive Capacity & Tone

The AI adjusts its behavior based on the user's current state — detected from behavioral signals, not explicit settings. This is not a mode the user toggles; it's the AI reading the room.

**Signals the AI reads:**

| Signal                                            | What it suggests              | AI response                                                                                                                                          |
| ------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low engagement (hasn't opened app in 2+ days)     | Overwhelmed or disengaged     | Smaller focus set (1-2 items). Gentler tone: "Welcome back. Here's the one thing that matters most today."                                           |
| High deferral rate (>50% of focus tasks deferred today) | Overloaded or misaligned plan | Offer to replan: "Looks like today didn't go as planned. Want me to re-sort based on what's actually possible?"                                      |
| All-meetings day (calendar shows <30 min of gaps) | No execution capacity         | Switch to light-only deck. Daily brief acknowledges: "Your day is wall-to-wall. I've queued only quick tasks for gaps. Deep work moves to tomorrow." |
| Health/crisis area active with recent captures    | Difficult life period         | Softer language throughout. No productivity framing. "When you're ready" instead of "you should." Smaller focus sets.                                |
| New area with flood of captures (20+ in a day)    | Onboarding or life transition | Batch triage mode. "You've captured a lot for [area]. Want me to organize these into a rough plan, or just file them for now?"                       |
| Consistent high completion rate                   | In flow, system is working    | Stay out of the way. Minimal commentary. Quick deck transitions.                                                                                     |

**Returning after a gap — catch-up mechanism:** When the user returns after 2+ days away, tasks may have been promoted by batch/sweep processing without any human touch point. The daily brief's "recently added" section expands to cover the full gap period: "While you were away, 12 tasks were added. Here's a summary by area and where I placed them." The brief keeps it scannable (grouped by area, sorted by AI-assigned importance) with a [Review each] option. This ensures the "no burial without human touch point" guarantee holds even when the user skips days. The tone is "welcome back, here's the situation" — never guilt about absence.

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

The AI gets smarter over time through two layers: a **long-term user profile** (plain markdown file) and **temporal daily observations** (SQLite table). USER.md is the one exception to "everything in SQLite" — it's the AI's understanding of who you are, and it deserves to be a file you can open in any editor.

**Two-layer architecture:**

| Layer                 | Storage                                     | Purpose                                              | Read when                               | Updated when                                                                    |
| --------------------- | ------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| **Long-term profile** | `~/.eon/USER.md` (file)                     | Stable patterns, preferences, calibrations           | Every interaction                       | Weekly by `memory-update` workflow, or immediately on explicit user declaration |
| **Temporal context**  | `temporal_memory` (SQLite, one row per day) | Daily observations, session notes, ephemeral context | Every interaction (today + last 7 days) | During each interaction                                                         |

**What goes in USER.md (long-term profile):**

```markdown
## Energy Patterns

- Most productive before 11am, energy dips 2-4pm
- Deep work sessions average 45 min (calibrated from 12 sessions)

## Effort Calibration

- Coding tasks take ~1.5x estimated time (8 data points)
- "Quick" tasks from user average 25 min, not 10

## Avoidance Patterns

- Financial tasks deferred 4 times in 2 weeks — try breaking into 5-min steps
- "Update resume" in backlog for 3 months, never touched

## Preferences

- Prefers shorter deck (5-6 items), finds 10 overwhelming
- Batches admin tasks on Fridays
- Casual tone, not corporate

## Context

- Building Eon (AI task manager) — primary focus
- Also running Company X
- Side project: open-source library Y (slow burn)
```

**What goes in `temporal_memory` (daily rows):**

```markdown
## Context

- User at conference (day 3 of 4), very limited time
- Only available 7-8am and after 6pm

## Observations

- Deferred "quarterly planning" for 3rd time this week
- Completed 2 quick wins during lunch break
- Asked about B2B pricing decision — seems top of mind

## Session Notes

- Morning: Reviewed deck, did 1 quick task, deferred rest
- Evening: 30-min deep work on auth flow
```

**Temporal memory embeddings:** Each `temporal_memory` row gets a vector embedding (stored in `vec_embeddings` with `entity_type = 'temporal_memory'`). This enables semantic retrieval beyond the 7-day read window. When triaging a financial task, the AI can `findSimilar("financial task avoidance")` against temporal memory embeddings and find relevant observations from 3 weeks ago — even though those rows are outside the default read window. The 7-day window is for routine context injection; embeddings provide on-demand deep recall.

**How temporal observations become long-term memory:**

The `temporal_memory` rows are the **evidence trail**. The `memory-update` workflow (weekly cron) reads the last 14 days of `temporal_memory` alongside USER.md and looks for patterns worth promoting:

1. **Override analysis.** If recent rows show 3+ triage corrections of the same type across different days → add to USER.md: "User prefers tasks about X to go under area Y."
2. **Sort placement corrections.** If the user consistently bumps certain types of tasks higher (or pushes them lower), note the pattern. "User bumps financial tasks higher than default placement" → adjust future placement heuristics. This is the learning loop for sort placement: user corrects AI → `ai_context` on the task records the correction → `agent_activity` logs it → `temporal_memory` captures the pattern → `memory-update` synthesizes into USER.md → future placements improve.
3. **Effort calibration.** If recent rows show consistent estimation misses → update USER.md calibration factor.
4. **Deferral patterns.** If the same task type appears as deferred across multiple days → note the pattern in USER.md.
5. **Session analysis.** If rows consistently show planned vs. completed mismatch → add overcommitment calibration to USER.md.
6. **Contradiction detection.** If recent observations contradict a USER.md entry (user started coding in the afternoon regularly) → update or remove the outdated pattern.

**Explicit user declarations** bypass the weekly cycle. "I prefer to code in the morning" or "I'm starting a new job next week" goes straight to USER.md during the conversation — no need to wait for pattern detection.

**How memory is used in prompts:**

All AI prompts receive USER.md content as context. Time-sensitive prompts (daily brief, deck rerank, triage) also receive today's `temporal_memory` + recent days. Workflows that need deeper context can use `findSimilar` against temporal memory embeddings. Example injection:

```
[From USER.md]
User patterns (learned over time):
- Best deep work: before noon (observed across 25 sessions)
- Effort calibration: coding tasks take ~1.5x estimated time
- Tends to defer financial tasks — batch on Fridays if possible

[From recent temporal_memory]
- User at conference this week, very limited time (day 3 of 4)
- Deferred "quarterly planning" 3 days in a row
- B2B pricing decision seems top of mind
```

**Memory lifecycle:**

- The user can view USER.md in the "What I've Learned" view — or just open `~/.eon/USER.md` in any editor
- Temporal context ages out of the default read window naturally (7 days) but remains searchable via embeddings
- Old `temporal_memory` rows are never deleted — they're small and serve as the evidence trail for the `memory-update` workflow
- All memory updates are logged in `agent_activity`: "Updated USER.md: Added effort calibration for design tasks (1.5x estimate)"

### 8.8 Model Strategy

Eon is **model-agnostic**. Users bring their own API keys (direct provider keys or OpenRouter) and choose which models power each job. The table below defines the **capability tier** each job requires — the user maps their preferred models to these tiers in settings.

| Job               | Tier Required       | Rationale                                                            | Default Mapping                                  |
| ----------------- | ------------------- | -------------------------------------------------------------------- | ------------------------------------------------ |
| Urgency detection | Fast (cheapest)     | High volume, needs to be instant, binary decision (urgent or not)    | Haiku, GPT-4o-mini, Flash                        |
| Stream batch      | Fast (cheapest)     | Multiple items per call, amortizes cost, needs grouping reasoning    | Haiku, GPT-4o-mini, Flash                        |
| Embedding         | Embedding model     | Runs on every capture + edit, must be cheap and fast                 | text-embedding-3-small, nomic-embed-text (local) |
| Deck ranking      | Rule-based (no LLM) | Reads from AI-sorted active list, deterministic, fast                | N/A                                              |
| Deck rerank       | Standard            | Needs reasoning but bounded scope, structured output                 | Sonnet, GPT-4o, Pro                              |
| Daily brief       | Capable (best)      | Conversational quality matters, runs once/day                        | Opus, o3, Pro                                    |
| Radar suggestions | Standard            | Needs nuance for avoidance/psychology, runs daily                    | Sonnet, GPT-4o, Pro                              |
| Weekly pulse      | Capable (best)      | Retrospective quality matters, runs once/week                        | Opus, o3, Pro                                    |
| Chat agent        | Standard            | Interactive, needs reasoning + tool use, user is waiting (streaming) | Sonnet, GPT-4o, Pro                              |

**Provider support:** Anthropic (Claude), OpenAI, Google (Gemini), OpenRouter (access to all models), and local models (Ollama, LM Studio) for offline/privacy. The provider abstraction means adding new providers is a single adapter, not a rewrite.

**Cost control:** The user sees estimated cost per operation in settings (based on their chosen models). The system defaults to the cheapest viable tier per job. Power users can upgrade specific jobs to better models. The deck reads from the AI-sorted active list without LLM on every read, ensuring the core execution loop is always free.

---

## 9. Technical Architecture

### Stack

- **Framework:** Next.js (App Router) with TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Database:** SQLite via better-sqlite3 (local file, no server). FTS5 for full-text keyword search. `sqlite-vec` extension for vector similarity search. The storage backend is abstracted behind repository interfaces — the app never touches SQL directly. This makes it straightforward to experiment with markdown files, Postgres, or a hybrid (SQLite for indexes/queries/embeddings, markdown for human-readable content) without changing application code.
- **Embeddings:** `sqlite-vec` stores embeddings alongside entities in the same SQLite file. Embedding models accessed via the same provider abstraction (OpenAI `text-embedding-3-small`, Voyage, or local via Ollama `nomic-embed-text`). Embeddings power semantic search, duplicate detection, and clustering. Generated on stream promotion and updated on significant edits.
- **Agentic layer: framework-agnostic by design.** All AI business logic — tools, workflows, composite operations — is implemented as plain TypeScript functions with injected dependencies (repositories, LLM provider, embedding store). No framework imports in business logic. A thin adapter layer wraps these functions for whichever agent framework runs the loop ([Mastra](https://mastra.ai), [Pi agent-core](https://github.com/badlogic/pi-mono), Vercel AI SDK, or a custom loop). The adapter translates between the framework's tool schema format (Zod, TypeBox, etc.) and the underlying function signature. **Swapping the agent framework means rewriting adapters, not business logic.** For MVP, we start with Mastra (batteries-included Next.js integration, workflow primitives, model routing). But the architecture is designed so the orchestration layer is swappable as the AI landscape evolves — particularly toward more autonomous, less structured agent loops (see Agent Architecture below).
- **AI:** Model-agnostic provider abstraction. Users bring their own API keys — direct (Anthropic, OpenAI, Google) or via OpenRouter for access to all models. Local models supported via Ollama/LM Studio for offline use. Keys stored in `.env`. The model routing layer (Mastra's for MVP, but abstracted) maps each AI job to a capability tier (fast, standard, capable, embedding) so the user configures preferences once.
- **Calendar:** Google Calendar API (OAuth, read-only). Events cached to `calendar_events` table.
- **State management:** React Server Components for data fetching. Client-side state (Zustand or similar) for interactive elements (deck, user state, chat).
- **No auth** — single-user local app for MVP

### Architecture Principles

1. **Data access layer abstracted — we will test full SQLite vs full markdown.** All database operations go through TypeScript repository interfaces (`TaskRepository`, `NoteRepository`, `AreaRepository`, `MemoryRepository`, etc.). The app imports interfaces, never concrete implementations. A factory function creates the right implementation based on config. The best local-first data model is an open question — we will build and test both:
   - **SQLite** (default, built first): better-sqlite3 with FTS5 + sqlite-vec. Best for structured queries, embeddings, and performance. All data in one file (`~/.eon/data.db`).
   - **Markdown**: All entities as `.md` files with YAML frontmatter. Human-readable, version-controllable, Obsidian-compatible. Memory files are already markdown content — a markdown backend would store them as plain files.
   - **Hybrid**: SQLite for indexes/queries/embeddings, markdown for content (`body` field). Best of both.
   - **Postgres**: For future cloud/team scenarios.

   The embedding store is separately abstracted (`EmbeddingStore` interface) since vector storage has unique requirements — the SQLite implementation uses `sqlite-vec`, a Postgres implementation would use `pgvector`, a markdown backend would use sqlite-vec as a sidecar index. Business logic functions consume repository interfaces, never storage internals. This abstraction is not speculative — we are actively planning to test both SQLite and markdown backends to determine which provides the best local-first experience.

2. **AI operations as a three-layer stack: functions → adapters → agent loop.** All AI operations follow the same separation of concerns:
   - **Business logic (plain TypeScript functions):** Every AI operation — CRUD, search, triage, deck generation, brief — is a pure TypeScript async function. Functions take injected dependencies (repositories, LLM provider, embedding store) and return typed results. Zero framework imports. These are the unit-testable core.
   - **Tool adapters (thin wrappers):** Each function gets a framework-specific wrapper that declares its schema (Zod for Mastra, TypeBox for Pi, etc.) and maps the framework's call convention to the underlying function signature. Adapters are ~5-10 lines each.
   - **Agent loop (swappable):** The loop (Mastra agent, Pi agent-core, Vercel AI SDK, or custom) registers the adapted tools and handles the LLM ↔ tool call cycle. The loop layer is the only part that's framework-dependent.

   ```
   ┌─────────────────────────────────────┐
   │  Agent Loop (swappable)             │
   │  Mastra / Pi / Vercel AI / custom   │
   ├─────────────────────────────────────┤
   │  Tool Adapters (thin wrappers)      │
   │  Framework-specific schema + call   │
   ├─────────────────────────────────────┤
   │  Business Logic (pure TypeScript)   │
   │  getTasks, streamCapture, etc.      │
   ├─────────────────────────────────────┤
   │  Repositories + Services            │
   │  TaskRepo, EmbeddingStore, LLM      │
   └─────────────────────────────────────┘
   ```

   Operations are categorized by autonomy level:
   - **Tools** (atomic): Single operations — CRUD, search, calendar queries, user state, memory. Tools let the agent _do_ things.
   - **Workflows** (composite): Multi-step orchestrations that chain tools with LLM reasoning — triage, deck generation, daily brief, radar, weekly pulse. Implemented as plain async functions that call tools in sequence. Exposed to the agent as single composite tools. Workflows let developers _control_ things — deterministic sequences that guarantee correctness.
   - **Skills** (domain knowledge): `<skill-name>/SKILL.md` files following the Agent Skills spec. Loaded by agents when relevant via progressive disclosure. Skills let the agent _know_ things — Eon's philosophy, prioritization heuristics, avoidance detection patterns, recurrence logic. Editable without code changes.
   - **Agents** (autonomous): The agent loop with tool access, workflow access, and skill knowledge. The chat agent can call any tool or workflow, observe results, and decide next steps autonomously.

   Prompts are stored as templates, not inline strings. Each workflow has its own prompt template, input schema, and output schema so they can be tuned independently.

   **Why this separation matters:** The AI landscape is moving toward giving models more autonomy — goal-driven agents with general computer access, not just structured tool callers. Today's structured workflows may become unnecessary as models get smart enough to compose the right steps from atomic tools alone. By keeping business logic framework-free, we can evolve the orchestration layer (from structured workflows → more autonomous loops → fully goal-driven agents) without rewriting the functions that actually do things. The workflows are a reliability optimization, not an architectural commitment.

3. **Offline-capable.** The app works without an internet connection for capture and basic deck (deterministic scoring). LLM features degrade gracefully — show a "using local scoring" indicator.

4. **Audit everything.** Every AI inference is logged to `ai_inferences`. Every system action is logged to `agent_activity`. This is non-negotiable for trust.

5. **One model config, used everywhere.** The user configures their API keys and model preferences once (in a config file or settings UI). The model routing layer uses this config for all AI operations — triage, deck, brief, radar, chat, embeddings. Each AI job maps to a capability tier (fast, standard, capable, embedding). The user assigns their preferred model to each tier. Prompts are provider-agnostic. Supported providers: Anthropic, OpenAI, Google, OpenRouter, Ollama/LM Studio (local).

6. **Graceful degradation.** When an LLM call fails, the embedding API is down, or any AI operation errors — the app continues working. Triage falls back to basic keyword matching for dedup and manual field entry. The deck falls back to cached `sort_key` ordering. The daily brief shows "AI unavailable" with a simple task list. No workflow should crash the app or block the user. Log the failure to `agent_activity`, retry once, then degrade.

7. **Protocol-first design.** Eon's capture and routing interfaces are designed as open protocols, not just internal APIs. The app is the reference implementation. Any agent framework, any UI, any integration can plug into the routing engine via well-defined endpoints: capture (ingest a thought), route (get the next best action), delegate (assign to an agent), and report (return results). This means Eon can become the routing layer for an ecosystem of AI agents and tools — not just a standalone app.

### Agent Architecture

The system has six layers. Each layer depends only on the layer below it. The critical boundary is between **business logic** (framework-free) and **agent loop** (framework-specific). Everything below the adapter layer is pure TypeScript with injected dependencies — no Mastra, Pi, or any framework imports.

```
┌─────────────────────────────────────────────────────┐
│  Agent Loop     Mastra / Pi / Vercel AI / custom     │  ← swappable
├─────────────────────────────────────────────────────┤
│  Tool Adapters  Schema wrappers (Zod / TypeBox)      │  ← thin, ~5-10 lines each
╞═════════════════════════════════════════════════════╡
│  Workflows      streamCapture, deckGenerate, etc.    │  ← plain async functions
├─────────────────────────────────────────────────────┤
│  Tools          getTasks, search, getUserProfile     │  ← plain async functions
├─────────────────────────────────────────────────────┤
│  Services       Calendar sync, Notifications, Embed  │
├─────────────────────────────────────────────────────┤
│  Repositories   TaskRepo, NoteRepo, EmbeddingStore   │
└─────────────────────────────────────────────────────┘
        ══════ framework boundary (above = swappable) ══════
```

**Tool scoping by agent role:** Not every agent gets every tool. The chat agent gets only domain tools (getTasks, search, streamCapture, etc.) — never raw computer-access tools like bash or file read/write. This ensures all operations go through the abstraction layer (audit logging, validation, embedding updates). A future Stage 2 executor agent for delegated tasks would get computer-access tools (bash, web browse, file I/O) scoped to its sandbox — that's a separate agent instance with a different tool set and system prompt.

#### Atomic Tools

Plain TypeScript async functions with injected dependencies. These are the building blocks that workflows and agents compose. Each function has a typed signature; the agent framework's schema format (Zod, TypeBox, etc.) is declared only in the adapter layer.

**Data — Tasks**
| Tool | Description |
|---|---|
| `getTasks` | Query tasks by status, area, type, parent, energy, tags |
| `getTask` | Single task by ID |
| `createTask` | Create task with all fields |
| `updateTask` | Partial update on any fields |
| `moveTask` | Change status (active/done/archived) with sort_key update |
| `logCompletion` | Log row to `task_completions` |
| `getCompletions` | Query completion history for a task |

**Data — Notes, Areas, Goals**
| Tool | Description |
|---|---|
| `getNotes` / `getNote` / `createNote` / `updateNote` | Note CRUD, filtered by area/task/tags |
| `getAreas` / `getArea` / `createArea` / `updateArea` | Area CRUD, filtered by status |
| `getGoals` / `getGoal` / `createGoal` / `updateGoal` | Goal CRUD, including KR progress |
| `getDecisions` / `getDecision` / `createDecision` / `updateDecision` | Decision CRUD. `updateDecision` handles lifecycle: marking `made` with outcome/rationale, superseding, revisiting. |

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
| `getUserProfile` | Read `~/.eon/USER.md` (long-term memory) |
| `updateUserProfile` | Write to `~/.eon/USER.md` (explicit user declarations, memory-update synthesis) |
| `getTemporalMemory` | Read `temporal_memory` rows for today + last N days |
| `upsertTemporalMemory` | Create or append to today's `temporal_memory` row |

**Activity & Sessions**
| Tool | Description |
|---|---|
| `logActivity` | Write to `agent_activity` |
| `getRecentActivity` | Read recent activity with filters |
| `getCurrentSession` / `createSession` / `updateSession` | Day session management |

#### Workflows

Multi-step orchestrations implemented as plain async functions that chain atomic tools with LLM reasoning. Workflows can be invoked directly by the app (e.g., morning triage) or exposed to the agent as composite tools via adapters. Because they're just functions, they work identically whether called by a Mastra workflow engine, a Pi agent, or a direct API route handler.

**1. `stream-capture`** — Raw text → stream item + urgency check

1. Store raw text in `stream` table (instant, never blocked by AI)
2. Run urgency-detection LLM: can this wait, or does it need immediate processing? (see Section 8.1)
3. If urgent: generate embedding → `findSimilar` (duplicate check) → LLM classifies (task/note/decision) and extracts structured fields → `createTask`/`createNote`/`createDecision` + store embedding + update stream status
4. If not urgent: stream item stays as `pending` for batch processing. No further AI work.
5. `logActivity` — record decision
6. Return result with correction chip data (if processed) or stream confirmation (if marinating)

**1b. `stream-batch`** — Background processing of marinating stream items after a burst settles

1. Collect all `pending` stream items from current burst + last 48 hours
2. Load titles + first ~200 chars of active notes (touched in 30 days)
3. Filter out items already dismissed by user (self-resolved, zero cruft)
4. Single LLM call with full context: classify each remaining item, detect related notes, identify note-append opportunities
5. For each item: promote (create entity or append to existing note), or leave for daily sweep
6. `logActivity` for each promotion

**1c. `stream-sweep`** — Daily sweep of remaining unprocessed items (runs within daily brief)

1. Collect all `pending` stream items older than current burst
2. LLM reviews with full system context: promote, dismiss, or elevate to user
3. Elevated items are included in the daily brief as a lightweight review section
4. Items that have survived 2+ sweeps without action → auto-decay (status = `decayed`, archived but searchable)

**2. `deck-generate`** — State + candidates → ranked deck (rule-based, no LLM)

1. `getUserState` — scope, energy, available time
2. `getTasks` where status = `active` AND `blocked_on IS NULL` AND (`resurface_after IS NULL OR resurface_after <= now`), filtered by energy/scope/time, ordered by `sort_key`
3. `getCalendarEvents` + `getAvailableGaps`
4. Query recently promoted tasks that haven't been through a triage yet: tasks joined to stream items where `promoted_at > last_session_created_at`, limited to 3. These surface as a lightweight "recently added" section alongside the deck — not a separate inbox, just additional context showing where the AI placed new captures. The user can tap to bump, snooze, or leave them.
5. Rule-based multi-factor ranking (sort_key position, deadline proximity, energy match, time fit, streak urgency, goal alignment)
6. Return sorted list (up to 10 items) + rationale for #1 + recently added list

**3. `deck-rerank`** — Rule-based deck → LLM-reranked with rationale

1. Get output from `deck-generate`
2. `getUserProfile` + `getTemporalMemory` — relevant patterns, preferences, recent context
3. `getGoals` — active goals
4. `getRecentActivity` — recent deferrals, completions
5. LLM reranks candidates, provides one-line rationale for #1 item (see Section 8.2 prompt)
6. `logActivity` — record rerank decision

**4. `daily-brief`** — Morning orchestration → plan + promotions + context blocks

**Build both a workflow version and an agent version. Test each and compare.**

**Workflow version** (deterministic, cheaper, predictable):

1. `getCalendarEvents` + `getAvailableGaps`
2. `getTasks` where status = `active` (the working set)
3. Query recently promoted tasks since last session: tasks joined to stream items where `promoted_at > last_session_created_at`. These are called out in the brief with placement context.
4. Run `recurring-check` workflow (nested) for recurring tasks due today
5. `getGoals` — active goals with KR progress
6. `getUserProfile` + `getTemporalMemory` — energy patterns, preferences, recent context
7. `getCurrentSession` (yesterday) — planned vs. completed
8. LLM generates: brief (including recently added callout with placement), focus_tasks, active_sort_order, context blocks, overcommitment flag (see Section 8.3 prompt)
9. Apply sort_key updates to active tasks based on the LLM's sort order
10. `createSession` for today
11. `logActivity`

**Agent version** (autonomous reasoning, adapts to edge cases):
A focused agent with the same tools as the workflow, but it reasons through the plan in multiple steps rather than following a fixed sequence. It has a system prompt scoped to daily planning (see Section 8.3) and access to: `getCalendarEvents`, `getAvailableGaps`, `getTasks`, `getGoals`, `getUserProfile`, `getTemporalMemory`, `getCurrentSession`, `updateTask`, `createSession`, `logActivity`, and the `recurring-check` workflow as a composite tool.

The agent decides _what to look at_ based on what it sees. Examples of where this produces better results:

- Sees a packed calendar → skips deep work planning entirely, focuses only on quick wins for gaps
- Notices a task deferred 4 days in a row → checks memories for avoidance pattern before promoting
- Sees user returning after 3-day gap → autonomously scopes down to 1-2 items, "welcome back" framing
- Finds conflicting priorities across goals → reasons about tradeoffs and presents the choice

**How to compare:** Give both versions the same inputs (same tasks, calendar, memories, history). Compare: plan quality, adaptiveness to edge cases, LLM cost, latency, predictability. The workflow is the baseline. The agent should beat it on edge cases or the extra cost isn't worth it.

**5. `radar-scan`** — Detect stale projects, deferrals, approaching deadlines, etc.

1. `getTasks` — all active tasks
2. Rule-based queries (see Section 8.4): stale projects, 3+ deferrals, approaching deadlines, missing next actions, blocked task follow-ups, boomerangs
3. Working set growth check: if active task count exceeds ~50, surface the bottom 10-15 by sort_key for review (defer, archive, or keep)
4. For blocked tasks: LLM reads `blocked_on` text, cross-references recent completions/captures to check if blocks are resolved
5. For avoidance candidates (3+ deferrals): LLM generates gentle suggestions
6. `logActivity` — record all radar items

**6. `weekly-pulse`** — Retrospective + forward look

1. `getCompletions` + completed tasks for the week
2. `getRecentActivity` — week's patterns
3. `getGoals` — progress on KRs
4. `getUserProfile` + `getTemporalMemory` — existing patterns + recent context
5. LLM generates: retrospective, wins, patterns, forward priorities
6. `updateUserProfile` if new patterns worth promoting (weekly pulse doubles as a memory-update trigger)
7. `logActivity`

**7. `recurring-check`** — Check recurrence tasks, surface due ones, update streaks

1. `getTasks` where `recurrence IS NOT NULL AND next_recurrence_at <= today`
2. For each: `getCompletions` in current period
3. LLM reads recurrence text + completions, determines which tasks are due
4. If due and completions < target_frequency → AI weaves into daily plan alongside top one-time tasks
5. If completions >= target_frequency → AI recomputes `next_recurrence_at` to next period
6. Recompute streaks from completion log → `updateTask` cached values

**8. `memory-update`** — Synthesize daily observations into long-term profile (weekly cron)

1. `getTemporalMemory` — last 14 days of temporal memory rows
2. `getUserProfile` — current USER.md content
3. `getRecentActivity` — corrections, overrides, deferrals
4. LLM analyzes: patterns worth promoting to USER.md? Existing entries contradicted by recent evidence? Stale observations to remove?
5. `updateUserProfile` if changes needed
6. `logActivity` — "Updated USER.md: Added effort calibration for design tasks"

**9. `task-complete`** — Handle task completion (triggered by "Done" action or chat agent)

1. `getTask(id)` — determine if one-time or recurring (`recurrence` field)
2. **If one-time:**
   a. `updateTask(id, { status: 'done', completed_at: now })`
   b. If task has `parent_id` → `updateTask(parentId, { last_progress_at: now })`
   c. If parent's active children count is now 0 → surface parent in next radar pass (missing next action)
3. **If recurring:**
   a. `logCompletion(taskId, note?)` — immutable event
   b. `getCompletions(taskId)` for current period
   c. If completions >= `target_frequency` → AI recomputes `next_recurrence_at` to next period
   d. If completions < `target_frequency` → task remains due this period
4. AI re-sorts remaining active tasks if the top of the sort is thin
5. `logActivity` — record completion

#### Services (Background Processes)

Deterministic processes that run on schedules or triggers. Not AI agents — they don't make decisions. For local deployment, these likely run on a separate Node process with cron scheduling. Implementation details will be refined as we build.

| Service                 | Trigger                        | What it does                                                                                                                                                     |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CalendarSyncService** | Periodic (configurable)        | Pulls events from Google Calendar API, caches to `calendar_events`, recomputes available gaps                                                                    |
| **NotificationService** | Periodic                       | Queries `reminder_at <= now`, fires browser Notification API, nulls `reminder_at` after firing (one-shot). Also checks `hard_deadline` within warning threshold. |
| **EmbeddingService**    | On capture + significant edits | Generates embeddings via configured provider, stores in `vec_embeddings`. Called by the triage workflow, not independently scheduled.                            |

#### The Chat Agent

The chat agent is an **autonomous loop with multi-step reasoning** — not a 1-shot tool caller. It receives a goal or message, reasons about what tools to call, observes results, and iterates until it has a complete answer. The agent loop framework is swappable (Mastra agent, Pi agent-core, Vercel AI SDK, or custom); the behavior is defined by the system prompt, available tools, and the business logic functions underneath.

**The philosophical direction:** AI is trending toward more autonomy — give the model a goal and let it reason freely, rather than hard-coding sequences. The chat agent should feel like a knowledgeable partner that figures out what to look at, not a menu of commands. Today's structured workflows provide reliability; as models improve, the agent may compose the same steps from atomic tools without needing predefined workflows. The architecture supports both modes — the agent can call composite workflow tools for reliability, or chain atomic tools for novel situations the developer didn't anticipate.

**System prompt includes:**

- User state (scope, energy, available time, engagement level)
- Today's plan summary (from current session)
- USER.md content (long-term memory)
- Recent `temporal_memory` rows (temporal context)
- Recent activity summary

**Tool access:** All domain tools (atomic + composite workflow tools). No raw computer-access tools (bash, file I/O) — the chat agent interacts with the system exclusively through the business logic layer. This guarantees audit logging, validation, and embedding updates on every operation. From the agent's perspective, `streamCapture(rawText)` is a single tool call that runs the full triage pipeline under the hood.

**Multi-step reasoning examples:**

- "What do I need to prep for my meeting with Jake?" → `getCalendarEvents` (find Jake meeting) → `search` ("Jake" + related project) → `getTasks` (blocked_on mentions Jake) → synthesize prep list
- "Move all Bounce tasks to next week" → `search` ("Bounce") → show preview of matched tasks → on confirmation, batch `updateTask` with new `resurface_after`
- "I'm feeling low energy today" → `updateUserState` (energy = light) → run `deck-generate` filtered to light → present updated deck
- "Add a task: call the dentist tomorrow" → invoke `stream-capture` workflow → urgency detected ("tomorrow") → immediate processing → return result
- "I'm feeling overwhelmed" → agent _autonomously decides_ to check task count, calendar load, recent deferrals, user profile energy patterns, then synthesizes a response. Nobody coded this sequence — the model composed it from available tools.

**Guardrails:**

- Destructive actions (delete, archive, bulk move) require user confirmation before executing
- Bulk operations show a preview: "Found 12 Bounce tasks. Move all to next week?"
- All agent actions are logged to `agent_activity` — the user can see exactly what the chat did and undo any action
- The agent explains its reasoning: "I searched for tasks mentioning Jake and found 3 blocked items and 2 related notes."

**Model tier:** Standard (needs reasoning but user is waiting — must be fast with streaming). See Section 8.8.

#### Stage 2: Executor Agent (Future)

When tasks are delegated to AI (Stage 2), a separate **executor agent** handles them. This is a different agent instance with a different tool set and system prompt — it gets computer-access tools (bash, web browse, file I/O) because general-purpose execution is the point. It runs in a sandbox, operates on a specific delegated task, and reports results back to Eon for human review. The executor agent is a natural fit for a Pi-style autonomous loop — goal-driven, unbounded step count, full computer access. The chat agent never needs these capabilities; it only needs domain tools.

### File Structure

```
/app                              -- Next.js routes
  /page.tsx                       -- Today view (deck + plan + chat)
  /projects/page.tsx              -- Projects view (filtered lens on tasks with children)
  /notes/page.tsx                 -- Notes view (browse/search all notes)
  /routines/page.tsx              -- Routines view (filtered lens on recurring tasks)
  /everything/page.tsx            -- Everything view (safety valve)
  /decisions/page.tsx             -- Decisions view (pending + made)
  /calendar/page.tsx              -- Calendar view
  /activity/page.tsx              -- Agent activity log
  /settings/page.tsx              -- Settings (API keys, model tier mapping, preferences)
  /api/                           -- API routes
    /stream/route.ts              -- Stream endpoints (add, dismiss, list recent)
    /capture/route.ts             -- Capture endpoint (invokes stream-capture workflow)
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
      stream-repository.ts        -- StreamRepository interface
      task-repository.ts          -- TaskRepository interface
      note-repository.ts          -- NoteRepository interface
      area-repository.ts          -- AreaRepository interface
      decision-repository.ts      -- DecisionRepository interface
      goal-repository.ts          -- GoalRepository interface
      session-repository.ts       -- SessionRepository interface
      activity-repository.ts      -- ActivityRepository interface
      memory-repository.ts        -- MemoryRepository interface (USER.md file + temporal_memory table)
      embedding-store.ts          -- EmbeddingStore interface
    sqlite/                       -- SQLite implementation of all interfaces
      stream.ts
      tasks.ts
      notes.ts
      areas.ts
      decisions.ts
      goals.ts
      sessions.ts
      activity.ts
      memory.ts
      embeddings.ts
    factory.ts                    -- createRepositories(config) → concrete implementations
    // Future: /markdown, /postgres — alternative backend implementations (actively planned)

  /ai/
    tools/                        -- Business logic functions (pure TypeScript, zero framework imports)
      stream.ts                   -- createStreamItem, getStreamItems, dismissStreamItem, updateStreamStatus
      tasks.ts                    -- getTasks, getTask, createTask, updateTask, moveTask, etc.
      notes.ts                    -- Note CRUD
      areas.ts                    -- Area CRUD
      decisions.ts                -- Decision CRUD
      goals.ts                    -- Goal CRUD
      search.ts                   -- search (hybrid FTS5 + vector), findSimilar
      calendar.ts                 -- getCalendarEvents, getAvailableGaps, getAvailableMinutes
      user-state.ts               -- getUserState, updateUserState
      memory.ts                   -- getUserProfile/updateUserProfile (file I/O), getTemporalMemory/upsertTemporalMemory (SQLite)
      activity.ts                 -- logActivity, getRecentActivity
      sessions.ts                 -- getCurrentSession, createSession, updateSession
      completions.ts              -- logCompletion, getCompletions
    workflows/                    -- Composite async functions (chain tools + LLM reasoning, no framework imports)
      stream-capture.ts           -- Raw text → stream + urgency check → immediate processing if urgent
      stream-batch.ts             -- Burst-end batch: classify marinating items, note grouping, note-append
      stream-sweep.ts             -- Daily sweep of remaining unprocessed items (runs within daily-brief)
      task-complete.ts            -- Handle completion (one-time vs recurring, parent update, deck refill)
      deck-generate.ts            -- State → ranked deck (rule-based, no LLM)
      deck-rerank.ts              -- Rule-based deck → LLM-reranked with rationale
      daily-brief.ts              -- Morning orchestration → plan + promotions + context blocks
      radar-scan.ts               -- Detect stale projects, deferrals, deadlines, etc.
      weekly-pulse.ts             -- Retrospective + forward look
      recurring-check.ts          -- Check recurrence, promote due tasks, update streaks
      memory-update.ts            -- Weekly synthesis: temporal_memory rows → USER.md updates
    prompts/                      -- Prompt templates (per-workflow, per-agent)
    adapters/                     -- Framework-specific tool wrappers (Zod schemas for Mastra, TypeBox for Pi, etc.)
      index.ts                    -- Adapter factory: wrapToolsForFramework(framework, tools) → adapted tools
    agent/
      config.ts                   -- Agent loop configuration (model routing, system prompt assembly, tool registration)
      chat.ts                     -- Chat agent setup (system prompt, tool set, guardrails)
      daily-brief.ts              -- Daily brief agent (alternative to workflow, see Section 9 Agent Architecture)
    skills/                       -- Domain knowledge files (SKILL.md, Agent Skills spec)
      planning/SKILL.md           -- How Eon approaches daily planning (priorities, energy, calendar, overcommitment)
      triage/SKILL.md             -- How to classify stream items, promotion heuristics, sort placement, task title conventions
      avoidance/SKILL.md          -- How to detect and respond to avoidance (gentle, break down, offer outs)
      memory/SKILL.md             -- When to write temporal_memory, when to update USER.md, what belongs where
      recurring/SKILL.md          -- How recurrence works, period boundaries, streak philosophy
      decisions/SKILL.md          -- How decisions flow (pending → made), blocking patterns, routing context
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
  /stream/                    -- Stream view, recent captures, dismiss/promote actions
  /capture/                   -- Capture input, brain dump mode, toasts, correction chips
  /deck/                      -- Now deck sorted list, item actions, rationale
  /plan/                      -- Daily brief, context blocks timeline
  /radar/                     -- Radar feed entries
  /projects/                  -- Project list, detail, next actions
  /routines/                  -- Recurring task list, streaks, consistency
  /calendar/                  -- Calendar view, gap highlights
  /activity/                  -- Agent activity log
  /chat/                      -- Chat interface
  /settings/                  -- API key config, model tier mapping, preferences
  /layout/                    -- Three-column shell, panel system, draggable divider, tab management
  /shared/                    -- Pills, badges, common UI elements

~/.eon/                             -- User data directory (local-first)
  data.db                           -- SQLite database (entities, temporal memory, embeddings, audit)
  USER.md                           -- AI's long-term user profile (the one file outside SQLite)
  attachments/                      -- File attachments by task ID
    {task_id}/
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
- The core execution loop (deck reads from AI-sorted list) is rule-based and free — no LLM required on every read.
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

### Phase 1: Foundation + Stream + Capture

**Goal:** You can dump things in and they get auto-organized. This alone is valuable.

**Build order:** Schema → repository interfaces + SQLite implementation → business logic functions (tools) → tool adapters → agent loop setup → `stream-capture` + `stream-batch` workflows → chat agent (with Phase 1 tools only) → API routes → UI

**Infrastructure:**

- SQLite schema setup with migrations (stream, areas, tasks, notes, support tables). FTS5 indexes on tasks and notes for keyword search. `sqlite-vec` extension loaded for vector search.
- Repository interfaces + SQLite implementation (data access abstraction from day one)
- LLM provider abstraction + model routing from user config
- Tool adapter layer (framework-specific wrappers for business logic functions)
- Agent loop setup (Mastra for MVP — swappable later)
- Settings UI (API key config, model-to-tier mapping, embedding model selection)

**Tools introduced:** `createStreamItem`, `getStreamItems`, `dismissStreamItem`, `getArchivedStreamItems`, `restoreStreamItem`, `createTask`, `updateTask`, `getTasks`, `getTask`, `createNote`, `updateNote`, `getNotes`, `getNote`, `createArea`, `updateArea`, `getAreas`, `search`, `findSimilar`, `logActivity`, `getRecentActivity`

**Workflows introduced:** `stream-capture`, `stream-batch`

**Agent introduced:** Chat agent — with access to only the tools and workflows that exist in this phase. Additional tools are added as phases land.

**Features:**

- Stream UI: slim, scannable list of recent captures with AI annotations (always accessible, one gesture away)
- Capture input UI (global text box, Cmd+K shortcut) → items land in stream
- Brain dump mode (Cmd+Shift+K) → larger text area, batch processing on close
- `stream-capture` workflow: raw text → stream → urgency check → immediate processing if urgent, marinate if not
- `stream-batch` workflow: process burst of captures together — note grouping, note-append detection, batch classification
- Semantic search: search bar queries both FTS5 (keyword) and `vec_embeddings` (semantic), merged and ranked by relevance
- Chat agent for natural language interaction (capture via chat, search, basic task management)
- Basic task list grouped by area, with orphan section
- Basic notes list grouped by area, with orphan section
- One-tap correction chips on promoted items (including flip task/note, reassign, separate/move between notes)
- One-tap dismiss on stream items
- Area CRUD (manual for now, with status: active/inactive/archived)
- Agent activity log (write-only for now)

**Success:** Capture feels instant — like texting yourself. Urgent/time-sensitive items are processed immediately. Everything else marinates — the user might handle it themselves, more context might arrive, or the batch pass classifies it with full context. The stream feels like working memory, not an inbox. Nothing silently sinks.

### Phase 2: The Now Deck + Notifications

**Goal:** You open the app and immediately know what to do. Time-sensitive tasks alert you.

**New tools:** `moveTask`, `getUserState`, `updateUserState`

**New workflows:** `deck-generate`, `task-complete`

**New services:** NotificationService

**Features:**

- `deck-generate` workflow: reads from top of AI-sorted active list, rule-based multi-factor ranking, returns sorted list of up to 10 items + recently added
- Scope pill + energy toggle (Deep | Light)
- Deck item actions: Done, Snooze, Not Today, Blocked
- Boomerang resurfacing logic (tasks reappear after resurface_after)
- Parent task as "project" display (tasks with children show project-like UI)
- User state management (singleton row)
- NotificationService: browser Notification API triggered by `reminder_at`. AI auto-sets reminders from time-specific capture language ("at 3pm", "before the meeting").
- File attachments: attach photos, files, screenshots to tasks. Stored in `~/.eon/attachments/`. Rendered inline in task body.

**Success:** The deck serves useful recommendations without LLM. Time-to-start-work < 10 seconds. "Pick up kids at 3pm" actually alerts you at 3pm.

### Phase 3: AI-Powered Deck + Daily Brief

**Goal:** The AI becomes your chief of staff, not just a scorer.

**New tools:** `createGoal`, `updateGoal`, `getGoals`, `getGoal`, `getCurrentSession`, `createSession`, `updateSession`, `getUserProfile`, `updateUserProfile`, `getTemporalMemory`, `upsertTemporalMemory`, `findSimilar` (temporal memory embeddings)

**New workflows:** `deck-rerank`, `daily-brief`, `memory-update`

**Features:**

- Goals CRUD and review flow
- `deck-rerank` workflow: LLM rerank (sorted list + rationale for #1, goal-aware)
- `daily-brief` workflow: natural language brief + context blocks, goal-aware
- Today view with plan + timeline + deck + chat
- Session recording (what was planned vs. completed)
- Adaptive capacity & tone: user state signals injected into all LLM prompts (engagement, capacity, patterns)
- Dynamic focus set sizing (1-2 items when overwhelmed, 5-7 when in flow)
- Temporal memory: AI writes daily observations to `temporal_memory` table during interactions, reads USER.md + recent rows for context. Each row gets a vector embedding for semantic retrieval.
- `memory-update` workflow (weekly cron): synthesizes `temporal_memory` rows into USER.md long-term patterns. Also triggered immediately for explicit user declarations.

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

- `radar-scan` workflow: stale parent tasks, repeated deferrals, approaching deadlines, missing next actions, completion debt, blocked task follow-ups
- Radar UI with action buttons (Revive, Snooze, Archive)
- Avoidance detection and gentle response
- Heartbeat logic for tasks with children (project pulse)
- Deep sort scan surfacing for long-unseen tasks that should rise in priority
- Gentle decay for old low-intent captures
- `memory-update` workflow: weekly cron synthesizes `temporal_memory` rows into USER.md (deferral patterns, session analysis, time-of-day preferences, effort calibration)
- "What I've Learned" view: renders USER.md — user can also just open `~/.eon/USER.md` in any editor
- Memory injection into all AI prompts: USER.md content + recent `temporal_memory` rows injected into triage, deck, daily brief, radar prompts

**Success:** The weekly review is replaced by a continuous radar drip. Nothing important gets lost. The AI visibly gets smarter over time.

### Phase 6: Recurring Tasks + Weekly Pulse

**Goal:** Full daily and weekly rhythm managed by AI.

**New tools:** `logCompletion`, `getCompletions`

**New workflows:** `recurring-check`, `weekly-pulse`

**Features:**

- Recurring task support (tasks where `recurrence IS NOT NULL`)
- `recurring-check` workflow: period-based completion tracking via `task_completions`
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
- Sort view: visual representation of the AI-sorted active list, optionally grouped by area or sort ranges. Drag to reorder = sort position changes. Gives spatial overview and builds trust — "I can see everything the AI decided."
- Decisions view: pending decisions at top (grouped by area), made decisions below (searchable, filterable). Pending decisions show which tasks they block.
- Status overview: counts by status (active, done, archived), counts by area, active goals with KR progress, pending decisions, blocked tasks with duration. "What's going on at a glance."
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
- Batch mode for the deck: when doing repetitive process work, show a filtered queue of similar tasks for rapid processing

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
| Time to capture (stream)             | < 2 seconds median                              | Capture friction → system abandonment     |
| Time to start work                   | < 10 seconds after opening                      | The blank page problem is solved          |
| Deck hit rate                        | > 60% of sessions, user acts directly from deck | AI recommendations are useful             |
| Fake deadline ratio                  | Approaches 0%                                   | Snooze loop is eliminated                 |
| Weekly active usage without "review" | Sustained                                       | Zero-maintenance promise holds            |
| Stream items per week                | Steady or growing                               | User trusts the system as universal capture |
| Overdue count                        | Near zero (only real deadlines)                 | "Overdue" means something                 |

### Trust Signals

| Signal                                      | What It Means                |
| ------------------------------------------- | ---------------------------- |
| User override rate decreasing over time     | AI is learning and improving |
| Agent activity viewed but rarely overridden | AI decisions are trusted     |
| "Show everything" view accessed < 1x/week   | User trusts the filter       |
| Promotion correction rate decreasing        | Triage accuracy improving    |

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
| **AI processing accuracy < 70%**      | Users stop trusting capture, revert to manual | AI only detects urgency at capture time (easy problem), defers classification to batch pass with full context (higher accuracy). One-tap correction chips. Log all corrections to improve prompts.                                     |
| **LLM latency makes deck feel slow**  | Breaks the "10 second" promise                | Show deterministic deck instantly, refine with LLM async. Cache recent deck.                                                                                                                                                           |
| **Overcapture anxiety**               | System feels like a guilt ledger              | Stream items decay naturally. Not every capture becomes an entity. Gentle decay for old tasks. Batch dismiss in Radar. No backlog counter. Stream has no badge count.                                                                   |
| **AI hallucinated JSON**              | Broken pipeline                               | Strict JSON schema validation. Retry with "fix JSON" prompt. Store raw outputs for debugging.                                                                                                                                          |
| **Calendar OAuth complexity**         | Blocks Phase 4                                | Calendar is optional. App works fully without it. Manual event entry as fallback.                                                                                                                                                      |
| **Cold start (no data)**              | First experience feels empty                  | Guided onboarding: "Tell me about your projects." Seed with common areas. Make first capture feel magical.                                                                                                                             |
| **User doesn't trust "black box" AI** | Ignores recommendations, uses as dumb list    | Agent Activity view. Rationale on #1 item. "Why this?" expandable on any deck item. Override everything.                                                                                                                               |
| **AI inference costs add up**         | Users surprised by API bills                  | Users bring their own keys and choose models per tier. Show estimated cost per operation in settings. Default to cheapest viable model. Rule-based deck ranking keeps the core loop free. Local models (Ollama) as zero-cost fallback. |

---

## 15. Open Questions

These are safe to defer but worth tracking:

1. **How explicit should area setup be?** Should the user define areas upfront, or should the AI infer them from captured tasks? (Recommendation: light onboarding to seed 3-5 active areas. Total areas can be unlimited — most start as inactive. AI suggests activating or creating areas over time.)

2. **How aggressive should decay/archiving be?** When should old low-intent tasks auto-archive? (Recommendation: 90 days untouched at the bottom of the sort -> archive. AI asks first.)

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

- **Saved / smart filters.** User-defined filtered views ("all deep-work tasks in Bounce," "everything blocked on Jake"). Enables power-user workflows without cluttering the default experience.
- **Eisenhower matrix view.** A focused visualization tool for when the user is splitting hairs — not a core organizing principle. Shows the top of the active sort (typically 8-12 items), plotted on a 2x2 grid. X-axis (urgency) derived from `hard_deadline` proximity, `times_deferred`, `resurface_after`, age. Y-axis (importance) derived from goal alignment, area context, `user_context`, `ai_context`. No urgency/importance fields are added to the schema — sort position already encodes these dimensions implicitly. User drags tasks between quadrants to override — overrides translate to sort_key changes, corrections noted in `temporal_memory`. Valuable as a communication tool: "Is the AI seeing things the way I see them?" Not useful at scale (100+ tasks) — the deck and sort handle that.
- **Project sections / headings.** Grouping tasks within an area into logical sections (e.g., "Launch Prep," "Post-Launch") without creating sub-areas.

**Planning & Focus**

- **Drag-to-schedule (time blocking).** Drag tasks onto the internal calendar to assign them to specific time slots. AI pre-populates suggestions; human adjusts.
- **Pomodoro / focus timer.** Built-in timer that pairs with the current top deck item. Tracks focus sessions per task. Optional — some users swear by it, others ignore it.
- **2-minute rule prompt.** During triage, if AI estimates a task at < 2 minutes, prompt: "This is quick — do it now?" Reduces backlog accumulation for trivial items.

**Analytics & History**

- **Habit heatmap.** GitHub-style contribution grid for recurring tasks. Visual streak tracking and consistency patterns over time.
- **Productivity analytics dashboard.** Weekly/monthly views: tasks completed, time in deep work, areas of focus, completion velocity, energy patterns.
- **Completion counts in weekly pulse.** "You completed 23 tasks this week, 8 were deep work" — adds a sense of progress to the existing radar pulse.

**Data & Editing**

- **Note-to-note linking.** Wiki-style `[[note title]]` links between notes. Builds a knowledge graph over time. Useful for decision trails and project context.
- **Bulk edit operations.** Multi-select tasks to re-sort, re-assign area, or archive in batch. Essential once task count exceeds ~100.
- **Import agent.** An agent that can iterate through any external source (Todoist export, Asana CSV, Apple Reminders, Things 3 JSON, plain text lists) and convert items into Eon's schema. Not a one-time migration — the agent should handle incremental imports and deduplication against existing tasks.

**Interaction**

- **Visual planning canvas.** A drag-and-drop daily/weekly planning surface where the AI pre-populates a suggested schedule based on priorities, energy, and calendar gaps. The user drags to rearrange, confirms the plan, and the deck follows it. Think of it as the bridge between "AI recommends" and "I commit to a sequence." Schema supports this via `sessions.ai_plan` (JSON block plan) and task `sort_key` for ordering.
- **Natural language commands.** "Move all my Bounce tasks to next week" or "Archive everything at the bottom of my sort older than 6 months." Power-user shortcut layer on top of the chat interface.

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
- **Proactive nudges.** Push notifications when the AI detects something important: "You have a meeting with Jake in an hour and 3 blocked-on tasks for him." "Registration for the conference closes tomorrow — you've been sitting on this for 2 weeks."
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
