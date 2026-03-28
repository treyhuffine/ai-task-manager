# Deck V2 — Spec

> Supersedes the adjust/review sections of `deck-checkin-spec.md`. Intake and triage beats are unchanged. This spec covers what happens after: the generated deck, how the user interacts with it, and how it stays useful throughout the day.

---

## The Problem We're Solving

The user sits down and doesn't know what to work on. They have too many things, unclear priorities, and the mental overhead of choosing is itself a blocker. They stare at the blank cursor.

**What they need:** "I know what to do next and why it matters." Not a perfect plan. Not a comprehensive view. Just enough clarity to start moving.

**What we keep getting wrong:** Over-structuring the output (deep/light/routines as separate categories), adding ceremony (review → confirm → execute as distinct phases), and front-loading decisions the user doesn't need to make yet.

---

## Design Principles

1. **The deck answers one question: "What should I put my energy into today?"** Not "here's your whole day organized by category." The deck is an energy compass — work top to bottom, stop when you stop.

2. **Important work is important work.** No deep/light split as structure. A 15-minute reply that unblocks a major deal is more important than a 3-hour coding session. The AI ranks by impact, not energy type. Energy, effort, and time estimates are metadata — not structural categories.

3. **30 seconds to "go."** The user sees the deck, glances at it, maybe moves one thing, and starts working. No review phase. No confirm button. The deck is immediately actionable.

4. **The deck is a living document, not a generated artifact.** It persists throughout the day. Complete something, it updates. Remove something, alternatives are right there. The generation moment is just the first render. The user's edits are respected — the AI doesn't re-rank unless explicitly asked.

5. **Show the AI's reasoning, not just its output.** Each task has a rationale. When the reasoning is visible, the user knows exactly where the AI might be wrong — and fixing it is trivial.

6. **Escape hatches at every level.** If the AI gets it wrong (and it will), recovery must be instant. The deck progressively reveals more options — from the primary stack to alternatives to radar to the full task list.

7. **Energy compass, not todo list.** The deck should never feel like "here are 15 things you have to complete." It's "here's how to prioritize your time." Whether you get through 2 or 7 is fine. The ranking handles what to sacrifice. This is reflected in language, visual design, and information hierarchy.

---

## The Flow

### 1. Context (Optional, ~10 seconds)

A text field: "Anything on your mind before I plan your day?"

Quick-tap chips for common signals. Free text for anything else. Skippable. The AI uses this plus everything it already knows (tasks, deadlines, recent activity, goals, patterns) to generate the deck.

### 2. The Deck

Context → deck. That's it. No triage step, no review phase, no confirm button. The deck appears and the user is immediately in execution mode.

Triage of unsorted stream items happens separately — via the "quick triage" prompt when new captures arrive during the day, or through chat. It never gates deck generation.

---

## The Deck — What The User Sees

### Day Context Line

One line, only when relevant:
> Open morning, fragmented afternoon. Front-load your focused work.

Or:
> Quarterly report is due end of day.

This is the *shape* of the day — what the AI knows about time, energy, and constraints. If nothing notable, this line is absent. This is not a summary of the tasks.

### The Priority Stack

A ranked list of tasks — the core of the deck:

```
1. ProjectAlpha — Finish API integration                  Alpha · M
   Last blocker before launch. One session away from done.
   ├ Wire up auth endpoint            ·················· done
   ├ Test error handling              ··················
   └ Update API docs                  ··················

2. ClientProject — Fix billing bug                        Client · S · Due Thu
   Customer-facing, 3 days old. Clear repro, well-scoped.

3. Reply to partner about deal terms                      Alpha · ~15m
   They're waiting on this to move forward.

4. Quarterly report                                       Ops · Due today
   Due end of day. Even 30 min of progress helps.

5. Review open PR                                         Client · ~5m
   Blocking the deploy pipeline. Quick review.
```

**Key characteristics:**

- **One list, ranked by importance.** Not grouped by energy type. A 5-minute review can rank above a 3-hour coding session if it's blocking something.
- **Per-task rationale.** One line under each task explaining why it's here and why at this position. This is how the user evaluates the AI's reasoning.
- **Subtasks visible when they exist.** The parent task is the "what" — subtasks show progress and what specifically to work on. Collapsed by default on items below #1.
- **Metadata as pills, not structure.** Area, effort (XS/S/M/L/XL), time estimate (~15m), deadline (Due Thu) — shown inline.
- **Urgent items are in the list, not in side callouts.** If something is due today, it's ranked appropriately with rationale explaining the urgency. No separate "worth noting" UI.

### Hard Deadline Treatment

Tasks with approaching deadlines get visual urgency:

- **Deadline pill** on the task card (e.g., "Due Thu", "Due today") — always visible when a hard deadline exists. "Due today" and "Due tomorrow" get an amber/warm treatment to stand out.
- **"Due today" filter** above the priority stack — a small toggle that filters the deck to only show items due today. Disabled with a tooltip ("No items with deadline today") when none exist. Subtle, not a separate section.
- **The AI handles ranking:** Deadline proximity is a major factor in the AI's ranking. A task due tomorrow that hasn't been started will rank high with rationale like "Due tomorrow, not started yet." Items due today are ranked at the top.

### Completed Items

Completed tasks collapse into a count at the top of the deck:

```
✓ 3 completed today                                          [view]
```

Tapping expands to show what was done. Keeps the deck focused on what's actionable. Gives a sense of progress without cluttering the view.

### Routines & Habits (Experimental)

A lightweight section below the priority stack. Not numbered, not ranked, not competing with tasks. Just presence and progress:

```
─── Routines ───────────────────────────────
☐ Work out          3 of 4 this week · 12d streak
☐ Read              0 of 1 today · 8d streak
```

- Checkable inline — one tap to mark done
- The AI may reference them in the day context line ("You haven't worked out yet this week") but they don't get rationale or ranking
- Present in the living deck, not in the generation phase
- Collapsible if the user wants to hide them

**Note:** Routines exist in a different dimension than task importance — they're about consistency over time, not urgency today. Days aren't linear; you might deep work, then gym, then deep work again. Habits don't belong in the importance ranking. We're starting with them as a separate section, but may cut them entirely if the separation feels forced. The deck's job is prioritizing what matters — habit tracking may belong in its own surface.

---

## Progressive Disclosure — The Escape Hatch

The deck is a ranked subset of all active tasks. If the AI got it wrong, the user needs access to more — but without being overwhelmed.

**Three tiers, all on one scrollable surface:**

### Tier 1: The Deck (primary)
The AI's picks. Full cards with rationale, subtasks, metadata. This is what the user sees first and interacts with most.

### Tier 2: More Options
Below the deck, a clear visual divider. The next ~10 tasks shown in a **compact style** — smaller text, no rationale, just title + area + effort. These are tasks the AI considered but ranked lower.

One-tap to promote any item into the deck.

**Radar items appear here too**, visually tagged (e.g., a subtle icon or "radar" label) so the user knows why they're surfaced. "You haven't touched this in 2 weeks" etc. Radar items can be promoted to the deck with one tap.

This section is collapsible — starts expanded, user can collapse to reduce noise.

### Tier 3: View All Tasks
A single link at the bottom: "View all tasks →"

Opens the full task list (existing tasks tab or a filtered view). This is the ultimate escape hatch — the "I know better than the AI today" path.

**The tiers are not separate views.** They're one scrollable surface with decreasing emphasis. The user scrolls past their deck into more options naturally. No buttons to click, no modes to enter.

---

## Deck Interactions

### Always-editable, no edit mode

The deck is always interactive. No toggle between "view" and "edit."

- **Drag handle** on each item (visible on hover/touch) for reordering
- **Remove** (X or swipe) sends an item to "more options"
- **Promote** from "more options" adds to the bottom of the deck (user can reorder)
- **Complete** marks done, moves to the completed count

Adjustments are the user's decision. **The AI does not re-rank when the user edits.** Manual arrangement is a signal — "I decided this order." The AI only re-ranks on explicit actions: "Generate New Deck" or "Reshuffle my deck" in chat.

### Collapsible sections

Each section (deck items, routines, more options, radar) is collapsible. Everything starts expanded. The user can collapse sections to focus — e.g., collapse "more options" when they're locked in, expand it when they need to browse.

---

## The Living Deck — Day Lifecycle

### Morning: Generation

The user opens the app. If it's a new day:
- **Prompt at top:** "Keep current deck" | "Generate new deck"
- "Generate" runs context → triage → fresh deck
- "Keep" preserves yesterday's deck with its completions and remaining items

If the user has already generated today, they see their deck as-is.

### During the day: Persistence

The deck persists. Complete a task, the completed count updates. Come back after lunch, same deck. No re-generation ceremony.

If new stream items arrive: thin prompt — "2 new captures. [Quick triage] [Later]"

The day context line may update to reflect time passing ("It's 3pm — 3 items remaining. The quarterly report is due today and hasn't been started.")

### End of day: Deadline escalation

If hard-deadline items haven't been completed as the day progresses, they get promoted into a visual "Due today" separator at the top of the deck — impossible to miss.

### Next day: Fresh start

New day, new prompt. "Keep current deck" or "Generate new deck." If the user generates, yesterday's context (what was completed, what carried over) feeds into the AI's new deck.

---

## Chat Panel Quick Actions

Two high-leverage quick action buttons always visible above the chat input. Contextual prompts that use the deck and current state.

The chat agent is how the user interacts with the intelligence behind the deck. The deck is the persistent visual state; chat is how you talk to it. This means chat can *modify* the deck — "move that PR review to the top", "drop the quarterly report for today", "add the onboarding doc to my deck." The agent updates the deck in response.

**Always visible:**
- **"What's next?"** — The AI considers: remaining deck items, time of day, recent completions. Returns a specific recommendation with reasoning, not a list.
- **"What's on my radar?"** — Pulls from the radar system. Things outside active focus that deserve a check-in. Can be promoted to the deck with one tap from the response.

**"More..." button** expands additional options:
- "Reshuffle my deck" — AI regenerates based on current state
- "I have [15/30/60] minutes" — AI picks the best task for that window
- "I'm stuck" — AI helps break down the current task, suggests a pivot, or offers a reset
- "I'm low energy" — AI suggests lighter, more achievable tasks from the deck and alternatives
- "What did I accomplish today?" — Summary of completions
- "What's falling behind?" — Surfaces deadline pressure, deferred items, stale projects

These quick actions keep the deck alive throughout the day without requiring regeneration or manual browsing. Chat is an alternative to drag-and-drop — sometimes it's easier to say "swap 2 and 4" than to manually reorder.

---

## Where Radar Lives

Radar is **not part of deck generation.** It's a pull-based system that surfaces in three places:

1. **"More options" section of the deck** — Radar items appear alongside task alternatives, visually tagged. Promotable to the deck with one tap.
2. **Chat quick action:** "What's on my radar?" — conversational response about things outside active focus.
3. **AI-initiated nudges in chat:** When context fits (user finished early, has a gap, explicitly asks for suggestions), the AI mentions radar items.
4. **Weekly pulse:** The weekly summary includes a radar section.

---

## Routines, Habits, and Self-Care

Routines appear in the living deck as a separate lightweight section (see above). They are:

- **Not part of deck generation.** They don't compete with task prioritization.
- **Present in the living deck** as checkable items with progress (streaks, completion counts).
- **Referenced by the AI** when relevant — in the day context line or in chat ("you haven't worked out yet this week").
- **Collapsible** — the user can hide them when focused on tasks.

This is experimental. If the separation feels forced or adds clutter, routines may move to their own surface or be cut from the deck entirely.

---

## Tone & Visual Design

The deck should feel like guidance from a trusted advisor, not a todo list manager.

**Language:**
- "Here's how I'd prioritize your day" not "Here are your tasks for today"
- "Work through these in order — wherever you stop is fine" not "Complete these 7 items"
- Rationale uses phrases like "this would be high-leverage because..." not "you need to..."
- Completion is celebrated briefly, not tracked anxiously

**Visual design:**
- The deck should not look like a checklist. No prominent empty checkboxes screaming at the user.
- Completion is subtle (a check appears, count increments) not dramatic
- The "more options" section is visually de-emphasized — available but not demanding attention
- Routines feel like a gentle presence, not additional obligations
- The overall feel is closer to a briefing document than a project management tool

---

## Data Model

### DeckPlan (revised)

```typescript
interface DeckPlan {
  /** One-line day shape context. Absent if nothing notable. */
  dayContext?: string;

  /** Ranked priority stack — THE deck */
  items: DeckItem[];

  /** Tasks AI considered but ranked lower */
  alternatives: AlternativeItem[];

  /** Radar items to surface in "more options" */
  radarItems?: RadarItem[];

  /** When this deck was generated */
  generatedAt: string;
}

interface DeckItem {
  id: string;
  title: string;
  parentTitle?: string;       // Parent task / project name
  areaName?: string;
  rationale: string;          // Why this task, why this position
  energy?: 'deep' | 'light'; // Metadata, not structural
  effort?: string;            // XS/S/M/L/XL
  estimatedMinutes?: number;
  hardDeadline?: string;      // ISO date
  taskId: string;
  subtasks?: SubtaskItem[];
  continuityContext?: string; // "Last session: got OAuth working"
}

interface AlternativeItem {
  id: string;
  title: string;
  parentTitle?: string;
  areaName?: string;
  energy?: 'deep' | 'light';
  effort?: string;
  reason: string;             // Why it wasn't included
  taskId: string;
}

interface SubtaskItem {
  id: string;
  title: string;
  effort?: string;
  completed: boolean;
}

interface RadarItem {
  id: string;
  title: string;
  areaName?: string;
  reason: string;             // Why it's on radar ("Not touched in 2 weeks")
  taskId?: string;            // If it maps to an existing task
}
```

Key changes from v1:
- No `deepWork[]` / `lightTasks[]` / `routines[]` split — one `items[]` array
- No `summary` — replaced by optional `dayContext` one-liner
- No `worthNoting` — urgent items ranked in the list with rationale
- No `meta.workingSetSize` — showing "5 of 34 tasks" adds anxiety, not value
- Added `radarItems`
- `DeckItem` replaces both `DeepWorkItem` and `LightTaskItem`

---

## Implementation Plan

### What to build
1. **`DeckStack` component** — the priority stack (replaces PlanReview + PlanDeepWork + PlanLightTasks + PlanBriefing)
2. **`DeckMoreOptions` component** — compact alternative/radar list below the stack
3. **`DeckRoutines` component** — lightweight habit/routine section (experimental — may cut)
4. **`DeckCompletedCount` component** — collapsed completion counter
5. **Update `DeckContainer`** — simplified flow: context → triage → deck (no review/confirm step, new day prompt)
6. **Chat quick actions** — 2 always-visible buttons + "More" menu above chat input, chat can modify deck
7. **Update conductor bar** — remove deep/light toggle, keep area scope + Generate New Deck
8. **Update types** — new DeckPlan/DeckItem/RadarItem interfaces
9. **Deadline escalation logic** — promote deadline-today items to top section as day progresses

### What to remove
- PlanReview (v1, v2, v3)
- PlanBriefing
- PlanDeepWork / PlanLightTasks / PlanRoutines (replaced by unified stack + separate routines section)
- Deep/Light toggle in conductor bar
- "Start Executing" confirm button
- "Worth noting" as a separate UI element

### What stays
- Context intake (Beat 1)
- Stream triage (Beat 2)
- Focus mode (triggered from deck items)
- Generate New Deck with time-based urgency
- Alternatives concept (expanded into progressive disclosure tiers)

---

## Future Work: Energy Blocks — Visualizing Your Day's Rhythm

A horizontal bar showing the texture of the day — not a schedule, but a personal rhythm map.

```
[  Deep focus  ][  Meeting  ][  Gap  ][  Meeting  ][  Light / wind down  ]
   8am–12pm       12–1pm      1–2pm     2–3pm         3–5pm
```

**The idea:** Blocks of time categorized by energy mode (deep focus, light/admin, meetings, gaps, self-care). The user glances at it to understand the shape of their day, then looks at the deck to decide what to do within those blocks. It's not "do task X at 9am" — it's "here's when you'll have focused time vs. fragmented time."

**Why it's not in MVP:**

The deck answers "what's important." Energy blocks answer "when to do it." These are fundamentally different problems, and "when" is the harder one. Without real calendar data, energy blocks are either:
- **User-configured patterns** ("my mornings are usually deep") — which is upfront work most people won't do, and it'll be wrong by 10am when an unexpected meeting drops in
- **Static guesses** — which aren't useful enough to justify the screen space

The core tension: we're trying to list things by importance *and* figure out where to fit them during the day. Those are competing goals on the same surface. For MVP, the deck's job is importance ranking. When to do things is the user's call — and honestly, that's how most productive people already work. They know what matters and find the time.

**When it becomes valuable:**
- **Calendar integration (Phase 4):** Real meeting data automatically populates meeting blocks, and the AI can infer genuine focus windows from the gaps. This is when energy blocks stop being guesses and start being useful.
- **Learned patterns:** "You usually do your best deep work 8-11am, then fade after lunch." This requires enough usage data to be meaningful.

**What it is NOT:**
- A calendar with tasks assigned to time slots
- A commitment ("you must do deep work from 8-10")
- A schedule that breaks when reality changes

**How it could interact with the deck:**
- The deck doesn't change based on blocks — blocks are context, the deck is the priority stack
- Tapping a block could filter the deck to tasks that fit that energy level
- The day context line could reference blocks: "Open morning, fragmented afternoon — front-load your focused work"

**Data model (when ready):**
```typescript
interface EnergyBlock {
  id: string;
  label: string;              // "Deep focus", "Meetings", "Light / gaps"
  startHour: number;          // 0-23
  endHour: number;
  type: 'deep' | 'light' | 'meeting' | 'break' | 'selfcare';
}
```

---

## Open Questions (Deferred)

1. **Agent-delegated tasks:** When agents complete work that needs human review, how does it appear in the deck? Deferred to Stage 2 design. The `DeckItem` model is flexible enough to accommodate this.

2. **Mobile:** The priority stack is inherently mobile-friendly. Quick actions in chat work on mobile. Information density on small screens needs design attention.

3. **AI nudge thresholds:** When should the AI proactively surface things in chat vs. wait to be asked? Conservative by default — only nudge when confidence is high and timing is right.

4. **Routines in the deck vs. separate surface:** Habits exist in a different dimension than task importance. Starting with them as a collapsible section in the deck, but this may feel forced. If so, move them to their own surface or cut entirely.
