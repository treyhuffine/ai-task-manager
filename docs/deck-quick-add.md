# Deck — Create a task and add it immediately

Status: **shipped** · Builds on `docs/deck-proactive-spec.md` and the Trust theme in `docs/deck-close-the-loop-spec.md`. Layout context: `docs/deck-layout.md`.

## What this is

From inside the Deck, put the task you already know you want to work on into today's deck without leaving the surface. This is for the case where you don't need the AI to find work for you: you already have the thing in mind and want it in the current work mode right now.

It is a manual, deterministic path. It does not run the generation pipeline or start an execution. It either creates one task and adds it to today's deck, or pulls one existing task onto it.

## The flow

1. The **add bar** (`DeckAddBar`) is pinned in the deck's fixed header, under the day strip: one field, always in the same place, never scrolled away however many deadlines sit above today's stack.
2. Type an intent. A dropdown offers **Create task "…"** first and, under **Add existing**, Todo tasks whose titles match and that aren't already on the deck. Arrow keys move through the options and Enter picks the highlighted one (Create by default), or click.
3. **Create** calls `useCreateTask()`. The new task is created with the default lifecycle status `todo` (never `in_progress`). On success the container's `handleQuickAdd` places it at the top of the stack and persists the deck.
4. **Add existing** calls the container's `handlePullExisting`, which places that task at the top of the stack the same way.
5. The field clears and keeps focus, so you can add several in a row.

## How each guarantee is met

**Clear create action in the Deck.** The add bar reads as an input at rest: a quiet filled background, an accent `+`, and a readable placeholder ("Add a task, or find an existing one"). It lifts to the panel color with a focus ring while you type, so there is never an "am I typing?" moment.

**One coherent create-and-add flow.** `handleQuickAdd` receives the freshly created task record and both (a) adds it to `plan.items` and (b) writes the new items array to the deck row (`persistDeck`, tRPC `deck.update`). Creating and placing are a single user action.

**Immediately visible and ready to work on.** Three things could otherwise make the new card blink out or land out of sight, and all are handled:

- *The Ready gate.* The Deck only renders an item while its task passes the shared `isClientReadyTodo` predicate, computed from the active tasks list. `useCreateTask` intentionally does **not** insert the new row into that list (the server owns filter placement), so the new task would be missing from the Ready set until the list refetches. `DeckContainer` holds quick-added tasks in a small `localTasks` overlay folded into `readyTaskIds`, making the task Ready-eligible immediately. The overlay entry is pruned the moment the authoritative list carries the task.
- *Active filters.* A brand-new task has no area, energy, or deadline, so any active area / work-mode / due-today filter would hide it. Both add paths clear those filters so the thing you just chose to work on actually shows. They are one click to re-apply.
- *Placement.* A task you just added is one you mean to work on now, so both paths put it at the **top** of the stack (`prependDeckItem`), not at the bottom.

**Failure and retry without duplicate tasks or silently missing membership, and the rest of the deck preserved.**

- *No silent membership loss.* `persistDeck` writes the whole `items` + `alternatives` array (never a delta), so every save preserves the rest of the deck. A failed write raises a toast with a **Retry** action. The retry re-sends the *current* plan (via `planRef`), so it can't clobber a change you made after the failure, and the added task can't quietly vanish on reload.
- *No duplicate deck membership.* Adds go through `prependDeckItem` / `appendDeckItem`, which are no-ops when the task is already on the deck, and the add bar never offers a task that's already there. A repeated event or a retry can't list one task twice.
- *No duplicate task on create failure.* The add bar guards against double-submit while a create is pending, and on a create error it keeps the typed text and surfaces a toast rather than clearing, so the user retries the same task instead of re-typing (which would create a second one). The residual lost-response case (create succeeded server-side but the response was dropped) is a property of the create path itself, not this flow, and would need a create-level idempotency key to close fully.

**No auto-start / no forced In progress.** Adding a task to the deck never transitions it. `createTask` defaults to `todo`, and both add handlers only edit deck membership. Starting work stays an explicit action, and no execution is launched.

## How it got here

The first version was a faded inline card at the bottom of the stack, opened by a small "Add task" pill in the day bar. It was styled to match a deck card (transparent, placeholder at 30% opacity, no border), so a click landed in a bare cursor with no sign you were typing, and it opened at the bottom while its trigger sat at the top. Two reversible presentation trials followed (an always-on field and a prominent button), then the focused deck layout, which reconciled "Add a task" (new) and "More options" (existing) into one create-or-pull field. On 2026-10-08 the focused layout became the only layout, the trials and their Settings rows were removed, and the add bar moved from inside the Today section to the deck's fixed header, because below a variable-height deadline list it could sit hundreds of pixels down.

## Code map

- `src/components/deck/deck-add-bar.tsx` — the create-or-pull field (`useCreateTask`, matching, keyboard choice, success/error handling).
- `src/components/deck/deck-container.tsx` — renders the add bar in the fixed header; `handleQuickAdd` and `handlePullExisting`, the `localTasks` overlay and its pruning, filter reset, and the failure-aware `persistDeck`.
- `src/lib/deck/quick-add.ts` — pure `prependDeckItem` / `appendDeckItem` (dedupe) and `toPersistedDeckItems` (client → persisted shape); unit-tested in `quick-add.test.ts`.
- `src/lib/deck/client-ready.ts` — the shared Ready-Todo predicate; `client-ready.test.ts` locks that a freshly created task is Ready immediately.

## Deliberately out of scope

The add bar matches existing tasks by title, which covers "I already have this one." The richer optional Deck experiments recorded in the source thinking remain untaken: semantic similar-task suggestions, low-energy task generation, a "Use my top items" quick-start, and packaging deck generation as an end-to-end subagent. A keyboard shortcut to jump to the add bar is also open: the app's hotkeys are all Cmd-based and the obvious combos are taken by the browser, so it needs a deliberate choice (a single-key shortcut outside text fields, or a free Cmd combo).
