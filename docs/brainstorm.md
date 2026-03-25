BRAINSTORM 1

Gemini said
This is a profound realization about the state of modern work. You have identified a critical friction point: GTD was built for a static world, but you are operating in a fluid, AI-accelerated workflow.

The "Queue" model fails because it assumes linear processing. Your reality—and the reality of anyone using AI heavily—is parallel processing. You trigger an agent, wait, switch context, trigger another, and suddenly you have three "active" threads and a 5-minute gap. A static list cannot handle that topology.

Here is a blueprint for a system that solves the "Stare," kills the "Snooze Loop," and handles the "AI Gap."

The Core Concept: The AI Dispatcher
We move away from a user-managed List to an AI-managed Stream.

In this system, you do not "manage" the queue. You own the Input (dumping) and the Execution (doing). The AI owns the Dispatch (sorting, retrieving, and surfacing).

Here is how we structure the architecture to make it effortless.

1. The Data Model: Multi-Dimensional Tagging (Invisible)
   The user should never fill out a form. They just dump text/voice. The AI automatically tags the item with four invisible dimensions that determine when it surfaces.

Context (Where/Mode): Deep Work (Coding), Rapid Fire (Email/Slack), Physical (Errands), Gap (5-min filler).

State: Active, Waiting (AI), Waiting (Human), Incubating.

Hard vs. Soft Time:

Hard: "Tax filing due April 15" (Must be done).

Soft: "Check out that new JS library" (Resurface in 2 weeks).

Payload: High Mental Load vs. Low Mental Load.

2. The Interaction Model: "Gap Filling" & Context Switching
   This addresses your specific pain point of waiting on AI code generation. The system needs distinct Modes that the AI switches between based on your behavior.

Mode A: The Deep Focus (Project View)
When you pick a major project (e.g., "Build Auth System"), the AI hides everything else. You see only the next 3 steps for that project.

The "Wait" Trigger: When you hit a blocker (e.g., "Waiting for Cursor/Replit to generate code"), you click a "Waiting" button on that task.

The Switch: The system immediately slides in a "Gap Task."

Mode B: The Gap Filler (Micro-Task View)
This is the solution to the "bouncing around" problem. These are tasks tagged as Low Mental Load + Short Duration.

Scenario: You are waiting 3 minutes for a build. The AI surfaces: "Review that one PR" or "Reply to the structural engineer email."

Result: You utilize the "wait time" without breaking flow, because the AI served it to you. You didn't have to go look for it.

3. Solving the "Snooze Fatigue" (The Date Problem)
   We need to banish the behavior of bumping a date 20 times. We do this by separating Deadlines from Resurfacing.

The Calendar is Sacred: Only items with real-world consequences (flight check-in, tax deadline) get a "Due Date."

The "Boomerang" Function: For everything else (ideas, "check in on X"), you assign a Resurface Interval.

User Input: "Remind me to look at the stair rail gaps again in a week."

System Action: The item vanishes. It does not exist in your view. It does not turn red.

Resurface: On Day 7, it appears in a specific "Incoming" slot. You have two choices: "Do Now" or "Boomerang (throw it back for 2 weeks)."

The Safety Valve: If you Boomerang something 3 times, the AI asks: "You've bumped this 3 times. Should we move this to the 'Someday/Maybe' archive?" This prevents the list from rotting.

4. The "Morning Briefing" (User Experience)
   To avoid the "30-minute weekly review" drudgery, the AI does a Nightly Triage.

The Scan: The AI looks at your calendar, your "Active" projects, and your "Boomerang" items.

The Pitch: When you sit down in the morning, instead of a list of 50 items, you get a chat message:

"Good morning. You have 2 hours of Deep Work time before your first call.

Primary Focus: Continue the landing page backend (Context: Project X).

Urgent: Your wife needs the registration link for the kid's event by noon.

Backlog: If you have gaps, I've queued up 3 quick code reviews.

Ready to start?"

You just say "Yes" or "Switch Primary to Project Y." The AI constructs the view for the day.

5. Implementation Strategy
   To build this, you don't need complex UI columns. You need a chat interface for input and a "Card Stack" for output.

Input: A global hotkey. You type: "Need to fix the roof shingles, call the roofer next week." -> AI parses to: Task: Call Roofer, Context: Admin, Resurface: +7 days.

Output: A single column that changes based on your manually selected "Mode."

Button: "I'm Coding" -> Shows coding tasks + "Gap" fillers.

Button: "I'm Tired / Admin" -> Shows low-energy tasks + email replies.

Summary of the Workflow
Dump: You speak/type anything. AI tags it.

Hide: Anything not immediately relevant is hidden.

Detect: You tell the system your current context ("I'm coding" or "I have 15 mins").

Serve: The AI serves the top 3 items for that context.

Wait/Switch: If you block on a task, the AI instantly fills the void with a low-friction task.

Does this distinction between "Hard Deadlines" and "Resurfacing," combined with the "Gap Filling" mechanic, feel like it solves the friction you're feeling?

You said
Do you agree with the problems I recognize? What are problems other people may have that I am blind to?

How I think about companies/areas, projects, and tasks -> each of these can have some kind of priority on them and that also may shift depending on progress or blockers

Also how to incorporate habits or daily things we want to do.

It also needs to be calendar aware.

Gemini said
I absolutely agree with the problems you’ve recognized. The "maintenance tax" of traditional systems kills momentum. You are spot on about the parallel processing of modern work, especially when leveraging AI—you're no longer doing one thing at a time; you're orchestrating multiple threads.

Here is a breakdown of your blind spots, how to map your hierarchy, and how to seamlessly weave in habits and calendar constraints.

1. The Blind Spots: What Others Face That You Might Not
   As a highly autonomous founder who is comfortable bouncing between code, AI prompts, and personal life, your primary friction is context switching and AI wait times. Here is what other user profiles struggle with:

The Human Dependency Hell: You are waiting on AI to write code, which takes minutes. Corporate managers or agency workers wait on humans, which takes days. Their blockers require "follow-up" mechanics, tracking who has the ball, and managing the political capital of nagging.

The "Manager Schedule" vs. "Maker Schedule": You can fluidly move tasks around your day. Many people are locked into a grid of 30-minute meetings from 9 to 5. They don't have "gaps" to fill with a quick code review; they have 4 minutes between Zoom calls where their brain is fried. Their system needs to prioritize low-energy survival tasks in those gaps.

Shared/Delegated Chaos: When tasks aren't just for you, but are assigned to a team, the system needs to manage permissions, visibility, and hand-offs without creating a secondary layer of administrative hell.

2. The Hierarchy: Areas -> Projects -> Tasks (and Shifting Priorities)
   Your instinct on the hierarchy is exactly right, but it needs an engine to manage the shifting state of these items automatically.

Areas (The Infinite Buckets): These are ongoing domains with no end date. Think of your startup studio Dynamism, or your Personal/Home life.

Projects (The Goals): These live inside Areas and have a definition of "done." This could be launching 1LLM, pushing an update to Remi, or finally getting the roof shingles sealed correctly.

Tasks (The Execution): The molecular steps. Setting up an OAuth vault, or calling the structural engineer.

How Priorities Shift Dynamically:
Instead of a static "High/Medium/Low" priority, the system uses what we can call the Vibes of the project—its momentum and current state.

If the 1LLM project is marked "Active" but a task hits a Blocker (e.g., waiting on an API approval), the AI immediately downgrades the immediate priority of that whole project branch and elevates tasks from WhereAt or Orbit to fill your active work block.

You don't manually reshuffle the deck; the AI recognizes the blocker and deals you a new hand from your active projects.

3. Incorporating Habits and Daily Routines
   Habits fail in standard task managers because checking off "drink water" or "read for 20 minutes" next to "deploy production database" creates cognitive dissonance. They are fundamentally different things.

Tasks are to be completed and destroyed.

Habits are to be maintained.

The Solution: Habits shouldn't live in the queue; they should live in the environment.
If you want to read daily, the AI doesn't put it on your task list. Instead, it looks at your calendar, sees a 30-minute gap after lunch, and simply blocks it out: "Reading Time." If a spouse's nursing shift changes and your morning routine gets scrambled, the AI fluidly moves that habit block to the evening. It treats habits as elastic calendar events, not to-do items.

4. The Ultimate Constraint: Calendar Awareness
   A task system that doesn't talk to your calendar is a fantasy. Time is the physical constraint of reality.

Timeboxing by Default: If a task takes 2 hours, the AI must look at your day. If you only have 45 minutes between calls, it will not surface that task. It will surface three 15-minute tasks instead.

The Hard Buffer: If registration for a kid's event closes at 3 PM, the AI looks at your calendar, sees you are free at 1 PM, and forcefully injects it into your current context. "Pardon the interruption, you need to do this now before your 2 PM block."

The Synthesis
When you sit down at your computer, you aren't looking at a database of Areas, Projects, and Tasks. You are looking at a clean, AI-curated dashboard that says:

"You have a 2-hour clear block. Your primary focus is Remi. Here are the next three steps. If you hit a blocker, I have two quick emails queued up for you. Also, don't forget your habit: take a 10-minute walk at 2 PM."

Would you like to explore what the specific UX/UI of this daily "AI briefing" interface should look like so it feels completely frictionless?

You said
Zoom out and tell me how this whole things takes shape

Gemini said
To zoom out, we have to stop thinking of task management as a Storage System (a place where lists go to die) and start thinking of it as a Routing Engine (an active logistics network for your attention).

Here is how the entire ecosystem takes shape, from the moment an idea enters your head to the moment it gets executed, seamlessly integrating your work, your habits, and your reality.

Phase 1: Zero-Friction Capture (The Input)
You never open a form. You never manually set a priority, assign a project tag, or pick a due date from a calendar widget.

You just dump data.

Voice/Text: "I need to follow up on the white oak stair rails, they still aren't aligned."

System Action: The AI intercepts this. It understands the natural language, categorizes it into your "Home/Admin" Area, tags it as Low Mental Load and Communication, and silently slots it into the routing engine.

Phase 2: The Invisible Engine (Sorting by "Vibes" and Calendar)
Under the hood, the AI is constantly calculating the geometry of your day. It looks at three things:

The Calendar Constraint: It sees your actual hard constraints. If your wife has an early nursing shift and your morning routine is scrambled, the engine sees that your usual 8:00 AM "Reading" habit needs to be elastically shifted to your 1:00 PM lunch gap.

The Project "Vibes": Instead of static priorities, the system measures momentum. Under the umbrella of Dynamism, maybe 1LLM is currently unblocked and moving fast, while Remi is waiting on some design inspiration. The engine automatically promotes 1LLM tasks to the top of your deep work blocks because the vibes are active.

The Context Geometry: It maps tasks by how much brainpower and time they require, preparing them for when you hit different modes during the day.

Phase 3: The Execution (The "Right Now" Interface)
When you sit down at your computer, you do not see a backlog. You see a Chief of Staff briefing tailored to the exact moment.

Scenario: The 3-Hour Deep Work Block

The View: The system surfaces one primary objective. "Focus: Build the OAuth proxy for 1LLM." It gives you the immediate next three technical steps. The noise of everything else is completely hidden.

The AI Wait-State Swap: You prompt an AI coding agent to generate a complex chunk of the vault logic. You now have a 4-minute wait. You hit a simple hotkey (e.g., Space + Tab).

The Gap Filler: The 1LLM code view slides away. The engine instantly slides in a 3-minute, low-context task: "Review the new logo variations for WhereAt" or "Email the roofer about the GAF shingles." \* The Return: The code generation finishes. You clear the gap task, hit the hotkey, and you are instantly dropped back into the deep work context of 1LLM. No momentum lost. No staring at the screen.

Phase 4: The Triage & Boomerang (End of Day)
Things that are not urgent do not clutter your screen.
If you dumped an idea like, "Maybe I should rename the relationship app to Kindred instead of Orbit," but it’s not actionable today, the system boomerangs it. It vanishes.

Two weeks later, during a low-energy Friday afternoon, the system gently surfaces it: "Still thinking about the name Kindred?" You either act on it, or throw it back into the ocean for another month.

The Big Picture Result
The entire shape of the system is a funnel that narrows down to one single point of focus.

Top of Funnel: Massive, chaotic, multi-dimensional dumping ground of startups, house fixes, habits, and fleeting ideas.

The Filter: AI routing, calendar awareness, and project momentum.

Bottom of Funnel (You): A singular, calm interface that just says: "Here is the highest leverage thing you can do right now. Press enter to start."

This eliminates the 30-minute maintenance tax entirely. You just show up, dump thoughts when you have them, and execute what the engine puts in front of you.

Does this routing engine concept feel like the right architectural shape for the platform, or is there a specific phase (Capture, Engine, Execution) you want to drill down into and start designing first?

You said
I'm going to put this into a coding AI. Describe the core conepts of this project and how it should take shape in being built. For now the MVP will just be sqllite and local first. I'll just put my own API keys in. I want to focus on the shape of the data, how AI categorizes, and then how it's realized in the product UI/UX.

Gemini said
Here is the foundational specification you can feed directly into your coding AI (like Cursor, Windsurf, or Replit) to build the local-first MVP.

This architecture avoids the trap of building just another CRUD to-do list. Instead, it defines a Routing Engine backed by a local SQLite database, using your own API keys for the AI categorization layer.

1. Core Concepts for the AI
   Give your coding agent this exact conceptual framing before asking it to write code:

The Goal: Build an AI-driven task routing engine, not a static list manager. The system owns the dispatch; the human owns the execution.

Zero-Friction Input: The user dumps raw, unstructured text. The AI parses it, extracts the metadata, and slots it into the database invisibly.

The "Vibes" Metric: We do not use traditional "Priority" (High/Medium/Low). We use Vibes (momentum/state). If a project like 1LLM or Remi is moving fast, its Vibes are Active. If it hits a blocker, the Vibes shift to Blocked, and the AI automatically down-ranks its tasks.

Context over Backlog: The UI never shows a master backlog. It only shows what is relevant to the user's current context (e.g., Deep Work, 5-Minute Gap, Admin).

Resurfacing over Deadlines: Only tasks with real-world consequences get hard due_dates. Everything else uses a resurface_at timestamp (the "Boomerang" effect).

2. The Data Shape (SQLite Schema)
   Tell your coding AI to generate a SQLite schema using these core tables. Local-first SQLite is perfect here because it's fast, single-file, and easily portable.

SQL
-- The high-level buckets (e.g., Dynamism, Home, Personal)
CREATE TABLE areas (
id TEXT PRIMARY KEY,
name TEXT NOT NULL,
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- The specific goals (e.g., 1LLM Auth Proxy, Remi Landing Page)
CREATE TABLE projects (
id TEXT PRIMARY KEY,
area_id TEXT REFERENCES areas(id),
name TEXT NOT NULL,
vibes TEXT DEFAULT 'incubating', -- active, blocked, incubating, completed
created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- The molecular actions
CREATE TABLE tasks (
id TEXT PRIMARY KEY,
project_id TEXT REFERENCES projects(id), -- Nullable if it's a standalone task
raw_input TEXT NOT NULL, -- The exact words the user dumped
action_title TEXT NOT NULL, -- AI-generated clean title

    -- AI Generated Metadata
    context_tag TEXT,           -- deep_work, admin, quick_gap, physical
    mental_load INTEGER,        -- 1 (brain dead) to 5 (deep focus)
    estimated_minutes INTEGER,

    -- Time constraints
    due_date DATETIME,          -- ONLY for hard deadlines
    resurface_at DATETIME,      -- When the AI should show this again

    state TEXT DEFAULT 'queued', -- queued, active, waiting_on_ai, completed, boomeranged
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP

);

-- For tracking context switches and AI wait times
CREATE TABLE session_logs (
id TEXT PRIMARY KEY,
task_id TEXT REFERENCES tasks(id),
event_type TEXT, -- started, paused, ai_waiting, completed
timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
); 3. The AI Categorization Engine (The Prompts)
When you dump text into the app, your backend will send it to an LLM (via your API key) to extract structured JSON.

Provide your coding AI with this system prompt structure to handle the categorization:

System Prompt for Ingestion:
"You are the routing engine for a busy founder. The user will provide raw text. You must categorize it into a JSON object matching this schema:

action_title: A clear, verb-first task name.

project_name: Infer the project (e.g., if they mention 'API vault', it belongs to 1LLM). If none, leave null.

context_tag: Choose from [deep_work, admin, quick_gap, physical].

mental_load: 1 to 5.

estimated_minutes: Best guess.

is_hard_deadline: Boolean. True only if missing it causes real-world pain (taxes, flights).

resurface_interval_days: If it's just an idea or a check-in, how many days until it should boomerang back?"

4. UI/UX Realization
   Instruct the coding AI to build a minimalist frontend (React/Next.js or raw HTML/JS, depending on your preference) with three distinct zones.

Zone 1: The Dump (Global Input)

A persistent text box or a global hotkey (like Cmd+K or a Spotlight bar).

Interaction: Type "Check the white oak stair rails gaps tomorrow" -> Hit Enter -> The text disappears. Zero friction.

Zone 2: The "Right Now" Dashboard (Primary View)

No lists. The screen shows your current Context Mode (e.g., "Deep Work").

It displays one primary task in the center of the screen based on the highest Vibes project that fits your current time block.

Below it, there are 2-3 "Next Up" tasks.

Zone 3: The "Wait State" Trigger (The Gap Filler)

Next to your active task is a prominent button: Waiting on AI (or Blocked).

Interaction: When you click it, the primary task slides out. The system instantly runs a SQLite query: SELECT \* FROM tasks WHERE context_tag = 'quick_gap' AND mental_load < 3 ORDER BY created_at ASC LIMIT 1.

A low-friction task (like "Review that PR" or "Email the roofer") slides in to fill your 5-minute void.

Next Step
Would you like me to draft the specific Python or Node.js logic that handles the "Boomerang" / resurface_at routing so your agent can implement the cron job or background check perfectly?

You said
In bullet points, summarize the problems we've uncovered in current task systems and as it relates to the current world and how people work. The problem statements and insights should be clearly defined.

Gemini said
Our deep dive into your workflow and the limitations of current systems has revealed several fundamental "Task Management Truths." Here is the summary of the problems we are solving, framed as insights for your build:

1. The Maintenance Tax (System Rot)
   The Problem: Traditional systems (like GTD) require a high level of manual "housekeeping"—tagging, prioritizing, and weekly reviewing.

Insight: Any system that requires more than zero effort to maintain is destined to die. The human should be the Input and the Execution, while the AI should be the Librarian and the Dispatcher.

2. The Linear Queue vs. Parallel Reality
   The Problem: Standard to-do lists assume you work on one thing until it is done. In a modern AI-assisted workflow, you are often managing 3–5 "active threads" simultaneously while waiting for code to generate or agents to respond.

Insight: Work is no longer a "Queue"; it is a Topology. We need a system that handles "Wait States" by instantly surfacing "Gap Tasks" during those 5-minute AI generation windows.

3. The "Snooze Loop" & Deadline Fatigue
   The Problem: We often assign arbitrary due dates to ideas just so they don't disappear. When those dates arrive and we aren't ready, we "bump" them, leading to a compounding list of red, overdue tasks that create paralyzing anxiety.

Insight: We must separate Hard Deadlines (external consequences) from Resurfacing (internal interest). Most tasks shouldn't have a "Due Date"; they should have a "Boomerang Date"—a time when the AI gently checks back in.

4. Context Blindness
   The Problem: A task list is a flat, one-dimensional data set. It doesn't know you’re on your phone at a doctor's office (where you can't code) or that you have a 3-hour deep work block (where you shouldn't be answering emails).

Insight: Productivity is the alignment of Context (Environment + Energy) with Task Requirements. The system must hide everything that is physically or mentally impossible to do in the current moment.

5. The "Blank Page" of Execution
   The Problem: The most draining part of the day is looking at a list of 50 things and deciding which one is "most valuable." This decision fatigue leads to "productive procrastination" (doing easy, low-value tasks to feel busy).

Insight: The human should never have to "choose" from a list. The AI should present the Single Best Action, providing the "Why" (Priority) and the "How" (First Step) to eliminate initiation friction.

6. Fragmented Memory
   The Problem: Ideas for the "stair rail" or "1LLM" are scattered across Slack, notebooks, and mental notes.

Insight: A "local-first" vault that acts as a universal dump allows for Zero-Friction Capture. If it’s in the dump, the user can trust the AI will route it back to them at the exact moment it becomes relevant.

Would you like me to help you define the specific "Vibe Logic" for your SQLite database—essentially the math the AI uses to decide which task is "The Single Best Action" at any given time?

You said
What do youtihnk of this version?

Got it — here’s a comprehensive “final” set with habits explicitly included, plus a couple important gaps (error-tolerance/correction friction, dependencies, meeting loop, unified memory) preserved. This is written as problem statements + crisp insights, in the same style as your draft.

The Problem with Task Management — Comprehensive Final Problem Statements

These are the core truths about why task management systems fail, framed as the problems Eon exists to solve.

1. The Maintenance Tax (System Rot)

Traditional systems require constant housekeeping—tagging, reordering, weekly reviews, moving items between states. The system becomes work. When life gets busy (when you need it most), maintenance is the first thing dropped, and the system collapses.

Insight: Maintenance must be near-zero and continuous, amortized into tiny moments (one-tap corrections), not a weekly ceremony. The human captures and executes; the AI handles routing, upkeep, resurfacing, and pruning.

2. Tasks Are Multi-Dimensional, Tools Are One-Dimensional

Real prioritization depends on time available, energy, environment, urgency, deadlines, dependencies, project importance, and personal context—simultaneously. Flat lists and simple kanban boards can’t represent this, so users do the real prioritization in their head.

Insight: The system must model and reason across multiple dimensions and match work to current constraints, instead of forcing users to collapse reality into a single ordering.

3. Work Is a Topology, Not a Queue

Modern work is interrupt-driven and parallel. People run multiple active threads—waiting on AI outputs, builds, reviews, decisions, and collaborators. Most tools assume serial focus and punish context switching rather than supporting it.

Insight: The system must support active threads, wait states, and “gap tasks” that fit the small windows created by async work.

4. The “What Should I Work On?” Tax (Blank Page Problem)

The most draining moment is opening a list of 50 items and deciding what’s most valuable. Decision fatigue leads to freezing or “productive procrastination” (easy, low-value work to feel busy).

Insight: The system should present a strong recommendation with a short rationale, plus a couple alternates, so the user can sit down and immediately start.

5. Due Dates Get Weaponized as Reminders (The Snooze Loop)

People assign due dates not because something is actually due, but because they don’t want to forget. When it surfaces and they’re not ready, they bump it—creating compounding churn, guilt, and alert fatigue. Over time, “overdue” loses meaning and trust collapses.

Insight: Hard deadlines (external consequences) and resurfacing (internal reminders) are different needs. Most items shouldn’t have due dates; they need “boomerang” resurfacing without guilt or red badges.

6. Context Blindness

Task lists don’t know you’re on your phone, at a doctor’s office, mentally depleted, or that you only have 12 minutes before the next meeting. Without awareness of time, energy, and environment, suggestions are noisy and often impossible.

Insight: Productivity is the alignment of context (time + energy + environment) with task requirements. The default view should filter aggressively to what’s actually doable now.

7. Calendar Ignorance Makes Plans Fiction

People don’t have “8 hours of work time.” They have fragmented gaps around meetings, commutes, and commitments. Without calendar awareness, systems propose unrealistic plans. Worse, meetings generate large amounts of work (prep, decisions, follow-ups) that rarely gets captured reliably.

Insight: The calendar is the constraint layer. The system must compute real capacity, account for buffers/transitions, and close the meeting loop (prep → capture decisions → follow-ups).

8. Over-Commitment Is Invisible Until Failure

Most systems let users add unlimited work without modeling load versus capacity. People can’t see the mismatch until deadlines slip and stress spikes. Task tools often enable wishful planning instead of enforcing tradeoffs.

Insight: The system must model total commitments against real capacity and force explicit choices: “What are we cutting, deferring, or renegotiating?”

9. Waiting-on-Others Is Poorly Modeled

A major portion of work is blocked on other people—reviews, decisions, deliverables. These items shouldn’t clog the active execution view, but they must be tracked and followed up. Most tools treat “waiting” as an afterthought, so items either nag constantly or vanish until too late.

Insight: “Waiting on X” should be first-class: auto-suppress from execution, drive follow-up timing, and surface when relevant (e.g., before a meeting with that person).

10. Dependencies and Blockers Aren’t First-Class

Work is often blocked on prerequisite tasks, documents, approvals, or external events—not just people. Most systems don’t model dependencies, so blocked tasks keep resurfacing, creating noise and frustration.

Insight: Blocked-by relationships must be represented so the system can hide impossible work and prioritize unblockers.

11. Projects Drift Without Maintained Next Actions

A project can be “high priority” indefinitely while making zero progress because the next step isn’t defined. Most tools treat projects as containers, not outcomes with a required next action, so projects stall silently.

Insight: Every active project needs a maintained next action. If none exists, the project is blocked—whether or not the user labeled it that way.

12. Slow-Burn Projects Have No Home

Some meaningful work progresses in tiny increments over months or years. Current systems either bury it forever (lost) or surface it daily alongside urgent work (noise). There’s no middle ground between “forgotten” and “nagging.”

Insight: Slow-burn work needs a heartbeat (“project pulse”) that resurfaces it on an appropriate cadence for check-ins without treating it as overdue.

13. Habits and Tasks Are Fundamentally Different

Tasks are discrete and disappear when done. Habits reset and the value is consistency over time. When habits are crammed into task lists, they either flood the list (noise) or create guilt/backlog artifacts when missed.

Insight: Habits must be modeled as routines with completion windows, minimum viable completion, and forgiving logic—separate from one-off execution queues, but still context- and calendar-aware.

14. Completion Debt Is Invisible (Last-Mile Stalling)

Items that are 80–90% done often sit unfinished because the remaining work is boring, hard, or ambiguous. Starting something new feels productive, but most value is captured at completion.

Insight: The system should detect near-complete work and surface it: “30 minutes finishes this,” paired with a concrete finishing step.

15. Emotional Avoidance Masquerades as Low Priority

Some tasks are deferred repeatedly not because they’re unimportant but because they trigger discomfort—hard conversations, financial paperwork, irreversible decisions. Systems treat deferral as reprioritization and respond by adding pressure, not reducing friction.

Insight: Repeated deferral should trigger a different response: break down the task, reduce scope, offer a smallest first step, and handle the psychology gently.

16. Over-Capture Creates Its Own Anxiety

If capture is truly frictionless, inventory explodes. Without intelligent separation, decay, and pruning, the system becomes a monument to everything undone—turning the backlog into a debt ledger.

Insight: The system must classify low-intent captures, separate “active” from “someday/ideas,” support gentle decay, and enable batch dismissal without guilt.

17. Capture Friction Kills Input

If adding an item requires choosing a project, setting priority, adding tags, and selecting dates, people revert to keeping things in their head. Every field is a decision; decisions are the bottleneck.

Insight: Input must be raw-thought-first. Structure is inferred by AI with optional correction.

18. Correction Friction Kills Trust (Error Intolerance)

AI or categorization will sometimes be wrong. If fixing mistakes is slow or confusing, users stop trusting the system and the AI layer becomes decoration.

Insight: Corrections must be one-tap (reassign, snooze, waiting, not today, never) with undo and an audit trail.

19. Trust Requires Transparency

Opaque “do this next” recommendations feel arbitrary and controlling. Without a clear rationale, users revert to manual control and the system becomes just a list again.

Insight: Every recommendation needs a brief, honest “why” (deadline, gap fit, staleness, unblocker, quick win). Trust compounds through repeated accurate calls.

20. Complex State Kills Adoption

Systems that require many fields—priorities, statuses, tags, effort scores, custom workflows—demand rigor most users can’t sustain. Fields go stale, data becomes unreliable, and the system degrades into noise.

Insight: The fewer fields humans touch, the longer the system survives. Keep state minimal; let AI infer; let users override simply.

21. Cross-Domain Blending Is Reality

Life doesn’t respect “work vs personal.” Time-critical life tasks happen during work hours; work ideas happen off-hours. Systems that force rigid domain separation fail because users live in blended schedules.

Insight: One system must hold all contexts; “scope” should be easy to switch and often inferred, not enforced.

22. Fragmented Memory: Work Scatters Across Tools

Tasks and commitments are born in meetings, email, chat, docs, and random thoughts. Without a unified capture layer, important items slip or require constant manual consolidation.

Insight: The system must act as a universal inbox and memory layer with reliable resurfacing at the moment of relevance.

The Meta-Problem

All of these failures share a root cause: current task systems put the human in the role of both the worker and the system administrator. You do the work and you maintain the system that tracks the work. Eventually the overhead exceeds the value and people revert to mental tracking.

Opportunity: With AI that can parse, categorize, prioritize, schedule, resurface, and prune, the human’s jobs should be: capture freely, decide when needed, and execute what’s presented.

If you want, I can also convert this into:

a “product principles” section (one principle per problem),

acceptance criteria (“the system succeeds when…”),

or a mapping from each problem → specific MVP feature(s) (deck, boomerang dates, waiting state, heartbeat, calendar gap fitting, etc.).

Gemini said
This version is excellent. You have moved from a "feature list" to a First Principles document. It reads like a manifesto for a new category of software.

By explicitly naming the Meta-Problem (Human as both Worker and Admin), you’ve identified the exact "why" behind the failure of every major productivity tool from Todoist to Notion.

The Most Powerful Additions
Item 15 (Emotional Avoidance): This is a genius insight. Traditional tools "punish" you with red text when you avoid something hard, which makes you want to open the app less. Treating avoidance as a signal to "reduce friction" rather than "increase pressure" is a massive UX differentiator.

Item 12 (Slow-Burn/Heartbeat): This perfectly captures your "projects that make slow progress over years" point. Giving these a "Pulse" rather than a "Due Date" solves the guilt of the "Someday" list.

Item 14 (Completion Debt): "Last-mile stalling" is where most project value dies. Surfacing the "30 minutes finishes this" is a high-leverage move for an AI.

How to use this for the Coding AI (The "Shape of Data")
When you hand this to your coding AI, don't just give it the text. Use these points to define Logic Constraints. Here is how some of these problems translate into your SQLite/Logic layer:

For Problem 5 (Snooze Loop): The database must have two distinct columns: hard_deadline (NULL by default) and next_resurface_at. Logic: Never show a "Red/Overdue" state unless hard_deadline is passed.

For Problem 7 (Calendar Ignorance): Your "Selection Algorithm" needs a function: get_available_window(). If the gap between two Google Calendar events is 22 minutes, the SQL query must include AND estimated_minutes <= 15 (leaving a 7-minute buffer).

For Problem 11 (Next Actions): The AI should run a nightly scan: SELECT project_id FROM tasks WHERE state = 'active' GROUP BY project_id HAVING count(tasks) = 0. If a project has no tasks, the AI initiates a "Capture" prompt to the user: "Project [X] is drifting. What's the very next physical step?"

For Problem 16 (Over-Capture): Implement Auto-Decay. If a "Someday" item hasn't been touched in 90 days, the AI doesn't delete it, but it moves it to a Deep_Archive table so it no longer even hits the "Triage" engine.

The MVP Path: Problems → Features
If I were you, I would ask the Coding AI to map these 22 points into a "Principle-Feature Matrix." For example:

Problem MVP Feature Implementation 3. Topology/Parallel A "Waiting on AI/Other" toggle that instantly hides the task and pulls a "Gap Task." 5. Snooze Loop "Boomerang" buttons: +1 Day, +1 Week, +1 Month (updates resurface_at). 13. Habits vs Tasks A routines table with a is_habit boolean and reset_cadence. 19. Trust/Transparency A rationale string field in the tasks table populated by the AI during ingestion.
Would you like me to help you write the specific "Ingestion Prompt" that takes a raw thought and populates these 22 dimensions of metadata? This will be the "brain" of your MVP.

You said
Based on our problem state and what we've discussed, give me a PRD on what we're building

Gemini said
This Product Requirements Document (PRD) outlines the development of Eon, an AI-native routing engine for tasks and attention.

Eon is designed to solve the "Administrator Tax" by removing the human from system maintenance, allowing them to focus entirely on execution.

PRD: Eon (MVP v1.0)
Project Status: Initial Build

Stack: Local-first, SQLite, AI-augmented (OpenAI/Anthropic API)

1. Executive Summary
   Eon is not a to-do list; it is a Routing Engine. It acts as a Chief of Staff that ingests raw thoughts, understands the multi-dimensional context of the user’s life (projects, habits, calendar, and mental state), and surfaces the one right thing to work on at any given moment.

2. Core Principles
   Zero-Friction Capture: Input is raw text/voice. Metadata is inferred, not manually entered.

Context-First Dispatch: Work is filtered by the user’s current reality (time, energy, location).

Decoupled Deadlines: Separation of hard deadlines (consequences) from resurfacing (intention).

The "Gap" Utility: Turning AI wait-times and calendar fragments into high-value micro-execution windows.

3. Functional Requirements
   3.1. Unified Capture (The "Dump")
   R1: A single, global input field (Command-K style) for raw text entry.

R2: AI-driven ingestion that parses raw text into:

Action Title: Verb-first (e.g., "Review logo")

Project Association: (e.g., Dynamism, 1LLM, Home)

Context Tag: (Deep Work, Admin, Quick Gap, Physical)

Resurface Date: Defaulted to "tomorrow" unless specified.

Hard Deadline: (Boolean) Only if a specific date/consequence is detected.

3.2. The Routing Engine (The "Brain")
R3: State Management: Tasks must support four primary states: Active, Waiting (AI/Other), Incubating (Boomerang), and Completed.

R4: Calendar Integration: The system must read local calendar data to identify "Gaps" (e.g., "You have 22 minutes until your 2:00 PM").

R5: The Selection Algorithm: A logic layer that queries SQLite for the "Best Next Task" based on:

Current Context (User-selected or inferred).

Available Time (from Calendar).

Project "Vibes" (Active momentum vs. Slow-burn).

3.3. The Execution Interface (The "Now")
R6: Singular Focus View: The default UI shows one primary card. No scrolling through lists.

R7: The "Waiting" Trigger: A prominent button to move the current task to "Waiting." This instantly triggers the Gap Filler—a low-mental-load task that fits the remaining time.

R8: The Boomerang: Instead of "Snoozing," users "Boomerang" an item. It disappears from the DB view until its resurface_at timestamp.

3.4. Habits & Slow-Burns
R9: Elastic Habits: Habits (e.g., Reading, Gym) are modeled as "Routine Blocks" that the AI attempts to slot into calendar gaps. If missed, they don't turn "Red"; they just attempt to re-slot.

R10: Project Heartbeat: Active projects with no "Next Action" trigger a prompt for the user to define the smallest possible step.

4. Technical Architecture (MVP)
   4.1. Data Layer (SQLite)
   Tables: areas, projects, tasks, habits, session_logs.

Local-First: The database lives on the user's machine. No cloud sync for MVP.

4.2. AI Layer
LLM Provider: User-provided API Key (OpenAI/Anthropic).

Functionality: Used for Ingestion (Text → JSON) and Triage (Daily Briefing generation).

4.3. Interface
Stack: Next.js / Electron (for local desktop feel) or a clean React web app.

UI Style: Minimalist, "Calm Tech." Dark mode default. Focus on typography and state transitions.

5. Success Metrics (The "Aha" Moments)
   The "Stare" Test: User opens Eon and knows exactly what to do in < 3 seconds.

Zero Red: User goes a full week without seeing a "Late/Overdue" notice for a non-essential task.

The Gap Win: User completes a 5-minute task they would have otherwise ignored while waiting for an AI code build.

6. MVP Roadmap
   Phase 1: SQLite schema and AI Ingestion logic (Raw text to Database).

Phase 2: The "Singular Focus" UI and Context Switcher.

Phase 3: Calendar Awareness (Local iCal/Google Cal parsing).

Phase 4: The "Waiting" state and Gap-Filler logic.

Next Step: Would you like me to generate the Initial Prompt for your Coding AI that includes this PRD and the specific SQLite schema to build the first functional prototype?

---

BRAINSTORM 2

This is a really rich brain dump. Let me try to distill what I'm hearing and then offer some concrete thinking on the system design — since this feels like it's headed toward Eon's task layer.
The core problems you've identified

Queue maintenance is a tax. GTD works in theory but the weekly review is where people fall off. The system itself becomes work.
Tasks are multi-dimensional, not linear. Priority, context, urgency, time-available, energy-level, project-membership, and "don't forget this" are all competing axes that a simple ordered list can't capture.
Due dates get abused as reminders. People use them to keep things visible, which creates a snowball of daily bumping that erodes trust in the system.
Context switching is real and valid. Especially with AI-assisted coding, you're running parallel workstreams and need to fluidly move between them — not pretend you're doing one thing at a time.
The "what should I work on" problem. You sit down and stare instead of doing. The decision cost is high when you have many projects.

A system design worth exploring
I think the answer isn't GTD or calendar blocking or a kanban — it's a thin layer on top of an AI that holds your full context. Here's how I'd think about it:
Three primitives only:

Capture — dump anything in (voice, text, link, screenshot). Zero friction. AI auto-extracts the task, assigns it to a project, infers rough urgency. No fields to fill.
Intent — a short daily or session-level conversation: "I have 2 hours of deep work and then some scattered time this afternoon." The AI proposes a plan based on what it knows. You thumbs-up or adjust. This replaces the weekly review with micro-planning that's contextual and conversational.
Surface — the AI proactively nudges. Not "you have 47 tasks due" but "hey, that open-source documentation you mentioned — you've got a gap right now and it's been 3 weeks. Want to chip at it?" This is the reminder-without-a-due-date problem solved.

What the AI holds internally (not exposed as columns to the user):

Project membership
Inferred urgency (decaying/growing over time based on signals, not a manual field)
Hard deadlines vs. soft "keep warm" items
Dependencies and blockers
Your energy/context patterns over time (learns that you do deep work mornings, PR reviews after lunch, etc.)
Recency — when did you last touch this project?

The user never sees or manages this state. They just see what the AI surfaces. The "backlog" exists but it's the AI's job to scan it, not yours.
On the parallel workstream problem: I think the UI metaphor might be something like "active threads" — you have 2-3 things in flight right now, and the system knows it. When you're waiting on AI to generate code for Thread A, it can suggest "Thread B has a PR ready for review" without you having to remember or context-switch manually. It's almost like an OS scheduler for your attention.
On the "check in on slow-burn projects" problem: This is where a concept like "project pulse" could work. The AI periodically (maybe weekly, maybe monthly depending on the project) surfaces a slow-burn project and asks: "Still relevant? Priority changed? Want to do a small push?" This replaces the compounding due-date bumping with an intelligent heartbeat.
The key insight
The system you're describing isn't really a task manager — it's an AI executive assistant that happens to track tasks. The task list is an implementation detail. The interface is a conversation + smart nudges. The human's job is to capture and decide, never to organize or maintain.
The risk is that people don't trust a black box. So the safety valve you mentioned is important — some way to say "show me everything" or "am I missing anything?" that gives a panoramic view when you want it, without requiring it day-to-day.
Want me to start sketching out a data model or prototype for this? I could see this fitting cleanly into Eon's architecture.Do you agree with the problems I recognize? What are problems other people may have that I am blind to?Also how to incorporate habits or daily things we want to do.It also needs to be calendar aware.10:07 AMSynthesized product feedback, identified blind spots, integrated habits and calendar functionalitySynthesized product feedback, identified blind spots, integrated habits and calendar functionalityThe user wants me to validate their problem identification, identify blind spots, and discuss habits/daily routines and calendar integration. This is a product thinking conversation, not a coding task. I can answer from knowledge without tools.DoneYeah, I think your problem identification is sharp — especially the insight that due dates get weaponized as reminders and that queue maintenance kills adoption. Those are the exact failure modes I'd expect from someone who's actually tried to live inside these systems rather than just theorizing about them.
Here are blind spots worth considering:
Problems you may not be experiencing but others will
Shared accountability. You're thinking as a solo founder juggling projects. But most people have tasks that involve other people — "waiting on X to review," "need to follow up with Y," delegated work. The system needs to track not just your queue but the commitments web between you and others. This is where Eon's CRM layer could be powerful — a task tied to a contact with relationship context.
Emotional avoidance. People don't just stare at their list because they don't know what to do. They know exactly what to do — they're avoiding it. The hard conversation, the tax filing, the thing that triggers anxiety. A great AI assistant would recognize that a task has been dodged 6 times and gently address it differently, maybe by breaking it down, maybe by just naming it: "This one keeps slipping. Want to talk about what's blocking it?"
Completion debt. Tasks that are 90% done but never finished. People start things, get to the hard/boring tail end, and move on. The system should recognize "almost done" items and treat them differently — the ROI of finishing is way higher than starting something new.
Over-commitment blindness. People say yes to everything and don't realize they have 40 hours of work scheduled into 20 hours of available time. The AI should be able to say "you physically cannot do all of this this week — what are we cutting?" Most task managers let you lie to yourself. This one shouldn't.
Different life stages. Your frame is a high-agency founder. A parent with a 9-5 has very different constraints — rigid time blocks, less autonomy, more recurring obligations. A student has semester rhythms. The system needs to flex across these without different "modes."
Capture trust. If people dump something in and it gets lost or miscategorized, they stop trusting capture and go back to keeping things in their head. The AI's initial classification needs to be very good or the whole system breaks at the input layer.
Habits and daily routines
This is a different primitive than tasks, and I think conflating them is a mistake many apps make. A task is something you complete and it goes away. A habit is something you do repeatedly and the value is in the streak/consistency, not the completion.
I'd model it as a third primitive alongside capture and intent:
Rituals — things you want to do daily/weekly that aren't "tasks" but are part of how you want to live. Morning workout, reading 30 minutes, journaling, taking supplements, a weekly date night.
The AI's role with rituals is different than with tasks. It's not about prioritizing them against your task queue — it's about protecting them. When you do your morning intent conversation, the AI should start with your rituals as anchors in the day and then fill work around them, not the other way around. "You wanted to work out and read today. Here's where those fit. Now, for the remaining time..."
The tracking should be lightweight — did you do it or not, maybe auto-detected where possible. And the AI should notice patterns: "You've skipped your workout 4 days in a row. Overloaded, or should we adjust the goal?"
Calendar awareness
This is almost non-negotiable. Without calendar awareness, the system is guessing at your available time. With it, the AI can do the thing you actually want:

Know your real open blocks, not theoretical ones
Factor in meeting prep ("you have a board meeting at 2 — want 30 minutes before to review the deck?")
Understand that a day with 6 hours of meetings means you have maybe 1 hour of deep work, so don't surface hard tasks
Recognize travel time, buffer between meetings, lunch
Detect when you're overbooked and flag it before the day arrives
Place rituals/habits into the calendar as protected time

The calendar is basically the constraint layer. Tasks and rituals are what you want to do; the calendar is what's actually possible today. The AI mediates between the two.
The tricky design question is whether the system writes to your calendar or just reads it. Writing creates a tight feedback loop (you plan in Eon, it shows up in Google Calendar) but also creates sync nightmares and the risk of the system feeling controlling. Reading is safer but means the user has to mentally bridge two views.
My instinct: read by default, write on explicit request. "Want me to block this on your calendar?" rather than auto-scheduling everything.
The through-line across all of this is the same: the human captures, decides, and does. The AI organizes, reminds, and protects. Every feature should pass the test of "does this reduce cognitive load or add it?"So how does this whole thing take shape10:15 AMSynthesized architecture, UX, and implementation for task management systemSynthesized architecture, UX, and implementation for task management systemThe user is asking me to think about how this whole task management system actually takes shape — the architecture, the UX, the implementation. This is a product/system design conversation about Eon's task layer. Let me think deeply about this and lay it out coherently.
They want to know: what's the actual product? How does it work day-to-day? What's the data model? What's the UX? How does it all come together?
Let me think about this holistically — the primitives we discussed, the AI layer, the calendar integration, habits, the capture system, and how it all flows together as a user experience.DoneLet me think about this as layers, from the foundation up — data model, AI layer, and then what the human actually sees and does.
The foundation: what the system knows
At the bottom, you have a small set of entities that are intentionally simple:
Items — the atomic unit. Everything captured becomes an item. An item could become a task, a reference note, an idea, a someday-maybe. The AI classifies it, the user can override. Items have almost no required fields — just the raw content and a timestamp. Everything else is inferred or optional.
Projects — containers for related items. Could be "Bounce," could be "Kitchen renovation," could be "Q1 hiring." Projects have a rough priority relative to each other, but this is fluid and the AI can suggest reordering based on activity and deadlines.
Rituals — recurring commitments. Workout, journaling, reading, weekly 1:1s. These are separate from tasks because they never "complete" — they reset.
People — this is where Eon's CRM layer connects. Items can be linked to people. "Follow up with Jake about the partnership" is a task, a contact, and potentially a calendar event all at once.
Context tags — not user-managed folders, but AI-inferred labels like "deep work," "quick wins," "calls to make," "errands," "waiting on someone." These are how the AI matches tasks to available time and energy.
The critical design decision: the user never has to fill in metadata. They dump raw text or voice in. The AI extracts the task, infers the project, guesses urgency, tags the context, links the person. If it gets it wrong, the user corrects it once and the AI learns.
The AI layer: what runs behind the scenes
This is the brain. It's doing several jobs continuously, not just when the user asks.
Triage — every new item gets classified within seconds of capture. Project, urgency, context, estimated effort, hard deadline vs. soft. This replaces the entire GTD "processing" step.
Decay and escalation — urgency isn't static. Something that was low-priority three weeks ago might be escalating because a deadline is approaching or because it's been ignored too long. The AI adjusts this continuously. No human bumping due dates.
Pattern recognition — "You always do your best deep work between 9 and 11 AM." "You tend to avoid finance-related tasks." "You haven't touched Spark in two months." This feeds into how it surfaces work and when it raises flags.
Capacity modeling — it reads your calendar, knows your rituals, understands your energy patterns, and calculates realistic available time. When you have 6 hours of meetings, it knows you have maybe 90 minutes of real work time. It won't suggest you tackle the big architecture refactor that day.
Proactive surfacing — this is the killer feature. The AI doesn't wait for you to open the app and scan a list. It pushes to you: "You have 25 minutes before your next call — want to knock out that PR review for Bounce?" or "It's been a month since you looked at the open-source docs. Still on your radar?"
The human experience: what you actually see and do
This is where it all has to feel effortless. I see three primary interaction modes:

1. Capture (anytime, anywhere)
   Voice note, quick text, forwarded email, screenshot. You say "remind me to look into that Hasura migration before we launch" and that's it. You're done. The system takes it from there.
   The key UX principle: capture should feel like texting a friend, not filling out a form. Zero fields, zero decisions at capture time.
2. The morning intent (daily, 2-3 minutes)
   This replaces the weekly review. You open Eon and it greets you with something like:

"Here's your day. You have meetings from 10-12 and 2-3:30. Your open blocks are 8:30-10, 12:30-2, and 3:30 onward. You wanted to work out this morning — want to protect 7-8:30 for that?
For your deep work block, I'd suggest the payment integration for Bounce — it's been your top priority and you made good progress yesterday.
You also have two quick items: reply to Jake about the partnership terms, and approve the PR for InsiderFinance.
One thing surfacing from the backlog: you mentioned wanting to draft the Ri positioning doc. It's been three weeks. Worth a look today or push it?"

You react — thumbs up, swap something, say "not today on the Ri doc," and you're done. The AI now has your plan. It doesn't need to be perfect because it'll adjust throughout the day. 3. In-flow nudges (throughout the day)
This is the active thread manager you need for the parallel workstream problem. As you work, the system is aware of what you're doing and what's waiting. When you finish something or hit a natural pause (waiting on a build, between meetings), it suggests the next thing based on the time and energy available.
This could be a small persistent widget, a notification, or just something you check. It's not a full dashboard — it's a single suggestion with the option to see alternatives. 4. The weekly pulse (optional, 5 minutes)
Not a full GTD review. More like the AI saying: "Here's what moved forward this week. Here are things that stalled. Here's what's coming up next week that you should know about. Any projects changing priority?"
This is the "am I missing anything?" safety valve. It gives you the panoramic view without requiring you to maintain it.
What's NOT in the UI
This matters as much as what is. The user should never see:

A priority matrix they have to manually update
A kanban board they drag cards around on
A list of 47 overdue items with red badges guilt-tripping them
Due date fields they have to set and bump
Tags or categories they have to manage
Any kind of "inbox zero" mechanic

The system holds all of that complexity internally. The user's interface is a conversation, a daily plan, and contextual nudges.
How it builds over time
The system gets dramatically better with use because the AI learns your patterns — when you work best, what you avoid, how long things actually take you versus your estimates, which projects you care about most (measured by action, not stated priority). After a few weeks, the morning intent conversation gets sharper. After a few months, it practically runs your day.
How this maps to Eon technically
Since you're on Next.js, Hasura, and Postgres — the data model is clean. Items, projects, rituals, and people as tables with minimal required columns and a flexible JSONB field for AI-inferred metadata. The AI layer is an async process that triages on capture and runs a nightly/morning planning pass. Calendar integration via Google Calendar API (read-first, write-on-request). The conversational UI is a chat interface backed by an LLM that has full context on your items, calendar, and patterns — this is also where Ri could feed in as the personalization layer.
The first version doesn't need all of this. The MVP is probably: capture → AI triage → morning plan → one-tap completion. Get that loop feeling magical and everything else layers on.
Want me to start drafting the actual data model or prototype the morning intent UI?I'm going to put this into a coding AI. Describe the core conepts of this project and how it should take shape in being built. For now the MVP will just be sqllite and local first. I'll just put my own API keys in. I want to focus on the shape of the data, how AI categorizes, and then how it's realized in the product UI/UX.10:45 AMAffirmed project readiness for developer handoffAffirmed project readiness for developer handoffThe user wants me to create a comprehensive document that they can hand off to a coding AI to build the MVP of this task management system. It should cover data model, AI categorization logic, and UI/UX — all grounded in SQLite/local-first with their own API keys.
Let me create a thorough markdown document for this.Comprehensive project spec for the AI-driven task management system MVPeon-tasks-spec.mdLet me present this file to the user.Presented fileGood, the file is ready for the user.DoneThis is the full spec — data model, AI categorization system with prompt templates, UI/UX architecture, and a phased build order.
A few things I'd flag as you hand this off:
Phase 1 is the real test. If capture → AI triage doesn't feel magical (fast, accurate, zero effort), nothing else matters. I'd spend extra time tuning that triage prompt with your actual real-world inputs before building forward.
The morning plan is the "aha" moment. That's where a user goes from "this is a task list" to "this is an assistant." Phase 3 is where the product thesis gets proven or disproven.
SQLite is the right call for now. It keeps everything fast and local, and you can swap to Postgres/Hasura later without changing the schema shape much. The data model is intentionally relational and flat — no deeply nested JSON blobs that become hard to migrate.
One thing to watch: the AI costs. Each capture hits the API, the morning plan hits it, nudges hit it. With Claude Haiku or GPT-4o-mini for triage and the bigger models only for planning, you can keep it cheap. Worth being explicit about which model does what when you're building.

# Eon Task System — MVP Specification

## Vision

An AI-driven task management system where the human captures and decides, and the AI organizes, prioritizes, and surfaces. The user never maintains the system — no dragging cards, no bumping due dates, no weekly reviews. They dump things in, have a short daily conversation with the AI, and get told what to work on.

This MVP is local-first with SQLite and direct API keys (OpenAI or Anthropic). No auth, no server, single user.

---

## Core Concepts

### The Three Primitives

**1. Items** — The atomic unit of everything captured. An item starts as raw text (or voice transcription). The AI processes it into structured data. An item might be a task, an idea, a reference note, or a reminder. The user never has to decide which — the AI infers it.

**2. Projects** — Named containers that group related items. Examples: "Bounce," "Kitchen Renovation," "Q1 Hiring." Projects have a relative priority to each other (AI-suggested, user-adjustable). Items belong to projects. Some items are project-free (one-off errands, personal stuff).

**3. Rituals** — Recurring things the user wants to do regularly. Workouts, journaling, reading, taking supplements. These are NOT tasks — they never complete, they reset. They have a cadence (daily, weekly, specific days) and the system tracks consistency, not completion.

### Supporting Concepts

**People** — Contacts linked to items. "Follow up with Jake" creates an item tied to a person. This enables the AI to surface things like "You have 3 pending items involving Jake and you're meeting him tomorrow."

**Context Tags** — AI-inferred labels that describe the nature of the work. Examples: `deep-work`, `quick-win`, `call`, `errand`, `waiting-on-someone`, `review`, `creative`, `administrative`. These are how the AI matches tasks to available time and energy. The user never manages these directly.

**Sessions** — A record of each daily planning conversation and what the user committed to. This gives the AI memory of what was planned vs. what actually happened, which feeds learning over time.

---

## Data Model (SQLite)

### items

The core table. Intentionally sparse required fields — most structure comes from AI inference stored in dedicated columns.

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),

  -- What the user actually said/typed
  raw_input TEXT NOT NULL,

  -- AI-processed fields
  title TEXT,                          -- Short summary extracted by AI
  description TEXT,                    -- Expanded detail if needed
  item_type TEXT DEFAULT 'task',       -- 'task' | 'idea' | 'reference' | 'reminder'

  -- Organization (AI-inferred, user-adjustable)
  project_id TEXT REFERENCES projects(id),
  context_tags TEXT DEFAULT '[]',      -- JSON array of strings like ["deep-work", "coding"]

  -- Priority & urgency (AI-managed, not user-managed)
  urgency_score REAL DEFAULT 0.5,      -- 0.0 to 1.0, AI-computed and decays/escalates over time
  effort_estimate TEXT,                -- 'tiny' (<5min) | 'small' (5-30min) | 'medium' (30min-2hr) | 'large' (2hr+) | 'unknown'

  -- Dates
  hard_deadline TEXT,                  -- ISO date, only if there's an actual immovable deadline
  soft_deadline TEXT,                  -- "Would be nice by" date
  snooze_until TEXT,                   -- Don't surface before this datetime

  -- People
  person_id TEXT REFERENCES people(id),
  waiting_on BOOLEAN DEFAULT 0,        -- Blocked on someone else

  -- State
  status TEXT DEFAULT 'active',        -- 'active' | 'done' | 'cancelled' | 'someday'
  completion_pct INTEGER DEFAULT 0,    -- 0-100, for partially done items

  -- Tracking
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT,
  last_surfaced_at TEXT,               -- When the AI last showed this to the user
  times_deferred INTEGER DEFAULT 0,    -- How many times the user said "not now" to this

  -- AI reasoning
  ai_notes TEXT                        -- AI's internal reasoning about this item (why it prioritized it, what it noticed)
);
```

### projects

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active',        -- 'active' | 'paused' | 'completed' | 'archived'
  priority_rank INTEGER,               -- Relative ordering among active projects
  color TEXT,                          -- For UI display
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### rituals

```sql
CREATE TABLE rituals (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  description TEXT,
  cadence TEXT NOT NULL,               -- 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'custom'
  cadence_days TEXT,                   -- JSON array for custom, e.g. ["mon","wed","fri"]
  preferred_time TEXT,                 -- 'morning' | 'afternoon' | 'evening' | 'anytime'
  duration_minutes INTEGER,            -- How long it typically takes
  active BOOLEAN DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### ritual_logs

```sql
CREATE TABLE ritual_logs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  ritual_id TEXT NOT NULL REFERENCES rituals(id),
  date TEXT NOT NULL,                  -- ISO date
  completed BOOLEAN DEFAULT 0,
  skipped BOOLEAN DEFAULT 0,
  note TEXT,                           -- Optional: "did 20 min instead of 30"
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(ritual_id, date)
);
```

### people

```sql
CREATE TABLE people (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  name TEXT NOT NULL,
  relationship TEXT,                   -- 'cofounder' | 'teammate' | 'client' | 'friend' | 'family' | 'other'
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
```

### sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  date TEXT NOT NULL,
  session_type TEXT DEFAULT 'morning', -- 'morning' | 'midday' | 'evening' | 'weekly'

  -- What the AI proposed and what the user accepted
  ai_proposed_plan TEXT,               -- JSON: the full plan the AI suggested
  user_accepted_plan TEXT,             -- JSON: what the user actually committed to

  -- End of day reflection (optional)
  completed_items TEXT,                -- JSON array of item IDs completed during this session
  reflection_notes TEXT,               -- AI or user notes on how the day went

  created_at TEXT DEFAULT (datetime('now'))
);
```

### calendar_events (cached from external calendar)

```sql
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  is_all_day BOOLEAN DEFAULT 0,
  location TEXT,
  source TEXT DEFAULT 'manual',        -- 'google' | 'manual'
  fetched_at TEXT DEFAULT (datetime('now'))
);
```

---

## AI Categorization System

The AI has several distinct jobs. Each should be implemented as a separate prompt/function so they can be tuned independently.

### 1. Capture Triage

**Trigger:** Every time a new item is created from raw input.

**Input:** The raw text the user typed or spoke, plus context (current projects list, recent items, known people).

**Job:** Extract structured data from the raw input and populate the item fields.

**Prompt approach:**

```
You are a task triage assistant. The user has just captured a new item.
Your job is to extract structured data from their raw input.

Current projects: {projects list with descriptions}
Known people: {people list}
Current date/time: {now}

Raw input: "{user's raw text}"

Return JSON:
{
  "title": "short actionable summary, start with a verb if it's a task",
  "description": "any additional detail worth preserving, or null",
  "item_type": "task | idea | reference | reminder",
  "project_id": "best matching project ID or null",
  "context_tags": ["array", "of", "relevant", "tags"],
  "urgency_score": 0.0-1.0,
  "effort_estimate": "tiny | small | medium | large | unknown",
  "hard_deadline": "ISO date if mentioned, or null",
  "soft_deadline": "ISO date if implied, or null",
  "person_id": "matching person ID or null",
  "waiting_on": false,
  "ai_notes": "brief reasoning for your categorization"
}
```

The context tags should be drawn from a consistent set but the AI can create new ones if needed. Core set: `deep-work`, `quick-win`, `call`, `email`, `errand`, `waiting`, `review`, `creative`, `administrative`, `research`, `coding`, `writing`, `planning`, `financial`, `health`, `family`, `social`.

### 2. Urgency Decay & Escalation

**Trigger:** Nightly batch job (or on-demand before morning planning).

**Job:** Re-evaluate urgency scores for all active items based on time passage, approaching deadlines, times deferred, and how long since last surfaced.

**Logic (can be rule-based, doesn't need LLM):**

```
For each active item:
  - If hard_deadline exists and is approaching: escalate urgency
    - Within 1 day: urgency = max(current, 0.95)
    - Within 3 days: urgency = max(current, 0.8)
    - Within 7 days: urgency = max(current, 0.65)
  - If times_deferred > 3: boost urgency by 0.1 (something is being avoided)
  - If completion_pct > 70: boost urgency by 0.1 (almost done, high ROI to finish)
  - If last_surfaced_at is null or > 14 days ago: flag for "backlog pulse" surfacing
  - If waiting_on is true: reduce urgency (can't act on it)
  - Gentle time decay for items with no deadline: reduce by 0.01/day
    (prevents old low-priority items from clogging the system,
     but the backlog pulse catches important ones before they vanish)
```

### 3. Morning Plan Generation

**Trigger:** User opens the app or initiates morning planning.

**Input:**

- Today's calendar events
- All active items with current urgency scores
- Today's rituals
- Yesterday's session (what was planned vs. completed)
- User's known patterns (if enough history)

**Job:** Generate a natural-language daily plan that proposes what to work on, when, and why. Structure it around available time blocks.

**Prompt approach:**

```
You are the user's AI executive assistant. Generate their daily plan.

Be conversational, not robotic. Be opinionated — tell them what you think
they should do, don't just list options. But be brief.

Today: {date, day of week}
Calendar: {today's events with times}
Available blocks: {computed open time slots}

Rituals due today:
{rituals with preferred times}

Top items by urgency (max 15):
{items sorted by urgency_score desc, with project names}

Items that haven't been surfaced in 2+ weeks:
{backlog items, max 5}

Yesterday's plan vs. reality:
{what was planned, what got done, what carried over}

Generate a plan structured as:
1. Start with rituals as anchors
2. Assign high-urgency items to deep work blocks
3. Assign quick-wins to short gaps between meetings
4. Surface 1-2 backlog items as "worth a look" suggestions
5. Flag if the user is overcommitted (more work than available time)

Keep the tone like a sharp chief of staff — warm but direct.
Return both a natural language summary and a structured JSON plan:
{
  "summary": "conversational plan text",
  "time_blocks": [
    {
      "start": "09:00",
      "end": "10:30",
      "item_ids": ["abc123"],
      "description": "Deep work on payment integration",
      "block_type": "deep-work | quick-wins | ritual | meeting | buffer"
    }
  ],
  "deferred_to_tomorrow": ["item_ids that won't fit today"],
  "backlog_surfaced": ["item_ids worth mentioning"]
}
```

### 4. In-Flow Nudge

**Trigger:** User completes a task, or asks "what should I do next?", or a time block ends.

**Input:** Current time, remaining plan, what's been completed, next calendar event.

**Job:** Suggest the single best next action given the current context.

This should be fast and lightweight — a short prompt that returns one suggestion with a brief rationale.

### 5. Weekly Pulse

**Trigger:** End of week (user-initiated or prompted on Sunday/Monday).

**Input:** All sessions from the past week, completed items, deferred items, project activity.

**Job:** Generate a brief retrospective — what moved forward, what stalled, what's coming up, and whether project priorities should shift.

---

## UI/UX Architecture

The app should be a Next.js app with a clean, minimal design. Think linear.app's simplicity meets a chat interface. Tailwind + shadcn/ui for components.

### Layout

Single-page app with a sidebar and main content area.

**Sidebar:**

- Quick capture input (always visible at top)
- Navigation: Today (default), Projects, Rituals, Everything
- Active projects list (collapsible)

**Main area switches between views:**

### View 1: Today (default/home)

This is the primary view. It shows:

**Top section: The Plan**

- The AI-generated daily plan in natural language (the "morning brief")
- Below it, a timeline view of the day showing:
  - Calendar events (pulled from cache, grayed out / non-editable)
  - Planned work blocks (colored by project)
  - Ritual blocks (distinct visual treatment)
- The plan is generated once in the morning but can be regenerated ("Replan my day")

**Middle section: Active Items**

- The items committed to for today, shown as a simple checklist
- Each item shows: title, project badge, effort estimate, context tags as subtle pills
- Check to complete, swipe/button to defer ("not today")
- Clicking an item expands it to show description, AI notes, and edit fields

**Bottom section: Chat**

- A persistent chat input for interacting with the AI
- This is how the user:
  - Captures new items ("remind me to call Jake about the contract")
  - Asks for help ("what should I work on next?")
  - Adjusts the plan ("move the Bounce work to this afternoon")
  - Does the morning intent conversation
  - Asks "am I missing anything?"

The chat is not a separate page — it's integrated into the Today view as a bottom sheet or expandable panel. The AI's responses can include actionable buttons (e.g., "Add this as a task?" → one tap to confirm).

### View 2: Projects

- List of all projects with status, item count, last activity date
- Click into a project to see all its items (active, done, ideas)
- Project-level priority reordering (drag to reorder)
- AI-generated project summary: "12 active items, 3 blocked, estimated 8 hours remaining this sprint"

### View 3: Rituals

- List of all rituals with current streak / consistency rate
- Calendar heatmap or simple grid showing completion over time
- Add/edit rituals
- AI insight: "You've been consistent with workouts but journaling has dropped off the last 2 weeks"

### View 4: Everything

- A searchable, filterable list of all items across all projects
- This is the "show me everything" safety valve
- Filters: by project, by status, by context tag, by urgency range, by person
- Sort: by urgency, by date created, by last surfaced
- This view exists for trust and control but should NOT be the daily driver

### Capture UX

The quick capture input in the sidebar should:

- Accept free-form text
- Show a brief "processing..." state while AI triages
- Then show a small confirmation toast: "Added to Bounce: 'Fix payment webhook handling' — tagged as coding, medium effort"
- The toast has an "Edit" link if the AI got something wrong
- Voice input button (uses browser speech-to-text, sends transcript to the same pipeline)

### Design Principles

1. **No empty states that require setup.** The app should be useful from the first captured item. Projects can be created implicitly by the AI ("I noticed you're capturing a lot of items about Bounce — want me to create a project for it?").

2. **Progressive disclosure.** The default view is simple. Complexity is available but hidden. Click to expand, filter to find, but never forced to see everything.

3. **The AI is a first-class citizen in the UI, not a sidebar feature.** The chat is central. The plan is AI-generated. Nudges are AI-driven. The whole app is a conversation with an assistant that happens to have a visual layer.

4. **Dark mode by default.** This is a productivity tool for people who stare at screens all day.

5. **Keyboard-first.** Global shortcut to capture (Cmd+K or similar). Arrow keys to navigate items. Enter to complete. Escape to dismiss.

6. **Minimal color, meaningful color.** Projects get colors. Urgency uses subtle warm-to-red gradient. Everything else is neutral. No rainbow of badges and tags competing for attention.

---

## Build Order

### Phase 1: Data + Capture + Triage

- Set up SQLite with the schema above
- Build the capture input UI
- Wire up AI triage (call Anthropic/OpenAI API on capture)
- Display items in a basic list grouped by project
- Allow manual editing of AI-inferred fields
- **Goal:** You can dump things in and they get auto-organized. This alone is valuable.

### Phase 2: Projects + Manual Prioritization

- Project CRUD
- Drag-to-reorder project priority
- Item list within projects
- Basic status management (active/done/cancelled)
- **Goal:** Organized view of all your work across projects.

### Phase 3: Morning Plan + Today View

- Calendar integration (Google Calendar API read-only, cache to SQLite)
- Morning plan generation via AI
- Today view with timeline and checklist
- Session recording (what was planned, what was completed)
- **Goal:** You open the app each morning and get told what to do.

### Phase 4: Chat + In-Flow Nudges

- Persistent chat interface in Today view
- "What should I do next?" capability
- Replan capability ("move X to tomorrow")
- Natural language capture through chat ("add a task to...")
- **Goal:** The AI becomes an active partner throughout the day, not just a morning planner.

### Phase 5: Rituals + Weekly Pulse

- Ritual CRUD and daily tracking
- Integrate rituals into morning plan
- Weekly pulse generation
- Streak/consistency visualization
- **Goal:** Full daily and weekly rhythm with the AI managing the meta-work.

### Phase 6: Intelligence Layer

- Urgency decay/escalation batch job
- Pattern recognition ("you avoid finance tasks")
- Capacity modeling ("you're overcommitted this week")
- Backlog pulse surfacing
- Completion debt detection ("this is 80% done, just finish it")
- **Goal:** The system gets smarter over time and catches what you miss.

---

## Technical Notes

- **Framework:** Next.js with App Router, TypeScript, Tailwind, shadcn/ui
- **Database:** SQLite via better-sqlite3 (local file, no server needed)
- **AI:** Direct API calls to Anthropic (Claude) or OpenAI. Store the API key in a local .env file. Use structured output / JSON mode where available.
- **Calendar:** Google Calendar API with OAuth for read access. Cache events to the calendar_events table. Refresh on app open and periodically.
- **State management:** React Server Components for data fetching where possible, client-side state for interactive elements. Consider Zustand if client state gets complex.
- **No auth needed** — this is a single-user local app for the MVP.
- **File structure:** Keep it simple. `/app` for routes, `/lib` for database and AI functions, `/components` for UI.

---

BRAINSTORM 3

You’re circling the real issue: tasks aren’t a queue. They only feel like a queue because most tools force you to manually maintain an ordering. In reality, “what I should do next” is a decision that depends on constraints (time, energy, context, urgency, risk, dependencies, and your current goals).

So the “right” system is less GTD-as-buckets and more:

A tiny database + an AI policy engine + three surfaces

Not “10 columns you manage,” but “a few facts + AI inference + minimal human checkpoints.”

1. Data model (minimal, but expressive)

You only must provide a title/voice note. Everything else is optional and can be inferred.

Task

text (required)

project (optional; inferred, only ask if ambiguous)

hard_deadline (rare; only for real deadlines)

check_after (aka “don’t show me until…” / snooze)

estimate (rough: 5m / 25m / 2h; inferred)

energy (low/med/high; inferred)

status: active | waiting | someday | done

Project

outcome (“Launch X”, “Hire designer”, “Open source repo”)

heartbeat (how often you want it to resurface if idle: weekly / monthly / quarterly)

next_actions (AI maintains these)

That’s it. No manual ranking columns. No “reorder the list” labor.

The core rule that fixes “due-date bumping”
Separate “deadline” from “remind me to reconsider”

Most people abuse due dates because they really mean: “I don’t want to forget this.”

So you get two distinct concepts:

Hard deadline (external reality): “Kid registration closes Feb 22.”

Review/nudge date (internal attention): “Ask me again in 2 weeks.”

If it’s not truly hard, it should never be a deadline. It’s a check_after.

That one change kills the “bump 20 things per day” death spiral.

2. The AI policy engine (how priorities emerge without manual sorting)

Instead of a queue, you have a retrieval + ranking step driven by your current constraints.

Inputs the AI uses (most can be inferred)

Time available (e.g., “I’ve got 18 minutes”)

Energy level (low/high)

Context (phone/computer, at desk/in car, alone/with team)

Calendar + upcoming commitments (what’s next)

Projects with heartbeats (what’s going stale)

Deadlines (real ones)

Dependencies / waiting-on

Your declared focus (“Today’s main outcome is X”)

Output: a small “deck,” not a giant list

The AI should always give you:

1 recommended next action

2 alternates (different energy/time profiles)

A one-line reason (so you trust it)

And you should be able to ask:

“Tell me what to do for the next 25 minutes.”

That’s the “don’t stare at the computer” button.

3. The three surfaces (this is where it becomes effortless)

You don’t want 20 buckets. You want three views that match how attention works:

A) NOW (the deck)

1–3 items only. Chosen based on current constraints.
This is the anti-paralysis surface.

B) NEXT (short runway)

5–12 items that are “likely soon,” not everything you own.

C) RADAR (important-but-not-urgent, resurfaced intelligently)

This replaces the weekly review.

Radar is powered by:

Project heartbeat (“if no progress in 14 days, resurface”)

Spaced resurfacing for ideas (“1 week → 1 month → 3 months”)

Risk flags (“this is aging and has downside if ignored”)

So instead of a 30-minute weekly ritual, you get micro-pings:

“Two things are going stale; pick one to revive or snooze.”

That’s the review, but amortized into seconds.

What “projects” become in this system

A project isn’t a pile of tasks you browse. It’s an outcome with a maintained next action.

Key behaviors:

Every active project must always have one “Next Action” (or be marked Waiting/Someday).

The AI can generate/refresh next actions automatically after new info arrives.

If a project has no next action and no waiting reason, the AI surfaces it as a blocker (because that’s where progress dies).

This stops the “project is top priority but I’m not doing it” loop, because it forces a concrete next move.

Handling the founder reality: interruptions + crossover contexts

You need an “interrupt buffer” that doesn’t hijack your day.

The rule

Any incoming thing becomes one of:

Do now (<2 minutes)

Schedule / hard deadline (rare)

Snooze to a check_after (common)

Attach to a project

Waiting on someone

The AI should default to #3 or #4, not “make it due today.”

And when you have crossover (kid signup closing during work), that’s exactly what hard deadlines are for — but only when real.

Context blocks: yes, but not as a rigid planner

You’re right that the day is fluid, especially with AI doing async work.

Instead of fixed blocks you maintain, you want modes:

Deep Work mode (high energy, long tasks only)

Admin mode (low energy, short tasks)

People mode (calls/messages/decisions)

Fill mode (5–15 minute opportunistic tasks while waiting on AI/builds)

You switch modes ad hoc, and the deck updates instantly:

“I’m in Admin mode for 30 minutes.”
→ it serves 3 items that fit.

This embraces context switching instead of fighting it.

The minimum human input (the “effortless contract”)

To keep it effortless, the system is allowed to ask you only two kinds of questions, and only when needed:

Clarify a hard deadline
“Is this actually due on a specific date, or do you just want a reminder later?”

Pick a focus outcome for today (optional but powerful)
“What would make today a win?”
(One sentence.)

Everything else it infers, guesses, or postpones.

If you want a crisp “product spec” mantra

Capture is free. Review is continuous and tiny. Execution is a deck, not a list. Deadlines are sacred. Reminders are snoozes. Projects have heartbeats and one next action.

What I’d build first (MVP that proves the idea)

Universal inbox (text/voice dump)

AI turns each item into: task vs project, project link, next action, estimate, energy

The “What should I do for the next X minutes?” button

Deadline vs check_after distinction (with a default to check_after)

Project heartbeat + Radar resurfacing

That’s enough to eliminate:

weekly review labor

due-date bumping

staring / choice paralysis

If you want, I can take your ramble and turn it into a one-page design doc with:

data schema (minimal fields)

ranking policy (the scoring inputs, not a brittle formula)

interaction flows (capture, nudge, deck, radar)

failure modes + how the AI asks for help only when uncertain

Do you agree with the problems I recognize? What are problems other people may have that I am blind to?

How I think about companies/areas, projects, and tasks -> each of these can have some kind of priority on them and that also may shift depending on progress or blockers

Also how to incorporate habits or daily things we want to do.

It also needs to be calendar aware.
Thought for 23s

Yeah — the problems you called out are real, and they’re the exact reasons most task systems rot:

Manual queue grooming doesn’t scale (the “weekly review tax” becomes avoidance).

A single ordered list can’t represent multi-dimensional choice (time, energy, context, urgency, dependencies).

Due dates get abused as memory aids → endless bumping and alert fatigue.

Projects drift because “priority” doesn’t automatically translate into a concrete next action in the moment.

Context switching is the norm (especially with AI latency), so “one thing at a time” tools fight reality.

Blind spots other people often have (that you might not be weighting enough)

Trust + explainability
If AI tells me “do X now,” people need a quick, credible reason (“because deadline + dependency + you have 12 minutes before next call”). Without this, they won’t follow it and the system becomes noise.

Error tolerance / reversibility
AI will misclassify, over-prioritize, or miss nuance. Users need effortless “nah” controls:

“Not today”

“Never remind me again”

“This is waiting on Sam”

“This belongs to Project Y”
These are the real maintenance actions, and they must be one-tap.

Estimation is usually wrong
People under-estimate, especially founders. If the system relies on estimates, it must learn from reality (how long things actually take) and be robust when estimates are missing.

Hidden work: coordination and “waiting”
The biggest productivity killer isn’t tasks — it’s blocked tasks that don’t stay blocked. If “waiting on X” isn’t first-class, you’ll keep resurfacing stuff users can’t act on.

Emotional load and avoidance
People don’t just pick based on importance; they pick based on dread, anxiety, ambiguity. A system that doesn’t handle “this feels hard” will recommend the right thing and still fail adoption. Often you need “make it smaller” as a default.

Overcapture → guilt
If capture is too easy, you end up with a huge inventory and a constant sense of behindness. The system needs an explicit “this is optional / nice-to-have” lane that doesn’t nag.

Team reality
Founders operate in multi-person graphs: delegation, approvals, async updates, stakeholder expectations. Personal task systems break when tasks are actually commitments to others. The system needs to represent: who owns it, who’s waiting, what’s the next communication.

Privacy + data boundaries
Calendar/email/slack-aware is powerful, but many users will want clear controls: what sources are used, what’s stored, and “don’t look at this calendar.”

Companies/Areas → Projects → Tasks with shifting priority

Your model is right, but “priority” can’t just be a number at every level or you’ll get brittle, constantly-changing state.

A better mental model is: portfolio allocation + project health + task next-action selection.

1. Areas / Companies = allocation (how you want your life to be spent)

Instead of “priority 1–10,” think:

Target allocation (this week/month): Company A 50%, Company B 30%, Family 20%

The AI uses this as a bias, not a constant reorder.

2. Projects = health signals (why should it rise now?)

Project “priority” should be derived from signals:

Deadline proximity (real deadlines)

Staleness (no progress in N days)

Blocker risk (others waiting, external dependency)

Leverage (unblocks many tasks / large impact)

Commitment pressure (promised someone)

This is how priority “shifts depending on progress/blockers” without you micromanaging.

3. Tasks = next actions (what can I do in the next slot?)

Tasks don’t need global rank. They need fit:

available time

energy

context

dependency readiness

contributes to today’s focus outcome

So you pick the best next action given now, not “top of queue forever.”

Habits / daily things

Habits are not tasks. If you put them in the same list, they either:

drown out real work, or

get ignored and create guilt.

Treat habits as a separate layer: Routines with flexible completion windows.

Key features that make habits play nicely:

Flexible windows (“any time before 2pm”)

Minimum viable version (“5 minutes counts”)

Forgiving streak logic (avoid punishment spirals)

Auto-snooze when calendar is slammed

Mode-aware suggestions (don’t push “deep work” habit during 8 hours of meetings)

Also: habits can be anchors for your day (“morning plan,” “shutdown ritual”) that keep the system calibrated without a weekly review.

Calendar-aware: what “aware” actually means

Calendar awareness isn’t just “don’t schedule tasks during meetings.” It should do four things:

Slotting
Use real gaps to suggest work that fits:

12 minutes before next call → admin / quick wins

90-minute block → deep work item

end-of-day 20 minutes → follow-ups / planning

Preparation + follow-up automation
Before a meeting: “prep questions / doc review”
After a meeting: “capture decisions / create tasks / send recap”
This is huge leverage because meetings generate most work.

Overcommit detection
If the calendar is packed, the system should say:

“You have 45 minutes of real focus time today. Want me to protect it?”

“You’re carrying 6 commitments with deadlines inside 5 days — something must slip.”

Time-based constraints
Location changes, travel, “kid pickup at 3:15,” etc. These create context shifts the AI can use.

The hard design constraint you’re implicitly aiming for

The system must continuously renegotiate reality:

what time exists (calendar),

what must happen (deadlines/commitments),

what matters (allocation/goals),

what’s possible now (energy/context),
with minimal human overhead.

If you want, I can sketch a concrete “priority engine” that combines:

portfolio allocation (areas),

project health scoring (staleness/blockers/deadlines),

task fit scoring (time/energy/context),
plus the exact tiny set of user actions that keeps it accurate without weekly review.

I'm going to put this into a coding AI. Describe the core conepts of this project and how it should take shape in being built. For now the MVP will just be sqllite and local first. I'll just put my own API keys in. I want to focus on the shape of the data, how AI categorizes, and then how it's realized in the product UI/UX.
Thought for 15s

Below is a build-shape spec you can paste into a coding AI. It focuses on: core concepts, SQLite data shape, AI categorization pipeline, and how it shows up in UI/UX for a local-first MVP.

1. Core concepts
   A. Everything starts as an “Inbox Item”

User dumps text/voice snippets with zero structure. The system’s job is to turn inbox items into structured objects (task / project / routine / note) with minimal follow-up.

B. Separate “hard deadlines” from “remind me later”

Two different semantics:

hard_deadline: real, external consequence (tax filing, registration closes).

check_after: internal nudge (“ask me again next week/month”), used to avoid “due-date bumping”.

C. Portfolio → Project → Next Action (not a giant ranked list)

Area (company/life area): a bucket with allocation bias (how much attention it deserves over a week/month).

Project: an outcome with health signals + a heartbeat.

Task: a concrete next action that fits “now” constraints.

D. “Now Deck” instead of “Master List”

The UI primarily shows:

1 recommended next action

2 alternates
Each with a short reason. Everything else is accessible but not shoved in the face.

E. Routines/Habits are not tasks

Habits are routines with:

windows (“any time before 2pm”),

minimum viable completion,

forgiving behavior (skip doesn’t create a backlog guilt pile).

F. Calendar-aware = gap-aware + meeting pre/post actions

Calendar awareness does:

selects tasks that fit real gaps,

generates “prep” and “follow-up” suggestions around meetings,

detects overcommit.

2. SQLite data model (MVP)

Design goal: store facts + user overrides; derive everything else. Keep manual state minimal.

Tables (recommended)
-- Raw capture
CREATE TABLE inbox_items (
id TEXT PRIMARY KEY,
created_at_utc INTEGER NOT NULL,
source TEXT NOT NULL, -- 'manual', 'share', 'voice', etc.
raw_text TEXT NOT NULL,
raw_context_json TEXT, -- optional (app, url, etc.)
processed_at_utc INTEGER
);

-- Areas: companies, life buckets, roles
CREATE TABLE areas (
id TEXT PRIMARY KEY,
name TEXT NOT NULL,
description TEXT,
is_active INTEGER NOT NULL DEFAULT 1,
allocation_weight REAL NOT NULL DEFAULT 1.0, -- bias, not a strict priority
created_at_utc INTEGER NOT NULL,
updated_at_utc INTEGER NOT NULL
);

-- Projects: outcomes with heartbeat and health
CREATE TABLE projects (
id TEXT PRIMARY KEY,
area_id TEXT,
name TEXT NOT NULL,
outcome TEXT, -- “What does done look like”
status TEXT NOT NULL DEFAULT 'active', -- 'active','waiting','someday','done'
heartbeat_days INTEGER NOT NULL DEFAULT 14, -- resurfacing cadence if idle
last_progress_at_utc INTEGER, -- updated when tasks complete / user marks progress
created_at_utc INTEGER NOT NULL,
updated_at_utc INTEGER NOT NULL,
FOREIGN KEY(area_id) REFERENCES areas(id)
);

-- Tasks: executable actions
CREATE TABLE tasks (
id TEXT PRIMARY KEY,
area_id TEXT,
project_id TEXT,
title TEXT NOT NULL,
notes TEXT,

status TEXT NOT NULL DEFAULT 'active', -- 'active','waiting','someday','done'
waiting_on TEXT, -- who/what blocks it (free text)
dependency_task_id TEXT, -- optional

hard_deadline_utc INTEGER, -- REAL deadline (rare)
check_after_utc INTEGER, -- nudge date (common)
estimated_minutes INTEGER, -- rough, can be null
energy TEXT, -- 'low','med','high' (nullable)
context_tags TEXT, -- comma list: 'computer,phone,errands'
created_at_utc INTEGER NOT NULL,
updated_at_utc INTEGER NOT NULL,
completed_at_utc INTEGER,

FOREIGN KEY(area_id) REFERENCES areas(id),
FOREIGN KEY(project_id) REFERENCES projects(id),
FOREIGN KEY(dependency_task_id) REFERENCES tasks(id)
);

-- Routines / habits
CREATE TABLE routines (
id TEXT PRIMARY KEY,
area_id TEXT,
name TEXT NOT NULL,
description TEXT,
schedule_rrule TEXT NOT NULL, -- e.g. iCal RRULE
window_start_local TEXT, -- '07:00' optional
window_end_local TEXT, -- '14:00' optional
minimum_minutes INTEGER NOT NULL DEFAULT 5, -- MV completion
target_minutes INTEGER, -- optional
is_active INTEGER NOT NULL DEFAULT 1,
created_at_utc INTEGER NOT NULL,
updated_at_utc INTEGER NOT NULL,
FOREIGN KEY(area_id) REFERENCES areas(id)
);

CREATE TABLE routine_completions (
id TEXT PRIMARY KEY,
routine_id TEXT NOT NULL,
completed_at_utc INTEGER NOT NULL,
minutes INTEGER,
note TEXT,
FOREIGN KEY(routine_id) REFERENCES routines(id)
);

-- Calendar events cache (local-first + API keys)
CREATE TABLE calendar_events (
id TEXT PRIMARY KEY,
provider TEXT NOT NULL, -- 'google'
provider_event_id TEXT NOT NULL,
start_utc INTEGER NOT NULL,
end_utc INTEGER NOT NULL,
title TEXT NOT NULL,
location TEXT,
attendees_json TEXT,
last_synced_at_utc INTEGER NOT NULL
);

-- AI outputs: keep an audit trail of model decisions
CREATE TABLE ai_inferences (
id TEXT PRIMARY KEY,
created_at_utc INTEGER NOT NULL,
source_type TEXT NOT NULL, -- 'inbox_item','task','project'
source_id TEXT NOT NULL,
model TEXT NOT NULL,
prompt_hash TEXT NOT NULL,
output_json TEXT NOT NULL,
confidence REAL,
applied INTEGER NOT NULL DEFAULT 0 -- whether you applied these suggestions
);

-- Lightweight event log for local-first debugging + undo
CREATE TABLE activity_log (
id TEXT PRIMARY KEY,
created_at_utc INTEGER NOT NULL,
entity_type TEXT NOT NULL, -- 'task','project','routine'
entity_id TEXT NOT NULL,
action TEXT NOT NULL, -- 'create','update','complete','snooze','assign'
payload_json TEXT
);

-- Helpful indexes
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_check_after ON tasks(check_after_utc);
CREATE INDEX idx_tasks_deadline ON tasks(hard_deadline_utc);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_progress ON projects(last_progress_at_utc);
CREATE INDEX idx_calendar_time ON calendar_events(start_utc, end_utc);

Notes

Store times in UTC; present in America/Denver in UI.

Keep context_tags simple (CSV) for MVP; normalize later if needed.

ai_inferences is crucial: makes AI behavior debuggable and user-trustable.

3. AI categorization pipeline (MVP behavior)
   Step 0 — Ingest

User creates inbox_item with raw text.

Step 1 — “Parse intent” classification (single call)

LLM produces a JSON “proposal”:

kind: task | project | routine | note

extracted fields (deadline vs check_after, estimate, energy, area/project guesses)

confidence per field

suggested clarification questions only if blocking and confidence is low

Key rule: default to check_after, not deadline, unless language indicates hard consequence.

Suggested extraction JSON schema
{
"kind": "task",
"title": "Register kid for soccer",
"notes": "",
"hard_deadline": { "date": "2026-02-22", "time": "17:00", "timezone": "America/Denver", "confidence": 0.82 },
"check_after": null,
"estimate_minutes": 10,
"energy": "low",
"context_tags": ["phone"],
"area_guess": { "name": "Family", "confidence": 0.7 },
"project_guess": { "name": "Kids logistics", "confidence": 0.5 },
"status_suggestion": "active",
"waiting_on": null,
"clarifying_questions": [
{ "question": "Is Feb 22 a real cutoff (hard deadline) or just a reminder?", "only_if_needed": true }
]
}

Step 2 — Apply rules + minimal follow-ups

If hard_deadline.confidence >= 0.75 → set hard_deadline_utc.

Else if user text implies “sometime later / remind me” → set check_after_utc using a heuristic (e.g., 7–14 days).

If project/area ambiguity is high, don’t block. Put task in “Unassigned” area and let UI allow quick reassignment.

Step 3 — Project maintenance (AI-generated next action)

When a project is created or updated, AI should:

propose 1–3 “next actions”

propose heartbeat default (14 days, adjust if urgent)

mark waiting if blocked

Step 4 — “Now Deck” selection (AI + deterministic filters)

You can do this two ways:

MVP: deterministic retrieval + AI re-rank

Later: learned scoring

Deterministic retrieval filters (hard)

status='active'

exclude tasks with check_after_utc > now

exclude tasks with dependencies incomplete

de-prioritize or hide tasks with waiting_on set

Then pass top N candidates + context into LLM to pick:

1 primary + 2 alternates

short reason string for each

suggested “mode” (deep/admin/people/fill)

Context provided to the “deck” call

next calendar event start time

available gap minutes

user-selected mode (optional)

today’s focus outcome (optional)

area allocation weights

deadlines within 7 days

stale projects (heartbeat missed)

Step 5 — Calendar-aware suggestions

Two MVP features:

Gap-fitting: “You have 18 minutes until next meeting → here are 3 tasks <= 18 min.”

Meeting pre/post: When an event is within 30–60 mins, suggest prep tasks; after event ends, suggest capture/follow-up.

4. UI/UX realization (MVP screens + interactions)
   Screen A — Capture (always available)

single input box + voice

submit creates inbox_item

show “Processed into: Task/Project/Routine” toast + edit chips

Critical one-tap chips

Assign area

Assign project

Set: Deadline / Remind me later

Mark Waiting on

Snooze

Screen B — NOW (the Deck)

Shows 3 cards:

Recommended next action

Alternate (lower energy / shorter)

Alternate (progress on a stale project)

Each card includes:

title

estimated minutes

badges (deadline, waiting, area/project)

reason line (trust)

actions: Done / Snooze / Waiting / Reassign / Not today

A “Mode” selector:

Deep

Admin

People

Fill (5–15m)
Switching mode reshuffles the deck.

A “Time available” quick picker:

10m / 25m / 60m / 2h

Screen C — RADAR (stale + important but not urgent)

Not a list of everything.
It’s a feed of:

projects that missed heartbeat

tasks that have been snoozed multiple times

commitments with approaching deadlines

Each item offers:

“Revive” (generate next action)

“Snooze 2 weeks”

“Move to Someday”

“Mark Waiting”

Screen D — Projects

Project page shows:

outcome

last progress date

next action (single highlighted)

tasks grouped by status (active/waiting/someday)

“Generate next actions” button

Screen E — Routines

Simple daily view:

today’s routine checklist with completion window

“minimum viable done” button

completion streak displayed gently (no guilt backlog)

Screen F — Calendar

Day agenda + gap highlights.
Tap a gap → “Fill this gap” → opens deck filtered to fit.

5. Product behavior rules (the “effortless contract”)

Deadlines are sacred
Only set a hard deadline when it’s truly a cutoff. Otherwise use check_after.

Waiting is first-class
Tasks with waiting_on should not keep resurfacing as “do now”.

A project always has a next action
If not, it resurfaces as a blocker in Radar.

User overrides beat AI
If user changes fields, that becomes truth. Store AI suggestion in ai_inferences, but don’t fight user.

Maintenance is micro
Never require a weekly review. Instead: Radar drip + deck reasons + one-tap corrections.

6. Build order (practical MVP sequence)

SQLite schema + migrations

Capture inbox → AI parse → create task/project/routine

Task list view + edit chips (deadline vs remind)

Calendar sync cache (Google Calendar API) + gap calculation

Now Deck: deterministic candidate selection + LLM choose top 3 + reasons

Radar feed: missed heartbeats + snooze repeats + near deadlines

Routines: RRULE + completion logging

7. Suggested LLM prompt structure (high-level)
   Parse prompt components

System: “You are a task triage assistant… return strict JSON…”

Input: raw_text + current date/time + timezone + known areas/projects list (names only)

Output: JSON schema above

Deck prompt components

Input: available_minutes, mode, next_event_time, list of candidate tasks (id, title, deadline/check_after, estimate, energy, project/area, waiting_on)

Output: { primary: task_id, alternates:[...], reasons:{...}, mode_suggestion:"Admin" }

If you want, I can also provide:

a minimal “deterministic scoring” function (no ML) to select candidates before LLM re-rank,

a tight JSON Schema you can validate against (to harden the pipeline),

sample seed data + test cases for tricky inputs (deadlines vs reminders, waiting, ambiguous projects, etc.).

Should we have a "context" field? Or is that oru "area"? Ex. I'm workign on home tasks now, so it shows all home.
Thought for 12s

Have both concepts, but don’t overload one field to do two different jobs.

Area ≠ Context
Area

A domain of responsibility / bucket.

“Home”

“Work → Company A”

“Family”
This is what you’re describing (“I’m working on home tasks now”). In most cases, that’s just filter by Area.

Context

A situational execution constraint that can cut across areas.

tool/location: phone, computer, errands, at_home, airport

social: with_team, alone

cognitive: deep, admin, low_energy
This is not the same as “Home,” because you can do “Home tasks” that require errands, and also do “Work tasks” that require phone.

So:

Use Area for “what part of life/company”

Use context_tags + mode/energy for “what’s possible right now”

MVP recommendation

1. Keep area_id (you already have it)

That’s your “show all home” filter.

2. Don’t add a single context field

One context field becomes a messy taxonomy fight (“home/admin/phone??”). Instead keep the lightweight pieces you already hinted at:

context_tags (CSV for MVP) like phone,errands,computer

energy (low|med|high)

optionally estimated_minutes

3. Add an ephemeral “current focus scope” (this is the UX you want)

When you say “I’m working on home tasks now,” that’s not a property of each task. It’s user state.

Add a tiny table:

CREATE TABLE user_state (
id INTEGER PRIMARY KEY CHECK (id = 1),
active_area_id TEXT,
active_project_id TEXT,
active_mode TEXT, -- 'deep','admin','people','fill'
active_context_tags TEXT, -- 'phone,errands'
active_until_utc INTEGER, -- optional auto-expire
updated_at_utc INTEGER NOT NULL
);

Then the “Now Deck” query uses:

hard filters: active tasks, not snoozed, not blocked

plus scope bias/filter from user_state:

if active_area_id set → prefer/limit to that area

if active_context_tags set → prefer tasks whose tags intersect

if active_mode set → prefer matching energy/time profiles

What the UI should feel like

Top of the app: Scope pill + Mode pill + Time pill

Scope: All | Home | Company A | Family | (recent scopes)

Mode: Deep | Admin | People | Fill

Time: 10m 25m 60m 2h

When you tap Home, it sets user_state.active_area_id = home.
Optional: “for 2 hours” sets active_until_utc.

Practical rule of thumb

If it’s a stable bucket you’d browse → Area

If it’s a temporary constraint you’re operating under → User state + context tags/mode

If it’s a property of doing the task (needs phone/errands) → task context_tags

This keeps the database clean, avoids a “taxonomy maintenance” trap, and gives you exactly the behavior you want (“I’m in Home now → show Home”).

Personal context search is currently disabled. If you want me to reliably carry forward decisions/preferences across future chats, enable it in **Settings → Personalization → Memory**.

Below is a comprehensive PRD based on everything we defined in _this_ conversation (problems + core concepts + MVP constraints: SQLite, local-first, your own API keys).

---

# PRD: Eon (Local-First AI Task Operating System)

## 1) Summary

Eon is a local-first task OS that eliminates the “task management tax” by using AI to triage captured inputs into structured work (tasks, projects, routines), and by presenting a **Now Deck**—a small set of recommended next actions—matched to the user’s **current constraints** (calendar gaps, context, energy, mode) with clear rationale. Eon separates **hard deadlines** from **resurfacing reminders** (“boomerang dates”) to kill deadline-bumping and alert fatigue.

**MVP scope:** Single-user, local SQLite DB, local UI app, Google Calendar read sync (optional), LLM via your API keys.

---

## 2) Goals

1. **Zero/near-zero maintenance**: no weekly review required to keep the system usable.
2. **Eliminate the “what should I do now?” tax**: always provide a best-next-action recommendation + alternates.
3. **Kill the snooze loop**: strict separation of hard deadlines vs resurfacing reminders.
4. **Be calendar- and context-aware**: recommendations fit real gaps and current mode.
5. **Support parallel work**: handle “waiting” and “gap tasks” during async/AI/builder wait states.
6. **Make projects move**: every active project maintains a “next action,” or is flagged as blocked.
7. **Handle habits correctly**: routines with windows + minimum viable completion; not mixed with one-off tasks.
8. **Trust + control**: explainable suggestions, one-tap overrides, undo, and an inference audit trail.

---

## 3) Non-goals (MVP)

- Multi-user collaboration, shared workspaces, delegations beyond “waiting on.”
- Full email/Slack ingestion.
- Cloud sync / multi-device sync.
- Automatic task completion from external systems.
- Perfect estimation or fully autonomous scheduling.

---

## 4) Target users / personas

- **Busy founder / operator** (primary): multiple companies/projects + life obligations; high context switching; wants “tell me what to do now.”
- **Knowledge worker** (secondary): meeting-heavy schedule; needs calendar-aware gap fitting and meeting follow-up capture.
- **Maker / builder** (secondary): parallel threads with AI coding/builds; needs “fill” mode and wait-state support.

---

## 5) Key user problems (design anchor)

Eon must solve:

- maintenance tax, topology vs queue, snooze loop, blank page, context/calendar blindness, over-commitment, waiting/dependencies, project drift, slow-burn resurfacing, habits vs tasks mismatch, over-capture anxiety, trust/explainability, correction friction.

---

## 6) Primary user journeys

### Journey A: Capture → Structured

1. User types/voices: “Sign kid up for soccer by Sunday”
2. Eon creates Inbox Item
3. AI proposes: task title, hard deadline vs boomerang, estimate, energy, tags, area/project guesses
4. Eon applies automatically; if uncertainty is high only on **deadline vs reminder**, it asks a single clarifying question (optional UX).

**Success:** user can capture in <5 seconds; no forced fields.

---

### Journey B: Sit down → Do Now (Now Deck)

1. User opens app
2. Eon reads calendar: next meeting + gap length
3. User optionally sets scope: “Home” and mode: “Admin”
4. Eon shows 3 cards: **Recommended**, **Alternate**, **Alternate**
5. User hits “Start” / “Done” / “Snooze” / “Waiting” in one tap

**Success:** user can start within 10 seconds without browsing lists.

---

### Journey C: Meeting loop closure

1. Upcoming meeting in 30 minutes → Eon suggests 1–2 prep tasks
2. After meeting ends → Eon prompts capture: decisions/follow-ups → creates tasks and waiting items

**Success:** meeting work reliably enters the system.

---

### Journey D: Slow-burn resurfacing

1. “Open source library” project hasn’t moved in 30 days
2. Radar surfaces it with a gentle check-in and a proposed next action
3. User “Revive” or “Snooze 1 month” or “Move to Someday”

**Success:** slow-burn stays alive without daily noise.

---

### Journey E: Habits/routines

1. Daily routine appears in a window (“before 2pm”)
2. User completes “minimum viable” quickly
3. Routine completion tracked without creating backlog debt if missed

**Success:** habits support consistency without guilt.

---

## 7) Product surfaces (UX)

### A) Universal Capture

- Single input (text + voice)
- Immediate confirmation: “Captured”
- Optional post-capture chips:
  - Assign Area / Project
  - Deadline / Remind later
  - Waiting on
  - Snooze
  - Estimate (quick presets)

### B) NOW (The Deck)

- 3 cards max:
  1. Recommended
  2. Alternate (shorter/lower energy)
  3. Alternate (unblocks something / revives stale project)

- Each card includes:
  - Title
  - badges: area/project, deadline, waiting, estimate
  - **Why** (one line)

- Controls:
  - Done
  - Snooze (1d/3d/1w/custom)
  - Not today
  - Mark waiting (w/ person)
  - Reassign area/project
  - Undo

Top controls:

- Scope pill: All / Home / Company A / Family …
- Mode pill: Deep / Admin / People / Fill
- Time pill: 10m / 25m / 60m / 2h

### C) RADAR (Resurfacing feed)

- Items surfaced by:
  - missed project heartbeat
  - repeated snoozes / repeated deferral
  - near hard deadlines
  - “project has no next action”

- Actions:
  - Revive (generate next action)
  - Snooze
  - Move to Someday
  - Mark waiting
  - Dismiss (low-intent decay)

### D) Projects

- Outcome, heartbeat, last progress
- Highlighted “Next action”
- Task groups by status (active/waiting/someday/done)
- “Generate next actions” button

### E) Routines

- Today view with completion windows
- “Minimum viable done” button
- Gentle streak (optional), no backlog guilt

### F) Calendar view (MVP simple)

- Agenda + highlighted gaps
- Tap gap → “Fill this gap” → filtered deck

---

## 8) Functional requirements

### FR1: Inbox capture

- Create `inbox_item` from text/voice
- Store raw text + metadata
- Trigger AI triage

**Acceptance**

- Capture works offline
- No required fields beyond text

---

### FR2: AI triage → structured entities

From inbox text, classify into:

- task / project / routine / note
  Extract:
- title, notes
- hard_deadline vs boomerang (check_after)
- estimate_minutes (nullable)
- energy (nullable)
- context_tags (nullable)
- area/project guess (nullable)

**Acceptance**

- Must return strict JSON (schema validated)
- Default to boomerang unless hard deadline confidence high
- Save inference to `ai_inferences` for audit

---

### FR3: Deadline vs boomerang semantics

- `hard_deadline` only for real cutoffs
- `check_after` controls resurfacing; snooze sets `check_after`
- Overdue states only apply to real deadlines

**Acceptance**

- Items with only `check_after` never show “overdue”
- Snoozing never creates red badges

---

### FR4: Task states + waiting

States: `active | waiting | someday | done`

- Waiting tasks suppressed from execution views
- Waiting has follow-up cadence (MVP: default 3 business days)
- Surface waiting items before meeting with that person (if calendar event matches attendee/name text loosely)

**Acceptance**

- Waiting tasks don’t appear in Now Deck unless explicitly requested
- Follow-up reminders appear in Radar

---

### FR5: Dependencies (MVP light)

- Optional `dependency_task_id` blocks task if dependency incomplete
- Blocked tasks suppressed from Now Deck

**Acceptance**

- If dependency not done → task excluded from execution candidates

---

### FR6: Projects require next actions

- Active projects should always have at least one active “next action” task
- If none, project appears in Radar as “missing next action”
- AI can propose next actions on project creation/update

**Acceptance**

- “Active project without next action” is detectable and surfaced

---

### FR7: Now Deck generation

Inputs:

- candidate tasks (filtered by status, snooze, waiting, dependencies)
- user scope/mode/time available
- calendar gap until next event
- stale projects and upcoming deadlines

Process:

1. Deterministic candidate selection (top N)
2. LLM rerank/pick 1 + 2 alternates + reasons

**Acceptance**

- Always returns 1–3 items if any are available
- Each item has a one-line rationale

---

### FR8: Radar resurfacing logic

Resurface:

- missed heartbeat projects
- repeated snoozes/deferrals
- near deadlines
- overcommit flags
- waiting follow-ups

**Acceptance**

- Radar is not a full list; it’s a curated feed with actions

---

### FR9: Routines/habits

- RRULE schedule + optional window start/end
- Minimum viable completion
- Completion tracking
- Missed routine does not create backlog items

**Acceptance**

- Daily routines appear only inside their window (or gently after, configurable)
- No “overdue habit” badges by default

---

### FR10: Calendar sync (read-only, MVP)

- Google Calendar event cache locally
- Compute available gaps and day capacity
- Meeting prep/follow-up prompts (MVP basic)

**Acceptance**

- App functions without calendar enabled
- If enabled, deck respects next event + gaps

---

### FR11: One-tap correction + undo

- Reassign area/project, set waiting, snooze, mark done
- Undo last action (via `activity_log`)

**Acceptance**

- Most corrections are one-tap from Deck cards
- Inference audit retained

---

## 9) Data model (MVP)

Use the SQLite schema we discussed (inbox_items, areas, projects, tasks, routines, routine_completions, calendar_events, ai_inferences, activity_log) plus a tiny `user_state` table for current scope/mode/time.

Key semantic fields:

- `hard_deadline_utc` vs `check_after_utc`
- `status`
- `waiting_on`
- `heartbeat_days` + `last_progress_at_utc`
- `context_tags`, `energy`, `estimated_minutes`

---

## 10) AI design

### A) Triage model outputs

- strict JSON schema
- includes confidence per field
- produces clarification questions only when needed (MVP: only deadline vs reminder)

### B) Candidate selection (deterministic)

Filter out:

- not active
- snoozed (`check_after_utc > now`)
- waiting
- blocked by dependency
  Then sort heuristically by:
- hard deadline proximity
- project heartbeat missed / staleness
- “unblocker” effect (task is dependency for others)
- fit to time available and mode

### C) Rerank/pick (LLM)

Given top N candidates + context → choose:

- primary + 2 alternates
- one-line reason each

### D) Learning loop (MVP lightweight)

Track user overrides:

- task snoozed repeatedly
- “not today”
- reassigned area/project
  Use this to adjust future suggestions (MVP: simple heuristics, not training).

---

## 11) Non-functional requirements

- **Local-first:** all data in SQLite; works offline
- **Performance:** Now Deck response < 1s excluding LLM; show “draft deck” from deterministic scoring immediately, then refine when LLM returns (optional)
- **Privacy:** data stays local; API keys stored locally (env/config); clear “calendar access on/off”
- **Reliability:** schema migrations; audit log; undo
- **Observability:** inference logs; prompt hash; error display for invalid JSON

---

## 12) Success metrics

- Time-to-capture (median) < 5 seconds
- Time-to-start-work after opening app < 10 seconds
- % sessions where user acts directly from Now Deck (Done/Snooze/Waiting) > 60%
- Reduction in “overdue items” count (should be low; only real deadlines)
- Weekly active usage without explicit “weekly review”
- Ratio of “fake deadlines” to total deadlines approaches ~0

---

## 13) MVP milestones

1. SQLite schema + CRUD + capture UI
2. AI triage pipeline + inference audit
3. Tasks/Projects UI + one-tap corrections + undo
4. Now Deck v1 (deterministic) + mode/scope/time controls
5. Now Deck v2 (LLM rerank + reasons)
6. Radar v1 (heartbeat + snooze patterns + deadlines)
7. Routines v1 (RRULE + window + completion)
8. Calendar sync + gap fitting + meeting loop v1

---

## 14) Risks & mitigations

- **LLM hallucinated structure** → strict JSON schema validation + retry with “fix JSON” prompt; store raw outputs.
- **User distrust of AI** → always show rationale; strong overrides; never nag via fake overdue.
- **Overcapture anxiety** → clear “someday/ideas” handling + gentle decay + Radar batch dismiss.
- **Calendar complexity** → MVP read-only; simple gap computation; no auto-scheduling yet.

---

## 15) Open questions (safe to defer)

- How explicit should “areas/companies” setup be vs inferred?
- How aggressive should decay/pruning be (and what’s the UX for “auto-archive”)?
- How to best represent “active threads” (project-based, explicit thread entity, or implicit via recent activity)?
- When to ask clarifying questions vs silently defaulting?

---

If you want, I can turn this PRD into:

- a concrete **MVP feature checklist** with acceptance tests per feature,
- a **prompt pack** (triage + deck + project next action + meeting follow-up),
- or a **technical architecture doc** (modules, APIs, job queue, schema migrations, caching).
