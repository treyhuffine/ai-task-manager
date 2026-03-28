# Deck & Check-in Spec

## What This Is

The deck tab is Eon's primary execution interface. It's not just a sorted task list — it's the output of a lightweight check-in flow that gets the right tasks in front of the user and gets them into flow.

The check-in lives inside the deck tab itself. It's not a modal, not a separate route. It's the deck's pre-flight state that collapses into the plan once complete.

---

## The Problem with the Current Deck

The current deck is a static sorted list: a focus card (#1) + "up next" items. This has three issues:

1. **No input before output.** The AI guesses priorities without knowing what changed — the user's energy, new context, shifted deadlines. The plan may be wrong, and the user has no cheap way to fix it before seeing it.
2. **No triage integration.** Stream items that haven't been sorted live in a separate tab. The user has to context-switch to process them, then come back to the deck. These should be triaged as part of getting the deck ready.
3. **Flat list doesn't match how people work.** Real work is project-level deep work + gap-sized light tasks. A flat numbered list doesn't distinguish between "spend 2 hours on this project" and "reply to this email in 5 minutes."

---

## Design Principles

1. **The check-in is the deck.** One surface, no mode switch. The check-in beats collapse as you move through them, leaving the plan.
2. **AI does 90% of the work.** Every triage item has a recommendation. The user's job is one tap: confirm or redirect.
3. **Skip anything.** Every beat is optional. On a clean day with no new context, you see the plan directly.
4. **No ceremony.** This isn't a "daily planning ritual." It's what happens when you open the app. It adapts to frequency — first open of the day gets the full flow; return visit 2 hours later skips straight to the plan.
5. **Conversational adjustment.** After the plan is shown, the user can adjust via chat: "swap 1 and 2", "add X to deep work", "not today on Y."

---

## The Check-in Flow: Two Beats + The Plan

The check-in has two optional beats that precede the plan. Each beat is skippable and takes 10-30 seconds. The whole flow is 1-3 minutes max.

### Beat 1: "What's on your mind?" (Context Intake)

**Purpose:** Let the user inject context that changes how the AI plans.

**UI:** A clean text area at the top of the deck tab with a warm prompt:

> *Anything I should know before I plan your day?*

Below the text area: a few quick-tap chips for common signals. These are learned from patterns over time but start with sensible defaults:

- `Low energy today`
- `Packed calendar`
- `Need to focus on [area]`
- `Nothing, let's go`

**Behavior:**
- Tapping "Nothing, let's go" or submitting empty skips to Beat 2 (or straight to the plan if Beat 2 is also empty).
- Tapping a chip adds that context and advances. Multiple chips can be selected.
- Free text is sent as context to the AI for deck generation.
- The text area also accepts brain-dump style input — multiple thoughts, raw ideas. These get captured to the stream AND used as context for the plan.

**When this beat appears:**
- First check-in of the day: always present
- Subsequent check-ins: collapsed to a single line ("Add context...") that expands on tap
- If user consistently skips: the AI learns and collapses by default

### Beat 2: "A few things need your call" (Stream Triage)

**Purpose:** Surface unsorted stream items that need a human decision before they can enter (or not enter) the deck.

**UI:** A compact list of stream items, each with an AI recommendation and one-tap actions.

Each item looks like:

```
"Check SEO results"                              2h ago
AI suggests: Task, mid-priority
[Accept] [Edit] [Dismiss]

"Progressive disclosure for onboarding"          Yesterday
AI suggests: Append to 'Onboarding UX' note
[Accept] [New note] [Dismiss]

"Maybe learn woodworking"                        2d ago
AI suggests: Low priority, boomerang 2 weeks
[Accept] [Not a task] [Dismiss]
```

**Key behaviors:**
- Each item has exactly one AI recommendation with reasoning available on tap.
- **[Accept]** applies the AI's recommendation (promote to task at suggested position, append to note, set boomerang, etc.)
- **[Edit]** opens a minimal inline editor to adjust before accepting (change area, priority zone, etc.)
- **[Dismiss]** removes it from triage (goes to recently archived, recoverable)
- **[Accept all]** button at the top when there are 3+ items — applies all AI recommendations at once.
- Items are sorted by AI confidence (most obvious decisions first) so "Accept all" is tempting.

**When this beat appears:**
- Only when there are unsorted stream items since the last check-in.
- If there are zero items, this beat is entirely absent — no empty state, no "0 items to triage."
- If user returns after multiple days, items are grouped: "12 captures while you were away" with area grouping and a prominent "Accept all" option.

**What this beat does NOT include:**
- Radar items (radar is its own view, not part of the check-in)
- System health checks (overcommitment, working set growth — these are woven into the plan text)
- Tasks that are already sorted (those just show up in the plan)

### The Plan (Beat 3): "Here's your day"

**Purpose:** The output — a briefing that tells the user exactly what to work on and why.

**UI:** This replaces the current flat deck list with a structured briefing.

#### Plan Header

A conversational summary from the AI (2-4 sentences):

> Your day has 2 deep blocks (8-10am, 1-3pm) and a fragmented afternoon. I'd focus the morning on Bounce — you're one session away from finishing the auth system. InsiderFinance billing bug is a good second block — scoped and has clear repro.

If there are high-threshold system signals, they appear as a single line below:

> *Worth noting: Tax filing is in 3 days and hasn't been started.*

This "worth noting" line only appears when something crosses a high bar (hard deadline within 72 hours + no activity, task deferred 5+ times, project blocking a goal that's stalled). If nothing qualifies, the line is absent.

#### Deep Work Section

The 1-3 projects (parent tasks) that deserve focused attention today. Each shows:

```
━━━ DEEP WORK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Bounce — Wire up token refresh endpoint
   Last session: Got OAuth flow working. Next: token refresh.
   "This is the last blocker before payments — finish it
   and the whole auth system is done."
   [Start] [Not today] [Blocked]

2. InsiderFinance — Fix billing bug
   Customer reported Monday. 3 days old. Clear repro steps.
   [Start] [Not today]
```

Key differences from the current focus card:
- **Project-level framing.** The user picks a project to work on. Tasks flow from the project. "Where did I leave off?" is answered by the context line.
- **Rich rationale inline** (not hidden behind a "Why?" button for the top items).
- **Continuity context** — what happened last session, what's next.

#### Light Tasks Section

Gap-sized tasks for between meetings and fragmented time:

```
━━━ LIGHT / GAPS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

3. Reply to Jake about partnership terms       ~15 min
4. Approve InsiderFinance PR                   ~5 min
5. Call dentist                                ~5 min  ← new
```

- Estimated minutes shown (when known) to help the user match tasks to gaps.
- "← new" badge on tasks that were just triaged in Beat 2.
- These are tappable — tap to expand for context or actions.

#### Recurring Tasks

If habits/routines are due today, they appear as a lightweight row:

```
━━━ TODAY'S ROUTINES ━━━━━━━━━━━━━━━━━━━━━━━━━━━

☐ Work out (3 of 4 this week)
☐ Read (streak: 12 days)
```

Not prominent. Not competing with deep work. Just present so they're tracked.

---

## Deck States

The deck tab has three states based on check-in status:

### State 1: Needs Check-in (first open of day)
Shows: Beat 1 → Beat 2 (if items exist) → Plan
The full flow. Beats collapse as completed, plan unfurls.

### State 2: Checked In (return visit, nothing changed)
Shows: Plan directly
No beats. The plan from the last check-in is still valid. Compact "Add context..." line at top for quick adjustments.

### State 3: Needs Refresh (return visit, things changed)
Shows: Thin prompt at top of plan
"2 new captures since your check-in. [Quick triage] [Later]"
Tapping "Quick triage" unfurls Beat 2 inline above the plan.
Tapping "Later" dismisses — items will appear in next full check-in.

---

## Conductor Row (Retained, Simplified)

The existing conductor row (work mode toggle + project scope) stays but moves below the plan header:

- **Energy toggle:** Deep | Light — filters the plan to show only the relevant section
- **Scope pill:** All | [Area] | [Project] — filters to a specific domain

These are secondary controls. The plan already groups by energy, so the toggle is mainly for "show me only light tasks" moments.

---

## Radar (Separate View)

Radar is NOT part of the check-in flow. It's a separate, pull-based view:

- **What it is:** A curated, AI-maintained list of things outside active focus that deserve periodic heartbeats. Side projects, incubating ideas, slow-burn work, dormant areas.
- **Where it lives:** Accessible from nav (under "More" or its own nav item). Also accessible via chat ("what's on my radar?").
- **When it surfaces:** Primarily in the weekly pulse ("Here are 3 things to consider if you have space this week"). The AI may mention radar items in chat if context fits ("You finished early — your OSS repo has issues piling up").
- **What it is NOT:** An alert system. Not part of daily check-in. Not forced. Not urgent.

System health checks (overcommitment, working set growth, stale projects with hard deadlines) are separate from radar — they're operational signals the AI weaves into the plan briefing text when relevant.

---

## Data the Check-in Considers

The AI uses all of these when generating the plan:

**From the system (automatic):**
- Calendar events + computed available time gaps
- All active tasks with sort_key, user_context, ai_context
- Hard deadlines within 7 days
- Stream items pending triage (for Beat 2)
- Recurring tasks due today
- Yesterday's session (planned vs completed, carryover)
- Active goals + KR progress
- Recently promoted tasks since last check-in
- USER.md (patterns, preferences, calibrations)
- Temporal memory (last 7 days of observations)
- User state signals (engagement, capacity, recent patterns)

**From the user (Beat 1):**
- Free text context ("feeling low energy", "big meeting at 2")
- Quick-tap chips (energy, calendar awareness, area focus)
- Brain dump items (captured to stream + used as plan context)

---

## Interaction After the Plan

The plan is not final. After it's shown, the user can:

1. **Tap actions on items:** Start, Not Today, Blocked, Complete, Defer
2. **Adjust via chat:** "Swap 1 and 2", "Add the investor deck", "Push Bounce to tomorrow"
3. **Re-triage:** If new stream items arrive, the refresh prompt appears
4. **Change energy/scope:** Toggle deep/light, scope to an area

The deck updates in place. No regeneration ceremony — adjustments are incremental.

---

## What Changes from Current Implementation

### Components to Modify
- `content-panel.tsx` — Replace `DeckContent()` with the new check-in + plan flow
- `dashboard-context.tsx` — Add check-in state (beat progression, triage items, plan data)
- `types/dashboard.ts` — New types for check-in state, plan structure, triage items

### New Components to Create
- `deck/check-in-intake.tsx` — Beat 1: text area + chips
- `deck/check-in-triage.tsx` — Beat 2: stream item triage cards
- `deck/plan-briefing.tsx` — Plan header + AI summary
- `deck/plan-deep-work.tsx` — Deep work section with project-level cards
- `deck/plan-light-tasks.tsx` — Light tasks section
- `deck/plan-routines.tsx` — Recurring tasks section
- `deck/deck-conductor.tsx` — Energy toggle + scope pill (extracted from current conductor row)

### API Endpoints Needed
- `POST /api/deck/check-in` — Submit Beat 1 context + Beat 2 triage decisions, receive generated plan
- `POST /api/deck/triage` — Get AI recommendations for pending stream items
- `POST /api/deck/adjust` — Incremental plan adjustments (swap, defer, add)
- `GET /api/deck/status` — Check if check-in is needed (has pending items, is first open today, etc.)

### State to Track
- `check_in_status`: 'needs_check_in' | 'checked_in' | 'needs_refresh'
- `current_beat`: 1 | 2 | 'plan' (progression through the flow)
- `triage_items`: pending stream items with AI recommendations
- `plan`: the generated plan structure (summary, deep work, light tasks, routines, worth noting)
- `user_context_input`: text from Beat 1

---

## Implementation Tasks

### Phase 1: Deck Structure & Check-in Flow (UI Shell)

- [ ] **1.1** Create deck component directory `src/components/deck/`
- [ ] **1.2** Build `check-in-intake.tsx` — Beat 1 with text area, chips, skip action
- [ ] **1.3** Build `check-in-triage.tsx` — Beat 2 with triage card list, accept/edit/dismiss actions, accept-all
- [ ] **1.4** Build `plan-briefing.tsx` — Plan header with AI summary text and "worth noting" line
- [ ] **1.5** Build `plan-deep-work.tsx` — Deep work section with project-level cards (title, continuity context, rationale, actions)
- [ ] **1.6** Build `plan-light-tasks.tsx` — Light tasks list with estimated minutes and "new" badge
- [ ] **1.7** Build `plan-routines.tsx` — Recurring tasks row
- [ ] **1.8** Build `deck-conductor.tsx` — Extract and simplify energy toggle + scope pill from current conductor row
- [ ] **1.9** Build `deck-container.tsx` — Orchestrator component that manages beat progression and renders the appropriate state (needs check-in / checked in / needs refresh)
- [ ] **1.10** Add check-in and plan types to `types/dashboard.ts`
- [ ] **1.11** Replace `DeckContent()` in `content-panel.tsx` with new `DeckContainer`
- [ ] **1.12** Wire up deck state in `dashboard-context.tsx` — check-in status, beat progression, plan data

### Phase 2: API & Data Layer

- [ ] **2.1** `GET /api/deck/status` — Determine check-in state (pending stream items count, last check-in time, is first open today)
- [ ] **2.2** `POST /api/deck/triage` — Return pending stream items with AI recommendations (entity type, placement zone, area, rationale)
- [ ] **2.3** `POST /api/deck/check-in` — Accept Beat 1 context + Beat 2 triage decisions, trigger plan generation
- [ ] **2.4** `POST /api/deck/adjust` — Handle incremental adjustments (swap, defer, add, not-today) without full regeneration
- [ ] **2.5** Plan generation logic — Assemble context (calendar, tasks, goals, deadlines, user context, memories), call LLM, return structured plan
- [ ] **2.6** Triage recommendation logic — For each pending stream item, generate AI recommendation (promote to task/note/decision, append, dismiss, boomerang)

### Phase 3: AI Integration

- [ ] **3.1** Plan generation prompt — Design the LLM prompt that produces the structured plan (summary, deep work picks, light task picks, routine status, worth-noting items)
- [ ] **3.2** Triage recommendation prompt — Design the prompt that evaluates stream items and recommends actions
- [ ] **3.3** Context assembly — Build the function that gathers all system data (calendar, tasks, goals, deadlines, temporal memory, USER.md) into the prompt context
- [ ] **3.4** Incremental adjustment handling — Handle "swap 1 and 2", "not today on X", "add Y" without full plan regeneration
- [ ] **3.5** Check-in frequency adaptation — Logic to determine which beats to show based on time since last check-in, whether anything changed, user patterns

### Phase 4: Polish & Edge Cases

- [ ] **4.1** Transition animations — Beats collapsing, plan unfurling, items appearing/disappearing
- [ ] **4.2** Return-visit "needs refresh" prompt — "2 new captures since check-in" inline prompt
- [ ] **4.3** Empty states — No deep work today (all light), no light tasks, no routines, no stream items
- [ ] **4.4** Chat integration — "Swap 1 and 2" in chat updates the deck plan in the other panel
- [ ] **4.5** Persistence — Save plan to sessions table, restore on return visit
- [ ] **4.6** Offline/fallback — Show cached plan with degradation notice when AI unavailable
