# Entity Links (note/task cross-linking + backlinks)

Status: proposed (v3)
Owner: TBD
Related: `docs/chat-sessions.md`, `docs/optimistic-updates.md`, `docs/storage-architecture.md`, `src/lib/db/schema.ts` (`chat_refs`), `src/lib/entity-refs/parse-markers.ts`, `src/lib/db/index.ts` (FTS trigger precedent), `src/lib/export/mirror/`

## 1. Summary

Let a note or task body link to another note or task, the way chat already links entities, and surface the reverse direction ("what points at this?") as backlinks. Authoring uses `@` (the same trigger as the chat composer) plus a slash-menu "Link" item — an earlier `[[` trigger was dropped as unintuitive. The stored marker stays id-stable `[[note:id]]` inside the body text (the single source of truth), so agent-written markers still render as chips and feed the index. Backlinks are a derived index in SQLite. The exported markdown mirror rewrites markers to readable wikilinks so the vault opens in Obsidian.

The design borrows Obsidian's architecture (content is truth, backlinks are derived) but keeps stable ids underneath (correct for a DB/agent app: links never rot on rename, agents dereference unambiguously).

### What changed from v2 (scope reduction)

v2 tried to make the markdown mirror a first-class consumer of the projection spine, which pulled in three revision counters, a rename cascade, and out-of-order render handling. That was over-engineering: the mirror is a secondary read-only export and already has its own per-write sync. v3 keeps the projection spine **links-only**, leaves the mirror on its existing mechanism, and adds only the body-link rewrite to the renderer. The remaining v2 correctness fixes (raw-SQL delete, editor tokenizer, trigger installation, typed edge keys, null-safe guards) are folded in. The result is smaller than v2.

### The honest consistency guarantee

- Canonical application writes (through the query helpers) update body and links atomically. Immediately consistent.
- External / raw-SQL writes are portable and never silently missed: a pure-SQL revision trigger marks them, and read-repair heals them.
- Supported graph reads (backlinks API, orchestrator/NL-MCP actions) repair pending sources first and return a transactionally consistent result.
- Raw SQL run directly against `entity_links` may be stale until the next repair. Explicit tradeoff for keeping external writes portable and JS-free.
- Mirror vault link slugs have the **same rename-staleness the existing frontmatter wikilinks already have**. Hardening that is separate, out-of-scope work (Section 8, Section 13).

### Non-goals

- Area targets. Grammar has `file | task | note | scratchpad`, no `area`. Targets are `task | note`. Area is a later extension (Section 13).
- Per-mention "linked references with context." One deduped edge per (source, target). See Section 13.
- Touching `chat_refs` (Section 12). Shared only at the grammar.
- A backlinks file. Index lives in the DB; the vault gets backlinks natively from Obsidian.
- Making the mirror transactional or cascade-perfect. Out of scope (Section 8).
- A JS-UDF "strong mode." Recorded as a future option only (Section 13).

## 2. Core concepts and the invariant

A **link** is a directed edge: source (the note/task whose body contains the marker) points at target. A **backlink** is the same edge read from the target end. No separate record: read `entity_links` by `target` for backlinks, by `source` for outgoing links.

**The invariant:**

> A row `(source = S, target = T)` exists in `entity_links` if and only if S's currently-persisted link-bearing text contains a resolvable marker pointing at T.
>
> Target existence does not affect the invariant. A row may point at a deleted target: an unresolved link (Obsidian behavior), not an inconsistency.

Consequences:

- The index is a pure function of the source's own text. Only the source's own write changes the source's rows.
- No target-keyed operation writes the index. Deleting T never deletes rows where `target = T`.
- Self-links are stored faithfully (`S -> S` if S's body links S). The panel filters self at render, so data stays pure and UX stays clean.

## 3. Data model

Two tables in `src/lib/db/schema.ts`.

### 3.1 `entity_links` (the derived edge index)

```ts
// ─── Entity Links ────────────────────────────────────────────────
// Derived, content-authored links between notes/tasks. One row per
// directed edge. A PROJECTION of body text, never authored by hand.
// Reconciled in-transaction on app writes; healed for external writes
// via revision-checked read-repair (§5–6). Invariant: row (S→T) exists
// iff S's current link-bearing text has a resolvable marker to T; target
// existence is irrelevant (§2). Distinct from `chat_refs` (§12); shared
// only at the `[[kind:id]]` grammar (parse-markers.ts).

export const entityLinks = sqliteTable(
  'entity_links',
  {
    id: text().primaryKey(),
    ...timestamps,
    sourceType: text({ enum: ['task', 'note'] }).notNull(),
    sourceId: text().notNull(),
    targetType: text({ enum: ['task', 'note'] }).notNull(),
    targetId: text().notNull(),
  },
  (table) => [
    index('idx_entity_links_target').on(table.targetType, table.targetId), // backlinks
    index('idx_entity_links_source').on(table.sourceType, table.sourceId), // outgoing + delete key
    uniqueIndex('entity_links_edge_uq').on(
      table.sourceType, table.sourceId, table.targetType, table.targetId,
    ),
  ],
);
```

Typed keys (reversed from v2's id-only): match on the real identity `(type, id)`, not on an assumption that ids are globally unique across `tasks` and `notes`. uuidv7 makes collision astronomically unlikely, but raw SQL is a supported capability and a same-id task and note would otherwise alias reads, dedupe, and cleanup. The columns already exist, so this costs nothing. Polymorphic association, so no FK; cleanup is by trigger + code (Section 5.1, Section 7).

### 3.2 `entity_projection_state` (links-only versioned spine)

One coalescing row per source entity, keyed naturally. A pure-SQL trigger bumps `source_revision` on any link-bearing write (every writer, no JS). `links_projected_revision` records how far reconciliation has caught up. Pending == `source_revision > links_projected_revision`.

```ts
// ─── Entity Projection State ─────────────────────────────────────
// One row per (source_type, source_id). Pure-SQL triggers on tasks /
// notes bump `source_revision` when link-bearing text changes (so raw
// SQL is caught too). Reconciliation advances `links_projected_revision`.
// Links-only: the mirror is NOT tracked here (§8). See §5–6.

export const entityProjectionState = sqliteTable(
  'entity_projection_state',
  {
    // Natural composite key: pure-SQL triggers write this table, so we
    // avoid a surrogate text id they would have to mint. House-style
    // exception, justified by the trigger-authored path.
    sourceType: text({ enum: ['task', 'note'] }).notNull(),
    sourceId: text().notNull(),
    ...timestamps, // SQL defaults populate on trigger INSERT; triggers set updated_at explicitly
    sourceRevision: integer().notNull().default(0),
    linksProjectedRevision: integer().notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.sourceType, table.sourceId] }),
    // Cheap "what is pending" scan for read-repair.
    index('idx_eps_pending')
      .on(table.sourceType, table.sourceId)
      .where(sql`${table.sourceRevision} > ${table.linksProjectedRevision}`),
  ],
);
```

Revision, not timestamp: do not use `updated_at` for staleness. Its `.$onUpdate()` is Drizzle-side (`schema.ts:42`), so external SQL will not bump it. `source_revision` is a trigger-incremented integer that every writer bumps. Timestamps stay for house style; the triggers set `updated_at` explicitly in SQL (Section 5.1).

Partial-index note: if SQLite rejects the two-column partial predicate here, drop `.where(...)` and scan (one row per entity, cheap). Confirm in Phase 1.

Regenerate `src/db/types.ts`; `pnpm db:generate` for the migration. Triggers install at runtime (Section 5.1), not via the migration.

## 4. Marker grammar, extraction, and authoring

### 4.1 Grammar (reuse)

`[[task:<id>]]` / `[[note:<id>]]` from `src/lib/entity-refs/parse-markers.ts` (`listNonFileMarkers` etc.). Do not fork the grammar.

### 4.2 Shared document-aware extraction (new)

The raw regex parser must keep working unchanged for chat. For notes/tasks, markers inside inline code and fenced code blocks are not links. Build one shared, code-aware extraction layer over the grammar, used by all three consumers so they cannot disagree: link derivation (Section 5), mirror rewrite (Section 8), editor tokenizer (Section 4.4). It masks/skips code regions, then applies the grammar. Do not modify the raw chat parser.

Link-bearing fields, parsed independently (so an unclosed fence in one cannot mask the other):

- Task: `description` and `body`, extracted separately, unioned.
- Note: `body`.

### 4.3 Storage vs display vs export

- Stored (truth): `[[note:<id>]]` / `[[task:<id>]]`. Id-stable.
- Displayed: a chip showing the target's current title, clickable.
- Exported (mirror): rewritten to the vault wikilink (Section 8).

### 4.4 Editor integration (a Markdown-capable node)

Target editor: `src/components/editor/rich-editor.tsx` (used by `task-slideout.tsx` and `note-slideout.tsx`), which saves via `getMarkdown()` (`rich-editor.tsx:240`). The chat `EntityChipNode` only has `parseHTML`/`renderHTML` and hardcodes Backspace to `'@'` (`entity-chip-node.tsx:86`), so it cannot be reused.

Build a Markdown-capable entity-link node/extension providing:

- An inline **`markdownTokenizer` plus a matching token name** so `[[note:id]]` is recognized on load, not only via `parseMarkdown`/`renderMarkdown` (Tiptap Markdown API: `.reference/tiptap-docs/src/content/editor/markdown/api/editor.mdx:269`). `renderMarkdown` emits the byte-identical `[[kind:id]]` so it round-trips through `getMarkdown()`.
- `@` trigger (single char, reuses the chat suggestion machinery) plus a slash-menu "Link" item that opens the same picker. `allowSpaces` on, since titles contain spaces.
- Live title resolution and click-to-navigate.
- Suggestion popover scoped to `task | note`, reusing the chat mention menu's data layer where practical (no scratchpad/reference-folders/files).

## 5. When and how the index updates

Three layers: the pure-SQL revision trigger (catches every writer), the in-transaction fast path (immediate for app writes), and read-repair (heals pending before a supported read).

### 5.1 Pure-SQL triggers (enforcement boundary)

No JS, so they fire for helpers and raw SQL identically and the DB file stays portable. Install them at runtime, idempotently, at DB init, following the existing **FTS trigger precedent** (`src/lib/db/index.ts:31`). `db:generate` does not emit triggers and `db:push` will not run handwritten trigger SQL, so runtime install is the single authoritative path; add a startup verification that they exist.

Per content table (`tasks`, `notes`), guards null-safe:

```sql
-- INSERT: create/advance the projection row
CREATE TRIGGER IF NOT EXISTS tasks_projection_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO entity_projection_state
    (source_type, source_id, source_revision, links_projected_revision, created_at, updated_at)
  VALUES ('task', NEW.id, 1, 0, datetime('now'), datetime('now'))
  ON CONFLICT(source_type, source_id)
    DO UPDATE SET source_revision = source_revision + 1, updated_at = datetime('now');
END;

-- UPDATE: only when link-bearing text changes (null-safe IS NOT)
CREATE TRIGGER IF NOT EXISTS tasks_projection_au AFTER UPDATE ON tasks
WHEN NEW.body IS NOT OLD.body OR NEW.description IS NOT OLD.description BEGIN
  INSERT INTO entity_projection_state
    (source_type, source_id, source_revision, links_projected_revision, created_at, updated_at)
  VALUES ('task', NEW.id, 1, 0, datetime('now'), datetime('now'))
  ON CONFLICT(source_type, source_id)
    DO UPDATE SET source_revision = source_revision + 1, updated_at = datetime('now');
END;

-- DELETE: clean this source's edges AND its projection row, for every writer
CREATE TRIGGER IF NOT EXISTS tasks_projection_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM entity_links WHERE source_type = 'task' AND source_id = OLD.id;
  DELETE FROM entity_projection_state WHERE source_type = 'task' AND source_id = OLD.id;
END;
```

Notes trigger set is identical with `'note'` and guard `NEW.body IS NOT OLD.body`. Title is not a link-bearing field (the index stores ids; titles resolve at read time), so title changes do not bump the revision.

The DELETE trigger is the fix for raw-SQL deletion (v2 could not repair a deleted source because it had no text to re-derive from). Now every delete, app or raw, removes the source's outgoing edges by typed identity directly. The app delete helpers therefore need no explicit edge delete: the trigger runs inside the same statement's transaction.

### 5.2 In-transaction fast path (application writes)

Helpers (`createTask` ~149, `updateTask` ~184, `createNote` ~354, `updateNote` ~384 in `queries.ts`) reconcile links in the same transaction as the row write. The row write fires the trigger (bumping `source_revision`), then the helper reconciles and advances the projection atomically:

```ts
const row = db.transaction((tx) => {
  const r = hydrateRow(tx.insert(tasks).values({ ... }).returning().get());
  reconcileEntityLinks(tx, 'task', r.id, taskLinkText(r.description, r.body)); // upsert-and-prune
  advanceLinksProjection(tx, 'task', r.id); // links_projected_revision = source_revision
  return r;
});

void upsertEmbedding('task', row.id, buildEmbeddingText('task', row)); // unchanged
void syncEntity('task', row.id);                                       // mirror, unchanged (§8)
return row;
```

Drizzle form: `db.transaction((tx) => { ... })`, `tx` for writes, no trailing `()`. Update paths reconcile only when link-bearing text changed (`bodyChanged` for notes, `bodyChanged || descriptionChanged` for tasks), matching the attachments guard. Deletes need no explicit edge delete (Section 5.1 trigger).

### 5.3 `reconcileEntityLinks` (upsert-and-prune)

Shared `src/lib/entity-refs/derive-links.ts`:

```ts
// text is already code-stripped by the §4.2 shared extraction
export function linksFromText(sourceType, sourceId, texts /* string[] */) {
  const out = new Map(); // `${type}:${id}` -> {targetType, targetId}
  for (const text of texts) for (const m of extractEntityMarkers(text)) {
    if (m.kind !== 'task' && m.kind !== 'note') continue; // drop scratchpad/file
    out.set(`${m.kind}:${m.id}`, { targetType: m.kind, targetId: m.id });
  }
  return [...out.values()]; // deduped; self-links KEPT (§2)
}
```

`reconcileEntityLinks(tx, sourceType, sourceId, texts)` inside the caller's transaction:

1. `desired = linksFromText(...)` (task passes `[description, body]`, note passes `[body]`).
2. `INSERT ... ON CONFLICT (source_type, source_id, target_type, target_id) DO NOTHING`.
3. Delete edges for this source whose `(target_type, target_id)` is not in `desired`.

Upsert-and-prune: unchanged edges keep id and `created_at`, and it is row-identical under retry (an orchestrator invariant).

### 5.4 Links drain / read-repair

For each source where `source_revision > links_projected_revision`: reconcile from current text, advance the projection. Idempotent and order-independent (recompute from current state), so at-least-once and out-of-order both converge. Runs inline on the fast path and as global read-repair before backlinks reads (Section 6).

## 6. Consistency and race conditions

better-sqlite3 serializes writes (no torn writes); concerns are logical staleness.

- **R1 same-source concurrent edits.** Serialized; each reconciles in-transaction; last write wins on body and edges together.
- **R2 dangling edge.** Legal by the invariant. Persists until the marker is removed from the source (not merely on the next unrelated save, not on target deletion). Renders unresolved.
- **R3 out-of-order/lost async.** Reconciliation is recompute-from-current keyed by revision, so it converges and nothing is lost.
- **R4 reader mid-rebuild.** Reconcile is transactional; readers see pre- or post-, never the swap.
- **R5 cross-entity (delete B vs edit A).** Impossible for the index: delete B writes only `source=B`; edit A writes only `source=A`. Two entities never share edge rows.
- **R6 helper bypass (raw SQL, tooling).** Caught by the revision trigger; healed by read-repair; never silently missed. No writer-specific handling anywhere.
- **R7 read-repair is global + transactional, not per-target.** A freshly-dirty source A that just added its first link to B is invisible from B's stale index, so repairing only B is insufficient. Backlinks reads do:

  ```text
  BEGIN IMMEDIATE
    repair every source where source_revision > links_projected_revision
    run the backlink query
  COMMIT
  ```

  A revision-checked retry protocol is equivalent. On repair failure, error rather than return stale. The pending partial index makes this cheap when nothing is dirty.
- **R8 duplicates / self.** Deduped in `linksFromText` and by the unique edge index. Self-links kept in data, filtered in the panel.

## 7. Delete and cleanup policy

- Delete source S: the row delete fires the Section 5.1 trigger, which removes `entity_links WHERE source = S` and the projection row, atomically. No helper-side edge delete needed.
- Delete target T: nothing. Rows `* -> T` stay and render as unresolved links.
- Prune (maintenance only): delete `entity_links` whose `(source_type, source_id)` no longer resolves (belt-and-suspenders). Never prune by unresolved target.

## 8. Markdown mirror (minimal: body rewrite only)

The mirror stays on its existing mechanism. It is not a consumer of the projection spine.

- The live renderer is `src/lib/export/mirror/render.ts` (`renderTask`/`renderNote`, driven by `sync.ts`), not `src/lib/export/markdown.ts`. Add a body-level rewrite there.
- Rewrite (via the Section 4.2 shared extraction) `[[task:<id>]]` / `[[note:<id>]]` to the exact vault wikilink the frontmatter already emits via `LinkResolver`, i.e. `[[tasks/<slug>--<id>]]` / `[[notes/<slug>--<id>]]`. Match the existing form precisely, do not invent `[[Title]]` or `[[Title/slug]]`. Apply to task `description`, task `body`, note `body`, threading the existing `opts.links`.
- Unresolved targets: preserve the original `[[note:<id>]]` marker verbatim (readable, stable), matching how frontmatter `wikiLink` degrades.
- The mirror keeps re-rendering on every write via the existing `void syncEntity` (which already fires for all field changes, so status/area/date/tag edits still export correctly). Entity-links does not gate or replace that.

Explicitly out of scope (unchanged from today's behavior, tracked as separate future work in Section 13):

- Rename cascade: renaming T changes T's slug and thus the rendered link text inside incoming files. The mirror already has this exact staleness for frontmatter `[[area]]`/`[[parent]]`/`[[task]]` wikilinks. Body links inherit it, no worse. Fixing it belongs to a mirror-wide cascade project, not here.
- Transactional/ordered mirror publication. The mirror's fire-and-forget characteristics are pre-existing and app-wide.

## 9. Reads, caches, maintenance, and agent surfaces

- `listBacklinks(targetType, targetId)`: after global read-repair (R7), rows where `target = (type,id)`, resolved to `{ sourceType, sourceId, title, route }`, self filtered, non-existent sources filtered defensively.
- `listOutgoingLinks(sourceType, sourceId)`: resolved targets, unresolved flagged for the UI.
- `rebuildAllEntityLinks()`: maintenance. Reconcile every source, advance projections, prune orphaned source rows.
- Route: `GET /api/entities/[type]/[id]/backlinks`, mirroring `api/entities/sessions/route.ts` + `referencing-sessions-button.tsx`, running the repair-then-query protocol.
- UI: "Linked references" section in `task-slideout.tsx` and `note-slideout.tsx`, incoming links (optional outgoing/unresolved), loads on open.
- Cache invalidation points at targets: editing A changes B/C backlink caches, and renaming A changes A's title everywhere it appears. The current settlement invalidates only the mutated entity's root (`optimistic-entity.ts:125`), the wrong direction. v1: broad-invalidate `['entity-backlinks']` on every task/note mutation, plus refetch-on-open/focus for agent/external writes.
- Agent surfaces (both): add `list_backlinks` (+ optional `list_outgoing_links`) to the orchestrator registry (`registry.ts`) AND implement the actual `chatTools.listBacklinks` tool for the NL MCP (`src/lib/mcp/agent.ts:32`), not merely an allowlist entry. Document the `[[task:id]]`/`[[note:id]]` body syntax in the agent prompt.

## 10. Migration and backfill

- `pnpm db:generate` for `entity_links` + `entity_projection_state`; apply. Triggers install idempotently at DB init (Section 5.1) with a startup existence check.
- Post-migration: run `rebuildAllEntityLinks()` atomically so the index and projection are correct on every upgrade, reset, or reseed. Any write path that ran before the rebuild is covered generically by the trigger + read-repair, so no path-specific handling is needed.
- Ship a repair CLI (`rebuildAllEntityLinks` + prune).

## 11. Testing

- Unit (`linksFromText` + extraction): dedupe, self-link kept, scratchpad/file dropped, task `description`+`body` parsed independently, inline-code and fenced markers ignored, an unclosed fence in `description` does not mask `body`, malformed markers fall through.
- Fast path: create/update/delete reconcile; guard skips no-op edits; title-only write does not bump the revision or reconcile; dangling target survives and persists until the marker is removed (R2); source delete removes outgoing rows via the trigger but leaves incoming rows (Section 7); upsert-and-prune row-identical under retry (R8); last-writer-wins same-source (R1).
- Spine: raw-SQL body update bumps `source_revision`; a backlinks read repairs and returns consistent results (R6, R7); read-repair discovers a brand-new source→target link invisible from the target's stale index (R7); raw-SQL delete removes edges via the trigger (Section 5.1); repair failure surfaces an error, not stale data.
- Cross-type id collision: a task and a note sharing an id do not alias reads/dedupe/cleanup (typed keys, Section 3.1).
- Editor: `[[note:id]]` loads via the tokenizer and round-trips through `getMarkdown()` save/load (Section 4.4).
- Mirror: body markers export as `[[tasks/<slug>--<id>]]`; unresolved targets preserved verbatim; status/date edits still re-render (existing sync unaffected).
- Maintenance: `rebuildAllEntityLinks` prunes orphaned source rows, keeps unresolved target rows; post-migration/reseed rebuild runs and repairs.

## 12. Why `chat_refs` stays separate (verified)

A chat-session context/pin mechanism, not a derived link index. Shared only at the grammar and a reverse index. Session-scoped with cascade delete (`schema.ts:1349-1351`, `queries.ts:3811-3813`); two layers where only mentions are content-derived while pins are authored and survive text changes (`materializeEventRefs` `queries.ts:4918`, `pinSessionRef` `queries.ts:4952`, `queries.ts:4993-4995`); behavioral state a link index would not want (`hydrate`, `position`, `created_by`, chat-only `scratchpad`/`file`, `queries.ts:4930`); and the agent context path re-parses markers directly rather than reading it (`expand-markers.ts:71`). Two tables, one grammar. Do not merge.

## 13. Out of scope / future

- Area links: extend the grammar with `area`, add `'area'` to the type enums and the mention menu. Table shapes already support it.
- Linked references with context: per-mention rows with position/snippet instead of deduped edges.
- Mirror rename cascade + transactional publication: an app-wide mirror project covering frontmatter and body wikilinks together (Section 8).
- UDF "strong mode": a deterministic better-sqlite3 scalar function running the shared parser inside the trigger, making arbitrary external SQL immediately consistent. Rejected for v1 (fails closed for any process without the function, breaking advertised direct-SQL portability). Future alternative only.

---

## 14. Task list

### Phase 1 — schema + triggers
- [ ] Add `entityLinks` and `entityProjectionState` to `schema.ts` (Section 3). Regenerate `src/db/types.ts`. `pnpm db:generate`; confirm partial index accepted (else full scan).
- [ ] Runtime idempotent trigger install at DB init following the FTS precedent (`db/index.ts:31`), for `tasks`/`notes` INSERT/UPDATE(guarded, null-safe)/DELETE (Section 5.1), plus a startup existence check.
- [ ] `git add docs/entity-links-spec.md` (currently untracked).

### Phase 2 — extraction + derivation core
- [ ] Shared code-aware extraction layer over the grammar (Section 4.2), consumed by derivation, mirror, editor. Do not touch the raw chat parser.
- [ ] `derive-links.ts`: `linksFromText(sourceType, sourceId, texts[])` (dedupe, keep self, drop scratchpad/file).
- [ ] `queries.ts`: `reconcileEntityLinks` (upsert-and-prune, typed keys), `advanceLinksProjection`, `taskLinkText`→`[description, body]`.

### Phase 3 — fast path + read-repair
- [ ] Wire in-transaction reconcile + `advanceLinksProjection` into `createTask`/`updateTask`(guarded)/`createNote`/`updateNote`(guarded) with `db.transaction((tx) => ...)`. Delete paths need nothing (trigger handles edges).
- [ ] Links drain + transactional global read-repair (Section 5.4, R7).
- [ ] `rebuildAllEntityLinks()` (reconcile all, advance, prune orphans).

### Phase 4 — read side
- [ ] `listBacklinks`/`listOutgoingLinks` (repair-then-query; resolve title/route; filter self; flag unresolved).
- [ ] `GET /api/entities/[type]/[id]/backlinks` running the repair protocol.

### Phase 5 — editor authoring
- [ ] Markdown-capable entity-link node: inline `markdownTokenizer` + token name, `renderMarkdown` of `[[kind:id]]`, `@` trigger + slash-menu "Link" item, read-only title resolution, click-to-navigate, suggestion scoped to task|note (Section 4.4).

### Phase 6 — backlinks UI + caches
- [ ] "Linked references" section in both slideouts; load on open.
- [ ] Broad `['entity-backlinks']` invalidation on task/note mutations + refetch-on-open/focus (Section 9).

### Phase 7 — mirror (minimal)
- [ ] Body link rewrite in `render.ts` for task description/body and note body via `opts.links` + shared extraction, emitting the exact `[[tasks|notes/<slug>--<id>]]` form; unresolved markers preserved verbatim (Section 8).

### Phase 8 — agent surfaces + lifecycle
- [ ] `list_backlinks` (+ optional `list_outgoing_links`) in the orchestrator registry AND a real `chatTools.listBacklinks` for the NL MCP (`mcp/agent.ts:32`). Document body syntax in the agent prompt.
- [ ] Post-migration automatic `rebuildAllEntityLinks()` (atomic) + repair CLI.

### Phase 9 — tests
- [ ] The Section 11 matrix (unit, fast path, spine/read-repair, cross-type id collision, editor round-trip, mirror, maintenance).
