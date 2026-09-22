# Deck — Focused layout (trial)

Status: **trial** · behind a per-browser pref, default off · Settings > General > Deck layout.

## Why

The Deck grew into a single command center: the day strip, Add a task, a triage
prompt, a change brief, a DEADLINES section, an IN PROGRESS list (often 6-8
cards), then the ranked stack, then MORE OPTIONS. Every piece is defensible, but
together they push "what do I do right now" three or four scrolls below the fold
and make the surface read as a console to survey rather than a place to work.

The Deck is really answering four questions at once (orient / monitor / decide /
focus), and a command center is the opposite of a focused work surface by
nature. This trial keeps the command center but gives it a hero and a floor, so
"decide + focus" leads and "orient + monitor" fold away.

## What the focused layout does

`DeckFocusedView` (`src/components/deck/deck-focused-view.tsx`) replaces the
dense body when the pref is `focused`:

- **The same ranked stack, flat and whole.** No hero, nothing singled out as the
  "top" task, nothing collapsed. Work is parallel in the agent world, so the
  deck does not pretend there is one next thing; the `DeckStack` renders every
  item, drag-reorder included, exactly as classic does.
- **One add field that creates or pulls** (`DeckAddBar`): type an intent and it
  both offers to create that task as new AND surfaces matching existing tasks to
  pull onto the deck (arrow keys + Enter, or click). This reconciles the old
  split between "Add a task" (new) and "More options" (existing) into a single
  obvious entry — the original source sketch of "[new task name +] / [list of
  similar tasks +]".
- **A compact ribbon** for status, one tap away: `N in progress · M to review`
  (expands the existing `CurrentWorkSection` inline) and `N to triage` (opens
  Stream). Each is a chip, not a full section, so status stops dominating the
  surface.

Shared with the classic layout: the per-item **rationale** ("why this, why now")
now renders as a single muted line that expands on click, so it stays a glimpse
rather than a wall of injected text (`SortableDeckItemCard` in `deck-stack.tsx`).

The point of the layout is not a hero — it is stripping the console around the
stack: the in-progress section and triage prompt fold into the ribbon, the
change brief drops to a quiet one-liner, and the empty chrome (an empty day-bar
row, the pairing spark icon) is gone.

## What is unchanged

- **Urgent hard deadlines still lead.** `DeadlineBand` (the always-on,
  deterministic hard-deadline strip) renders above this view exactly as before,
  in both layouts. Deadlines were the one thing that must not fold, and they
  don't: the focused layout deliberately does not touch them.
- **Interrupt banner and change brief** still show above the hero (dismissible),
  since a priority interrupt or "what changed since yesterday" is exceptional
  and transient, not permanent chrome.
- The classic dense layout is the default and is completely untouched.

## Reversibility

Per-browser localStorage (`src/lib/client/deck-layout-mode.ts`,
`ri.client.deckLayoutMode`), no schema, mirrors the quick-add trial. Default
`classic`. When the focused layout wins, make it the layout and retire the
switch; if it loses, delete `deck-focused-view.tsx`, `deck-layout-mode.ts`, and
the Settings row.

## Code map

- `src/lib/client/deck-layout-mode.ts` — the pref.
- `src/components/deck/deck-focused-view.tsx` — flat stack + add bar + ribbon.
- `src/components/deck/deck-add-bar.tsx` — the create-or-pull add field.
- `src/components/deck/deck-container.tsx` — branches the body on the pref, hides
  the standalone `CurrentWorkSection` in focused mode (it moves into the ribbon),
  and prepends quick-added tasks so they land at the top.
- `src/components/settings/sections/general-section.tsx` — the Deck layout row.

(`deck-add-composer.tsx` remains the create-only composer for the classic
layout's quick-add trial.)
