# First run: the main chat

A new home has no setup wizard. It opens straight on the dashboard, and its main chat walks the
person through setup as a conversation: the orchestrator introduces itself and asks, one message at
a time, only what this home doesn't have yet. Then it hands over to the usual starters.

Built 2026-10-01. Code: `src/components/chat/onboarding/` (the steps and their order in
`onboarding-flow.ts`, the conversation in `main-chat-onboarding.tsx`, one file per step that needs
more than a field), the shared identity editor in `src/components/orchestrator/`, and the harness
picker in `src/components/onboarding/`.

## What a home actually needs

Only a harness that answers: a coding CLI (Codex, Claude Code, Cursor, OpenCode or Antigravity), installed,
signed in, and responding to a real request. Everything else has a default or can wait:

- The model and effort: the harness's defaults, said in one line with a way to change them (below).
- The agent skill: installed on setup, as the wizard did (Settings, Models shows it).
- Areas, imports, apps, a first agent: useful, asked in the conversation, all skippable.

So the harness is the only step that can't be skipped, and usually the person never sees it.

## The conversation

Each step shows only when it applies to this home (`stepApplies`).

| Step | Shown when | It asks | What the answer writes |
|---|---|---|---|
| Name and look | Always | "What should I go by?" Name, a look (emoji, a picture, art made in the app, a color), ideas to start from. For a new home, a note about `ri connect` for people who meant to connect another computer. | `orchestratorName`, `orchestratorEmoji`, `orchestratorColor`, `orchestratorImage` |
| Harness | A home that was never set up, and the background check couldn't set one up | "I need a way to think." The harness picker (sign-in check, a real test request, model, billing consent for a key-only setup) | The active harness and its default model, user state's default tuple, the agent skill |
| You | Always | "What should I call you?" | `user_state.name` |
| Import | History from Claude Code, Codex or OpenCode in a folder still on disk (shown while the search runs, and finished silently if it finds nothing) | "I found 1,604 chats across 685 projects. Want to bring in the ones you're working on now?" The eight most recent projects, the latest three worked in within two weeks already ticked. Bringing them in starts the import in the background and moves straight on | Agents (one per project) and their chats |
| What you're working on | There's history to draft from and no description yet | A one or two sentence draft written from the recent projects and their chat titles, to confirm ("That's right"), fix or skip. Never a blank box: with no history it isn't asked | `user_state.description` |
| Areas | No areas yet | "Want me to keep things in areas?" Suggestions from what you said and the projects you brought in, Work and Personal, or your own | Areas |
| Apps | Always | Popular apps in a row and a search over all of them. Notes that it checks before sending anything or doing anything that can't be undone (the default Ask first policy) | Connections, through Settings |
| A first agent | No agents yet, and no import bringing some in | The New agent dialog, or Later | A workspace |
| Done | Always | "You're all set", then the starters | `orchestratorIntroducedAt`, and `onboardedAt` for a new home |

Each answer shows as the user's reply bubble, and the next message picks up whichever answer came
last (`acknowledge`), since which steps came before depends on the home. A short typing beat
separates steps (skipped under reduced motion). "Skip setup" ends it at any point once a harness is
set up. Before that, nothing would work, so it isn't offered.

## Running ahead of the steps

Three things start in the background so the steps that need them rarely wait:

- **The harness check** (`use-harness-check.ts`), from the first message, for a home that was never
  set up: every harness's sign-in at once (fast), then one real request to the one it can set up
  without asking (`autoHarness`: Codex on a subscription, then Claude Code on a subscription or
  Bedrock, in registry order). A key-only setup bills per call and needs consent, and Cursor,
  OpenCode and Antigravity need a model picked, so those go to the person. The picker also suggests
  the first installed harness in enabled registry order. Existing homes skip this setup and keep
  their saved choices. When the check passes, the step saves the setup and
  finishes without a question (an empty reply, so the step itself isn't shown). If the empty main
  chat was made on anything else, it's started over on this one.
- **The model line** (`onboarding-default-model.tsx`). Wherever the harness was settled, after the
  naming when the check did it, after the person's answer when they picked, one quiet line says
  what's now the default: "Found Claude Code. Default set to Opus, medium effort." Change opens the
  model menus' list (every harness with its sign-in state, so one that isn't signed in can't be
  picked) and the effort ladder for the picked model, inline. Save makes it the default through
  `setDefaultSelection`, like Settings, Models, and starts the empty main chat over on it. It's
  never a question: the conversation goes on past it either way, and it doesn't come back once the
  chat is used (the model menus' "Make default" and Settings change it after).
- **The search for history** (`useImportDiscovery`), from the first message, under the same cache key
  as the import panel. It can take up to 90 seconds.
- **The import itself** (`import-runner.ts`), once projects are picked: module-level, so the
  conversation, and even leaving the chat, never waits on it. A progress line sits under the newest
  message and a toast says when it's done.
- **The "working on" draft** (`POST /api/onboarding/about-suggestion`,
  `src/lib/onboarding/about-suggestion.ts`), once the history is known and a harness is set up: one
  fast call over the recent project names and chat titles. A failed call leaves a plain field.
- **Area suggestions** (`POST /api/onboarding/area-suggestions`, `src/lib/onboarding/area-suggestions.ts`),
  once what you're working on is settled: one fast, tool-less call
  through the harness, two to four areas in your own words. The step shows Work and Personal at once
  and adds the suggestions when they land. A failed call answers with no suggestions.

## Decisions

- **Confirm, don't compose.** "What are you working on?" as a blank box was the step people stalled
  on. The history usually already says it, so the step offers a draft to accept or fix, and isn't
  asked at all when there's nothing to draft from (the orchestrator learns from use, and Settings,
  Profile keeps the field).
- **Recent projects, not everything.** A machine can hold hundreds of project folders (every
  worktree is one). The step offers the eight most recent and ticks the ones in use, and Settings,
  Imports has the rest.

- **No wizard.** The old `/welcome` asked five screens of things, only one of which a home needs
  before it works. The route now redirects home, so old links and sign-in returns still land.
- **Scripted, not stored.** The messages are drawn with the transcript's own components but aren't
  chat events. The harness conversation starts clean (events the model never saw would leave Ri's
  record and the harness's out of step), and every answer lands in settings the orchestrator already
  reads. Sending a message replaces the conversation with the real transcript, as it does the usual
  intro.
- **Connecting reuses Settings.** Every way of connecting already lives on a provider's page in
  Settings, Plugins. An app tile opens that page directly (`anchor: 'connectors:<id>'`), and closing
  Settings or returning from a sign-in page refreshes what the step shows.
- **Art is made in the app.** "Make art" draws soft color fields from a seed
  (`src/lib/orchestrator/art.ts`), instantly and for free, uploaded as SVG only if kept.
- **One editor everywhere.** The name and look step, Settings, Profile ("Your assistant") and the
  dialog behind the pencil on the rail's home row are the same `IdentityEditor`.
- **An empty chat isn't use.** `describeHomeUse` (what lets `ri connect` set a fresh home aside)
  counts only chats with something said in them, since a new home makes its main chat on first load.

## When it shows

- An empty main chat in a home whose `user_state.orchestrator_introduced_at` is null. Reaching the
  end or skipping sets it, so the next empty chat opens on the usual intro. The conversation that
  just finished stays up, starters and all, until the chat is used.
- Progress is kept per browser and per home (`localStorage` `ri.mainChat.onboarding:<homeId>`), so a reload or a
  connector's sign-in redirect comes back to the same step. Answers are saved as each step finishes.
- A home set up before this (`onboarded_at` set, no `orchestrator_introduced_at`) sees it on its
  next empty main chat, without the harness step: press New in the chat bar.
- Someone who types into the composer instead leaves it unfinished, and the next empty chat offers
  it again where they left off.

## Storage

`user_state` gained `orchestrator_emoji`, `orchestrator_image` (an attachment, snake_case on disk
and hydrated by `getUserState` / `updateUserState`), `orchestrator_color` and
`orchestrator_introduced_at`, with `orchestrator_name`, in migration 0004. All nullable preferences, no schema defaults.
`PATCH /api/user-state` checks them through `parseOrchestratorLook`. `onboarded_at` now means the
first run finished in a home that was new, and is still what `describeHomeUse` reads.

## Not built

- Art made by a model. The local generator covers "make me something" without a wait or usage.
- Workday hours and time zone. The deck asks where they matter, and the time zone is read from the
  browser.
