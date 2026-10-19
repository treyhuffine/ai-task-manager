# The global default model, and each harness's own default

Two separate settings decide what a chat starts on when nobody picks a model.

- **The global default model** (`user_state.default_harness`, `default_model`, `default_variant`,
  `default_effort`). One harness, model, variant and effort for the whole home. New chats, agent
  main chats, task and note chats, executions an agent starts without naming a harness, and
  background calls (deck, briefs, image capture, the NL MCP) start on it.
- **A harness's own default** (`harness_settings.default_model`, `default_variant`,
  `default_effort`, one row per harness). Used when something picks that harness without a model:
  an agent asking `start_execution` for Codex, a chat switching to Codex with no model named. That
  includes the global default's harness: picking Claude Code asks for Claude Code's own default.

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
2. No harness named: the global default model's harness, model, variant and effort.
3. A harness named: that harness's own default for whatever else isn't named.

A variant only rides along with the model it belongs to. Two places still decide on their own: the
new-chat window remembers per agent, per browser, what was last used there (`writeLaunchPrefs`),
and a trigger with no model runs on its harness's first model when it fires.

## Settings, Models

Three sections, in order:

- **Default model** (`DefaultModelSection`): the global default, one line ("Claude Code · Opus ·
  Extra high") with Change, which opens the same harness, model and effort editor as first-run
  setup (`DefaultSelectionEditor`). Its description says it's global and that each harness keeps
  its own.
- **Harnesses and models** (`HarnessSettingsPanel`): every harness as one row with its logo, name
  and sign-in state, opening in place (an accordion, several at once, all closed to start). Open,
  a harness shows its sign-in, its visible models and "When something picks Codex without a
  model": its own model, variant and reasoning, saved with the visible models
  (`PUT /api/harness/models/enabled`). Every harness has it, the global default's included. While
  a model is the global default, its checkbox is locked and tagged "global default", so it can't
  be hidden from the menus that mark it.
- **Usage & budget**.

Harnesses are drawn with their real logos everywhere (`HarnessIcon`, `ProviderIcon`, path data in
`src/components/settings/harness-logo-data.ts`, chosen by the registry's `icon`).

## The global default is a choice, not a habit

It changes only when someone means it to:

- **Settings, Models: "Default model"**.
- **A model menu's "Make … default"**: the chat box's model menu and the new-execution window's.
  When what's picked there isn't the default, one quiet line at the top of the menu says what the
  default is and offers to make this the default (`MakeDefaultRow`). The default is also marked
  "default" in the list. Nothing shows outside the menu, so it never asks.
- **First-run setup**: the harness the main chat's first run sets up, its model and the usual
  effort. One line in the conversation says what that is, with Change (`DefaultModelLine`,
  docs/main-chat-onboarding.md). Settings' "Get started" list also has "Pick a default model",
  done once one is set.

All three go through `PUT /api/harness/default` (`harness.defaultPut`), which checks the pick
against the harness's live catalog and refuses a model, variant or effort it doesn't offer rather
than swapping one in. It turns the model on in that harness's visible models so the menus can mark
it, and leaves that harness's own default alone (`setHomeDefaultSelection`). On the client,
`setDefaultSelection` (`src/lib/client/default-selection.ts`) is the one helper.

What doesn't change it: sending a message, picking a model or effort for one chat, switching a chat
to another harness (which starts a new chat), starting any chat, or saving a harness in Settings.
Until 2026-10-01 every send and new chat rewrote it, so it followed whatever chat was typed in last.

Unpinning the model that is the global default moves the default to that harness's own default,
since nothing else can resolve the id.

## Unset

A home that never chose (null) runs on Codex and its default model, resolved at read time. The
Default model section says so. Starting a chat doesn't fill it in. First-run setup preserves a
saved harness, model and effort, even when setup is unfinished and resumed in a browser without
its earlier progress.
