# Execution launcher — known gaps

Deliberate omissions in the launcher (the ➕ modal on a workspace row), recorded
so they're a decision rather than a surprise. Each entry says what's missing,
why it wasn't fixed, and what fixing it would actually take.

_Last reviewed: 2026-07-29_

## Import lists repo-root transcripts only

`use-launch-sources.ts` matches a discovered project to the current workspace by
exact path equality (`project.cwd === workspace.cwd`). Transcripts recorded
inside a **worktree** are therefore never offered, even though discovery finds
them:

```
/Users/…/startups/insiderfinance                      ← listed (47 sessions)
/Users/…/conductor/workspaces/insiderfinance/berlin   ← not listed
/Users/…/flow/.work/worktrees/insiderfinance/…-7e1c20 ← not listed
```

Since agents in this app run in worktrees, a meaningful share of history is
invisible in the launcher. It is still reachable from **Settings → Imports**,
which lists every project without workspace scoping.

**Why it's unfixed.** The obvious identity checks don't hold:

- *Resolve the repo with git.* Worktree directories are removed when their
  execution is archived, so the path no longer exists to interrogate.
- *Use `prRepository` from the transcript.* Durable and survives deletion, but
  present in only ~14 of 325 local transcripts (~4%) — it's written when a PR
  was involved, not routinely.
- *Match on the repo's directory name appearing as a path segment.* Works for
  the Conductor layout, but false-positives across repos that share a basename.

**What fixing it takes.** Rank instead of filter: put paths we can attribute
confidently first (the workspace `cwd`, plus worktree paths recorded on
`executions.worktree_path`), then everything else below with its path visible,
so nothing is hidden. Pair it with widening `ensureImportWorkspace`
(`src/lib/import/external-agents.ts`), which uses the same equality to decide
where an imported session lands — left as-is, surfacing a worktree session would
import it into a **new workspace named after the worktree** rather than the
repo's existing one.

## Chat search reaches less than it appears to

`chat_events_fts` indexes only events with `source IN ('user','agent')` and
non-empty content. One real workspace had 8,285 events but 50 indexed rows —
the rest were `system` (7,705), tool calls, thinking and results. Searching
therefore covers what you and the agent *said*, not what the agent *did*.

The launcher now lists recent chats when no query is typed, and says so in the
empty state, so the group no longer reads as broken. Widening the index (tool
summaries, thinking) is the actual fix and hasn't been done.

## Fixed: imported chats were invisible after arriving

Recorded here because the shape of the bug is worth remembering. Importing
landed every session as `status: 'archived'` on both the chat and its execution.
Archived work is absent from the workspace tree and from every active-only list,
including this panel's own "Recent chats", so a folder with seven imported
transcripts showed **zero** rows and an Import tab that said everything was
already imported. Both statements were true and the reader was still stuck: the
only route back was FTS search, which happens to span both statuses, and you had
to already know a keyword.

Imports land `active` now (`createImportSkeleton`), `pnpm unarchive:imports`
backfills rows created before that, and the Chats tab has a **Show archived**
toggle for deliberately-filed work. Two things made the original state easy to
miss and are worth guarding:

- `listWorkspaceExecutions` filters status in *two* places — the execution and
  the newest-chat subquery. Relaxing one alone yields a join that matches
  nothing, which is indistinguishable from the flag not working.
  `queries.workspace-executions.test.ts` covers it.
- `SetupCard` inferred "provisioning" from `!worktreePath`. An import never has
  a worktree, so an active one rendered "creating worktree…" with a live elapsed
  counter forever. It now branches on `surfaceKind === 'imported_agent'` and
  states where the transcript ran instead of inventing a fork point.

## A settled import is deliberately absent from the by-status rail

Imports land `active` so they're visible in the workspace tree. That put them in
`classifySession`'s reach, where the only bucket they could land in is
`waiting` — rendered as **"Waiting response"** with a clock icon. A finished
Codex chat from March is waiting on nothing, and importing is a bulk action:
onboarding's fourth step *is* the import panel, it offers per-project
select-all, `MAX_IMPORT_SELECTION` is 1,000, and `listRailSessions` has no
LIMIT. Measured on a real home, a 24-chat import put **14** rows under "Waiting
response" — enough to bury the one row that needed a human, and a 300-chat
import is the same action with a bigger number.

`classifySession` now returns `BucketId | null`, and a settled import gets
`null`. The exclusion sits *after* the pending/streaming/unread checks on
purpose, so an import re-enters the rail the moment it becomes live work: a sync
that pulls in new messages makes it `unread`, continuing the chat makes it
`working` or `needsApproval`. It stays in the workspace tree and in search the
whole time, because those read `listWorkspaceExecutions` and the FTS index and
never consult a bucket.

Both readers (`status-view.tsx`, `rail-status-pills.tsx`) skip nulls, which is
load-bearing: they share `classifySession` specifically so the HUD pill counts
match the rail body row for row, and one of them ignoring the null would break
that. `status-view` also counts bucketed rows rather than raw sessions for its
empty state, or a home whose only active sessions are imports would render four
zero-count headers instead of "No active sessions yet."

## An imported chat never catches up on its own

An import snapshots the transcript as it stood. If the provider session later
continues, the new messages land on disk and nothing pulls them in:

```
~/.codex/…/rollout-…-019f8c04-….jsonl   27,051,693 bytes on disk
external_session_imports.sync_offset     5,549,771 synced  ← 79% missing
```

That is a real case from a real home (a beamd Codex chat). 452 events were in
the DB, 4,214 were on disk, and search for a phrase from the newest message
returned nothing — search was working correctly against a transcript that was
four fifths absent.

Detection already works: every discovery scan re-fingerprints the file and flips
the ledger to `changed`, and **Settings → Imports** renders that as "Updates
found" with a Sync button that does catch up (3,762 events for the chat above).
The gap is purely that nothing fires it for you. Two paths that look like they
would, and don't:

- **Opening the chat.** `useSessionReconcile` runs on mount, but
  `reconcileSession` returns early unless `chat_sessions.external_session_id` is
  set, and an import leaves that column NULL — the provider id lives on the
  ledger row instead. So the one action a user would expect to refresh a chat
  is a guaranteed no-op for imports.
- **The launcher's Import tab.** It only lists `imported: false` candidates, so
  a chat with 21 MB pending is filtered out as "already imported".

**What fixing it takes.** Deciding *when*, which is the actual design question,
not the plumbing (`synchronizeCandidate` already handles incremental catch-up
from an offset). Candidates: sync on open for imported sessions, keyed off the
ledger rather than the empty column; sync the `changed` set on a schedule; or
surface a count in the launcher so the tab stops claiming everything is current.
Note `MAX_STAGED_HISTORY_BYTES` is 25 MB, so a *full* resync of a transcript
larger than that throws `history_resync_limit` — incremental is under the cap,
which makes "never let the offset go stale" the cheaper policy.

## Only what you and the agent said is searchable, even after a sync

Related but separate from the FTS gap above, and worth stating in numbers: after
the sync described above, that chat held 4,214 events of which **315** are in
`chat_events_fts`. The rest are `tool_call` (1,738), `tool_result` (1,738) and
`result` rows, which the insert trigger skips by design.

## OpenCode import needs the CLI on PATH

Discovery reports OpenCode `available: false` when the `opencode` binary isn't
found, even when `~/.local/share/opencode` holds readable history. Uninstalling
the CLI makes existing transcripts unimportable. Claude and Codex are unaffected.

## Cursor has no importer

`ExternalAgentSource` is `'claude' | 'codex' | 'opencode'`. The app can *run*
Cursor as a harness, so the asymmetry is real: you can drive it but not pull its
history in. Adding it means writing a reader for Cursor's transcript format.

## Jira and Asana are unverified against live accounts

Both are wired into `src/lib/connectors/task-sources.ts` with defaults that need
no user input (Jira: `assignee = currentUser() AND statusCategory != Done`;
Asana: resolve a workspace gid first, then list). Neither has been exercised
against a real connection — the mappers are written against each toolkit's
declared output shape, not an observed payload. Todoist looked equally correct
on paper and was returning `410 Gone` from a sunset endpoint until it was fixed.
Treat the first real result from either as unverified.
