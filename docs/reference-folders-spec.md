# Reference Folders

Status: Phases 1 and 2 implemented. Phase 3 done except the agentex swap,
which is blocked on a field that does not exist yet.
Owner: Trey

Three things changed during implementation, all recorded in place below:

- **§6/§7** — the prompt block ships via agentex's `instructionsFile`, not
  Claude's `--append-system-prompt`. `instructionsFile` is the only delivery
  path every provider resolves, and §7 already assumed Codex would get
  prompt-level guarding, which a Claude-only flag could not deliver.
- **§7** — the write guard is `Edit(...)` rules only. `Write(...)` and
  `NotebookEdit(...)` path rules are silently ignored by Claude Code, which
  says so out loud when you pass one. Verified against 2.1.220, details below.
- **§8** — the drill-down does not reuse `listTree`. `workspace.open()` throws
  on a git folder that has no agentex worktree metadata, which a reference
  folder never has. Details in §8.

## 1. Problem

Work in one workspace routinely depends on knowing what is in another folder.
Frontend needs the backend's route shapes. An app needs the design system it
consumes. A caller needs the real API of a library it depends on. Sometimes the
folder is not code at all: a docs directory, a notes vault, a spec dump.

The agent can already read any absolute path. Nothing blocks it. The actual
failure is that **it does not know the folder exists**, so it never looks, and
it invents the answer instead. The fix is therefore mostly about awareness, not
access.

Today the only workaround is to make the other folder a workspace, which drags
in a rail entry, worktrees per execution, `filesToCopy`, setup and teardown
scripts, preview targets, and connector scopes. That is a large amount of
machinery for "please grep this," and it is exactly the kind of structure that
rots. The other workaround is to physically copy folders inside the working
tree, which pollutes the file tree and the `@` picker.

## 2. Decisions (locked)

- **Name: reference folders.** Not "repos" (they are not always code) and not
  "linked folders" (linking reads as bidirectional). Referencing something
  implies you consult it and do not change it, which is exactly the semantics.
  UI label "Reference folders", subtitle "read-only folders this workspace can
  see". Table `reference_folders`.
- **A table, not a JSON column on `workspaces`.** Rows need FK integrity when
  pointing at another workspace, need to be queried in reverse ("what
  references this?"), and will grow columns. This follows the same lift that
  `executions`, `preview_targets`, and `triggers` already made.
- **Two target kinds: a workspace or a bare path.** Forcing everything to be a
  workspace is the rot this feature exists to avoid, and half the real cases
  cannot be workspaces at all (`node_modules/foo`, a docs folder, a vault).
  Exactly one of `path` / `target_workspace_id` is set.
- **`workspace_id` is nullable, and NULL means global.** A global reference is
  visible in every workspace. This copies the pattern `triggers` already uses
  for brain-level versus workspace-level rows, and removes the need for a join
  table.
- **Read-only by convention, enforced best-effort.** See §7 for exactly how far
  the guarantee goes, which is further than prompt text and short of a
  hard sandbox.
- **The prompt block is the feature.** `@alias` is the accelerator on top. If
  only one of the two ships, ship the prompt block.

## 3. Non-goals

- Writable references. If you need to change it, make it a workspace.
- Syncing, fetching, cloning, or pulling a reference folder. Flow reads what is
  on disk and reports drift. It never mutates.
- Auto-detecting sibling repos.
- Indexing reference folders into embeddings or `search`.
- Recursion. A reference's own references are not followed.

## 4. Data model

`src/lib/db/schema.ts`, placed after `workspaces`.

```ts
// ─── Reference folders ────────────────────────────────────────
// A read-only folder a workspace's agents may consult. Points at either
// another workspace (`targetWorkspaceId`) or a bare path on disk (`path`),
// never both. `workspaceId` NULL means the reference is global and visible
// from every workspace, matching the brain-level convention in `triggers`.

export const referenceFolders = sqliteTable(
  'reference_folders',
  {
    id: text().primaryKey(),
    ...timestamps,
    // Owning workspace. NULL = global (visible everywhere).
    workspaceId: text().references(() => workspaces.id, { onDelete: 'cascade' }),
    // What the user types after `@`. Lowercase, `[a-z0-9][a-z0-9._-]*`, so
    // the mention parser never has to disambiguate against a path.
    alias: text().notNull(),
    // Bare-path target. Absolute. Mutually exclusive with targetWorkspaceId.
    path: text(),
    // Workspace target. Resolved to a path at read time so the reference
    // survives the workspace's folder moving. Mutually exclusive with `path`.
    targetWorkspaceId: text().references((): AnySQLiteColumn => workspaces.id, {
      onDelete: 'cascade',
    }),
    // Optional note the agent sees under the path. Adding a reference should
    // be one field, not two. The alias and path already carry most of the
    // signal, so this is for the cases where the name is not self-evident.
    description: text(),
    position: integer().notNull().default(0),
    status: text({ enum: ['active', 'archived'] })
      .notNull()
      .default('active'),
    archivedAt: text(),
  },
  (table) => [
    index('idx_reference_folders_workspace').on(table.workspaceId, table.status),
    index('idx_reference_folders_target').on(table.targetWorkspaceId),
    // Alias uniqueness is per scope. Two partial indexes because a plain
    // UNIQUE(workspace_id, alias) lets duplicate global aliases through.
    uniqueIndex('uniq_reference_folders_global_alias')
      .on(table.alias)
      .where(sql`${table.workspaceId} IS NULL AND ${table.status} = 'active'`),
    uniqueIndex('uniq_reference_folders_workspace_alias')
      .on(table.workspaceId, table.alias)
      .where(sql`${table.workspaceId} IS NOT NULL AND ${table.status} = 'active'`),
  ],
);
```

Exactly-one-of is expressed as a `check()` in the table extras if drizzle-kit
emits it cleanly for SQLite. If it does not, drop the check and enforce in the
query layer instead. Do not hand-write the migration SQL to add it.

Writes go through a field whitelist (`workspaceId`, `alias`, `path`,
`targetWorkspaceId`, `description`, `position`). `id`, the timestamps, and
`status` belong to the query layer. The HTTP routes hand over
`await request.json()` cast to the input type, which is a compile-time claim
and nothing more — spreading that straight into `.set()` let a stray `id` in
the body rewrite the primary key and orphan the row. `id` is still honoured on
*create*, which is what makes a retried create idempotent.

Cascade choices: deleting the owning workspace deletes its references.
Deleting a *target* workspace also deletes references pointing at it, since a
reference to nothing has no meaning and there is no path to fall back to.

Migration is generated with `pnpm db:generate`, never by editing the journal by
hand, and applied with `pnpm db:push` or by restarting the dev server so
`getDb()` auto-migrates. Never via `sqlite3`.

## 5. Resolution

`src/lib/reference-folders/resolve.ts`.

```
resolveReferenceFolder(ref) -> { alias, absolutePath, description, exists, git } | null
```

- Bare path: use `path`, which the query layer already stored absolute.
  `normalizeReferencePath` expands `~` and resolves relatives at write time,
  matching every `/api/fs` route. Without it a hand-typed `~/code/api` resolved
  against the *server process* cwd and rendered as missing for a folder that
  was right there.
- Workspace target: use `getWorkspace(targetWorkspaceId).cwd`.
- `exists: false` when the path is gone. The reference stays in the table and
  renders as broken in the UI. It is omitted from the prompt block, because a
  path that does not exist is worse than silence.
- `git` is populated only when the folder is a git repo: current branch, dirty
  or clean, and ahead/behind counts against the tracking branch. Best-effort
  and cached briefly per session build, since it shells out.

`listReferenceFoldersForWorkspace(workspaceId)` returns global rows plus that
workspace's rows, with **workspace rows winning on alias collision**. This
matches how `resolveSkillDirsForSession` already resolves workspace skills over
global ones.

A reference points at a folder, and the agent gets whatever is in that folder.
Nothing resolves dynamically to a branch or a session. If you want an
in-progress worktree, add that worktree's path as a bare-path reference. That
is a one-off by design and needs no machinery.

`targetWorkspaceId` therefore earns its column for three plain reasons: FK
integrity, surviving the target workspace's folder moving, and inheriting the
workspace name to prefill the alias. Not for branch following.

## 6. Prompt injection

**Implemented via `instructionsFile`, not `--append-system-prompt`.** The
content-session seam at `adapter.ts` uses the latter, but it is a Claude-only
flag, and §7 below assumes Codex still gets the prompt-level guard. Agentex's
`instructionsFile` is resolved by every provider (claude maps it to
`--append-system-prompt-file`, codex folds it into base instructions), so the
block is portable. It was previously unused in Flow, and
`orchestratorSessionConfig` does not set it, so there is no collision.

The file is written to `<workDir>/reference-folders/<chatSessionId>.md` on every
session build, so it always matches the current reference list.

Renderer in `src/lib/executor/prompts/reference-folders.ts`:

```
## Reference folders (read-only)

Folders outside your working directory that you may read and search.
Do not modify anything in them. If a change is needed there, say so
instead of making it.

- backend  ->  /Users/trey/code/api
  Go API server this app calls. HTTP routes live in internal/http/.
  git: main, clean, 4 behind origin
- design-system  ->  /Users/trey/code/ds
  Shared React components. Source of truth for design tokens.
- vault  ->  /Users/trey/notes
```

`description` is optional. When absent, the entry is just the alias, the path,
and the git line. The alias plus path already carry most of the signal, and a
missing description is not a reason to hide the folder.

The `git:` line is the drift guard. Pointing at a checkout sitting on a
three-week-old feature branch is the quiet failure mode of this whole feature,
and one line of state lets the agent notice instead of trusting it.

Omit the whole block when a workspace has no active, existing references, so
zero-reference sessions pay nothing.

Session config is fixed at spawn, so every mutation route calls
`recycleForReferenceFolderChange` — otherwise a running agent keeps the old
folder list until it happens to restart. This is the same problem connector
scopes solve with `recycleWorkspaceSessions`, and a global reference recycles
every workspace's execution sessions rather than one. The instruction file is
deleted when the session closes, so `.work/reference-folders/` doesn't
accumulate a file per chat forever.

## 7. Read access and the read-only guarantee

Be precise about this, because "read-only" is doing a lot of work in the copy.

`@agentex/agent@0.0.34` `ProviderConfig` has **no** `additionalDirectories`
field. It does have `extraArgs`, `allowedTools`, and `disallowedTools`, so
everything below goes through argv passthrough with no agentex change needed.

Agentex is expected to add a typed `additionalDirectories` with
"extend the workspace" semantics, matching Claude's `--add-dir` and Gemini's
`--include-directories`. Flow should swap the passthrough for the typed field
when it lands (Phase 3), but must not wait on it. Note that Codex's nearest
equivalent (`sandbox_workspace_write.writable_roots`) governs writes only and
does not gate reads, so the capability spread will stay uneven and the
prompt-level instruction below remains the portable guard.

For Claude:

1. Push `--add-dir <absolutePath>` per resolved reference. Without this the
   Read tool is confined to the working directory and the agent has to fall
   back to permission-gated `Bash` calls.
2. Push `Edit(//<absolutePath>/**)` into `disallowedTools` as the write guard.
3. `--add-dir` grants read *and* write. The prompt instruction plus the deny
   rules are the guard. This is not a sandbox.

**Verified empirically against Claude Code 2.1.220** rather than assumed, since
this is the part the UI copy makes a promise about:

- `Edit(//<abs>/**)` **binds**. A Write attempt into a denied reference folder
  is refused and the file is left untouched, even under
  `--dangerously-skip-permissions`. Deny wins over allow.
- `Write(//<abs>/**)` is **not a valid rule**. The CLI rejects it out loud:
  "not matched by file permission checks — only Edit(path) rules are ...
  Edit rules cover all file-editing tools." So only Edit rules are emitted, and
  the `Write` / `NotebookEdit` patterns this spec originally called for would
  have been silently inert.
- Repeated `--add-dir` flags **accumulate** rather than overwrite, so ours
  coexist with the one agentex already pushes for the skills dir
  (`providers/claude/session.ts:199`).
- **Bash is not covered by Edit rules.** A shell redirect could still write into
  a reference folder. This is a guard, not a sandbox, which is exactly why the
  prompt says not to modify these folders and why the settings copy says
  "an instruction plus a tool filter that blocks the editing tools, not an OS
  sandbox."

**Delivery is not uniform across providers, and the gap is bigger than this
spec originally assumed.** `instructionsFile` is read in agentex's
`providers/<p>/session.ts` for claude, codex and pi, but only in `execute.ts`
(the one-shot path) for cursor and opencode. Flow always goes through
`createSession`, so on cursor and opencode the field is silently dropped.

| Flow harness | delivery | what the agent gets |
|---|---|---|
| claude | `full` | prompt block, `--add-dir`, `Edit(...)` deny rules |
| codex | `prompt-only` | prompt block, no tool-level fence |
| cursor | `unsupported` | **nothing** |
| opencode | `unsupported` | **nothing** |

`referenceFolderProviderWiring` returns that three-way verdict, split out of
the adapter so it is testable without standing up a session. `unsupported`
logs that the folders were configured but **not delivered**, rather than the
reassuring partial-degradation warning an earlier version emitted — on those
harnesses the agent never learns the folders exist, which is the whole feature.
A regression test pins the classification.

Revisit whenever agentex grows session-scoped instructions for the rest.

The UI copy must not promise more than this delivers. "Read-only" in the
subtitle, and a one-line note in the section that the guard is an instruction
plus a tool filter, not an OS sandbox.

## 8. `@alias` in the mention picker

`src/components/chat/editor/mention-menu/types.ts` already discriminates four
kinds and section-renders. Add a fifth:

```ts
export interface ReferenceFolderMentionItem {
  kind: 'reference';
  id: string;
  alias: string;
  absolutePath: string;
}
```

Two-step behavior:

- Typing `@back` offers `backend` under a "Reference folders" section.
- Selecting it **retargets the file picker into that folder**, so
  `@backend/src/routes/` resolves. This is the ergonomic payoff and it falls
  out of the existing suggestion plumbing rather than needing new machinery.

**How the drill-down actually works.** Selecting a reference inserts no chip.
It rewrites the composer text to `@<alias>/`, which leaves Tiptap's suggestion
active and re-runs `items` with a query the parser recognizes. Typing
`@backend/` by hand lands in exactly the same state, so there is no hidden
picker mode to get out of sync — the query string *is* the state.

Two things made this cheap, both verified against `@tiptap/suggestion@3.21.0`:
`items` may be async (the plugin awaits it), and it only re-runs when the query
changes. So the reference's file list is fetched inside `items`, once per
drill-down rather than once per render, with no forced re-render needed when
the data lands.

Inside a drill-down that reference's files lead, but worktree matches still
follow underneath: an alias sharing a name with a real folder must not make
that folder unreachable. Reference files are scored on the `alias/relative`
label rather than the absolute path, so a user whose home directory is
`/Users/api` doesn't get spurious hits on every file.

Ranking lives in `mention-menu/ranking.ts`, split out of `extension.ts` so the
ordering rules are testable without loading Tiptap or React.

Serialization: the chip stores the **absolute path** and renders the label as
`backend/src/routes`. Absolute is unambiguous for the agent and needs no
prompt-side expansion. Pretty label keeps the transcript readable. Reference
chips do not offer click-to-open, since the file viewer only resolves paths
inside the worktree and a click that silently does nothing is worse than none.

Tree data needs a new route, since `/api/sessions/[id]/tree` is worktree-scoped:

```
GET /api/reference-folders/:id/tree
GET /api/sessions/:id/reference-folders   (the picker's list, session-scoped
                                           like the sibling `picker` route)
```

**This does not reuse `listTree`, and the reason matters.** `listTree` needs an
agentex `Workspace` handle, and `workspace.open()` *throws* on a git folder
that carries no agentex worktree metadata (`.git/info/agentex.json`) unless the
caller supplies a `baseBranch`. A reference folder is somebody else's checkout,
so it has neither, and inventing a base branch for it would be fabricating
state. `listTreeGit` would then run `git status` and stat every changed file to
attach flags this surface explicitly does not want.

So `src/lib/reference-folders/tree.ts` does a smaller read: `git ls-files
--cached --others --exclude-standard` when the folder is a repo (gitignore
aware, tracked plus untracked), a pruned directory walk when it is not.
Symlinks are not followed, so a link cannot walk the listing out of the folder
the user pointed at. Both paths are strictly read-only, which matters more here
than code reuse — a test asserts the folder is byte-identical afterwards and
that no `agentex.json` appears. Capped at 20k entries with the truncation
reported rather than silent.

## 9. UI

New `src/components/workspaces/reference-folders-section.tsx`, mounted in
`workspace-settings-sheet.tsx` next to `files-to-copy-section.tsx` and
`worktree-scripts-section.tsx`.

Per row: alias, resolved path, description, live git state, and a broken badge
when the path is missing. Add flow is a small dialog with a mode toggle:

- **Pick a workspace** from a select, or
- **Pick a folder** using the existing `folder-picker-dialog.tsx`.

Then alias, prefilled from the folder or workspace name and slugified, so the
common case is pick-a-folder-and-confirm. Description is optional, with
placeholder copy that pushes for *why you would look there* rather than what it
is, since that is the only version worth typing.

A "visible in every workspace" toggle writes `workspaceId: null`. Global rows
render in every workspace's list with a marker and are editable from any of
them.

Use semantic design tokens throughout. No raw Tailwind palette.

## 10. Orchestrator actions

`src/lib/orchestrator/registry.ts`, alongside the existing workspace actions:

- `list_reference_folders` (`workspaceId` optional, omitted lists global)
- `create_reference_folder`
- `update_reference_folder`
- `archive_reference_folder`

All dispatch through `queries.ts`. Throw `ActionError` with
`not_found | invalid_params | conflict`, never raw `Error`. `create` must be
safe under retry, so a repeated create with the same scope and alias is a
`conflict` rather than a duplicate row.

Path validation branches on `ctx.remote`: a trusted local CLI call may pass any
absolute path, an untrusted HTTP call may not, since arbitrary-path reads from
a remote caller is a disclosure vector.

## 11. Edge cases

- **Alias collides between global and workspace.** Workspace wins. Warn in the
  UI when adding a workspace alias that shadows a global one.
- **Reference points at its own workspace.** Reject at create time.
- **Two references resolve to the same path under different aliases.** Allowed.
  Harmless, and blocking it is more annoying than the duplication.
- **Path is inside the workspace's own cwd.** Allowed but flagged in the UI,
  since it is redundant with the working directory.
- **Target workspace archived.** Reference still resolves. Archiving a
  workspace is not a statement about its folder.
- **Path disappears.** Renders broken, omitted from the prompt, never
  auto-deleted.
- **Huge folder.** No traversal at prompt-build time, only at `@` drill-down,
  where `listTree` already prunes `node_modules`, `.next`, and friends.
- **Nested references.** Not followed. One level only.

Found while building Phase 2:

- **An alias shares a name with a real worktree folder.** Both are offered.
  The reference's files lead (the user typed the alias) and worktree matches
  follow under their own header, so neither becomes unreachable.
- **A reference folder is a symlink farm.** The walk does not follow symlinks,
  so a link cannot pull the listing outside the folder that was pointed at.
- **A reference is an enormous monorepo.** Listing caps at 20k entries and logs
  the truncation, rather than silently implying the repo is small.
- **The tree fetch fails mid-keystroke.** The picker degrades to worktree-only
  matches instead of emptying or throwing.
- **A drill-down into a broken reference.** The route returns an empty list
  rather than a 404, so the composer shows "no matches" instead of erroring.
- **The reverse reference collides.** "Also reference back" reports the mirror
  failure separately, since the forward reference is already saved and calling
  the whole thing failed would be wrong.

## 12. Tests

- `resolve.test.ts`: both target kinds, missing path, archived target
  workspace, git state parsing, global versus workspace precedence.
- `reference-folders.test.ts` (prompt renderer): empty list renders nothing,
  broken paths omitted, git line present and absent, description present and
  absent, ordering by `position`.
- `adapter` test: `--add-dir` present for Claude, absent for other providers,
  and absent when the workspace has no references.
- Query-layer test: alias uniqueness per scope, cascade on both workspace FKs,
  exactly-one-of rejection.
- Route test for `GET /api/reference-folders/:id/tree`, including a bare
  non-git folder.

As built: **96 tests across 7 files.**

- `queries.reference-folders.test.ts` (26) — alias scoping, cascades,
  exactly-one-of at both the query and CHECK layers, backlinks, `~`/relative
  path normalization, and the write whitelist.
- `resolve.test.ts` (17) — both target kinds, missing and non-directory paths,
  real git branch/dirty/drift/detached parsing, precedence.
- `session-config.test.ts` (8) — argv and deny-rule shape per provider.
- `prompts/reference-folders.test.ts` (13) — block rendering.
- `mention-menu/ranking.test.ts` (20) — drill-down parsing, chip
  serialization, section ordering, the name-clash and absolute-path-scoring
  cases.
- `reference-folders/tree.test.ts` (10) — gitignore honoured, heavy dirs
  pruned, symlinks not followed, unreadable subtree survived, and an assertion
  that listing **never writes** to the folder.
- `api/reference-folders/[id]/tree/route.test.ts` (5) — git and bare folders,
  broken reference returns empty rather than erroring.

The adapter's argv gating is covered through `referenceFolderProviderWiring`
rather than by booting a session.

## 13. Tasks

### Phase 1 — the feature (ship and use before doing Phase 2)

- [x] Add `referenceFolders` to `src/lib/db/schema.ts` with both partial unique
      indexes and the exactly-one-of check.
- [x] `pnpm db:generate`, review the emitted SQL, apply with `pnpm db:push`.
      **The CHECK survived codegen intact** (`drizzle/0008_marvelous_madame_web.sql`)
      and is covered by a test that inserts through Drizzle directly, bypassing
      the query layer.
- [x] Derive types in `src/db/types.ts` from the schema. Do not hand-write.
- [x] Query functions in `src/lib/db/queries.ts`: list (workspace + global,
      workspace wins on alias), get, create, update, archive. Typed
      `ReferenceFolderError` carries the stable codes to both transports.
- [x] `src/lib/reference-folders/resolve.ts` with git-state probe and a
      short-lived cache.
- [x] `src/lib/executor/prompts/reference-folders.ts` renderer.
- [x] Wire into `adapter.ts`, gated to `sessionType === 'execution'`. Uses
      `instructionsFile` rather than `--append-system-prompt` — see §6.
- [x] Push `--add-dir` per reference for Claude. Warn once on other providers.
- [x] Investigate `disallowedTools` path patterns against the installed Claude
      Code version. **They bind, but only as `Edit(...)` rules** — findings
      recorded in §7 and reflected in the settings copy.
- [x] `reference-folders-section.tsx` plus the add dialog, reusing
      `folder-picker-dialog.tsx`.
- [x] Mount in `workspace-settings-sheet.tsx`.
- [x] Orchestrator actions and their `ActionError` handling.
- [x] Tests from §12 that cover Phase 1 surface area (50 tests across 4 files).
- [x] `pnpm ts`, plus `pnpm smoke:boot` since the registry gained an import.

### Phase 2 — `@alias`

- [x] `ReferenceFolderMentionItem` in the mention types.
- [x] Section rendering and scoring, extracted into `mention-menu/ranking.ts`
      so it can be tested without Tiptap. The popup bands drill-down results
      under an `In @alias · read-only` header.
- [x] `GET /api/reference-folders/:id/tree`, plus
      `GET /api/sessions/:id/reference-folders` for the picker's list.
      **Does not reuse `listTree`** — see §8.
- [x] Drill-down retargeting so `@backend/src/routes/` resolves, driven purely
      off the query string with an async `items`.
- [x] Chip stores absolute path, renders pretty label, and skips click-to-open.
- [x] Tests (35 across ranking, tree, and the route).
- [x] `pnpm ts`.

### Phase 3

- [x] Reverse-reference backlinks in the UI ("Referenced by Frontend, Mobile"),
      backed by `listReferenceFoldersTargeting` and
      `GET /api/workspaces/:id/referenced-by`.
- [x] "Also reference back" toggle at create time, shown only when adding a
      workspace→workspace reference from a real workspace. The forward
      reference is saved first; a failure on the mirror is reported without
      implying the whole thing failed.
- [ ] **Blocked.** Swap the `--add-dir` argv passthrough for agentex's typed
      `additionalDirectories`. Confirmed absent from `ProviderConfig` in
      `@agentex/agent@0.0.34`, so there is nothing to swap to yet. §7 records
      the semantics that field should have if it gets added.

## 14. Open questions

1. ~~**Global references: ship in Phase 1 or defer?**~~ **Resolved: Phase 1.**
   The nullable `workspace_id` and the "visible in every workspace" toggle both
   ship together. A design system referenced by four frontends is the obvious
   second use case, and the alternative is entering it four times.
2. ~~**Does `description` stay required?**~~ **Resolved: optional.** Adding a
   reference should be one field. The prompt renderer omits the line when it is
   absent.
3. ~~**Should a reference appear in the file tree column?**~~ **Resolved: no.**
   Reference folders stay a prompt and `@` concern. Putting them in the tree
   invites treating them as editable, which is the opposite of the point.

No open questions remain. Ready to build on approval.
