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
nature. This trial keeps the command center and the flat ranked stack, but
strips the console around it: status folds into a ribbon, AI commentary becomes
one-line glimpses, and every block gets the same labeled-section grammar.
(An earlier pass tried a single "hero" task; it was dropped because work is
parallel in the agent world and no one task should be singled out.)

## What the focused layout does

`DeckFocusedView` (`src/components/deck/deck-focused-view.tsx`) replaces the
dense body when the pref is `focused`. It gives the deck body the same section
grammar as the DEADLINES band above it, so nothing floats loose between them:

- **A "Today" section header** styled exactly like DEADLINES (uppercase label,
  quiet inline meta, a rule). The change log ("6 carried over · 1 new") is that
  meta, not its own banner, and the revert escape hatch sits behind a small
  "Versions" toggle at the end of the rule. The summary text comes from
  `summarizeDeckChanges` (`src/lib/deck/change-summary.ts`), shared with the
  classic brief.
- **The deck's framing as a one-line glimpse** under the header: muted, not
  italic, click to expand the full note. The same treatment as every item's
  reasoning (below), so all AI commentary on the deck speaks in one voice.
- **One add field that creates or pulls** (`DeckAddBar`): type an intent and it
  both offers to create that task as new AND surfaces matching existing Todo
  tasks (not already on the deck) to pull in, via arrow keys + Enter or click.
  This reconciles the old split between "Add a task" (new) and "More options"
  (existing), the original source sketch of "[new task name +] / [list of
  similar tasks +]".
- **A compact ribbon** for status, one tap away: `N in progress · M to review`
  (expands the existing `CurrentWorkSection` inline) and `N to triage` (opens
  Stream).
- **The same ranked stack, flat and whole.** No hero, nothing singled out as the
  "top" task, nothing collapsed. Work is parallel in the agent world, so the
  deck does not pretend there is one next thing.

Shared with the classic layout: each card's **reasoning** (the "why this, why
now" rationale plus any "last session" continuity note) renders as a single
muted line that expands on click. The continuity note used to render as an extra
italic paragraph on the first card only; it now folds into the same glimpse on
whichever card has it, so no card gets special UI for being first.

## What is unchanged

- **Urgent hard deadlines still lead.** `DeadlineBand` (the always-on,
  deterministic hard-deadline strip) renders above this view exactly as before,
  in both layouts. Deadlines were the one thing that must not fold, and they
  don't.
- **A priority interrupt** (rare, router-escalated) still gets a banner above the
  section, but only when one exists.
- The classic dense layout is the default and keeps its full change-brief banner.

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
