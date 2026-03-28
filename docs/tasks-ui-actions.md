# UI/UX Actions: Tasks, Notes, Stream

Implementation plan for making list items actionable with inline editing, drag-and-drop, and search.

> **Note:** Deck is excluded from this scope — needs separate rethink.

---

## Phase 1: Areas Data Layer

Unblocks all area dropdowns across tasks, notes, and stream.

- [x] **GET `/api/areas` route** — returns all areas, ordered by `sort_order`. Support `?status=active` filter (default to active only).
- [x] **GET/PATCH `/api/areas/[id]` route** — get and update individual areas.
- [x] **`src/lib/api/areas.ts` service** — `areasApi.list(filter?)`, `areasApi.get(id)`, `areasApi.update(id, input)`
- [x] **`src/hooks/use-areas.ts`** — `useAreas(filter?)` query hook, `useUpdateArea()` mutation
- [x] **`AreaSelect` dropdown component** — reusable area picker used by both task rows and note rows. Shows area name. Includes "No area" option to unset.

---

## Phase 2: Task Row Redesign

### 2a: Row Layout & Display

- [x] **Checkbox** (left side) — visual circle/check, not a native checkbox. Reflects `status`.
- [x] **Title** — primary text, truncated with `line-clamp-2`.
- [x] **Metadata line** below title showing:
  - [x] Area badge (colored pill with area name, or "No area")
  - [x] Energy pill (`deep` / `light` — colored dot + label)
  - [x] Effort pill (`trivial` / `small` / `medium` / `large` / `epic`)
  - [x] Hard deadline (calendar icon + relative date via `formatDate`)
  - [x] Boomerang/resurface date (timer icon + relative date, only if `resurface_after` is set)
  - [x] Recurrence indicator (repeat icon, only if `recurrence` is set)
  - [x] Blocked indicator (lock icon + `blocked_on` text, only if set)
- [x] **Status styling** — done tasks: dimmed + strikethrough title. Archived: hidden by default via filter.

### 2b: Inline Editing (click-to-edit on metadata)

- [x] **Area badge click** → opens `AreaSelect` dropdown → PATCH `area_id`
- [x] **Energy pill click** → cycles: deep → light → unset → deep → PATCH `energy`
- [x] **Effort pill click** → cycles: trivial → small → medium → large → epic → unset → PATCH `effort`
- [x] **Deadline click** → native date input → PATCH `hard_deadline`
- [x] **Boomerang click** → date picker popover → PATCH `resurface_after`

All mutations use `useUpdateTask()` which auto-invalidates the task list cache.

### 2c: Hover Actions (right side of row)

- [x] **Snooze button** → dropdown with 1d / 3d / 1w options → PATCH `resurface_after` + increment `times_deferred`
- [x] **Archive button** → PATCH `status: 'archived'`
- [x] **Block button** → text input popover for `blocked_on` → PATCH `blocked_on` + `blocked_since`

### 2d: Task Completion

- [x] **One-time task completion** — click checkbox → POST to complete endpoint → marks `done`, `completed_at: now`. Row dims with strikethrough.
- [x] **Recurring task completion** — click checkbox → POST to `/api/tasks/[id]/complete`:
  - Insert `task_completion` record
  - Calculate next occurrence from `recurrence` pattern
  - Update `next_recurrence_at` on the task
  - Task stays `active`
- [x] **API endpoint: `POST /api/tasks/[id]/complete`** — handles both one-time and recurring completion logic server-side

### 2e: Drag and Drop Reorder

- [x] **Install drag-and-drop library** — `@dnd-kit/core` + `@dnd-kit/sortable`
- [x] **Drag handle** — visible on hover, left of checkbox
- [x] **Reorder logic** — on drop, compute new `sort_key` using `fractional-indexing` (`generateKeyBetween(prevKey, nextKey)`) → PATCH `sort_key`
- [x] **Optimistic update** — reorder in local state immediately, PATCH in background. Revert on error.

### 2f: List-Level Controls

- [x] **Status filter** — pills/tabs: Active (default) | Done | Archived | All → passed as `status` filter to `useTasks()`
- [x] **Energy filter toggle** — Deep | Light | All → passed as `energy` filter
- [x] **Area filter dropdown** — uses `useAreas()` → passed as `area_id` filter
- [x] **Sort control** — sort by: AI order (sort_key, default) | Deadline | Created | Updated

---

## Phase 3: Note Row Redesign

### 3a: Row Layout & Display

- [x] **Icon** (left side) — FileText icon, or ExternalLink icon if `url` is set
- [x] **Title** — if present, primary text. If no title, show first line of body as title.
- [x] **Body preview** — `line-clamp-2` of body text below title (or below first-line-as-title)
- [x] **Metadata line:**
  - [x] Area badge (same component as tasks)
  - [x] Context tags (colored pills)
  - [x] Linked task indicator (if `task_id` is set)
  - [x] URL indicator (external link icon if `url` is set)
  - [x] Date (relative created_at)

### 3b: Inline Editing

- [x] **Area badge click** → same `AreaSelect` dropdown → PATCH `area_id`
- [x] **Tag pills** → click to edit/remove, "+" to add → PATCH `context_tags`

### 3c: Hover Actions

- [x] **Archive button** → PATCH `status: 'archived'`
- [x] **Link to task** → task picker popover (search tasks by title) → PATCH `task_id`
- [x] **Open URL** → if `url` is set, external link button

### 3d: List-Level Controls

- [x] **Status filter** — Active (default) | Archived | All
- [x] **Area filter dropdown** — same as tasks, uses `useAreas()`

---

## Phase 4: Stream Wire-Up

### 4a: Real Data

- [x] **GET `/api/stream` route** — returns stream items ordered by `created_at` desc. Support `?status=pending` filter.
- [x] **PATCH `/api/stream/[id]` route** — update stream item status, promotion fields.
- [x] **`src/lib/api/stream.ts` service** — `streamApi.list(filter?)`, `streamApi.update(id, input)`, `streamApi.dismiss(id)`
- [x] **`src/hooks/use-stream.ts`** — `useStream(filter?)`, `useDismissStream()`, `useUpdateStream()` hooks
- [x] **Replace mock data** in `StreamContent` with `useStream()` hook

### 4b: Per-Item Actions

- [x] **Dismiss button** → PATCH `status: 'dismissed'`, `dismissed_by: 'user'`. Item removes from list.
- [x] **Promote to task** → creates task from `raw_text` → PATCH stream item `status: 'promoted'`, `promoted_to_type: 'task'`, `promoted_to_id`
- [x] **Promote to note** → creates note with `body: raw_text` → PATCH stream item similarly
- [x] **Edit raw text** → inline text edit → PATCH `raw_text`

### 4c: Visual States

- [x] **Marinating** — default style, raw text, amber dot
- [x] **Promoted** — annotation showing what it became ("→ task"), dimmed/lighter text, green dot
- [x] **Source badge** — capture | voice | brain_dump | chat icons

### 4d: List-Level

- [x] **Status filter** — Pending (default) | Promoted | All
- [ ] **"Process all" button** — batch triggers processing of all pending items (future, when AI triage is built)

---

## Phase 5: Search

### 5a: FTS Keyword Search (quick win — indexes already exist)

- [x] **GET `/api/search` route** — accepts `?q=` param, queries `tasks_fts` and `notes_fts` tables, returns combined results with entity type labels and snippets
- [x] **`src/lib/api/search.ts` service** — `searchApi.query(q)`
- [x] **`useSearch(query)` hook** — query with enabled flag, returns typed results
- [x] **Search UI** — Cmd+K global shortcut opens search overlay/modal. Results show: icon (task/note), title, body snippet with highlighted match, date, entity type badge.
- [x] **Keyboard shortcuts** — ESC to close, Cmd+K to toggle

### 5b: Semantic Embedding Search (layer on top of FTS)

- [ ] **Embedding pipeline** — on task/note create and significant edits, generate embedding via configured provider, store in `vec_embeddings` table
- [ ] **Hybrid search** — FTS results + vector similarity results merged and re-ranked by combined score
- [ ] **Duplicate detection** — at promotion time, check new entity against existing embeddings for near-matches (PRD Section 12, point 21)

---

## Shared Components Built

- [x] `AreaSelect` — dropdown area picker (used by tasks + notes) — `src/components/shared/area-select.tsx`
- [x] `SearchOverlay` — Cmd+K modal with combined FTS results — `src/components/shared/search-overlay.tsx`
- [x] `Popover` — Radix UI Popover wrapper — `src/components/ui/popover.tsx`
- [x] `TagEditor` — inline tag pill editor with add/remove — `src/components/shared/tag-editor.tsx`
- [x] `TaskPicker` — search-and-select a task (for linking notes to tasks) — `src/components/shared/task-picker.tsx`

---

## Files Created

### API Routes
- `src/app/api/areas/route.ts` — GET (list), POST (create)
- `src/app/api/areas/[id]/route.ts` — GET, PATCH
- `src/app/api/stream/route.ts` — GET (list)
- `src/app/api/stream/[id]/route.ts` — PATCH
- `src/app/api/tasks/[id]/complete/route.ts` — POST (handles one-time + recurring)
- `src/app/api/search/route.ts` — GET (FTS search across tasks + notes)

### Services
- `src/lib/api/areas.ts`
- `src/lib/api/stream.ts`
- `src/lib/api/search.ts`

### Hooks
- `src/hooks/use-areas.ts`
- `src/hooks/use-stream.ts`
- `src/hooks/use-search.ts`

### UI Components
- `src/components/ui/popover.tsx`
- `src/components/shared/area-select.tsx`
- `src/components/shared/search-overlay.tsx`
- `src/components/tasks/task-row.tsx`
- `src/components/tasks/task-list.tsx`
- `src/components/notes/note-row.tsx`
- `src/components/notes/note-list.tsx`
- `src/components/stream/stream-list.tsx`

### Modified
- `src/components/dashboard/content-panel.tsx` — replaced inline TasksContent/NotesContent/StreamContent with imports
- `src/components/dashboard/dashboard.tsx` — mounted SearchOverlay
- `src/db/types.ts` — added AreaFilter, StreamFilter, NoteStatus; fixed Create*Input types to omit `id`
- `src/hooks/use-tasks.ts` — added `useCompleteTask()`
- `src/lib/api/tasks.ts` — added `complete()` method
- `src/app/api/notes/route.ts` — added `status` filter support
