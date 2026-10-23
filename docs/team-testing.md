# Testing personal and team Homes

Use disposable Homes through `pnpm iso`, with distinct ports. Never run this acceptance guide against the owner's only copy of team data, restart production or reset a real Home. Use a unique test prefix and keep the returned canonical IDs. The [verification ledger](unified-home-verification.md) separates browser/data fixtures, actual native binaries and live provider qualification.

## Execution and authority

| Path | Where work runs | What it can use |
| --- | --- | --- |
| Personal chat with a connected team | Its selected personal agent, harness and account | Existing membership through `list_homes` and explicit `target_home_id`, with no second MCP key or required import |
| Shared task → Work with agent → personal destination | The selected personal environment | Private conversation and planning. Publish result explicitly selects shared output |
| Team-owned agent/chat | The Team server, ordinary local runner and harness | Owner-configured folder and shared server sign-in. Active Team members can read and control its work |
| Retained legacy team chat | Readable history, bound to an ordinary Team agent on its next accepted send | Existing IDs and authors remain. Pending legacy turns never replay |
| Named external MCP client | The client's own model and runtime | The existing member-bound content tool allowlist, independent revocation and no team execution/admin bypass |

Tasks, notes, manual rank, Areas and membership work with Team AI off. A native Teams connection supports full-team browsing, personal references and authorized native agent operations. A separate MCP connection is needed only for a separately authorized external client.

## 1. Personal and standalone use without AI

Open a personal Home with no teams. Verify Tasks List/Board, Notes, Deck, existing agents/chats, settings and shortcuts retain their behavior. Keep private data private.

Create a disposable standalone team, add an owner and a member, and leave AI off. Create tasks in every lifecycle state and notes with attachments. Use duplicate titles, one task assigned to each person and one unassigned task. Both people can browse all shared records, edit and archive them, filter Areas and use search. Only the owner can permanently delete or administer membership. No personal Home, model, provider account, agent name or MCP setup is required.

At 390px and on desktop, verify action bars, menus, close controls and settings remain reachable. On a Mac desktop window, all sheets clear the native drag bar. Standalone team members have no fictitious My Ri destination.

## 2. Connect once and browse all work

Sign into the team as the existing member. Choose **Settings → Your access → Connect to My Ri**, then paste the short-lived link into personal **Settings → Teams**. Reconnecting yourself uses this flow, not a new invitation. Verify the member count does not change.

Use the Home selector to open the team. Tasks opens the common task surface with List and Board. Clear Assigned to me and Area filters to see unassigned tasks and work assigned to other members. Assignment determines personal automatic inclusion, not permission to browse.

In personal Tasks, choose **Source → the team** and **All** or **Todo**. This is imported personal work, with a direct Browse all team tasks action. Assigned tasks enter automatically. Add an unassigned task to personal work without changing its assignee, and save a note reference. Repeated add, reconnect and sync must retain one reference. Check freshness, offline/error state and Retry rather than treating a failed refresh as an authoritative empty list.

## 3. Private rank and Area organization

Reorder an imported task among personal tasks, and separately reorder the canonical team task. Sync again. Personal and team order must stay independent. A new import is unranked and cannot modify a saved Deck.

In a mixed view, source labels read **Team • source Area**, while the private Area remains separate under Only you. Rename the team and source Area and verify IDs/references do not change. Check lists, board cards, details and Deck context, including missing Areas and same-name teams.

In personal **Settings → Teams → the team**, set an optional whole-team Area default and a more specific source-Area rule. The specific rule wins for a new task or saved note. A later source edit or rule change must preserve a private selection or deliberate clear. Preview the count and scope before applying a default to existing unorganized references. Legacy choices and deliberate clears must not be silently preselected. Archive/delete a destination Area, remove a source Area and reconnect the same team to verify safe inactive rules and stable private identity. No rule data belongs in team APIs or shared history.

## 4. Native personal agent access

Start a fresh ordinary personal chat. Ask it to discover connected Homes, select the team's stable ID, list members and read five canonical tasks. This uses the existing Teams connection, not a second MCP key. Reads must not import those records.

Using only disposable records, ask it to create an unassigned task and note, read them by canonical ID, edit with the current body revision, assign the task and complete/archive it. Verify AI/member authorship and one result per idempotency key. Retry an acknowledged request and an unknown outcome without making duplicates.

Create the same title in another Home and reuse an ID in an isolated fixture. The explicit destination must control the write. Ambiguous Home names require clarification. Disconnect or revoke the membership, then retry. A failed team operation must never fall back to writing personal data.

## 5. Work on shared tasks and publish deliberately

From the team task inside personal Ri, choose **Work with agent** directly. Select the configured personal agent, harness and model. Where both personal and team destinations are available, review where work runs and who can read it. Cancelling the launcher starts nothing. Cancelling a prepared launch removes a newly created, still-pristine reference. Existing references are reused without changing assignment or added-work provenance. A failed/retried launch must not create duplicate references or chats.

Starting personal work does not change shared lifecycle status or publish the conversation. Keep drafting in the personal chat or private planning field. Use **Publish result** to select a summary, links or files and review the named team audience. Verify only that selection appears on the team. Shared title/body edits remain shared immediately. Complete the task only through an explicit lifecycle action.

## 6. Team-owned agents, saved chats and results

Team agents run on the Team Home's server through the ordinary local runner. Sign in to an installed harness using the existing Settings flow. The sign-in step says "Everyone on the team uses this sign-in." Create a team agent using an owner-chosen folder on that server. There is no separate container or restricted Claude engine.

Treat members as trusted users of this machine and OS account. The desktop "Hosted on this computer" flow records whether a personal Ri shares this OS user, including a custom personal root. Successful Home startup records its canonical root and kind in a per-OS-user registry. Server checks combine that registry with default personal/dev locations and the desktop creation record, using file metadata only. Custom roots started after Team creation are discovered on the next check. A historical custom root never started by this version and never recorded by desktop cannot be discovered by scanning arbitrary disk locations. Turning on AI and creating an agent show the owner a non-blocking warning about access to files, personal Ri and signed-in accounts, including GitHub. Open PR, merge and GitHub lists use the Team server’s existing gh account consistently. [Deferred isolation](team-isolation.md) records the accepted risk and preserved archive.

An active member without a personal Home starts an ordinary chat. Another member continues it. Verify creator and per-turn requester, concurrent message serialization, results, files, Git and preview. Any member can stop a turn, cancel a queued message, answer a question, approve or deny a permission prompt and archive or close a chat. Only a signed-in person can answer or approve. Agent/session and external AI credentials must fail that operation. Members may edit AGENTS.md and open an agent terminal without a chat. The Files activity log attributes manual edits and terminal opens to members. Agent configuration and sign-ins remain owner-only.

Remove the requesting member, revoke the requesting sign-in or turn AI off. Queued/running work must stop or refuse further dispatch. Restart an interrupted turn and verify no accepted or completed request replays. The ordinary native binding remains fixed to its Team Home across stop, continuation and restart.

Use two members to verify private conversation selection. New and Resume select a shared conversation only for the person choosing it. With no selection, opening Chat stays at the start view. Another member's newer activity must not replace an open conversation after refocus or reload. Open a different Ask conversation by link while another chat is saved as current. Files, Terminal and Preview must retain the viewed chat across reload. New and model changes copy that viewed chat’s settings. A missing chat shows inline Retry while the sidebar remains available. A helper launched in Plan only from Ask must return to Ask when a person approves its plan.

Leave a background task running, then queue another member's message. Stop the task through its normal control and verify the queue progresses. Restart closes the old harness before another send. Turn AI off, remove a member or revoke a sign-in and verify their background/self-started work closes as well. Archive a dirty worktree without force and verify the refusal leaves running and queued work untouched. An unconfirmed close must leave Archive retryable, with active state preserved. A late dirty write during close preserves queued work and wakes the queue after refusal. Reject personal sends during teardown. Verify Archive, Restart and AI-off recover a root that exited before process recording, while a live unidentified PID remains blocked. Personal remote Restart and Close chat accept a queued stop and retain the retrospective label.

Existing restricted chats keep IDs, authors, cursors, links and history. At upgrade their queued work is cancelled and running work interrupted with a reason. With exactly one active configured agent, the next send binds the same chat automatically. Otherwise choose through the normal launcher. Without an agent the history stays readable. An unknown creator stays unknown. The old encrypted API key stays saved and unused until the owner explicitly removes it.

## 7. Optional external MCP clients

An invited person joins once, then opens **Settings → MCP access → Create MCP connection** and chooses the client preset. The optional label names a separately revocable client, not another member. Store the one-time token in the client's secret field. Existing `external-ai` settings links continue to resolve.

Read/create/edit/assign/complete/archive disposable shared records through `/api/team/mcp`, using canonical IDs, body revisions and idempotency keys. This works with the team's built-in AI off. Permanent deletion and native team execution are outside the external content allowlist, including for an owner's client.

Revoke one MCP client and verify its next operation fails, while another client and the native Teams connection still work. Removing the membership revokes all its future access. Never put reusable tokens in chat messages.

## Automated checks

The final implementation's [review map](unified-home-review.md) links shared code, forward migrations, durable captures and verification limits. `src/lib/spaces/unified-acceptance.test.ts` is the reusable populated two-Home baseline. `desktop/team-smoke.ts --production` exercises actual Electron against the built Next app, including a Team-only window, settings, task/note action bars and relaunch. `--personal --production` verifies that creating a Team leaves the existing personal Home, draft, navigation and service intact. These commands create and stop only their disposable Homes. They do not qualify live provider accounts or restart production.

```sh
pnpm iso /private/tmp/ri-unified-review --init --port 42831 -- pnpm ts
pnpm iso /private/tmp/ri-unified-review --port 42831 -- pnpm exec vitest run src/lib/spaces src/lib/team src/lib/home src/lib/sessions src/lib/work-results
pnpm iso /private/tmp/ri-unified-review --port 42831 -- env RI_SPACES_BROWSER_TEST=1 RI_REVIEW_CHROMIUM='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' pnpm exec vitest run src/components/team
pnpm iso /private/tmp/ri-unified-review-electron -- env RI_TEAM_NAV_ELECTRON=1 pnpm exec vitest run --config desktop/vitest.config.ts
pnpm iso /private/tmp/ri-unified-review-desktop-build -- env RI_DESKTOP_ROOT=/private/tmp/ri-unified-review-desktop-build pnpm exec node desktop/launch.mjs --build-only
pnpm iso /private/tmp/ri-unified-review-desktop -- pnpm desktop:team-smoke --production
pnpm iso /private/tmp/ri-unified-review-personal-desktop -- pnpm desktop:team-smoke --personal --production
```

Desktop production mode requires its own `.next-desktop` build, as above. Build the ordinary production app with `pnpm iso /private/tmp/ri-unified-build -- pnpm build`. The immutable verifier supplies the required detached-main path and all opt-ins. See [review10](unified-home-review10.md) for current regressions and evidence limits, and [review3](unified-home-review3.md) for gated-suite accounting.

The current execution journey uses a fake harness through the ordinary runner. It proves policy and lifecycle, without authorizing real accounts or claiming native provider qualification. Browser fixtures do not qualify an Electron bridge or a live provider subscription. Exact commands, commits, results and remaining acceptance work belong in the verification ledger.


### Shared skills and server apps

With AI off, open Skills from Team settings. Owners manage installed Team skills through the shared skill manager. Members inspect the same Team catalog. Private/global personal skills are excluded from Team app tools.

Configure an agent's start command as owner. Opening Preview starts nothing. Run starts one ordinary server process and shows its shared output. Stop and Restart use the common supervisor. Paste a reachable URL and verify the iframe refuses Ri's own origin, URL credentials and non-HTTP schemes. Check both 390px and desktop layouts. Remote Team viewers never gain the personal desktop bridge.

### Evidence categories

The final-source ledger records the commit, exact commands, exit status, counts and limits. Browser checks use Brave via Playwright’s Chromium transport, real components and CSS, and fixture data adapters. Electron history checks bundle the actual sandboxed preload and use CDP key/mouse dispatch and a menu callback. They do not claim physical input, a signed release, or real provider entitlement. No Docker operation is part of this revision.

### Sixth-review recovery and offline checks

With an uncached agent chat, go offline before opening it. The pending view must show offline recovery, with no new-conversation composer. Reconnect and verify the same current chat opens. Fail a background refresh with a chat already loaded and verify the transcript stays mounted with Retry. A failed History Resume shows its reason and retains selection. The main chat has Restart, preserving history while closing its harness.

Automated tests cover actual agentex shutdown escalation using controlled Node CLIs, signed Team CLI success/forged/expired refusal, real MCP/HTTP alias admission, concurrent launch receipts and final teardown-script refusal. The GitHub account notice is visible to ordinary members on dedicated servers with AI on or off. Known sending chats retain their message attribution. These tests use disposable Homes and no real accounts.


Recovery checks: while an idle harness is closing, send the next member request
and require one successful turn after close. A settings recycle followed by
Archive must confirm shutdown before removing the worktree. Check Cursor with
its exec launcher and detached tool, not only a direct Node stand-in. Failed
agent/session reads must show Retry, offline reads must not create another chat,
and background refresh must retain the exact mounted composer and draft with
one notice. Healthy idle and first-run screens have no Restart row. Running or
failed-close main chats expose Restart chat. A native MCP launch using
permission_mode, harness and task_id must retain those choices, and unknown or
conflicting fields must refuse without a child. A JSON-only signed CLI get_task
must work. A failed-first-send retry must retain its original intent. These
checks are automated in the review7 ledger and are rerun by the full suite.


Settings saves that cannot recycle an idle harness still save the changes. Open
that chat to see its Restart recovery notice. No new send uses the stale handle
until confirmed Restart succeeds. New and History Resume failures retain the
viewed conversation and refresh this recovery state. The native Linux subreaper
tests run only on Linux with Python 3. A macOS pass qualifies the identity and
cleanup fixtures, not the Linux kernel probes.


Review9 adds these checks to the shared paths:

- On a fresh Team board, Done is visible along with Consider, Todo and In
  progress. Agent activity and chat links remain available. Change columns,
  reload, then change viewer or Home and verify the choice stays scoped.
- While a member works, owner settings edits still interrupt that work and
  cancel queued turns. Settings remain saved even when shutdown fails. Only
  the affected chat blocks further sends until Restart confirms cleanup.
- A task, note or skill chat with an unconfirmed close exposes Restart beside
  its explanation. Successful Restart shows feedback and clears the control
  error. A successful message Retry removes stale Restart recovery. An unsent
  failed message stays available for Retry after Restart.
- A readable leftover record names the actual surviving process by PID and
  executable, without exposing command arguments. The server owner inspects
  it. Once it exits, Restart checks again and clears recovery. Other chats
  continue normally. Corrupt or unreadable recovery state still disables AI
  for the Home, while tasks and notes remain usable.
- A connection decision whose notification cannot run is saved visibly with
  its full note and recovery explanation. Restart does not replay it as
  unexpected new work. The next human message supplies the saved context exactly once, acknowledged through native input acceptance.

Main's model menu and speeds retain Team permissions: members select enabled
models and speeds for shared work, while host catalog/default administration
remains owner-only. Speed preferences stay scoped by Home and viewer.

Main migrations 0000–0023 remain unchanged. Migration 0024_breezy_rawhide_kid is generated by drizzle-kit for the remaining refactor schema delta. The owner explicitly authorized retiring the unapplied branch history. Populated personal/Team rehearsals cover main 0018, 0019, 0020, 0021 and 0023, retaining original receipts, rowids, FTS, foreign keys and sealed credentials. No production Home was inspected or migrated.
