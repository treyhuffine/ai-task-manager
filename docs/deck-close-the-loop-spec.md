# Deck — Close the Loop

Status: **proposed** · 2026-07-14 · Builds on `docs/deck-proactive-spec.md` (shipped through its build-now pass)

## Why this spec

The proactive deck shipped and the direction is right. A full review (implementation +
product) found the gaps are not in the design — they're in four loops that were designed
but never closed:

1. **Trust** — small correctness cracks that break the deck's core promises ("don't miss
   deadlines," "nothing disappears," "what you did is saved").
2. **Learn** — the deck generates acceptance telemetry every day (not-today, restore,
   reorder, dismiss) and throws all of it away. Both designed learning signals
   (`timesDeferred`, router `mutedKinds`) are dead wires: nothing ever writes them.
3. **Honesty** — the mid-day reconcile loop is built and unit-tested but nothing ever
   fires it. Principle 2 of the proactive spec ("stays honest through the day") is
   shipped code that never runs.
4. **Attention** — the product is becoming an agent-workforce operating layer
   (Capture→Triage→Route→Execute→Review→Learn), but the deck only ranks tasks for the
   human to *do*. It cannot see running executions or agent output awaiting review — on
   an agent-heavy day, the single highest-leverage item. The deck's unit must evolve from
   "task" to "attention item": do this / review this / delegate this.

Plus a fifth theme, **Simplify**: the surface has accumulated chrome (filters, modes,
mock routines, dead radar code, three generations of plan-review components) that works
against "glance and start."

## Current state (grounded)

- **Generation** — `generateDeck` (`src/lib/ai/generate-deck.ts:113`): 3 phases, both AI
  phases on `process.env.MODEL_STANDARD || 'gpt-5.4-mini'` (`:360`, `:392`) despite the
  header describing phase 2 as "a small model." Task-window queries use UTC
  `toISOString().slice(0,10)` (`:119-123`) while `forDate` uses `todayLocalDate()`
  (`:293`) — two different day boundaries in one function.
- **Reconciliation** — model decisions validated against the actual items array
  (`:433-470`), good. Defer/drop decisions do **not** touch the task record.
- **`timesDeferred`** — read in the prompt (`deck-generation.ts:129`) and sent per task
  (`:241`); only write anywhere is `timesDeferred: 0` on create (`queries.ts:151`).
  Dead signal.
- **Change-router** — `src/lib/deck/change-router.ts`: absorb/digest/interrupt with
  interrupt budget + focus gating; `mutedKinds` input (`:47`) only populated in a test.
  Production caller `reconcile-external.ts:154` never passes it.
- **Mid-day reconcile** — `reconcileDeckWithExternalChanges`
  (`src/lib/deck/reconcile-external.ts`): deterministic calendar-snapshot diff → bump →
  router → new `midday` version. Reachable only via `POST /api/deck/reconcile` and the
  `reconcile_deck` orchestrator action. No heartbeat, no scheduler entry, no client hook
  calls it.
- **Triggers** — morning cron trigger seeded at boot, default on at 04:00
  (`src/lib/deck/trigger.ts`, `instrumentation.ts:184`). Lazy `ensureTodaysDeck` on
  `GET /api/deck` with in-process dedupe. Google Calendar provider registered at boot
  (`instrumentation.ts:161`, `src/lib/deck/calendar-connector.ts`).
- **Client** — `DeckContainer` (`src/components/deck/deck-container.tsx`, 782 lines):
  local `useState` + raw `api.*` calls, not TanStack Query. Hydration joins persisted
  `items[].taskId` against `useTasks({status:'active', limit:50})` and silently drops
  any deck item outside that page (`:82`). All mutations fire-and-forget via
  `persistDeck` → `.catch(console.error)` (`:171`). Subtask complete/defer are local
  state only (`:528-554`) — lost on reload, never written to the task. "Due today"
  compares `new Date(hardDeadline).toDateString()` (`:294`) — date-only strings parse as
  UTC midnight and shift a day in negative-offset timezones. Restored bumped items
  reappear in the bumped lane after reload (change log kept, membership never checked,
  `:633-636`). `MOCK_ROUTINES` hardcoded (`:62`). `radarItems` always `[]` — promote
  branch unreachable (`:487-503`).
- **Review feed (exists!)** — `listNeedsReviewSessionCandidates()`
  (`src/lib/db/queries.ts:3439`) + `GET /api/sessions/needs-review`: active sessions
  with unread outcomes, already excluding the interactive orchestrator chat and the
  morning-deck refresh. This is the deterministic "agent output awaiting review" feed
  the attention phase needs — it just isn't surfaced on the deck.
- **Dead components** — `plan-review.tsx`, `plan-review-v2.tsx`, `plan-review-v3.tsx`
  in `src/components/deck/`.

## Principles for this pass

1. **Close loops before adding surface.** Nothing net-new until what's designed runs.
2. **Every user override is training data.** If the user corrects the deck and the deck
   can't get smarter from it, we wasted the correction.
3. **Deterministic where possible, model where valuable.** The review lane and the
   mid-day diff are deterministic. The model is for judgment (ranking, carry/defer/drop),
   and the judgment step deserves the capable model, not the cheapest one.
4. **The deck ranks human attention, not just human tasks.** Review items are
   first-class. Delegation is an action, not a separate app area.
5. **Glance test.** Two seconds of looking should tell you what to do now. Every lane,
   filter, and banner pays rent against that.

---

## Phase 1 — Trust (correctness under the core promises)

### 1.1 One definition of "today" `[reuse]`
- Extend `src/lib/deck/date.ts` with `addDaysLocal(date: string, days: number): string`
  (pure, no `Date` parsing of date-only strings).
- In `generateDeck`: compute `forDate = todayLocalDate()` once at the top; derive the
  recurring-due cutoff and the 7-day deadline window (`sevenDaysFromNow`) from `forDate`
  via `addDaysLocal`, replacing the UTC `toISOString().slice(0,10)` math at
  `generate-deck.ts:119-123`. `fiveDaysAgo` stays an ISO instant (it compares
  timestamps, not days).
- Unit tests in `date.test.ts`: boundary at local midnight in a negative-offset TZ,
  month/year rollover.

### 1.2 Client day boundary `[ui]`
- Replace both `toDateString()` comparisons in `deck-container.tsx` (`:294`, `:301`)
  with string comparison: `item.hardDeadline?.slice(0, 10) === todayLocalDate()`.
  `todayLocalDate` is pure and client-safe — import it, don't duplicate it.

### 1.3 Server-hydrated deck payload (kills the 50-task drop) `[new]`
- New query helper `getDeckTaskRecords(deck)` in `queries.ts`: every `TaskRecord`
  referenced by `items[]`, `alternatives[]`, and `changes[]`, plus their subtasks —
  regardless of status or count.
- `GET /api/deck`, `GET /api/deck/:id`, `POST /api/deck/generate`, and
  `POST /api/deck/:id/revert` return `{ deck, tasks }`.
- `hydrateDeckRecord` consumes that task set instead of the paged `useTasks` fetch.
  `useTasks({limit:50})` remains only for the task browser and quick-add surfaces.
- Delete the silent `if (!task) continue` failure mode (`deck-container.tsx:82`): with
  server hydration a missing task is a data bug — log it loudly.

### 1.4 Restore ghost `[ui]`
- `bumpedItems` (`deck-container.tsx:633`) and the hydration path exclude any change
  whose `taskId` is currently in `plan.items`. History stays intact in `changes`; the
  lane just stops showing items that are already back on the deck.

### 1.5 Subtask actions persist `[reuse]`
- `handleSubtaskComplete` (`:528`) calls `completeTask.mutate({ id: subtaskId })` — the
  real mutation (writes `task_completions`, advances recurrence, bumps
  `lastProgressAt`). The local plan update stays for optimistic UI.
- `handleSubtaskDefer` (`:542`): persist as `deferredSubtaskIds: string[]` on the
  parent `DeckItem` JSON (schema type + zod, no SQL migration) so it survives reload.
  Hydration filters those subtasks out of the card.

### 1.6 Deck state onto TanStack Query `[new]` `[ui]`
- New `src/hooks/use-deck.ts`: `useDeck()` (the hydrated `{deck, tasks}` payload),
  `useDeckMutation()` (PATCH items/alternatives with optimistic update + rollback +
  invalidation), `useGenerateDeck()`, `useRevertDeck()`.
- Move `hydrateDeckRecord` + `taskToDeckItem` into `src/lib/deck/hydrate.ts` (shared,
  testable, and needed by 5.3).
- `persistDeck` fire-and-forget dies. Failed persists roll back and surface via the
  app's standard toast pattern — never `console.error` only.
- This is also the container diet: after this task `DeckContainer` should be render
  orchestration only (~300 lines, see 5.5).

### 1.7 Smoke `[reuse]`
- Extend deck tests: hydrated payload contract (task outside any 50-row page still
  renders), restore round-trip shows no ghost, subtask complete writes a
  `task_completions` row, deadline-today matches at local 11:30 PM in UTC-8.

## Phase 2 — Learn (the moat: acceptance telemetry)

### 2.1 `deck_decisions` table `[new]`
- Schema (`src/lib/db/schema.ts`), standard `id` + `...timestamps` first:
  - `deckId` → FK `decks.id`, cascade. `forDate TEXT` denormalized for cheap windows.
  - `taskId TEXT` nullable (dismissals aren't task-scoped). Title denormalized, same
    reason as `DeckChange.title`.
  - `action TEXT` enum: `'not_today' | 'restore' | 'promote' | 'add' | 'remove' |
    'complete' | 'reorder' | 'revert' | 'delegate' | 'dismiss_change'`.
  - `detail` JSON: `{ fromPosition?, toPosition?, changeKind?, source? }`.
- Migration via `pnpm db:generate` (never hand-edit the journal).
- Query helpers: `recordDeckDecision(...)`, `getDeckDecisionStats(days)` (per-task
  aggregates), `getDismissalCounts(days)` (per change-kind).
- Thin route `POST /api/deck/:id/decisions` dispatching through `queries.ts`.

### 2.2 Capture every override `[ui]`
- Container handlers (via the 1.6 mutation hooks) record: not-today, restore,
  promote-from-alternatives, add (browser/quick-add), remove, complete-from-deck,
  reorder (with from/to positions), revert, brief/interrupt dismiss (as
  `dismiss_change` with the change kind in `detail`).
- Fire-and-forget alongside the deck mutation — a failed telemetry write must never
  block an interaction.

### 2.3 Wire `timesDeferred` (finally) `[reuse]`
- `queries.ts` helper `recordTaskDeferral(taskId, forDate)`: increments
  `tasks.timesDeferred` **once per task per `forDate`** (guarded by an existing
  same-day `not_today`/defer decision row — same-day regens and repeat taps don't
  double-count).
- Callers: the `not_today` decision path (server-side, inside the decisions route) and
  `generateDeck`'s reconciliation loop when it emits a `deferred` change
  (`generate-deck.ts:447`).
- The prompt already consumes it (`deck-generation.ts:129`) — no prompt change needed.

### 2.4 Feed decisions back into generation `[reuse]`
- `buildDeckPrompt` gains `[Your Recent Deck Decisions]` (last 14 days, aggregated by
  `getDeckDecisionStats`): "deferred 3x recently," "restored twice after the AI bumped
  it," "manually moved off position 1 the last 2 times the AI put it there."
- `DECK_SYSTEM_PROMPT` guidance: repeated not-today = stop pushing it (unless deadline
  forces it, say so); repeated restore/promote = the user wants this ranked higher than
  you think; repeated demotion of your top pick = your #1 calibration is off, weight
  their sort order more.

### 2.5 Router learning: derive `mutedKinds` `[reuse]`
- `getMutedChangeKinds()`: change kinds dismissed ≥3 times in 14 days with no
  intervening `restore` on those changes → muted.
- Pass into `routeChange` at `reconcile-external.ts:154`. The router already supports
  it (`change-router.ts:47`) — this closes the designed loop with zero router changes.
- Unit test: 3 dismissals demote a kind to silent; a restore resets it.

## Phase 3 — Honesty (turn on what's built)

### 3.1 Mid-day reconcile cadence `[reuse]`
- In-process interval in `instrumentation.ts`, same pattern as the health sweep
  (`:87`): every 15 minutes call `reconcileDeckWithExternalChanges()`, guarded by
  (a) a `sweeping` re-entry flag, (b) `hasCalendarProvider()`, (c) local time within
  `workdayStart..workdayEnd`.
- Why not an orchestrator cron trigger like the morning deck: reconcile is
  deterministic and cheap — no agent judgment involved, so no reason to spend a
  scheduler dispatch + agent session on it. The scheduler stays for agent-shaped work.
- `POST /api/deck/reconcile` and `reconcile_deck` stay as the manual/agent paths.
- The router (Phase 2.5's `mutedKinds` included) decides what the user actually sees.

### 3.2 Real routines (kill the mock) `[reuse]` `[ui]`
- `getRoutineStats()` in `queries.ts`: recurring tasks (`recurrence IS NOT NULL`) →
  `RoutineItem` with real `completedCount` for the current period (from
  `task_completions`), `targetCount`/`period` parsed from `recurrence`, `streak` =
  consecutive prior periods meeting target.
- `DeckDayBar`/`DeckRoutines` consume it; routine complete calls
  `completeTask.mutate` (which already advances `nextRecurrenceAt` and logs the
  completion). Delete `MOCK_ROUTINES` (`deck-container.tsx:62`).
- Fallback decision if streak math balloons: ship count-for-period without streaks
  first — but the mock does not survive this pass either way.

### 3.3 Right-size the models `[reuse]`
- Phase 2 gathering: `process.env.MODEL_FAST || process.env.MODEL_STANDARD || fallback`
  (`generate-deck.ts:360`) — matches the "small model" the file header already claims.
- Phase 3 generation: `process.env.MODEL_CAPABLE || process.env.MODEL_STANDARD ||
  fallback` (`:392`). The deck is the product's judgment surface; it gets the most
  capable configured model, not the cheapest.
- Fix the latent provider mismatch: `.env.example` ships `anthropic/`-prefixed model
  ids (`MODEL_STANDARD=anthropic/claude-sonnet-4-6`) but `generate-deck.ts` feeds the
  value straight into `openai(...)`. Route model resolution through the app's
  provider-resolution seam so a prefixed id picks the right SDK; until then the deck
  silently requires OpenAI ids and breaks on the documented defaults.
- **Decision (tracked, out of scope here):** moving deck generation onto the harness
  (orchestrator/agentex) like the rest of the product. This task only makes the current
  pipeline honest; the harness move is a separate spec.

## Phase 4 — Attention (the deck as the human lane of the loop)

### 4.1 `DeckItem.kind` `[new]`
- Extend the `DeckItem` JSON type + zod: `kind: 'do' | 'review'`, default `'do'`.
  (`'decide'`/`'unblock'` are anticipated but not built until something produces them.)
  No SQL migration — JSON column.

### 4.2 Review lane (deterministic, live) `[reuse]` `[ui]`
- The deck GET payload gains `reviewItems`, derived at read time from
  `listNeedsReviewSessionCandidates()` (`queries.ts:3439`) — **not** stored on the
  `decks` row. Review state changes minute to minute; a stored copy is stale by
  definition. The deck row stays the plan; the review lane is live truth.
- UI: a "Needs your review" group rendered above the do-stack in `DeckStack`:
  execution/session label, workspace name, time since the outcome landed. Click opens
  the execution. Copy contains no em dashes or semicolons (user-facing string rule).
- Generation awareness (light touch): `buildDeckPrompt` gains a `[Pending Reviews]`
  line (count + labels) so sizing accounts for review time when picking do-items.
  Review items themselves are never LLM-ranked and never deck entries — the "never
  invent tasks" invariant holds.
- This is the seam the future Execution Queue plugs into (see 4.4).

### 4.3 Delegate as a card action `[ui]` `[reuse]`
- Each do-card gets "Delegate" alongside Focus / Done / Not today.
- V1 is intentionally thin: opens the existing new-execution composer prefilled with
  the task's title, description, and continuity context; the user picks the workspace
  and sends. Records a `delegate` deck decision (2.1) with the task id.
- Once dispatched, the card shows a running badge (execution id in the decision
  `detail`, surfaced via the review lane when output lands). No auto-routing, no
  Flow-chosen strategy — the user owns the hook (strategy-agnostic primitives rule).

### 4.4 One brain, two lanes (decision doc, no code) `[new]`
- Write the alignment note into `docs/execution-queue-ideas.md`: the deck ranks
  **human attention** (do + review), the execution queue ranks **agent capacity**
  (proposed + running work). They are two lanes of one loop, share
  `deck_decisions`/acceptance telemetry, and must never become two competing answers
  to "what should I look at now." Any queue UI surfaces on the deck through the
  review lane and the delegate action — not as a sibling tab with its own ranking.

## Phase 5 — Simplify (rides along with any phase)

### 5.1 Delete dead components `[ui]`
- Remove `plan-review.tsx`, `plan-review-v2.tsx`, `plan-review-v3.tsx` from
  `src/components/deck/` (verify no imports via `index.ts` first).

### 5.2 Remove `radarItems` `[ui]`
- Strip from `DeckPlan`, `hydrateDeckRecord`, `handlePromote`'s radar branch
  (`deck-container.tsx:487-503`), and `DeckMoreOptions` props. It has never carried
  data; the promote branch is unreachable and unpersisted.

### 5.3 One task→card mapper `[reuse]`
- Single `taskToDeckItem` / `taskToAlternativeItem` pair in `src/lib/deck/hydrate.ts`
  (from 1.6) used by all four current call sites (`deck-container.tsx:40`, `:126`,
  `:357`, `:442`, `:468`). The field-by-field rebuilds diverge today (some drop
  `estimatedMinutes`/`hardDeadline`).

### 5.4 Demote the conductor filters `[ui]`
- Area filter, work-mode toggle, and due-today filter move into one overflow control
  on `DeckConductor`. The default face of the deck: framing line, what-changed brief,
  the stack. Due-today stays visible only as a passive count badge.
- Rationale: filters are the user doing the organizing the AI was supposed to have
  done. They remain available, but they stop costing glance time.

### 5.5 Container diet `[ui]`
- With 1.6 + 5.3 landed, `DeckContainer` keeps only render orchestration and handler
  wiring. Target under ~300 lines. No new abstractions — just move data logic to the
  hook and lib modules created above.

---

## Explicitly not in this pass

- **Harness move for deck generation** — tracked as the decision in 3.3.
- **Execution Queue build** — 4.4 only writes the alignment so the deck and queue
  converge instead of colliding.
- **Deadline-driven proactive execution** (agent starts the work before the deadline
  becomes a human emergency) — the natural Phase 4 follow-up, but it depends on the
  queue's propose→approve flow. The delegate action (4.3) is its manual precursor.
- **Multi-day planning, team-sourced decks** — unchanged from the proactive spec.
  One constraint to hold from `team-product-direction.md`: every task touch goes
  through `queries.ts` helpers so it still works when the task came from somewhere
  else.

## Suggested order

Phase 1 and Phase 5 deletions first (trust + cheap wins, one PR-sized chunk each).
Phase 2 next — it's the moat and everything after it benefits from the telemetry.
Phase 3 then turns on the honesty loop with the router now learning. Phase 4 last,
and 4.2 (review lane) before 4.3 (delegate).

## Task list

### Phase 1 — Trust
- [ ] **1.1** `addDaysLocal` + local day boundary in `generateDeck` task windows
- [ ] **1.2** Client due-today via string compare + `todayLocalDate`
- [ ] **1.3** Server-hydrated `{deck, tasks}` payload; drop the 50-task join
- [ ] **1.4** Bumped lane excludes tasks currently on the deck
- [ ] **1.5** Subtask complete → real `completeTask`; defer → persisted `deferredSubtaskIds`
- [ ] **1.6** `use-deck.ts` hooks: TanStack Query + optimistic mutations + toast on failure
- [ ] **1.7** Smoke coverage for 1.1–1.5

### Phase 2 — Learn
- [ ] **2.1** `deck_decisions` schema + migration + query helpers + POST route
- [ ] **2.2** Record every deck override from the client handlers
- [ ] **2.3** `recordTaskDeferral` wired to not-today + reconcile defers (once per day)
- [ ] **2.4** `[Your Recent Deck Decisions]` prompt section + system-prompt guidance
- [ ] **2.5** `getMutedChangeKinds()` → `routeChange`; tests

### Phase 3 — Honesty
- [ ] **3.1** 15-min in-process reconcile interval (guarded) in `instrumentation.ts`
- [ ] **3.2** Real routines from recurring tasks; delete `MOCK_ROUTINES`
- [ ] **3.3** Gathering→`MODEL_FAST`, generation→`MODEL_CAPABLE`; fix provider-prefix resolution

### Phase 4 — Attention
- [ ] **4.1** `DeckItem.kind: 'do' | 'review'`
- [ ] **4.2** Live review lane from `listNeedsReviewSessionCandidates` + `[Pending Reviews]` sizing context
- [ ] **4.3** Delegate card action → prefilled execution composer + decision record
- [ ] **4.4** One-brain alignment note in `docs/execution-queue-ideas.md`

### Phase 5 — Simplify
- [ ] **5.1** Delete `plan-review*.tsx`
- [ ] **5.2** Remove `radarItems` end to end
- [ ] **5.3** Consolidate task→card mapping in `src/lib/deck/hydrate.ts`
- [ ] **5.4** Filters into one overflow control; due-today as passive badge
- [ ] **5.5** Container under ~300 lines
