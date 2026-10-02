# Optimistic updates for tasks, notes, and areas

## The problem

Every everyday mutation on a task, note, or area used to do nothing to the UI
until the server round-trip finished, then `invalidateQueries` and wait for a
*second* round-trip (the refetch) before anything changed on screen:

```
click → await PATCH (RTT #1) → onSuccess → invalidate → refetch (RTT #2) → UI moves
```

Over a proxy that is two serial round-trips of dead air per action, which is why
completing a task, changing its area, or moving a date felt like it lagged or
didn't register. Nothing was eager, so responsiveness was gated on the network.

## The shape of the fix

The mutation layer is unusually centralized: nine hooks in three files
(`src/hooks/use-tasks.ts`, `use-notes.ts`, `use-areas.ts`), and every one of the
~35 call sites funnels through them. So the fix lives in the hooks, not the call
sites: make the hooks optimistic once and every surface (list, slideout, detail
page, deck) gets it for free.

The hooks share one helper, `src/lib/query/optimistic-entity.ts`:

- **`onMutate` → `optimisticPatch` / `optimisticRemove`** patches the cache
  immediately (single-entity cache `[root, id]` and every filtered list
  `[root, filter]`) and returns a snapshot.
- **`onError` → `rollbackOptimistic`** restores the snapshot and shows a toast.
- **`onSettled` → `settleEntity`** invalidates in the background to converge on
  server-derived fields. This is fire-and-forget: the UI already shows the
  optimistic state, so it never gates responsiveness.

This mirrors the pattern already proven in `useMarkSessionRead`
(`src/hooks/use-workspaces.ts`).

## Two cache shapes

Under each root key there are two shapes, and the helper handles both:

- **`[root, id]`** — the full record, *with* `body`.
- **`[root, filter]`** — an array of list DTOs. Lists omit `body` and carry
  `bodyExcerpt` + `bodyLen` instead (`src/lib/api/dto/entity-list.ts`). So a body
  edit is projected to the excerpt shape (`projectPatchToList`) before it is
  written into a list, and the raw `body` is never left on a list row.

The patch is always a **partial merge**, never a record replace, because the same
update hook carries many fields (`title`, `energy`, `areaId`, `dueAt`, `body`,
`sortKey`, ...).

## Why this does not break the Tiptap body editor

The body editor (`src/components/editor/rich-editor.tsx`) was painstakingly tuned
to feel smooth, and optimistic body writes could have reintroduced cursor jumps.
They don't, for three independent reasons:

1. **The editor is authoritative while focused.** Its content-sync effect bails
   on `editor.isFocused` and on `content === prevContentRef.current`. A cache
   write during typing can never call `setContent` on the live document.
2. **We only ever write `body` back as the exact markdown the editor emitted**
   (equal to `prevContentRef.current`), so even an unfocused editor short-circuits
   the sync effect instead of reflowing.
3. **The server stores `body` verbatim.** `updateTask` / `updateNote`
   (`src/lib/db/queries.ts`) write `input.body` straight through (`withoutAttachments`
   only strips the `attachments` key) and return it unchanged. The only
   transformation in the whole loop is the editor's own `getMarkdown()`, which
   runs client-side *before* the value is ever sent. So the returned `body`, the
   optimistic `body`, and `prevContentRef.current` are byte-identical — there is
   nothing for a settle refetch to reflow, and no server↔cache drift to
   reconcile.

**Do not change the helper to write a server-normalized `body` into the live
cache.** The one hazard that would introduce is a stale, out-of-order response
overwriting newer keystrokes; the "editor is authoritative, reconcile only
derived fields on settle" rule is what avoids it.

## Per-mutation behavior

| Hook | Optimistic behavior | Settle |
| --- | --- | --- |
| `useUpdateTask` / `useUpdateNote` / `useUpdateArea` | merge the patched fields into single + list caches | invalidate root |
| `useCompleteTask` | flip `status: 'done'` + `completedAt` for non-recurring tasks; **skip** the flip for recurring tasks (the server bumps `nextRecurrenceAt` and keeps them active, which we can't predict client-side) | invalidate root |
| `useDeleteTask` / `useDeleteNote` | remove the row from every list, drop the single cache | invalidate root |
| `useCreateTask` / `useCreateNote` / `useCreateArea` | **not** list-optimistic (which filtered lists a new row belongs to is decided server-side); seed the detail cache so opening the new item is instant | invalidate root |

## Deliberate scoping

- **Creates are not list-optimistic.** Filters are evaluated server-side, so we
  can't reliably know which filtered lists a new row belongs to without guessing,
  and guessing wrong flashes a row into the wrong list. Creates are also lower
  frequency and lower pain than field edits. They seed the detail cache and let
  the settle refetch place the row.
- **Recurring completes are not optimistic.** See the table above.
- **`settleEntity` invalidates on every settle rather than coalescing bursts.**
  This matches the previous refetch frequency (autosaves are already debounced
  500ms), and the UI no longer waits on it. Coalescing rapid saves into a single
  trailing refetch is a possible future optimization but was left out to avoid
  version-dependent `isMutating` semantics.

## Convergence for external writes

There is no realtime channel for tasks/notes, so a write from another actor
(AI content-chat edit, CLI/MCP, another tab) reaches an open client through the
normal nets: `settleEntity` after this client's own mutations, plus the
`refetchOnWindowFocus: true` / `staleTime: 30_000` defaults in
`src/providers/query-provider.tsx`. The AI content-chat path additionally runs
its own invalidate on turn completion (`src/components/ai-elements/slideout-chat.tsx`).

Agents get two more nets, because their changes are the ones a person sits and
watches for:

- **Turn edges.** Every chat turn starting or ending, and every reconnect of
  the page stream, refreshes task lists, counts and attention badges
  (`invalidateTaskListsSoon` in `src/lib/query/invalidate-tasks.ts`, driven by
  `useGlobalSessionStream`). An agent moves tasks during a turn, through MCP in
  the server or the `ri` CLI in its own process, and the server sees every
  turn edge either way. Coalesced to one refetch per second.
- **The board polls** its lanes every 15s while mounted (`BOARD_POLL_MS` in
  `task-kanban.tsx`), for a move in the middle of a long turn, a CLI call from
  a terminal, or another device. TanStack pauses it while the tab is hidden.

Neither touches a single task (`['tasks', <id>]`, the one that carries
`body`). A background refresh never refetches a document someone may have
open. That still converges on focus and on settle, as above.

## Leaving the page with unsaved work

A client is a viewer. Work runs on the home and keeps running after the page
goes away (route handlers don't abort when the browser disconnects), so leaving
mid-archive, mid-preview or mid-AI-call loses nothing. The one thing a refresh
or close can lose is input that exists only in this page.

Every tab registers one `beforeunload` guard (`src/components/desktop/desktop-chrome.tsx`,
mounted from the root layout, so it runs in plain browsers too, not only the
desktop app). It asks before leaving only for that local input, and
`viewerUnloadBlocker` in `src/lib/client/version-reload.ts` names the first
thing that would be lost:

| Blocker | Means |
|---|---|
| `chat` | A chat composer can't prove its draft is in localStorage, usually a file chip still uploading. |
| `document` | A task, note or area edit in `documentSaves` hasn't been acknowledged by the server. |
| `input` | Voice is recording or transcribing. |
| `capture` | Quick capture content isn't stored on this device yet. |
| `request` | A request carrying typed input is in flight and the page holds its only copy. |

The browser's prompt can't carry custom text, so the guard also shows a toast
with that reason, visible as soon as the person chooses to stay.

Two rules keep it from firing for nothing:

- **Only mutations that carry typed input count.** A mutation whose payload is
  something the person typed, with no other local copy until the home
  acknowledges it, sets `meta: { carriesInput: true }`: chat send and retry
  (the composer clears on send), task/note/area create and update, the
  execution scratchpad and profile text. The unload guard, desktop close and
  version reload all count through `countUnsavedMutations`
  (`src/lib/query/mutation-meta.ts`). Everything else, read receipts,
  archives, previews, git, AI briefs, is left out, so a viewer can always walk
  away from running work.
- **A save that failed in passing retries on its own.** `documentSaves` retries a
  failed write on a 2s, 5s, 15s, 30s then 60s ladder when the failure was a
  network error, a gateway or server error, 408 or 429 (a server restart mid-save
  is the common case). A 4xx refusal stays pending for the retained-draft
  recovery instead of retrying. Before this, one failed save held the guard
  for the life of the tab. The retries share the `save-changes-failed` toast id
  so they replace each other rather than stacking.

## Tests

`src/lib/query/optimistic-entity.test.ts` covers the pure helpers against a real
`QueryClient`: excerpt projection, single + list patching, body→excerpt mapping,
root isolation, snapshot rollback, and removal.
