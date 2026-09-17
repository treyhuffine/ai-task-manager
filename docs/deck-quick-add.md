# Deck — Create a task and add it immediately

Status: **shipped** · Builds on `docs/deck-proactive-spec.md` and the Trust theme in `docs/deck-close-the-loop-spec.md`.

## What this is

From inside the Deck, create the task you already know you want to work on and place it in the current Deck without leaving the surface. This is for the case where you don't need the AI to find work for you: you already have the thing in mind and want it in the current work mode right now.

It is a manual, deterministic path. It does not run the generation pipeline, propose similar tasks, or start an execution. It creates one task and adds that same task to today's deck.

## The flow

1. **Add task** button in the day bar (`DeckDayBar`) toggles an inline `DeckQuickAddCard` at the bottom of the stack.
2. Typing a title and pressing Enter calls `useCreateTask()` → `POST /api/tasks`. A new task is created with the default lifecycle status `todo` (never `in_progress`).
3. On success the container's `handleQuickAdd` (`deck-container.tsx`) places the task onto the current deck plan and persists the membership via `PATCH /api/deck/:id`.
4. The card clears and refocuses so you can add several in a row.

## How each guarantee is met

**Clear create action in the Deck.** The day bar carries a persistent **Add task** button; it's not buried in a menu or a separate route.

**One coherent create-and-add flow.** `handleQuickAdd` receives the freshly created task record and both (a) adds it to `plan.items` and (b) writes the new `items` array to the deck row. Creating and placing are a single user action.

**Immediately visible and ready to work on.** Two things could otherwise make the new card blink out the instant it appears, and both are handled:

- *The Ready gate.* The Deck only renders an item while its task passes the shared `isClientReadyTodo` predicate, computed from the `useTasks({status:'active'})` list. `useCreateTask` intentionally does **not** insert the new row into that list (the server owns filter placement), so the new task would be missing from the Ready set until the list refetches. `DeckContainer` holds quick-added tasks in a small `localTasks` overlay that is folded into `readyTaskIds`, making the task Ready-eligible immediately. The overlay entry is pruned the moment the authoritative list carries the task, after which the real row's live status takes over.
- *Active filters.* A brand-new task has no area, energy, or deadline, so any active area / work-mode / due-today filter would hide it. `handleQuickAdd` clears those filters so the thing you just chose to work on actually shows. They are one click to re-apply.

**Failure and retry without duplicate tasks or silently missing membership, and the rest of the deck preserved.**

- *No silent membership loss.* `persistDeck` writes the whole `items` + `alternatives` array (never a delta), so every save preserves the rest of the deck. A failed write is no longer swallowed with a `console.error`: it raises a toast with a **Retry** action. The retry re-sends the *current* plan (via `planRef`), so it can't clobber a change you made after the failure, and the added task can't quietly vanish on reload.
- *No duplicate deck membership.* Adds go through `appendDeckItem`, which is a no-op when the task is already on the deck. A repeated event or a retry can't list one task twice.
- *No duplicate task on create failure.* The quick-add card guards against double-submit while a create is pending, and on a create error it keeps the typed title and surfaces a toast rather than clearing, so the user retries the same task instead of re-typing (which would create a second one). The residual lost-response case (create succeeded server-side but the response was dropped) is a property of the create API itself, not this flow, and would need a create-level idempotency key to close fully.

**No auto-start / no forced In progress.** Adding a task to the deck never transitions it. `createTask` defaults to `todo`, and `handleQuickAdd` only edits deck membership. Starting work stays an explicit action (the Start control / `transition_task`), and no execution is launched.

## Presentation trial (composer UX)

The classic composer was deliberately styled to match a deck card: transparent background, a placeholder at 30% opacity, no border. That made it calm but non-obvious. You could click it and land in a bare cursor with no signal that you were now typing, and the field opened at the bottom of the stack while its trigger lived up in the day bar, so the change happened off where you were looking.

The fix is a reversible client-side trial (`src/lib/client/deck-quick-add-mode.ts`, per-browser localStorage, no schema, mirrors `entity-view-mode.ts`). Switch it in **Settings > General > Deck quick-add**:

- **Classic** (default) — the original faded inline card at the bottom, opened by the small "Add task" pill. Unchanged.
- **Always-on field** (`persistent`) — a composer pinned at the top of the stack that plainly reads as an input at rest (bordered, a `+`, a readable placeholder) and lights up on focus (ring + an Enter/Add affordance). Nothing to discover; there is never an "am I typing?" moment.
- **Prominent button** (`trigger`) — a clear primary-tinted "Add a task" button in the day bar opens that same redesigned composer at the top of the stack.

Both redesigned variants share one component (`src/components/deck/deck-add-composer.tsx`) and land the new task at the **top** of the stack, directly under the composer where the eye already is, ready to work on. All the guarantees above still hold (Todo only, no auto-start, dedupe, failure toast with retry, immediate visibility). When a variant wins, fold it in as the one real design and delete the switch; if none do, delete the module and the key.

## Code map

- `src/components/deck/deck-day-bar.tsx` — the **Add task** trigger (`addTaskVariant`: pill / prominent / hidden).
- `src/components/deck/deck-quick-add.tsx` — the classic inline create card (`useCreateTask`, success/error handling).
- `src/components/deck/deck-add-composer.tsx` — the redesigned composer shared by the `persistent` and `trigger` trial variants.
- `src/lib/client/deck-quick-add-mode.ts` — the per-browser presentation preference.
- `src/components/deck/deck-container.tsx` — `handleQuickAdd`, the `localTasks` overlay and its pruning, filter reset, top/bottom placement per mode, and the failure-aware `persistDeck`.
- `src/lib/deck/quick-add.ts` — pure `appendDeckItem` / `prependDeckItem` (dedupe) and `toPersistedDeckItems` (client → persisted shape); unit-tested in `quick-add.test.ts`.
- `src/lib/deck/client-ready.ts` — the shared Ready-Todo predicate; `client-ready.test.ts` locks that a freshly created task is Ready immediately.

## Deliberately out of scope

The optional Deck experiments recorded in the source thinking remain untaken and are not required by this path: pulling similar existing tasks as one-click alternatives, low-energy task generation, a "Use my top items" quick-start, and packaging deck generation as an end-to-end subagent. See `docs/deck-close-the-loop-spec.md` and the Ri product notes for that open design space.
