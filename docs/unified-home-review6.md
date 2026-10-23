# Sixth review corrections

Reviewed source: `68c52639`. Continue on `refactor/unified-home-experience`.
Published and installed agentex is `0.0.47`. The shutdown findings reproduced
with the actual SDK and disposable stand-in CLIs despite that upgrade.
Current main `37166859` adds notification changes beyond the previously merged
`1133959c` and is incorporated before final qualification. HUD `acae188a` is
preserved. No migration changes. Released 0000–0021 artifacts remain immutable.
No production access, restart, Docker, deployment, push or merge to main.

Checked implementation items require focused verification. The final delivery
separately requires all 13 gates at a clean committed HEAD, with
`sourceUnchanged: true` and `allPassed: true` in the external manifest.

- [x] B1/B5: shutdown headroom, one SDK close across retries, recorded process confirmation for every harness, and main-chat recovery.
- [x] B2: distinguish offline/pending main-chat reads from an explicit empty server response.
- [x] B3: signed Team session CLI reaches the same authorized operations as MCP.
- [x] B4: undeclared Home/Team/Space destination fields refuse before effects.
- [x] S1: cached chats survive background refresh failure, with Retry and a working destination chooser.
- [x] S2: final worktree teardown refusal preserves member queue and accurate outcomes.
- [x] S3: launch validation, concurrent idempotency and accepted receipt replay after archive.
- [x] S4: stable launch/Resume errors and visible History failures.
- [x] S5: published MCP schemas and Team alias compatibility.
- [x] S6: typed workspace invalidation in launch/import paths.
- [x] D1/D2: disclose the server GitHub account on dedicated servers and retain disclosed sending-chat attribution under the accepted OS-account boundary.
- [x] E1: realistic SDK escalation/process regressions and stronger repair, label and sibling-stop evidence. Distinguish subprocess tests from in-process registration tests.
- [x] Reconcile original W00–W11 and all decisions. Commit and immutable-source gates remain the required final delivery qualification below.

## Finding-to-regression map

All test paths are under `src/`. Focused runs use disposable Homes. Final
qualification is determined by the external manifest for the delivered commit.

| Finding | Correction and evidence |
| --- | --- |
| B1/B5 | Common runner waits 10 seconds, beyond the SDK's EOF/TERM/KILL budget. A WeakMap retains the original pending SDK close Promise across wrapper timeouts and retries. A completed rejection permits a new attempt, with the same PID confirmation. Lifecycle PID records cover handles without `.proc`, retaining exact process identity and ownership checks. `runner/sdk-cursor-close.test.ts` exercises actual SDK escalation through personal Restart, sibling Close and main New. `runner/sdk-antigravity-close.test.ts` verifies the real SDK's recorded PID is dead before worktree removal. `runner/close-unrecorded.test.ts` checks delayed close/retry joins plus live-unrecorded refusal. The existing unconfirmed-close retry now asserts one SDK call. |
| B1 recovery | Main HarnessChatSession exposes the existing RestartMenuItem and hook. `components/chat/harness-chat-state.test.tsx` mounts the actual main-chat hooks and recovery control. |
| B2/S1 | Shared ChatLookupState distinguishes paused/pending reads from confirmed null. ChatRefreshNotice keeps cached transcript/editor positions stable. A failed destination can leave to Agents. `components/chat/harness-chat-state.test.tsx` checks personal, Team and pinned offline states, reconnect and explicit-null positive control. `components/team/team-chat-state.test.tsx` checks actual destination/navigation/hooks, main/execution refresh failure, stable mounted views, Retry and chooser. These are mounted linkedom tests with UI leaves stubbed. The explicit Brave gate retains actual AgentView navigation at phone and desktop widths. |
| B3 | Team-folder guard permits only a session CLI with credential and Home tools URL. The Home still verifies the live signed member turn. `team/team-session-cli.test.ts` launches the actual session CLI subprocess, verifies numeric receipt/JSON aliases/conflicts and refuses unsigned, forged and expired credentials with no writes. |
| B4 | Common destination admission rejects undeclared Home/Team/Space spellings before parsing can strip them. `orchestrator/mcp-destinations.test.ts` expands the mutation matrix across all five real MCP handlers, HTTP and CLI registration, with total-change and private-history controls. Personal CLI registration tests are in-process. Native separate-Home CLI evidence is provided by the existing native-access suite. |
| S2 | Execution-owned PTYs stop before teardown. Member queue withdrawal and archive outcomes happen only after actual worktree removal succeeds. `sessions/archive-teardown-dirty.test.ts` uses a real Git worktree and a teardown script that writes a file, then verifies refusal retains the execution and resumes the queued member turn without an archive reason. Initial and late dirty tests remain. Filesystem effects and OS shutdown are not one transaction. |
| S3/S4 | Shared availability preflight precedes child creation. Launch requests serialize by Home/member/agent/request ID. Existing message JSON stores an intent hash, without a schema change, so normalized effort matches retries and changed intent conflicts. Accepted receipts survive child archive and still recheck sender bounds. Legacy receipts keep their original contract. `sessions/team-launch-replay.test.ts` checks auth/model/task failures without child rows, four simultaneous launches, one turn, archive/replay and changed-intent refusal. Model/task errors have stable public codes. Resume maps domain failures; History displays the error, retains selection/menu and closes on success. Actual route and mounted History tests cover failure/retry. |
| S5 | HTTP and ri_team MCP use one alias/destination validation helper. `team/team-mcp-aliases.test.ts` calls both endpoints on an actual HTTP listener and checks identical writes/refusals. `mcp/registry-schema.test.ts` preserves the published empty get_handoff_context schema while runtime input stays strict. |
| S6 | Ordinary execution start, launcher and both import paths call invalidateWorkspaceViews, refreshing typed and legacy consumers together. Existing mounted `hooks/use-work-view-invalidation.test.tsx` covers common invalidation behavior and per-chat scope. |
| D1/D2 | Ordinary members see the Team server GitHub-account notice even on dedicated servers and with AI off, checked in `components/team/team-ai-settings.test.ts`. The shared member-message adapter now forwards verified session identity into stored events and the ordinary sender label. `trpc/team-ws-agent.test.ts` uses a real WebSocket/appRouter, checks the delivered prompt and stored sender, with a human-message control. This does not create OS-account isolation or make terminal/Git controls person-only. |
| E1 | `cli/commands/agent-declaration.test.ts` runs actual doctor/update subprocesses against populated Team fixtures with bad version/permissions and a read-only service-controller fixture, checks unchanged data and refused Home actions. `sessions/personal-remote-stop.test.ts` uses real retrospective label logic, checks exact remote label commands and separate sibling stops, plus a local generation seam to avoid account-backed calls. HTTP/WS listeners, subprocesses, in-process registration and mounted component tests are named separately. |

## Personal close policy and remaining limits

Personal shutdown previously proceeded best effort on main. This branch's
confirmed-close policy is a real behavior change, not merely fixture alignment.
The correction waits through the SDK's full default shutdown budget, rechecks
recorded processes and provides an explicit main-chat recovery control.
A known live process must never lose its worktree. Unknown handles whose close
cannot confirm remain retryable. Team shutdown remains fail closed.

GitHub controls consistently use the Team server's signed-in account, under the
existing named capabilities and member activity attribution. This accepted OS
account can access files and credentials, including a member key. A caller
omitting its signed chat identity can impersonate that member within this
accepted boundary. A disclosed sender retains its stored and delivered chat
attribution. No new permission or sandbox architecture is introduced here.

All qualification uses isolated Homes and fake accounts/providers. SDK process
regressions use actual SDK code with controlled Node CLIs, never a real account.
Brave component transports and source Electron/built-app smoke do not qualify
live subscriptions, microphone hardware, physical input or a signed release.
No owner data is used. An unobserved orphan cannot safely be killed by name.

The first review6 combined run at `182f0e43` caught two existing lifecycle tests
whose explicit recovery was blocked by caching a rejected close forever. The
runner now distinguishes a pending close from a completed rejection. The tests
retain their refusal/recovery assertions, with an added two-attempt check. That
run also caught Electron keyboard input before the document had focus. The
recorded timings do not show overlapping window tests, so concurrency is not
established as its cause. The test now requires actual document focus and sends
complete key presses. All seven navigation/authority checks remain. The verifier
runs browser and Electron window gates separately. The initial failed manifest
is retained as historical evidence and does not qualify delivery.

The old review5 manifest at `68c52639` remains historical evidence for that
source. The final external review6 manifest records exact source, commands,
counts, logs and captures. Only its complete passing result qualifies delivery.

[Seventh review corrections](unified-home-review7.md) supersede this ledger for current delivery, including contextual Restart chat and action-route sender attribution.
