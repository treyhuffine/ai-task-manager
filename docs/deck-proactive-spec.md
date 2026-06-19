# Proactive Deck — Spec

Status: **proposed** · Supersedes the reactive model in `docs/deck-v2-spec.md`

## Goal

Invert the deck from **reactive** to **proactive**.

Today the deck is user-driven: you open the Deck tab, fill in a check-in
(`CheckInIntake`), and only then does the AI rank your tasks. That is a decision
tax at the worst moment of the day, and it makes the human do the organizing —
the exact thing this app exists to remove (*"minimize the decisions and
maintenance overhead that lead to system and task rot"*).

The proactive deck is **always already there.** It is dealt for you before you
sit down — overnight (or on first look), reconciling yesterday into today against
your priorities, hard deadlines, and your real calendar. Through the day it stays
honest to reality without you driving it, and it never jerks you around. The AI is
your chief of staff: it absorbs almost everything silently, surfaces the few things
worth knowing at a calm moment, and only interrupts you when a decision is truly
yours to make.

The standard for "done": you wake up, glance at the deck, and it's *right* —
sized to the day you actually have, with the one or two things that matter on top,
and you start executing without arranging anything.

## Principles (decided)

1. **The deck only rearranges itself in response to things you didn't do.**
   Internal changes (you add a task, finish one, reorder) never trigger a
   reshuffle — your plan holds. External changes (a meeting appears/moves/cancels;
   later: an incoming message, a reassigned task) *do* reshape it, automatically,
   because you didn't choose them and shouldn't have to reconcile them by hand.

2. **Automatic, but never surprising.** Every automatic change is (a) **narrated**
   — what moved and why — and (b) **reversible** — every change creates a restore
   point. Nothing ever silently disappears; bumped items **relocate to a visible,
   labeled lane** with their reason, one tap from coming back.

3. **Calendar is the skeleton, not a constraint.** The deck is your tasks *poured
   into the real gaps of your real day*, not a list sitting next to a calendar.
   Blocking time is the floor; sizing and slotting are the value.

4. **The default is silence.** Mid-day signals route through one policy: most are
   absorbed silently, some batch into a calm digest at a natural seam, and only a
   rare few — a decision only you can make *and* one that can't wait — earn an
   interrupt. A zero-interrupt day should still leave you caught up.

5. **The AI is the driver; manual control is an intentional detour.** Regenerating
   from feedback still exists, but you have to *choose* it. The proactive deck must
   be fully valuable with zero input. Optional "intent for today" is a steer you
   can ignore, never a gate.

## Current state (grounded)

What exists today, so the task list below is precise about reuse vs. net-new.

- **Schema** — `decks` table at `src/lib/db/schema.ts:180`. Columns: `context`,
  `contextTags[]`, `framing`, `items: DeckItem[]`, `alternatives: DeckAlternative[]`,
  `searchContext`, `model`, `createdAt`, `updatedAt`. `DeckItem = {taskId,
  rationale, continuityContext, source}` and `DeckAlternative = {taskId, reason}`
  (same file, `:193`/`:200`). **No notion of "which day," no version/lineage, no
  change log, no calendar.**
- **Generation** — `generateDeck(generationContext)` in
  `src/lib/ai/generate-deck.ts`. Three phases: (1) deterministic DB queries for
  active/deadline/recurring tasks + areas + recent completions, (2) small-model
  knowledge-base search, (3) standard-model structured output via
  `deckResponseSchema`. Persists a **brand-new** deck row each call. **It never
  reads the previous deck** ("next generation ignores the prior deck entirely") and
  has no calendar input. Prompt/schema live in `src/lib/ai/deck-generation.ts`
  (`DECK_SYSTEM_PROMPT`, `deckResponseSchema`, `buildDeckPrompt`).
- **Triggers (all reactive)** — `POST /api/deck/generate`
  (`src/app/api/deck/generate/route.ts`, from `DeckContainer` check-in), chat tool
  `regenerateDeck` (`src/lib/ai/chat-tools.ts:430`), orchestrator action
  `regenerate_deck` (`src/lib/orchestrator/registry.ts:544` → calls `generateDeck`).
- **Read** — `GET /api/deck?limit=1` returns the newest deck by `createdAt`
  (`src/app/api/deck/route.ts`); the client decides if it's "today's." Query
  helpers `getLatestDeck` / `getDeck` / `updateDeck` at `src/lib/db/queries.ts:558`.
  Mutations via `PATCH /api/deck/:id`.
- **Scheduler (reusable!)** — `src/lib/scheduler/runner.ts`: 60s tick, file-locked
  single-process, at-most-once, active-hours windows. `schedules` table at
  `src/lib/db/schema.ts:697` supports `kind:'cron'`, `cronExpression`, `timezone`,
  `activeHoursStart/End`, `targetKind:'orchestrator'|'workspace'`. Cron validation in
  `src/lib/scheduler/cron.ts`, dispatch in `src/lib/runs/dispatch.ts`. Boots from
  `instrumentation.ts`. **Key nuance:** schedules dispatch a *prompt to an agent
  session*, they don't call functions directly.
- **UI** — `src/components/deck/deck-container.tsx` orchestrates intake → deck.
  `CheckInIntake`, `DeckStack`, `DeckMoreOptions` (alternatives), `PreviousDeckPreview`,
  `DeckDayBar`. Client deck shape `DeckPlan` at `src/types/dashboard.ts:171`.
- **Calendar** — stub tab only; real data arrives via the connectors work
  (separate in-flight effort).

## Target model — the deck's lifecycle

### A. Morning (the daily boundary)
At ~4AM local (configurable) **or** the first time you look that day — whichever
fires first — exactly one **active deck for today** is ensured. Generation now
**reconciles**: reads yesterday's deck, sees what got done vs. didn't, and makes an
opinionated call per leftover (carry forward / defer / drop, each with a reason),
then ranks against priorities + hard deadlines + calendar, **sized to the hours you
actually have** and slotted against your real gaps. Carried/deferred/dropped items
land in the visible bumped lane, not the void.

### B. Mid-day (staying honest, hands-off)
The app heartbeat re-looks at the day on a cadence. When **external reality**
changes the shape of the day (calendar delta), the deck **auto-adapts** — re-sizes,
re-slots, and **decides what gives** — records the change, and routes a notice
through the change-router (§ below). Internal edits never trigger this. The "what
gives" choice is **AI-made under light guidance**, not a hard rule (see §5).

### C. Manual (intentional)
A clearly-chosen "regenerate" path (the current check-in flow, demoted from the
front door) lets you re-deal with feedback or an explicit intent. Plus a one-tap
**revert** to any prior snapshot of today's deck.

## What changes, by area

### 1. Data model (`src/lib/db/schema.ts`)
The deck needs a sense of *day*, *lineage*, and *what changed*. Proposed additions
to `decks`:

- `forDate TEXT` — the day this deck is for (`YYYY-MM-DD`, local). Defines "today's
  deck."
- `supersededAt TEXT` (nullable) — null = the active deck for its `forDate`. A regen
  or mid-day reshape sets the prior active row's `supersededAt` and inserts a new
  active row. **Versioning falls out for free**: every prior version is a row;
  revert = re-activate one.
- `replacesDeckId TEXT` (nullable) — lineage pointer to the version this one
  replaced (for the revert UI and audit).
- `origin TEXT` enum `morning | midday | manual | first_open` — what produced this
  version.
- `changes JSON` — the deltas that produced this version, so the UI renders "what
  changed" without diffing:
  `Array<{ kind: 'carried'|'deferred'|'dropped'|'added'|'reordered'|'bumped', taskId, reason, source: 'reconcile'|'calendar'|'user' }>`.
- Extend `DeckItem` with optional **slotting**: `slotStart?`, `slotEnd?` (ISO) and
  `slotReason?` — where in the real day this sits.

New query helpers in `src/lib/db/queries.ts`: `getActiveDeckForDate(date)`,
`getDeckVersions(date)`, `supersedeAndInsertDeck(...)`, `revertDeckTo(deckId)`.

### 2. Generation becomes reconciliation-aware (`src/lib/ai/generate-deck.ts` + `deck-generation.ts`)
- Phase 1 gains two inputs: **the previous active deck** (via
  `getActiveDeckForDate(yesterday)` / latest) and **today's calendar events** (via
  the calendar provider, §4).
- `buildDeckPrompt` includes a `[Yesterday's Deck — status]` section (what was on
  it, what completed) and a `[Today's Calendar]` section (busy blocks + free gaps +
  total available minutes).
- `DECK_SYSTEM_PROMPT` gains reconciliation + sizing + slotting rules: make an
  explicit carry/defer/drop call on each leftover; never exceed available hours;
  assign deep work to the largest gap, light tasks to short gaps; flag honest
  deadline math (a Fri deadline with a packed Thu/Fri is effectively due today).
- `deckResponseSchema` gains: per-item `slot` ({start, end, reason} | null) and a
  top-level `reconciliation: Array<{taskId, decision:'carry'|'defer'|'drop', reason}>`.
- `generateDeck` persists via `supersedeAndInsertDeck` (writes `forDate`, `origin`,
  `replacesDeckId`, `changes`) instead of a bare insert.

### 3. Triggers become proactive
- **`ensureTodaysDeck(opts)`** (new, server-side) — the backbone. If no active deck
  for today, run the reconciliation `generateDeck`. Idempotent (one deck/day).
  Local-first safe: works with zero scheduler.
- **Lazy path (Phase 1 — the only trigger to start)** — `GET /api/deck` calls
  `ensureTodaysDeck()` so the deck is dealt on first look. This is the whole trigger
  story for the flip; local-first safe, no scheduler needed.
- **Cron path (deferred → Phase 3, lands with the heartbeat)** — a `kind:'cron'`,
  `targetKind:'orchestrator'` schedule at the user's configured time whose prompt is
  the morning-reconciliation instruction; the orchestrator agent calls
  `regenerate_deck`/`ensureTodaysDeck`. Reuses the whole scheduler. Added when the
  heartbeat goes in, not before.
- Keep `regenerate_deck`, the chat tool, and `POST /api/deck/generate` — they remain
  the **manual** path, now writing versions instead of clobbering.

### 4. Calendar provider interface (decoupled from the connector)
A thin read interface the deck consumes, so generation + heartbeat can be built and
tested against a stub before the real connector lands:
`getCalendarEventsForDay(date): Promise<CalendarBlock[]>` where
`CalendarBlock = { start, end, title, source }`. Implemented later by the connectors
layer; ships first as a stub returning `[]` (deck degrades gracefully to "a normal
day"). Derived helper `computeFreeGaps(blocks, workdayBounds)`.

### 5. The change-router (firehose policy) — `src/lib/deck/change-router.ts` (new)
One source-agnostic policy that every external signal flows through. Three channels:
- **Absorb (silent)** — default. Deck reflects reality; change is discoverable in
  the bumped lane / "what changed" log, never pushed.
- **Digest (ambient)** — accumulates; delivered at a natural seam (morning brief,
  next deck open, end of a focus block) as one calm summary.
- **Interrupt (now)** — only if **both**: needs a decision only the user can make,
  **and** can't wait. Rare by design. **Surface: a priority banner in-app to start.**
  Later, an interrupt may also fan out to a user's registered notification channel
  (push/etc. — that channel system is to be built separately).

Routing inputs: did the AI resolve it cleanly? magnitude (touches a hard-deadline /
explicitly-prioritized item?)? time-sensitive? is the user in a focus block?
Includes an **interrupt budget** (target ≈ 0–2/day; more = miscalibration) and
**batching** (report net change per tick, not per event). The bar is **learned**:
dismiss a class repeatedly → it demotes toward silent. Built calendar-shaped but
generalizes to every future connector (Slack, email, reassignments).

**"What gives" is AI-decided, not rule-coded.** When a calendar delta forces
something off today, the model chooses what bumps under *light guidance* in the
prompt — prefer lower-priority / lighter / softer-deadline items; treat a
hard-deadline or explicitly-prioritized item as expensive to bump and flag it loudly
if it must; respect recent momentum. No hard "always protect X" rule — the intent is
captured as guidance, the model applies judgment, and every bump is narrated +
reversible so a wrong call is one tap to fix.

### 6. UI (`src/components/deck/`)
- **Bumped lane** — a distinct, labeled grouping (extend `DeckMoreOptions` /
  `alternatives` rendering) for carried/deferred/dropped items, each showing its
  reason, each one tap to restore. *"Nothing disappears; it relocates."*
- **Change callouts** — inline, dismissible "what changed" notices driven by the
  deck's `changes` log, with Undo. Surface morning reconciliation as a brief.
- **Revert control** — "back to my earlier deck" using `getDeckVersions` /
  `revertDeckTo`.
- **Slotting view** — render `slot` times so the deck reads against the real day
  (the surfaced timeslots).
- **Demote `CheckInIntake`** — no longer the gate to seeing a deck; becomes the
  optional manual-steer / regenerate surface.

## Phasing — ship the flip first, layer the rest

- **Phase 1 — Proactive flip (no calendar needed).** Day-aware schema + versioning,
  `ensureTodaysDeck`, **lazy first-look trigger only**, reconciliation
  (carry/defer/drop) in generation, bumped lane + revert UI, demote the check-in.
  **This alone kills the reactive model and delivers the morning "it's already
  right" moment.**
- **Phase 2 — Calendar (size + slot).** Provider interface + stub → real connector;
  sizing and slotting in generation; slot rendering.
- **Phase 3 — Mid-day + router (lands with the heartbeat).** Heartbeat hook,
  **4AM cron trigger**, `change-router`, AI-decided auto-bump on calendar delta,
  digest + priority-banner interrupt, focus-gating, learned bar.
- **Phase 4 — Delight.** Meeting-derived prep/follow-up task suggestions; honest
  deadline math surfacing; router learning across all connectors.

## Out of scope / deferred
- Changing the deck's model provider (still OpenAI in `generate-deck.ts`); the
  reconciliation step may later warrant a stronger model — separate decision.
- The connectors/auth layer itself (separate in-flight effort; this spec only
  defines the read interface it must satisfy).
- Multi-day / weekly planning. This is strictly "today."

## Decisions (resolved 2026-06-18)
- **Trigger:** Lazy `ensureTodaysDeck` only for Phase 1. The 4AM cron is **deferred
  to Phase 3** and goes in alongside the heartbeat. Cron is never load-bearing
  (local-first).
- **Auto-bump:** **AI decides under light guidance** — no hard-coded "protect X"
  rule. The prompt carries the intent (prefer bumping lower-priority / lighter /
  softer-deadline; treat hard-deadline items as expensive, flag loudly if bumped);
  the model applies judgment; every bump is narrated + reversible.
- **Interrupt surface:** **priority banner in-app** to start. Later may also fan out
  to a user's registered notification channel (that channel system is TBD/separate).
- **Workday bounds for sizing:** **decide later.** Phase 2 placeholder = 9–6 local;
  revisit (user setting vs. inferred) when calendar sizing is built.

---

## Task list

Tags: `[reuse]` extends existing code · `[new]` net-new · `[cal]` needs calendar ·
`[ui]` front-end. Phase 1 is the minimum to retire the reactive deck.

### Phase 1 — Proactive flip
- [ ] **1.1** `[new]` Add `decks` columns: `forDate`, `supersededAt`,
  `replacesDeckId`, `origin`, `changes` JSON; extend `DeckItem` with optional `slot`
  fields. Update `DeckItem`/`DeckAlternative` interfaces. (`src/lib/db/schema.ts`)
- [ ] **1.2** `[new]` Drizzle migration for 1.1 (`pnpm db:generate`; regenerate, don't
  hand-edit the journal).
- [ ] **1.3** `[new]` Query helpers: `getActiveDeckForDate`, `getDeckVersions`,
  `supersedeAndInsertDeck`, `revertDeckTo`. (`src/lib/db/queries.ts`)
- [ ] **1.4** `[reuse]` Teach `generateDeck` to load the previous active deck and
  pass yesterday's-deck status into the prompt; persist via `supersedeAndInsertDeck`
  with `origin`/`changes`. (`src/lib/ai/generate-deck.ts`)
- [ ] **1.5** `[reuse]` Reconciliation in prompt + schema: `[Yesterday's Deck]`
  section in `buildDeckPrompt`; carry/defer/drop rules in `DECK_SYSTEM_PROMPT`;
  add `reconciliation[]` to `deckResponseSchema`; map decisions into `changes` +
  the bumped lane. (`src/lib/ai/deck-generation.ts`)
- [ ] **1.6** `[new]` `ensureTodaysDeck(opts)` — idempotent "one active deck for
  today," runs reconciliation when missing. (`src/lib/deck/ensure-todays-deck.ts`)
- [ ] **1.7** `[reuse]` `GET /api/deck` calls `ensureTodaysDeck()` (lazy first-look
  guarantee). (`src/app/api/deck/route.ts`)
- [ ] **1.8** `[ui]` **Bumped lane**: labeled grouping for carried/deferred/dropped
  with reason + one-tap restore. (extend `src/components/deck/deck-more-options.tsx`)
- [ ] **1.9** `[ui]` **Change callouts + morning brief** from `deck.changes`, with
  Undo. (`src/components/deck/`)
- [ ] **1.10** `[ui]` **Revert** control over deck versions (`getDeckVersions` /
  `revertDeckTo`). (`src/components/deck/deck-container.tsx`)
- [ ] **1.11** `[ui]` Demote `CheckInIntake` — deck renders proactively on open;
  intake becomes the optional manual-steer surface, not a gate.
  (`src/components/deck/deck-container.tsx`, `check-in-intake.tsx`)
- [ ] **1.12** `[reuse]` Keep `regenerate_deck` / chat tool / `POST /generate` as the
  manual path, now version-writing (no clobber). (`registry.ts:544`,
  `chat-tools.ts:430`, `api/deck/generate/route.ts`)
- [ ] **1.13** Smoke: morning ensure is idempotent; revert round-trips; nothing
  vanishes (every removed item is in the bumped lane).

### Phase 2 — Calendar (size + slot) `[cal]`
- [ ] **2.1** `[new]` Calendar provider interface
  `getCalendarEventsForDay(date) → CalendarBlock[]` + `computeFreeGaps` + a stub
  returning `[]`. (`src/lib/deck/calendar.ts`)
- [ ] **2.2** `[reuse]` Feed today's calendar + free-gap + available-minutes into
  Phase 1 of `generateDeck` and into `buildDeckPrompt`.
- [ ] **2.3** `[reuse]` Sizing + slotting rules in `DECK_SYSTEM_PROMPT`; populate
  per-item `slot`. Honest deadline-math note.
- [ ] **2.4** `[ui]` Render slots so the deck reads against the real day; surface the
  day's timeslots.
- [ ] **2.5** `[cal]` Wire the stub to the real calendar connector when it lands.

### Phase 3 — Mid-day + change-router (lands with the heartbeat)
- [ ] **3.1** `[new]` **4AM cron trigger** — deck-schedule manager creates/owns a
  `kind:'cron'`, `targetKind:'orchestrator'` schedule at the user's configured time
  (configurable + on/off) driving the morning reconciliation. (`src/lib/deck/schedule.ts`,
  reuses `schedules` + `src/lib/scheduler/cron.ts`) *(deferred here from Phase 1)*
- [ ] **3.2** `[new]` `change-router.ts`: absorb/digest/interrupt classification,
  interrupt budget, batching, focus-gating, learned bar. (`src/lib/deck/`)
- [ ] **3.3** `[new]` `reconcileDeckWithExternalChanges()` — diff current calendar vs.
  the deck's assumed snapshot; AI-decided resize/slot/bump under light guidance;
  record `changes`; emit through the router. (`src/lib/deck/`)
- [ ] **3.4** `[reuse]` Hook 3.3 into the app heartbeat cadence.
- [ ] **3.5** `[ui]` Digest surface (calm "what shifted while you focused") +
  **priority-banner** interrupt surface.
- [ ] **3.6** `[new]` Router learning: dismiss-a-class → demote toward silent.
- [ ] **3.7** `[new]` *(when channels exist)* Optionally fan an interrupt out to a
  user's registered notification channel — depends on the separate channel system.

### Phase 4 — Delight
- [ ] **4.1** Meeting-derived prep/follow-up task **suggestions** (never silent
  creation).
- [ ] **4.2** Generalize the router across connectors (Slack/email/reassignments).

---

## Build-now pass (pre-connector) — 2026-06-18

Phase 1 shipped. This pass builds everything in Phases 2–3 that does **not** need
the calendar connector or the app heartbeat, against a **calendar provider seam**
(stub today) so it lights up the moment a connector registers a real provider.

**Building now:**
- **Calendar seam** — `src/lib/deck/calendar.ts`: `getCalendarEventsForDay` (stub
  `[]` + `setCalendarProvider` registry for connectors), `computeFreeGaps`,
  `availableMinutes`. Pure-function tests.
- **Workday bounds + manual time budget** — `user_state.workdayStart/End` (default
  09:00–18:00) + reuse existing `user_state.availableMinutes`. Sizing works with
  zero calendar via an explicit budget.
- **Sizing + slotting in generation** — `[Today's Time]` prompt section, `slot`
  on deck items, honest-deadline guidance; deck stores the `calendarSnapshot` it
  was built against (for mid-day diffing).
- **Slot rendering** — time badge on deck cards.
- **change-router** — `src/lib/deck/change-router.ts`: absorb/digest/interrupt
  policy, interrupt budget, focus-gating, `mutedKinds` hook. Fully unit-tested.
- **Mid-day reconcile (inert until real calendar)** —
  `src/lib/deck/reconcile-external.ts`: deterministic diff of live calendar vs the
  deck's snapshot → router → auto-bump / freed-time nudge → new `midday` version.
  Driven via `POST /api/deck/reconcile` + orchestrator action `reconcile_deck`
  (a heartbeat/scheduler calls it later). Tested with a mock provider.
- **4AM morning cron** — `src/lib/deck/schedule.ts` upsert of a `kind:'cron'`
  orchestrator schedule on the existing scheduler; `GET/PUT /api/deck/schedule`;
  conductor toggle. Default off (opt-in).
- **Change channels + interrupt banner** — `DeckChange.channel`, `DeckInterruptBanner`,
  brief/bumped handling for `bumped`/`calendar`-sourced changes.

**Still deferred (genuinely blocked):**
- Real calendar feed → the **connector** (the seam is ready for it).
- Heartbeat *cadence* that auto-calls reconcile → the **heartbeat** (reconcile is
  callable now; scheduler can stand in).
- Router-learning *persistence* (dismiss→demote over time) → needs real signal
  volume; the `mutedKinds` input exists as the hook.
- Phase 4 (prep-task suggestions, non-calendar connectors).
</content>
</invoke>
