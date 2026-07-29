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
