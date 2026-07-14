# Chat / Session Search — Spec + Task List

Status: proposed (2026-07-14)
Owner: Trey

## Goal

Make chat/execution transcripts a first-class searchable surface. Today the
only "search" over chats is a client-side substring filter over ≤200 already
loaded rows in the History rail tab (`src/components/workspaces/history-view.tsx`
lines 62-76), matching only `label`, `execution.label`, `workspaceName`, and
`branchName`. Message content is never indexed anywhere — the FTS + vector
stack is hardwired to tasks/notes/stream.

We want to:

1. Full-text search **inside** chat transcripts (message bodies), including
   imported Claude, Codex, and OpenCode history.
2. Filter by **active vs. archived** and by **source** (native vs. imported).
3. Make search **always visible** — not gated behind the History tab — while
   also working inside History.
4. Expose it to the **orchestrator agent**. Chat search stays **out of ⌘K** on
   purpose (see decisions).

## Result shape

A search hit is a **chat session**, ranked by BM25, carrying the best-matching
message **snippet** (with match highlighting) and the matched event id so the
UI can deep-link into the transcript. Grouping happens at query time — we index
individual events for precision, then collapse to one row per session.

## Locked decisions

- **FTS-first, no embeddings for chats in v1.** "Deep search into transcripts"
  is a keyword problem; transcripts are large and noisy, so embedding every
  event is expensive with low payoff. Semantic chat search is a clean phase-2
  add (the existing hybrid path already degrades to FTS-only without an OpenAI
  key — see `src/lib/embeddings/search.ts:146`).
- **Index message text only.** Trigger indexes `chat_events.content` where
  `source IN ('user','agent')`. Skip `tool_result` blobs, `thinking`,
  `system`, and `result` plumbing — otherwise a search for "auth" returns 400
  file-dump matches. A `tool_summary` FTS column is reserved (empty for now) so
  indexing tool-call names/args later is additive, no reindex of message rows.
- **No running/complete/failed filter.** That is not a stored column — chat
  liveness is derived at request time from live signals. Active/archived is a
  real column (`chat_sessions.status`) and is what we ship.
- **Cursor import stays out of scope.** Cursor is a live harness without a
  supported saved-history importer. OpenCode imports are included alongside
  Claude and Codex and remain part of the generic imported source filter.
- **One always-visible search box in the main rail.** A persistent search input
  sits above the rail tab switcher (`RailTabs`). When its query is non-empty,
  results replace the active tab's body (so it "is part of" History and every
  other tab). History's inline substring filter is removed in favor of this.
- **Chat search stays out of ⌘K (deliberate).** ⌘K is a low-volume,
  high-precision launcher across tasks/notes/stream; folding noisy transcript
  hits into it risks drowning those results. Chat search is isolated to the
  power-rail surface, where a longer, scrollable, facet-filtered result list is
  the expected shape. Revisit only if users ask for it.

## Non-goals (v1)

- Semantic/vector search over chats.
- Searching tool outputs / file paths touched by an agent (schema is ready for
  it; ranking + noise-control deferred).
- Date-range and per-agent facets (easy follow-ups once the endpoint exists).
- ⌘K integration (kept deliberately isolated to the power rail — see decisions).
- Scroll-to-matched-message deep-link (v1 just opens the session; the matched
  event id is returned by the API so it's a small follow-up).

---

## Architecture

### Index (owned by `EXTRA_SQL` in `src/lib/db/index.ts`)

FTS lives in `EXTRA_SQL`, not Drizzle migrations — same as `tasks_fts` /
`notes_fts` / `stream_fts` (lines 30-89). It runs after `migrate()` so
`chat_events` already exists.

Use a **regular** FTS5 table (not `content=` external-content) so conditional
indexing is safe: the delete trigger deletes unconditionally by rowid, which is
a no-op for never-indexed rows, avoiding the external-content "delete must
match a prior insert" footgun.

```sql
-- FTS for chat transcripts. session_id/event_id are UNINDEXED payload so we
-- can group by session and deep-link without joining back to chat_events.
CREATE VIRTUAL TABLE IF NOT EXISTS chat_events_fts USING fts5(
  session_id UNINDEXED,
  event_id UNINDEXED,
  content,
  tool_summary            -- reserved; empty in v1
);

CREATE TRIGGER IF NOT EXISTS chat_events_fts_ai AFTER INSERT ON chat_events
WHEN NEW.source IN ('user','agent') AND NEW.content IS NOT NULL AND NEW.content <> ''
BEGIN
  INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
  VALUES (NEW.rowid, NEW.session_id, NEW.id, NEW.content, '');
END;

CREATE TRIGGER IF NOT EXISTS chat_events_fts_ad AFTER DELETE ON chat_events BEGIN
  DELETE FROM chat_events_fts WHERE rowid = OLD.rowid;   -- no-op if unindexed
END;

CREATE TRIGGER IF NOT EXISTS chat_events_fts_au AFTER UPDATE ON chat_events BEGIN
  DELETE FROM chat_events_fts WHERE rowid = OLD.rowid;
  INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
  SELECT NEW.rowid, NEW.session_id, NEW.id, NEW.content, ''
  WHERE NEW.source IN ('user','agent') AND NEW.content IS NOT NULL AND NEW.content <> '';
END;

-- One-shot idempotent backfill: only fills when the index is empty, so it runs
-- once for existing/imported history and never duplicates on later boots.
INSERT INTO chat_events_fts(rowid, session_id, event_id, content, tool_summary)
SELECT rowid, session_id, id, content, ''
FROM chat_events
WHERE source IN ('user','agent') AND content IS NOT NULL AND content <> ''
  AND NOT EXISTS (SELECT 1 FROM chat_events_fts LIMIT 1);
```

Verify the exact `source` literal for assistant text against the live executor
writer before finalizing (schema comment at `schema.ts` chat_events says
`user/agent/thinking/tool_call/tool_result/system/result`; import writes
`source: 'user'` at `external-agents.ts:245`, live agent text is `source: 'agent'`).

### Query layer — `searchChatSessions()` in `src/lib/db/queries.ts`

```ts
export interface ChatSearchResult extends RailSessionRow {
  snippet: string;        // FTS snippet() of the best-matching event, highlighted
  matchedEventId: string;
  score: number;          // normalized BM25, same formula as ftsSearch()
}

export function searchChatSessions(opts: {
  query: string;
  status?: 'active' | 'archived';   // omit = both
  workspaceId?: string;
  source?: 'native' | 'imported' | 'claude' | 'codex' | 'opencode';
  limit?: number;                    // sessions, default 30
}): ChatSearchResult[]
```

Implementation:

1. Build the FTS match string with the existing escaping (`"term"*` prefix
   matching — factor the helper out of `ftsSearch`, `search.ts:47-53`).
2. Raw FTS scan via `getRawDb()`, joined to `chat_sessions` for filtering,
   ordered by `rank`, scanned to `limit * 20` events:

   ```sql
   SELECT f.session_id AS sessionId, f.event_id AS matchedEventId,
          snippet(chat_events_fts, 2, '[', ']', '…', 12) AS snippet, rank
   FROM chat_events_fts f
   JOIN chat_sessions cs ON cs.id = f.session_id
   WHERE chat_events_fts MATCH ?
     AND (:status IS NULL OR cs.status = :status)
     AND (:workspaceId IS NULL OR cs.workspace_id = :workspaceId)
     AND (:sourceFilter ...)          -- surface_kind='imported_agent' / surface_ref
   ORDER BY rank
   LIMIT :scan
   ```

   Source filter maps to `surface_kind = 'imported_agent'` (imported) vs. not
   (native), and `surface_ref` = `'claude'|'codex'|'opencode'` for the specific
   imported sources.
3. Group by `sessionId` in JS, keep the best rank + its snippet, preserve rank
   order, take top `limit` session ids.
4. Hydrate those sessions with the **same joins as `listHistorySessions`**
   (`queries.ts:3606-3630`: workspace name/emoji/attachments + execution flatten)
   restricted to the matched ids, re-sorted to FTS rank order, and attach
   `snippet` / `matchedEventId` / `score`.

Default `status` is undefined (search active **and** archived) — the whole point
is surfacing old and imported chats. This differs from `list_workspace_sessions`
which defaults to active.

### API — `GET /api/sessions/search`

New route `src/app/api/sessions/[...]` sibling of the existing session feeds
(`src/app/api/sessions/history`, `/rail`, `/needs-review`). Dedicated endpoint,
not `/api/search` (which hydrates task/note/stream and would fight the
session-shaped result).

```
GET /api/sessions/search?q=<str>&status=<active|archived>&workspaceId=<id>&source=<...>&limit=<n>
→ 200 ChatSearchResult[]     (empty array when q is blank)
```

Auth is the standard middleware Bearer check; client calls go through
`authFetch`.

Client: add `sessionsApi.search(...)` to `src/lib/api/sessions.ts` and a
`useSessionSearch(query, filters)` hook (`src/hooks/use-session-search.ts`) that
debounces/`useDeferredValue`s the query, like `useSearch` does.

### UI

**A. Persistent rail search (primary surface)** — `src/components/workspaces/rail-tabs.tsx`
- Add an always-visible search input between `TriggersButton` and `RailHeader`
  (wide mode only; hidden when `collapsed`).
- Lift a `railSearch` string into `RailTabs`. When non-empty, render a new
  `<SessionSearchResults query filters />` in the body slot **instead of** the
  active tab (`StatusView` / `HistoryView` / `WorkspaceNav`), so search works on
  every tab including History.
- `SessionSearchResults` (new, `src/components/workspaces/session-search-results.tsx`):
  facet chips (Active / Archived / All, and Source: All / Native / Imported),
  rows reusing `HistoryRow` styling with the highlighted `snippet` under the
  label, grouped by the existing `groupByDateBucket`. Row click →
  `setActiveView(session.id)` (`dashboard-context.tsx:465`). v1 just opens the
  session; scroll-to-`matchedEventId` deep-link is deferred (the id is still
  returned by the API for later).

**B. History tab** — `src/components/workspaces/history-view.tsx`
- Remove the inline `SearchInput` + client `filtered` substring pass (lines
  62-76, 105, 179-209). The persistent rail box now covers History content
  search. Keep the workspace-pill filter.

Chat search is **not** added to ⌘K (`SearchOverlay`) — it stays isolated to the
power rail so transcript hits don't drown the high-precision task/note/stream
launcher. No changes to `search-overlay.tsx` / `constants/commands.ts`.

### Orchestrator — `search_sessions` action

`src/lib/orchestrator/registry.ts`, next to `list_workspace_sessions_action`
(line 1024), registered in the `actions` array (line 1689):

```ts
const search_sessions_action = defineAction({
  name: 'search_sessions',
  description:
    'Full-text search across chat and execution transcripts (message bodies). ' +
    'Returns matching sessions with a highlighted snippet and relevance score. ' +
    'Searches active and archived by default; filter by status/workspace.',
  params: {
    query: z.string().min(1),
    status: workspaceStatus.optional(),          // active | archived
    workspaceId: z.string().optional(),
    limit: z.number().int().positive().max(50).optional(),
  },
  cli: { positional: ['query'] },
  handler: (_ctx, { query, status, workspaceId, limit }) =>
    searchChatSessions({ query, status, workspaceId, limit }),
});
```

Update the harness surface doc string so the agent knows chats are searchable
(`src/lib/orchestrator/harness-surface.ts` — the "across tasks, notes, and
stream" blurb around lines 232/317).

---

## Task list

### Phase 1 — Index + query (backend core)
- [ ] **1.1** Add `chat_events_fts` vtable + AI/AD/AU triggers + one-shot backfill to `EXTRA_SQL` (`src/lib/db/index.ts`).
- [ ] **1.2** Confirm the assistant-message `source` literal against the live executor + reconcile writers; adjust the trigger `WHEN` set if needed.
- [ ] **1.3** Factor the FTS match-string builder out of `ftsSearch` (`src/lib/embeddings/search.ts:47-53`) into a shared helper.
- [ ] **1.4** Implement `searchChatSessions()` + `ChatSearchResult` in `src/lib/db/queries.ts` (FTS scan → group-by-session → hydrate via the `listHistorySessions` join → attach snippet/score).
- [ ] **1.5** Restart dev server (or `pnpm db:push` path) so `getDb()` re-runs `EXTRA_SQL`; confirm the vtable exists and the backfill populated existing + imported events.

### Phase 2 — API + client data
- [ ] **2.1** `GET /api/sessions/search` route (q + status + workspaceId + source + limit → `searchChatSessions`).
- [ ] **2.2** `sessionsApi.search()` in `src/lib/api/sessions.ts`.
- [ ] **2.3** `useSessionSearch(query, filters)` hook with deferred query.

### Phase 3 — UI
- [ ] **3.1** `SessionSearchResults` component (facet chips + snippet rows + date grouping + open-on-click).
- [ ] **3.2** Persistent search input in `RailTabs`; swap body to results when query non-empty (wide mode only).
- [ ] **3.3** Remove History's inline substring filter; keep workspace pills.

### Phase 4 — Agent surface
- [ ] **4.1** `search_sessions_action` + register in `actions` array.
- [ ] **4.2** Update `harness-surface.ts` search blurb to include chats.

### Phase 5 — Tests + docs
- [ ] **5.1** Unit test `searchChatSessions`: seed a session + events (active, archived, imported), assert hit + snippet + that archived/imported are found and `tool_result`/`thinking` are NOT indexed. Mirror `src/lib/import/external-agents.test.ts` style.
- [ ] **5.2** Backfill test: insert events before the vtable exists (fresh db path), open `getDb()`, assert the one-shot backfill indexed them.
- [ ] **5.3** Update `docs/chat-sessions.md` with the search flow; note the `tool_summary` reserved column and the phase-2 semantic/tool-indexing extensions.

## Resolved

- **⌘K:** chat search is not added to the command palette — isolated to the
  power rail to avoid noise.
- **Click behavior:** v1 opens the session; scroll-to-matched-message deferred.
- **Surface:** main rail only in v1; not the execution-view compact rail.
