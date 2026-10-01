# The main chat's first run

A new home's main chat opens with the orchestrator introducing itself and setting up the few things
worth asking a person about, one message at a time, the way a conversation goes. Then it hands over
to the usual starters.

Built 2026-10-01. Code: `src/components/chat/onboarding/` (flow in `onboarding-flow.ts`, rendering in
`main-chat-onboarding.tsx`, the apps step in `onboarding-apps.tsx`) and the shared identity editor in
`src/components/orchestrator/`.

## The conversation

| Step | It asks | What the answer writes |
|---|---|---|
| Name and look | "What should I go by?" Name, a look (emoji, a picture, art made in the app, a color) and ideas to start from (Ri with its mark, Rye 🍞, Chief of Staff 💼, Penny, Alfred, Jarvis, Ada, Grace, Sage, Atlas). Says both can change any time. | `orchestratorName`, `orchestratorEmoji`, `orchestratorColor`, `orchestratorImage` |
| You | "What should I call you?" | `user_state.name` |
| What you're working on | A line or two, or Skip for now | `user_state.description` |
| Apps | Popular apps in a row, a search over all of them, and a note that it checks before sending anything or doing anything that can't be undone (the default Ask first policy, `docs/connector-approvals.md`) | Connections, through Settings |
| A first agent | Only for a home with no agents: the same New agent dialog the rail uses, or Later | A workspace |
| Done | "You're all set", then the starters | `orchestratorIntroducedAt` |

Each answer shows as the user's reply bubble, and the assistant's next message picks it up ("Rye it
is.", "Nice to meet you, Trey."). The face beside its messages, in the rail and in the chat header
changes the moment a look is saved. A short typing beat separates steps (skipped under reduced
motion). "Skip setup" ends it at any point.

## Decisions

- **Scripted, not stored.** The messages are drawn with the transcript's own components but are not
  chat events. The real conversation with the harness starts clean (writing events the model never
  saw would leave Ri's record and the harness's out of step), nothing waits on a model or spends
  usage, and every answer lands in settings the orchestrator already reads: the name in its brief
  (`renderOrchestratorBrief`), your name and description in user state. Sending a message replaces
  the conversation with the real transcript, as it does the usual intro.
- **Asked once.** Your name and what you're working on used to be the `/welcome` wizard's first step
  ("You"). They moved here, so the wizard is only the machinery a chat needs to run (harness,
  import, areas) and nobody is asked twice. The wizard's note about connecting another device moved
  to its first step.
- **Connecting reuses Settings.** Every way of connecting (OAuth, hosted MCP accounts, keys, your own
  OAuth app) already lives on a provider's page in Settings, Plugins. An app tile opens that page
  directly (`openSettings('plugins', { anchor: 'connectors:<id>' })`), and closing Settings or
  returning from a sign-in page refreshes what the step shows as connected.
- **Art is made in the app.** "Make art" draws soft color fields from a seed
  (`src/lib/orchestrator/art.ts`), instantly and for free. Only kept art is uploaded, as an SVG
  attachment, and is then drawn like any picture. Generated art has no script, text or links.
- **One editor everywhere.** The name and look step, Settings, Profile ("Your assistant") and the
  dialog behind the pencil on the rail's home row are the same `IdentityEditor`, saving through
  `useSaveIdentity`.

## When it shows

- An empty main chat in a home whose `user_state.orchestrator_introduced_at` is null. Reaching the
  end or skipping sets it, so the next empty chat opens on the usual intro. The conversation that
  just finished stays up, starters and all, until the chat is used.
- Progress is kept per browser (`localStorage` `ri.mainChat.onboarding`), so a reload or a
  connector's sign-in redirect comes back to the same step. Answers are saved as each step
  finishes.
- A home that existed before this (no `orchestrator_introduced_at`) sees it on its next empty main
  chat: press New in the chat bar.
- Someone who types into the composer instead leaves it unfinished, and the next empty chat offers
  it again where they left off, with Skip setup a click away.

## Storage

`user_state` gained `orchestrator_emoji`, `orchestrator_image` (an attachment, snake_case on disk
like every attachment column and hydrated by `getUserState` / `updateUserState`),
`orchestrator_color` and `orchestrator_introduced_at` (migration 0005). All nullable preferences, no
schema defaults. `PATCH /api/user-state` checks them through `parseOrchestratorLook`: one emoji, a
palette color, an image that is an uploaded image file. Changing the look doesn't touch the running
main chat. Changing the name recycles it (`docs/orchestrator-harness.md`).

## Not built

- Art made by a model (the user describes it, the harness draws it). The local generator covers
  "make me something" without a wait or usage, and a model can come later behind the same button.
- Workday hours and time zone. The deck asks for these where they matter, and the time zone is read
  from the browser.
