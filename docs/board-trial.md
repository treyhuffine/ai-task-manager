# Board trial

One Board destination surveys two different kinds of work: immediate conversation activity and durable task outcomes. Their statuses remain separate.

Implementation checklist:

- [x] One Board entry across wide rail, collapsed rail and command palette, with visible Agent Activity / Tasks switcher
- [x] Remember last view, initial Agent Activity, explicit Tasks and legacy links remain task focused
- [x] HUD quick popovers expand into the same Board and temporarily reveal and focus the requested bucket
- [x] Activity cards share HUD populations, attention, filtering, ordering and navigation, including agent main chats
- [x] Task lifecycle, drag, optimistic updates, attention and chat links preserved
- [x] Separate persistent Columns menus, unfinished task defaults, recoverable empty selection
- [x] Responsive layout, keyboard access, focus restoration, loading and error handling
- [x] Tests, typecheck, scoped lint, dev browser verification and documentation reconciled against acceptance criteria

## Behavior and preferences

The power rail and command palette open **Board**, initially on **Agent Activity** and subsequently on the last view selected in this browser. The Tasks panel's Board button explicitly opens **Tasks** in that same dialog. Team boards stay task-only and keep their existing four-column default.

Links name the view: `?board=activity` or `?board=tasks`. Legacy `?board=1` links continue to open Tasks. The selected view is reflected in the URL using replacement history, so reload restores it without adding a browser-history entry for each toggle. Closing removes only Board parameters. Navigating to a conversation closes the Board, even if that conversation was already underneath it.

Each view has a **Columns** menu with checkable entries and Show all columns. Tasks initially shows Consider, Todo and In progress. Done and Archived start hidden. Agent Activity initially shows all four existing status buckets. Explicit choices, including no visible columns, survive close/reopen and reload. An all-hidden board offers Show all columns. Visibility does not change any status or the HUD's global counts.

Preferences are local to the browser, following the rail's existing client preference pattern:

| Key | Meaning |
| --- | --- |
| `ri.board.view` | Last selected Board view |
| `ri.board.columns.tasks` | Personal task columns, shared by task-context and rail entry |
| `ri.board.columns.activity` | Agent Activity columns |
| `ri.board.columns.team-tasks` | Separate task-only team presentation |

A status popover's expand button opens Agent Activity with `boardFocus=<bucket>`. It temporarily reveals and focuses that column, even if saved as hidden. Simply expanding, navigating or closing never saves a changed column selection. A deliberate edit in Columns adopts the displayed selection and clears temporary focus.

## Data and navigation

`useActivityBuckets` combines the existing `useSessionBuckets` and `useAgentAttention` results. Both the HUD popovers and activity Board consume this same projection. Existing attention priority, inactive and settled-import exclusion are unchanged. Conversation IDs are deduplicated and each bucket sorts by existing recency signals. Agent main chats appear only when needing attention, matching the HUD. Thinking main chats do not inflate Working.

Execution cards open their existing primary chat. Main-chat cards open their agent. The Board deliberately follows the HUD's current one-row-per-execution population rather than introducing a new rollup for sibling chats. Waiting response retains its established meaning, including quiet active chats. It does not claim every card contains an unanswered question.

Cards use labels, identities, timestamps and existing main-chat previews. Pending execution questions come from the existing in-memory pending-request snapshot attached to the rail response. No extra transcript queries, background model calls, database policies or migrations are introduced. Activity cards cannot be dragged. Task cards still use the existing semantic lifecycle commands and optimistic hooks.

## Verification

- `src/lib/client/task-board.test.ts`: remembered entry, legacy and explicit links, HUD focus URL and cleanup
- `src/hooks/use-board-columns.test.ts`: defaults, corrupt/stale storage, explicit empty selection and temporary reveals
- `src/lib/sessions/activity-buckets.test.ts`: shared population/count parity, classification priority, inactive/import exclusions, ordering, deduplication and navigation
- `src/components/board/board.browser.test.ts`: actual dialog and HUD, persisted independent selections, empty recovery, hidden target focus, both conversation destinations, keyboard task drag, task creation and chat links through real hooks

Validated with 134 passing tests across 13 scoped files, `pnpm ts`, scoped ESLint and browser checks against the fictional dev dataset. Browser qualification covered wide and collapsed rail entry, command palette, explicit Tasks entry, remembered views, focus restoration, desktop/tablet/phone layout, real task creation and keyboard drag, and completion from a task slideout with Done hidden. The move and completion survived reload.

Dev qualification uses an isolated synthetic home at `/tmp/ri-board-trial-deabbb` on port 42251, with production and the normal dev server left running unchanged. Local preview: `http://localhost:42251/?board=activity`. This is a trial server, not a production rollout. It starts with:

```sh
pnpm iso /tmp/ri-board-trial-deabbb --port 42251 -- env RI_LOCAL_APPS=0 pnpm dev --port 42251
```

Pair a new browser using this isolated home's `pnpm auth:pair` link. Optional app runtimes are disabled in the preview to keep qualification focused on Board.
