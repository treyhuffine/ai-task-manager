# The Problem with Task Management — Final Problem Statements

These are the core truths about why task management systems fail, framed as the problems Eon exists to solve.

A brain dump of what I want to accomplish, and below it are the problems and first principles.

I am building a task system for the AI-first world. It should handle all the difficult parts of a task system. Key concepts:

- It is more of a routing engine than a task manager
- We are solving the problem people spending tons of thinking about what to do instead of doing. The AI should do most the heavy lifting. The user is mostly told what to do, with maybe a small subset of options or reminders to dial it in.
- The goal is to not give a heavy system for the user to manage. Painful systems get abandoned. A person should be given more time to focus on the things that really matter - they have higher output with lower energy input/burnout
- Users need to feel confident all their ideas get captured and surfaced when it makes sense and that something important doesn't get lost.
- The user always knows where things left off and what to do when they pick up a project/task. Context switching cost should be minimal.
- We will start local first (sqllite and my own API keys. No auth to get in. We want to nail the core concepts. I may switch to markdown over sqllite, so may this layer easy to experiment with how data is stored)
- The AI should handle all the tedious work (labeling, triaging intake against what exists, present a short list of what matters)
- No due dates unless it's a hard deadline. Otherwise we want some way to track rough time periods of execution. So maybe a created date and an urgency. We surface more urgent things more and do it more the longer they push it off or ask the user if the urgency is lower. (I'm not sure if urgency is the right word, but I'm also not sure priority is either.)
- Since there are no dates, we will think more in a queue, but the challenge with queues (ex. The GTD framework which is the best we had up until now), is that tasks aren't static or linear. We may multi-task, especially if we're waiting on an AI coding assistant or something. Priority ebs and flows as life evolves.
- There will be an Agent Activity tab that shows all the updates an agent makes. The user can change anything right there, or ask the AI to change it.
- We must connect calendars to see what's going on in a day so the AI is aware of time avialable
- We will have an internal calendar (not push to google) where it will have context blocks and real commitments pulled from their external calendar.
- Capture should be effortless and the AI should be really effective. We may need some kind of agentic loop that takes the input and correctly sets all the fields and attaches it to projects.
- We need to have some way to incorporate habits/rituals but not make them a task. Maybe a separate list with offers of time to do it.

Should the AI present time slots exact work, or rough context and project(s) they can do in deep work, between meetings, etc?

Overall, I don't want to overengineer. If a user looks under the hood, they shouldn't vomit. It shouldn't be brittle to maintain. The concepts behind this should be simple, clear, and scalable.

---

## 1. The Maintenance Tax

Traditional systems require constant housekeeping — tagging, reordering, weekly reviews, moving items between states. The system itself becomes work. When life gets busy (when you need it most), maintenance is the first thing dropped, and the system collapses.

**Insight:** Maintenance must be near-zero and continuous — amortized into tiny moments (one-tap corrections), not a weekly ceremony. The human captures and executes. The AI routes, maintains, resurfaces, and prunes.

---

## 2. Work Is a Topology, Not a Queue

Real work is multi-dimensional and parallel. What you should do next depends on time available, energy, environment, urgency, deadlines, dependencies, and project importance — simultaneously. These shift throughout the day. Modern AI-assisted workflows make this worse: people run 2-3 active threads, waiting on code generation, builds, reviews, and other people. Flat lists and kanban boards can't represent this, so users do the real prioritization in their head.

**Insight:** The system must model tasks across multiple dimensions, support active parallel threads and wait states, and dynamically match work to the user's current constraints — not force them to collapse reality into a single ordering.

---

## 3. The Blank Page Problem

The most draining moment is opening a list of 50 items and deciding what's most valuable. Decision fatigue leads to freezing or "productive procrastination" — doing easy, low-value tasks to feel busy. The cognitive cost of choosing often exceeds the cost of doing.

**Insight:** The system should present a strong recommendation with a short rationale, plus a couple of alternatives. The user should sit down and immediately know what to do and why — not browse a menu.

---

## 4. The Snooze Loop

People assign due dates not because something is actually due, but to avoid forgetting. When the date arrives and they're not ready, they bump it. This compounds — 20 fake deadlines to dismiss daily — generating guilt, alert fatigue, and destroyed trust. "Overdue" loses all meaning.

**Insight:** Hard deadlines (external, immovable) and resurfacing (internal, flexible) are fundamentally different needs. Most items shouldn't have due dates. They need a "boomerang" — a point at which the AI checks back in, silently, without guilt or red badges.

---

## 5. Context and Calendar Blindness

Task lists don't know you're on your phone, at a doctor's office, mentally depleted, or that you have 12 minutes before the next meeting. People don't have "8 hours of work time" — they have fragmented gaps around meetings, commutes, and commitments. Without awareness of calendar, time, energy, and environment, every suggestion is a guess and every plan is fiction.

Additionally, meetings are one of the largest sources of new work — prep, decisions, follow-ups — and almost none of it gets captured reliably. The loop from "meeting happened" to "tasks exist in the system" is broken.

**Insight:** The calendar is the constraint layer. The system must compute real available capacity, factor in buffers and transitions, filter suggestions to what's actually doable now, and close the meeting loop (prep → decisions → follow-ups).

---

## 6. Over-Commitment Is Invisible Until Failure

Most systems let users pile on unlimited work without modeling load versus capacity. People can't see the mismatch until deadlines slip and stress spikes. Task tools enable wishful planning instead of enforcing tradeoffs.

**Insight:** The system must model total commitments against real capacity and force explicit choices: "You have more committed work than available time this week. What are we cutting, deferring, or renegotiating?"

---

## 7. Blocked Work Creates Noise

Work is often blocked — on other people (reviews, decisions, deliverables) or on prerequisite tasks, approvals, or external events. Blocked items shouldn't appear in the active execution view, but they need tracking and follow-up. Most systems treat "waiting" and "blocked" as afterthoughts, so these items either nag constantly or vanish until too late.

**Insight:** "Waiting on" and "blocked by" must be first-class states — auto-suppressed from execution, with follow-up timing, and automatic resurfacing when relevant (e.g., before a meeting with the person you're waiting on, or when a prerequisite task completes).

---

## 8. Projects Drift Without Next Actions

A project can be "high priority" indefinitely while making zero progress because no one has defined the concrete next step. Most tools treat projects as containers, not outcomes requiring a maintained next action. Projects stall silently.

**Insight:** Every active project needs a maintained next action. If none exists, the project is effectively blocked — whether or not anyone has labeled it that way. The system must detect and flag this.

---

## 9. Slow-Burn Projects Have No Home

Some meaningful work progresses in tiny increments over months or years — open-sourcing a library, writing a book, learning a skill. Current systems either bury it forever in a backlog (lost) or surface it daily alongside urgent work (noise). There is no middle ground between "forgotten" and "nagging."

**Insight:** Slow-burn work needs a periodic heartbeat — a "project pulse" that resurfaces it on an appropriate cadence (weekly, monthly) for a check-in, without treating it as overdue or competing with today's urgent items.

---

## 10. Completion Debt Is Invisible

Items that are 80-90% done sit unfinished because the remaining work is boring, hard, or ambiguous. Starting something new feels more productive, but value is captured at completion, not initiation. This creates a growing pile of almost-done work that represents significant wasted investment.

**Insight:** The system should detect near-complete items and actively prioritize them: "30 minutes finishes this" paired with a concrete finishing step. The ROI of completing is almost always higher than the ROI of starting.

---

## 11. Emotional Avoidance Masquerades as Low Priority

Some tasks get deferred repeatedly not because they're unimportant but because they trigger discomfort — hard conversations, financial paperwork, irreversible decisions. Systems treat every deferral identically and respond by adding pressure (red badges, urgency escalation), which makes avoidance worse.

**Insight:** Repeated deferral of a non-trivial item should trigger a different response: break it down, reduce scope, suggest the smallest possible first step, or gently name the pattern. Handle the psychology, not just the logistics.

---

## 12. Habits, Routines, and Rituals Aren't Tasks

Recurring activities get crammed into task lists where they don't belong. But they're not all the same thing either:

- **Habits** are things you do for their own sake — workout, meditate, read. The value is consistency. Missing one day isn't failure; missing a week is a signal. They need streaks, forgiveness, and "minimum viable completion" (even 10 minutes counts).
- **Routines** are recurring obligations that have real consequences if skipped — pay bills, do laundry, water plants. They need flexible windows and "it's been X days" nudges, not streak tracking.
- **Rituals** are time-anchored commitments, often involving others — weekly 1:1s, family dinner, therapy. These are calendar events with prep and follow-up needs.

**Insight:** All three must be modeled separately from one-off tasks, with logic appropriate to each type: forgiving consistency tracking for habits, window-based nudging for routines, and calendar-integrated prep/follow-up for rituals. None of them should flood the daily task queue or generate guilt when missed.

---

## 13. The Capture Paradox

Two opposing forces kill task systems at the input layer:

- **Too much friction:** If adding an item requires choosing a project, setting priority, adding tags, and picking a date, people revert to keeping things in their head. Every field is a decision, and decisions are the bottleneck.
- **Too little friction:** If capture is truly effortless, inventory explodes. Every passing thought goes in. Without intelligent separation and decay, the system becomes a growing monument to everything you haven't done — a debt ledger, not a tool.

And when the system does process input, it will sometimes get it wrong. If fixing a miscategorization takes more than a second, users stop trusting the AI layer entirely.

**Insight:** Capture must be raw-thought-first — structure inferred by AI, never required upfront. But the system must also classify low-intent captures separately (someday/ideas), support gentle decay, enable batch dismissal, and make corrections one-tap. The backlog should feel like a resource, not an indictment.

---

## 14. Cross-Domain Blending and Fragmented Memory

Life doesn't respect boundaries between work and personal. You need to sign your kid up for camp during work hours because registration closes at noon. You think of a work idea at the gym. Systems that force rigid domain separation fail because users live in blended schedules.

Compounding this, tasks and commitments are born across many surfaces — meetings, email, Slack, docs, conversations, random thoughts. Without a unified capture layer, important items slip through or require constant manual consolidation from scattered sources.

**Insight:** One system must hold all life contexts without forcing the user to maintain separate views or switch modes. And it must be the universal inbox — the one place things go so you can trust that nothing is lost, regardless of where the thought originated.

---

## The Meta-Problem

All of these failures share a root cause: **current task systems put the human in the role of both the worker and the system administrator.** You do the work _and_ you maintain the system that tracks the work. The overhead of administration eventually exceeds the value of organization, and people revert to keeping everything in their heads — which is where they started.

**The opportunity:** With AI that can parse, categorize, prioritize, schedule, resurface, and prune, the human's only jobs should be: **capture freely, decide when asked, and execute what's presented.**

---

## Product Principles (derived from the above)

These aren't problems — they're design constraints that determine whether the solutions to the above problems actually hold up in practice:

1. **Transparency builds trust.** Every AI recommendation needs a brief, honest rationale — "due tomorrow," "quick win, you have 15 min," "this project hasn't moved in 3 weeks." Trust compounds through repeated accurate calls.

2. **Minimal state survives contact with real users.** The fewer fields humans touch, the longer the system lives. AI infers; humans override when needed; corrections are one-tap with undo.

3. **Default to filtered, allow the firehose.** The daily view should show only what's actionable now. But "show me everything" must always be one click away. Users need the safety valve to trust the filter.

---

Thoughts:
