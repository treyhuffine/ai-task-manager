# Storage Architecture: DB as Truth, Markdown as Mirror

Decision doc for how the app stores your data. Written for me, future-me, and anyone poking around the repo trying to understand why it's built this way.

## TL;DR

**SQLite is the source of truth. Every database write also writes a live markdown mirror of your data to disk.** Humans and agents read the files. Writes go through the app, an MCP tool, or direct SQL. Two-way sync (where editing a file updates the DB) is explicitly a future feature, not v1.

You get the durability, speed, and relational integrity of a database. You also get a folder of plain markdown files you can grep, back up, commit to git, open in Obsidian, or feed to any LLM on earth. The app can disappear and your brain is still on your disk.

## Why Not Pure Markdown

The filesystem-as-brain pattern (gbrain, OpenClaw, Obsidian) is real and has a lot of gravity right now. We seriously considered going that way. The pitch is strong: files are the universal protocol every tool, every agent, every human, and every future AI already speaks.

It breaks down for this app specifically because this is an **execution tool**, not a knowledge wiki. Look at what a task actually holds: `status`, `sort_key`, `last_surfaced_at`, `times_deferred`, `next_recurrence_at`, `parent_id`, `blocked_on`, `area_id`, deck references. This is operational state churned by agents at sub-second rates, not documents humans thoughtfully edit. The things a DB gives you — atomic writes, indexes, foreign keys, vector search, full-text search — are not nice-to-haves here. They're load-bearing.

File-based systems duck this with git as a concurrency primitive. We don't have that — our writes are agent actions, not human commits. Going file-primary means building a reliable file watcher with cycle prevention, atomic write semantics, conflict resolution when the user edits a file mid-agent-update, markdown-to-structured parsing for every field an agent might touch, and performance work to keep the UI responsive when a single operation rewrites 50 files. All solvable. None free. And every week we spend building that is a week not spent on the actual product.

## Why Not Pure Database

A pure DB with no file output is what Linear, Todoist, and Notion do. It's simpler to engineer. It's also the thing users are increasingly asking to get away from.

The reasons people want files on disk are real and compounding:

- **Ownership.** Your brain lives on your computer. The app can shut down tomorrow and your data is still readable.
- **Tool compatibility.** Every editor, every backup tool, every sync client, every AI agent already speaks files and markdown. No integrations required.
- **Observability.** `grep`, `rg`, `git log`, `git blame`. You can answer questions about your own data with 50 years of Unix tooling.
- **LLM-ready.** Point any present or future AI at the folder. No MCP server to stand up, no schema to document, no adapter to write.
- **Longevity.** Markdown has been stable for 20+ years. The format will outlive any specific database schema.

Pretending these don't matter is the kind of thinking that makes tools feel like rented space instead of owned tools.

## The Design: DB Writes, File Mirrors

```
                  ┌────────────────────────────┐
   App UI  ───┐   │                            │
   MCP     ───┼─► │  SQLite (source of truth)  │ ──► Live export ──► ~/<root>/*.md
   SQL     ───┘   │                            │
                  └────────────────────────────┘
                              │
                              ▼
                        Agents & humans
                        read the files
```

- Every write path — UI action, MCP tool call, API route, direct SQL — goes through the database layer.
- After each committed transaction, the affected entities are re-exported to markdown on disk.
- Reads can come from either side. Fast structured queries go to SQLite. Agent context, grep, Obsidian, backup all use the files.
- The file export is deterministic and idempotent. Re-running it on an unchanged DB produces byte-identical files.

## Filesystem Shape

The mirror's default root is the app's user-data directory (e.g. `~/.flow/`).
Type folders live **directly** in the root — no `mirror/` wrapper — so the
path is as short and flat as possible:

```
<user-data-dir>/                      # default; override via *_MIRROR_PATH
├── README.md                         # explains the mirror + which files are internal
├── notes/
│   ├── meeting-prep-thursday--<uuid>.md
│   └── .tmp/                         # in-flight writes (hidden from primary glob)
├── tasks/
│   └── wire-up-exporter--<uuid>.md
├── areas/
│   └── work--<uuid>.md
├── stream/
│   └── <uuid>.md                     # stream items are short; slug optional
├── attachments/                      # uploaded files (images, PDFs, audio)
│   └── <uuidv7>.<ext>                # referenced by markdown bodies as
│                                     # `../attachments/<file>`
├── .archive/                         # archived / merged-away entities
│   ├── notes/<uuid>.md
│   ├── tasks/<uuid>.md
│   └── attachments/<file_name>       # files no entity references anymore
│
# Alongside the mirror (internal, not user-facing):
├── data.db                           # SQLite, source of truth
├── config.json                       # local auth + settings
└── snapshots/                        # one-shot snapshots from `snapshot` command
                                      # (self-contained: copies referenced
                                      # attachments into <snapshot>/attachments/)
```

Growing past ~10k files in one type starts to feel sluggish in Finder /
Obsidian. At that point, shard by year (e.g. `notes/2026/…`). Additive change
to the exporter, no schema impact. Don't pre-shard.

### Filename scheme

`{slug}--{uuid}.md` — hybrid format. Slug is cosmetic, UUID is authoritative.

- Double-separator (`--`) so IDs with internal hyphens (UUIDv7, standard UUIDs) parse back out reliably: "split on the last `--`, the right side is the ID."
- Parse rule for ID lookup: read directory, find the file whose name ends with `--{id}.md` (or is exactly `{id}.md` if slug was empty).
- Title change rewrites the filename. Git sees this as a rename. References by ID still work. References by path break — that's fine because we never promise path stability.
- Slugs use `@sindresorhus/slugify` — Unicode-aware (transliterates accented + CJK characters, strips emoji), so titles in any language produce usable filenames.

**Flat within type, not nested by area.** Type boundaries (notes vs tasks vs areas) are stable. Area membership is data, not structure — it goes in frontmatter. Nesting by area would force cascade renames every time something moves.

### Temp files

Write in flight lives at `<type>/.tmp/<slug>-<ulid>.md`. Hidden from the primary glob because `*-{id}.md` doesn't descend into `.tmp/`. If we crash with a temp file present, it's a diagnostic artifact — reconcile picks it up and either promotes it or cleans it up.

### Archive and delete

- `status: archived` (soft delete or merge-away) → move the file to `.archive/<type>/<filename>`
- Hard delete → remove from disk entirely
- `.archive/` keeps a browsable paper trail without cluttering the primary folders

## Example File

```markdown
---
id: 01HF3K2M9P...
type: note
title: Meeting prep Thursday
status: active
area_id: 01HF3K2M5N...
area_name: Work
task_id: 01HF3K2M8N...
task_title: Prepare for quarterly review
context_tags: [prep, quarterly]
created_at: 2026-04-17T08:15:32.000Z
updated_at: 2026-04-17T09:42:11.000Z
managed_by: flow
---

<!-- Managed by the app. Edits here are overwritten on next sync. -->
<!-- To modify: use the app, the MCP tool, or write SQL directly. -->

Notes from pre-meeting. Key topics: headcount plan, Q2 roadmap, budget ask.

## Sources

### Voice capture, 2026-04-15 14:23
> Original raw text of the first stream item, preserved in full.

### Capture, 2026-04-16 09:10
> Original raw text of the second stream item, preserved in full.
```

**Denormalization rules:**
- Frontmatter carries FK *plus* display name for every reference: `area_id` + `area_name`, `task_id` + `task_title`. Agents read frontmatter for structured lookup without chasing chains of IDs.
- Full source content lives in the body under a `## Sources` heading, not truncated, not in frontmatter. Frontmatter is for structured metadata; body is for content.
- When a referenced entity (area, task) is renamed, cascade re-export every file that references it. Bounded by the reference graph, fast enough at app scale.

## Write Pipeline

**Inline, synchronous, post-commit.** The export fires after the DB transaction commits, in the same request path.

```typescript
const affected = new MutationContext(); // just a typed Set

const note = await db.transaction(async (tx) => {
  const created = await notes.create(tx, input);
  affected.add('note', created.id);
  for (const streamId of mergedStreamIds) {
    await streams.update(tx, streamId, { status: 'promoted', ... });
    affected.add('stream', streamId);
  }
  return created;
});

// transaction committed, DB is now authoritative
await exporter.syncBatch(affected);
```

### Invariants

- **DB commits first, file writes after.** Never the reverse. If the DB rolls back, nothing is written to disk. If the file write fails after commit, next sync or reconcile picks it up.
- **One transaction → one batch export.** `syncBatch` fans out file writes with `Promise.all`, no concurrency cap. Node handles hundreds of concurrent small-file writes fine. Measure before optimizing.
- **Cascading updates go through the same batch path.** Renaming an area computes all affected notes and tasks, adds them to the batch, fires one `syncBatch`.

### Per-file write sequence (rename-aware)

1. Glob `<type>/*-{id}.md` to find the current file (if any).
2. Write new content to `<type>/.tmp/<new-slug>-{id}.md`.
3. If the current filename differs from the target, delete it.
4. Rename the temp file to its final location.

Atomic-ish. The ~1-10ms window where no primary file exists is recoverable via reconcile. Alternative (rename-then-delete) leaves a transient duplicate; we prefer "briefly zero" over "briefly two" because readers (Obsidian, grep, agents) only ever see one version.

## Reconcile

Three triggers, same logic:

1. **On startup** — app boots, reconciler sweeps.
2. **Every 15 minutes** — timer runs in-app. (Eventually moves to a daemon; same behavior.)
3. **On-demand CLI** — `flow export` forces a full sync when debugging or after a crash.

Algorithm, no cursor:

1. For each entity in the DB, glob `<type>/*-{id}.md`:
   - No file → write it
   - File exists, frontmatter `updated_at` < DB `updated_at` → rewrite
   - File exists, frontmatter `updated_at` ≥ DB `updated_at` → skip
2. For each file in each type folder, if the ID isn't in the DB, log loudly and leave it alone. (We don't build orphan-quarantine until we actually hit orphans.)

Simple, boring, reliable. At current scale, even a full-scan reconcile of a few thousand entities runs in well under a second.

## Merges

Only stream → note in v1. Note-to-note merges deferred.

### How it works

- Agent decides N stream items should become one note.
- In one transaction: create/update the target note, mark each stream as `status: 'promoted'` with `promoted_to_id = note.id` and `promoted_to_type = 'note'`.
- Export batch: note file gets written with a `## Sources` body section listing all N streams (ID + raw_text); each stream file gets updated to reflect its promoted state.

**The child side owns the FK.** Streams point to their destination note via `stream.promoted_to_id`. The note doesn't carry a `source_ids` column — at export time, the exporter does a reverse query:

```sql
SELECT * FROM stream
WHERE promoted_to_id = :note_id AND promoted_to_type = 'note';
```

Single source of truth (the FK on stream), no drift risk, no schema change for the note side. Export code is written generically (reverse-lookup across any type with `promoted_to_id`), so when note-to-note merges eventually land, the exporter handles them without changes.

### Schema note

`notes.stream_item_id` becomes redundant once merges are modeled via `stream.promoted_to_id`. See "Schema Changes at Implementation Time" below.

## CLI

Two related commands, different jobs:

- **`flow export`** — force a full sync of the live mirror *right now*.
  Idempotent and safe to run anytime. Subcommands: `flow export status`
  (counts per type) and `flow export path` (print the mirror root).
- **`flow snapshot`** — write a one-shot timestamped snapshot to
  `<user-data-dir>/snapshots/<app>-snapshot-<date>/`. Use for offline archives,
  migrations between machines, or pointing Obsidian at a frozen copy.

The mirror runs automatically (live inline writes + every-15-min reconcile).
You shouldn't need `flow export` in normal use — only when debugging drift
or recovering from a crash.

## Signaling the Mirror is Read-Only

Three signals, belt-and-suspenders:

1. **Header comment on every file** (the agent signal):
   ```
   <!-- Managed by the app. Edits here are overwritten on next sync. -->
   <!-- To modify: use the app, the MCP tool, or write SQL directly. -->
   ```
   LLMs reliably read file headers. Highest-leverage deterrent.

2. **Frontmatter field** `managed_by: <app-name>` — machine-readable.

3. **README.md in the export root** — human-facing explanation with examples of how to actually edit things.

We deliberately do **not**:

- `chmod 444` the files. Too hostile, breaks the app's own writes, power users override it anyway.
- Use a custom extension (e.g. `.app.md`). Breaks editor associations and Obsidian.
- Lock the folder. Same problem, worse.

The soft signal handles 99% of cases. The 1% who ignore it and lose a manual edit will understand after the first time.

## What You Keep From Each Side

**From the database:**

- Atomic writes, real transactions
- Foreign keys catch broken references before they ship
- Indexed queries, FTS5, vector search via sqlite-vec
- Clean schema migrations
- Trivial remote/team story — just point multiple clients at the same DB
- Fast full-app queries without scanning the filesystem

**From markdown:**

- Portability — your data lives on your disk as plain text
- Tool compat — Obsidian, VS Code, any editor
- Unix composability — `rg`, `fd`, pipes, git hooks
- Optional git history — `git init` the folder and every change is a commit
- OS integration — Spotlight, Finder tags, file-sharing
- LLM context — zero integration required to feed the folder to any AI
- Offline readability — the files work even if the app is gone

## What's Explicitly Not Here (v1)

These are real costs. Don't pretend they aren't.

- **Edit-in-place doesn't stick.** If you open a task in Vim and change the title, it gets overwritten on the next sync. The file is a view, not a participatory surface.
- **No structural reorganization by moving folders.** The folder layout mirrors the DB's entity model. Moving `tasks/abc.md` to a different folder doesn't re-parent it.
- **No multi-writer via the filesystem.** If you want two agents on two devices to collaborate, that goes through the DB (or a synced DB), not shared files.
- **No note-to-note merges.** Stream → note only in v1. Note-to-note requires a schema addition (see below).
- **No orphan quarantine.** Reconcile logs orphaned files loudly but doesn't move them. Build that when/if we actually see orphans in practice.

If any of these matter more than the DB's guarantees, you want a different tool (Obsidian, gbrain). For an opinionated execution app with a real UI, they don't.

## Schema Changes at Implementation Time

To be done in the same commit that lands the exporter:

- **Remove `notes.stream_item_id`.** Redundant with `stream.promoted_to_id`, and it can't represent N-to-1 merges. Blast radius is tiny — the column plus one guard in `src/lib/ai/chat-tools.ts` (the `FK_FIELDS` set). Reverse queries via `stream.promoted_to_id` replace every use.

Deferred until the feature lands:

- **Note-to-note merges** — add `promoted_to_id`, `promoted_to_type`, `promoted_at` to the notes table, parallel to stream. Reuses `status: 'archived'` for the merged-away side. Not needed v1.

## Future: Two-Way Sync

This is an opt-in feature we add **when** (not **if**):

1. Users ask for it repeatedly with concrete use cases, or
2. The filesystem-primary direction clearly wins in the broader AI tools space, or
3. We want to support collaborative editing via shared folders (iCloud, Dropbox, git).

### What two-way sync would look like

```
   File edit (Vim, Obsidian, Claude Code)
            │
            ▼
   File watcher (chokidar)
            │
            ▼
   Parse frontmatter + body diff
            │
            ▼
   Replay as API call (same path as any other write)
            │
            ▼
   DB update → re-export (with cycle guard)
```

Every file edit becomes an intent that replays through the same write path as UI and MCP. No special "file-sourced" write semantics. The DB remains the source of truth; the file system is just another input channel.

### What's hard about it

- **Watcher reliability.** `fs.watch` is flaky on macOS. `chokidar` is the right tool but still needs careful tuning.
- **Cycle prevention.** DB write → file export → watcher fires → parses → tries to write to DB → loop. Solved with a write fence (ignore file events for N ms after an export) plus content hashing (skip if unchanged).
- **Partial edits.** User changes the title in frontmatter but also rewrites the body. Which parts replay? Frontmatter fields map cleanly to columns. Body is ambiguous.
- **Conflict resolution.** User edits file at 10:00:01 while agent updates DB at 10:00:00. Last-write-wins with timestamps is probably fine at single-user scale; needs more thought for teams.
- **Cross-device.** If the folder is in iCloud/Dropbox, edits from another device look like external file events. Has to work.
- **Performance.** A rename of an area could trigger a cascade rewrite of every task in it. Batching and debouncing matter.

Each item is solvable. None is trivial. Honest estimate for reliable two-way sync: 3-6 weeks of focused work plus an ongoing tail of edge cases.

### Why we're deferring it

- We don't know yet if users actually want to edit the files. They might be happy with read-only observability.
- The one-way mirror delivers most of the value (portability, tool compat, LLM context, backup) at a fraction of the engineering cost.
- Building two-way sync before validating demand is the kind of infrastructure work that delays shipping.
- The one-way design doesn't paint us into a corner. Two-way is additive, not a rewrite.

## Open Questions

Answered above and no longer open: filename scheme, tmp location, reconcile strategy, rename ordering, batch writes, denormalization shape, merge modeling, archive behavior.

Still open — decide when we build:

- **Where does the export root live?** Default `~/<app-name>/`, configurable via env var. User-chosen vs app-managed needs a call.
- **How do we handle large bodies?** Notes with 50KB+ of content. Frontmatter-only? Separate files? In-body? (Default: in-body, decide on a cap if it becomes a problem.)
- **Do we export `decks` and `task_completions`?** They're derived/event-log data — might belong in a `.history/` or `.derived/` subdirectory.
- **Do we export `api_keys` or `user_state`?** No — secrets and ephemeral state don't belong on disk as plain text. Confirm and document.
- **Git integration.** Do we `git init` the export folder automatically? Offer a flag? Leave it to the user?
- **Initial export performance.** First export of a filled DB — blocking boot, or background?

## Resolved design decisions

- **Attachments live at `<user-data-dir>/attachments/<uuidv7>.<ext>`, as a
  sibling of the entity type folders.** Markdown bodies reference them via
  relative paths (`../attachments/<file>`), which resolve naturally in
  Obsidian, VS Code, and `gh`. The same URL prefix (`/api/attachments/...`)
  lives in the live DB body; a string replace on export rewrites it. Each
  entity carries an `attachments[]` JSON manifest — a materialized view of
  which files its body references. Orphan sweep moves unreferenced files to
  `.archive/attachments/`.

These are real design items, not blockers.

## Summary

Storage model is: **structured state in a database, readable mirror on disk.** You get the engineering properties of SQLite and the portability, transparency, and tool ecosystem of a markdown folder. You don't get edit-in-place today, but nothing stops us from adding it later if the product and the field both pull in that direction.

This is a deliberate point on the design frontier, not a compromise. It matches what this app is: an opinionated execution tool with a real UI, not a blank-slate folder users shape themselves.

Ship the one-way export. Revisit two-way sync when we have evidence it matters.
