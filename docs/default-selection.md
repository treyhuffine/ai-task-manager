# The default for new work, and each harness's own default

Two separate settings decide what a chat starts on when nobody picks a model.

- **The default for new work** (`user_state.default_harness`, `default_model`, `default_variant`,
  `default_effort`). One harness, model, variant and effort for the whole home. New chats, agent
  main chats, task and note chats, executions an agent starts without a model, and background calls
  (deck, briefs, image capture, the NL MCP) start on it.
- **A harness's own default** (`harness_settings.default_model`, `default_variant`,
  `default_effort`, one row per harness). Used only when something picks that harness without a
  model and it isn't the harness of the default for new work: an agent asking `start_execution` for
  Codex, a chat switching to Codex with no model named.

Neither writes the other. Until 2026-10-19 they shared a write path: the home's value was a copy of
the active harness's row, saving that row's default in Settings also rewrote the home's, and
"Make default" rewrote both. A copy that drifted (left over from when every send rewrote the
home's value) then showed in Settings as Claude's Opus · Medium while every new chat started on the
home's Fable · Extra high. `src/test/regressions/default-selection-is-a-choice.test.ts` holds both
lines.

## What a start lands on

`resolveStartSelection` (`src/lib/harness/start-selection.ts`) is the one rule, used by executions
(`dispatchExecutionSession`), main chats, task and note chats and a new chat that switches harness:

1. What the start names wins: harness, model, variant, effort.
2. No harness named: the default for new work's harness.
3. No model named, on the default for new work's harness: its model, variant and effort.
4. No model named, on another harness: that harness's own default.

A named model keeps the default's effort when the model offers it. A variant only rides along with
the model it belongs to. Two places still decide on their own: the new-chat window remembers per
agent, per browser, what was last used there (`writeLaunchPrefs`), and a trigger with no model
runs on its harness's first model when it fires.

## The default for new work is a choice, not a habit

It changes only when someone means it to:

- **Settings, Models: "Default for new work"** (`DefaultForNewWork`), the card at the top. The only
  place in Settings called "the default". Change opens the same harness, model and effort editor
  as first-run setup (`DefaultSelectionEditor`).
- **A model menu's "Make … default"**: the chat box's model menu and the new-execution window's.
  When what's picked there isn't the default, one quiet line at the top of the menu says what the
  default is and offers to make this the default (`MakeDefaultRow`). The default is also marked
  "default" in the list. Nothing shows outside the menu, so it never asks.
- **First-run setup**: the harness the main chat's first run sets up, its model and the usual
  effort. One line in the conversation says what that is, with Change (`DefaultModelLine`,
  docs/main-chat-onboarding.md).

All three go through `PUT /api/harness/default` (`harness.defaultPut`), which checks the pick
against the harness's live catalog and refuses a model, variant or effort it doesn't offer rather
than swapping one in. It turns the model on in that harness's visible models so the menus can mark
it, and leaves that harness's own default alone (`setHomeDefaultSelection`). On the client,
`setDefaultSelection` (`src/lib/client/default-selection.ts`) is the one helper.

What doesn't change it: sending a message, picking a model or effort for one chat, switching a chat
to another harness (which starts a new chat), starting any chat, or saving a harness in Settings.
Until 2026-10-01 every send and new chat rewrote it, so it followed whatever chat was typed in last.

While a model is the default for new work, Settings won't hide it from its harness's visible models
(the checkbox is locked and tagged "default"), and unpinning it moves the default to that harness's
own default, since nothing else can resolve the id.

## A harness's own default

Each harness tab in Settings, Models has "When something picks Codex without a model": model,
variant and reasoning, saved with the visible models (`PUT /api/harness/models/enabled`). The
harness of the default for new work shows no second picker there, since its new work starts on the
card above. Its own default is kept and applies again if the default for new work moves to another
harness.

## Unset

A home that never chose (null) runs on Codex and its default model, resolved at read time. The card
says so. Starting a chat doesn't fill it in. First-run setup preserves a saved harness, model and
effort, even when setup is unfinished and resumed in a browser without its earlier progress.
