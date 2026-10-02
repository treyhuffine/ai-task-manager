# The default harness, model and effort

What new chats and executions start on, and what background calls (deck generation, chat titles,
first-run suggestions) run on. One choice for the home: `user_state.default_harness`,
`default_model` and `default_effort`. Each harness also keeps its own default model and effort in
`harness_settings`, used when switching to that harness without naming a model.

## It's a choice, not a habit

The default changes only when someone means it to:

- **Settings, Models**: "make default" on a harness, or its default model.
- **A model menu's "Make … default"**: the chat box's model menu and the new-execution window's.
  When what's picked there isn't the default, one quiet line at the top of the menu says what the
  default is and offers to make this the default (`MakeDefaultRow`). The default is also marked
  "default" in the list. Nothing shows outside the menu, so it never asks.
- **First-run setup**: the harness the main chat's first run sets up, its model and the usual
  effort. One line in the conversation says what that is, with Change for the harness, model and
  effort (`DefaultModelLine`, docs/main-chat-onboarding.md).

All three go through the same route (`PUT /api/harness/models/enabled` with `makeActive`, which
writes the home's tuple in one transaction, `setActiveHarness`). On the client,
`setDefaultSelection` (`src/lib/client/default-selection.ts`) is the one helper.

What doesn't change it: sending a message, picking a model or effort for one chat, switching a chat
to another harness (which starts a new chat), starting any chat. Until 2026-10-01 every one of
those rewrote the default, so it followed whatever chat was typed in last: replying in an old chat
on Codex made the next new chat, execution and deck run on Codex, and one quick chat on a small
model moved the deck onto it. `src/test/regressions/default-selection-is-a-choice.test.ts` holds
the line.

## Other memory

The new-execution window remembers, per agent, the harness, model, mode and branch last used there
(`writeLaunchPrefs`, the browser's localStorage, so per device). In that window it wins over the
home default for that agent.

## Unset

A home that never chose (null) runs on Claude Code and its default model, resolved at read time.
Starting a chat doesn't fill it in.
