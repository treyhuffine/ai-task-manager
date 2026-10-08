# Deck — Layout

Status: **shipped** · the only deck layout since 2026-10-08. Adding tasks: `docs/deck-quick-add.md`. Heartbeat chip: `docs/heartbeat-spec.md` §7.2.

## Why it looks this way

The Deck grew into a command center that surveyed everything at once: the day strip, an Add task pill, a triage prompt, a change brief, deadlines, a full In progress list (often 6 to 9 cards), the ranked stack, then More options. Every piece was defensible, but together they pushed "what do I do now" several scrolls down, and the surface read as a console to survey rather than a place to work.

The Deck answers four questions (orient, monitor, decide, focus), and a command center is the opposite of a focused work surface by nature. So the layout keeps the command center and the flat ranked stack, but strips the console around it. It was built as a reversible "focused" trial behind Settings > General > Deck layout, refined against live renders, and then made the only layout. The trial switch and the classic layout are gone.

## Principles

1. **Hard deadlines never fold.** Missing one is irreversible, so the always-on `DeadlineBand` stays pinned above today's work, in every phase, even when generation fails.
2. **No hero, nothing collapsed.** Work is parallel in the agent world, so the stack is flat and whole. No task gets special UI for being first. (A single "hero" task was tried and dropped.)
3. **Fold status, not tasks.** In progress, triage, done today, and the heartbeat are chips one tap away, never full sections competing with the stack.
4. **One section grammar.** Every block uses the DEADLINES pattern: an uppercase label, quiet inline meta, a rule. Nothing floats loose between sections.
5. **One voice for AI commentary.** The deck's framing, each card's rationale, and any "last session" note are one-line muted glimpses that expand on click. Never always-on italic prose.
6. **Silence is the healthy state.** A chip appears only when it has something to say: no empty bars, no status for things that are fine.

## Top to bottom

**Fixed header** (never scrolls):

- **Conductor** (`DeckConductor`): Light / Deep, area filter, Due today, the morning auto-refresh toggle, Generate New Deck.
- **Day strip** (`DeckDayBar` → `DayShapeStrip`): the day's shape and the "good window for…" pairing line. A habits row appears under it only once habits are backed by real tracking.
- **Add bar** (`DeckAddBar`): one field to create a task or pull an existing one onto today's deck. Always in the same place. See `docs/deck-quick-add.md`.

**Scrolling body:**

- **DEADLINES** (`DeadlineBand`): urgent hard deadlines, deterministic, self-hides when there are none.
- A stale-deck note, only when the plan on screen isn't today's, and a priority interrupt banner, only when the router escalated one.
- **TODAY** (`DeckToday`):
  - Header: `TODAY` with the change log as quiet meta ("7 carried over · 1 new", via `summarizeDeckChanges`) and a small **Versions** toggle that opens the revert list (`DeckVersionList`).
  - The deck's framing as a one-line glimpse.
  - **Status row** of chips, each shown only when it applies: `N in progress · M to review` (expands `CurrentWorkSection`), `N to triage` (opens Stream) or, when nothing awaits a decision, `Triaged while you were away` (an unseen triage digest), `N done` (what you finished from the deck today), and the heartbeat chip when it needs you (`heartbeatDeckSignal`).
  - The ranked stack (`DeckStack`), flat, drag to reorder.

**Pinned footer:** More options (alternatives, bumped, radar, view all tasks).

Without a deck on screen (intake, generating, or generation unavailable), `CurrentWorkSection` renders standalone under the deadlines, so what is actually underway stays visible.

## Code map

- `src/components/deck/deck-container.tsx` — state, handlers, the fixed header, and the body.
- `src/components/deck/deck-today.tsx` — the Today section: header, framing, status row, stack.
- `src/components/deck/deck-add-bar.tsx` — the create-or-pull field.
- `src/components/deck/deck-versions.tsx` — the revert list behind "Versions".
- `src/components/deck/deck-day-bar.tsx` — day strip plus habits row.
- `src/components/heartbeat/heartbeat-chip.tsx` — the exception-only heartbeat chip and its settings sheet.
- `src/lib/deck/change-summary.ts` — the change-log summary (tested).
- `src/lib/heartbeat/status.ts` — `heartbeatDeckSignal`, when the deck mentions the heartbeat (tested).
- `src/components/deck/deck-stack.tsx` — the cards and their one-line reasoning glimpse.

## Still open

- Item #1 still gets two small special treatments in `DeckStack`: the "Hide items below" divider is always visible after the first card (hover-only after the others), and subtasks start expanded on the first card only.
- A keyboard shortcut for the add bar (see `docs/deck-quick-add.md`).
