# Seventh review corrections

Reviewed source: `ef30357b`. Continue on `refactor/unified-home-experience`.
Keep confirmed shutdown, use a contextual "Restart chat" control, and preserve
shared UI and domain operations. No production access, restart, deployment,
Docker, push or merge to main. No new migration is planned. Released
0000–0021 SQL, snapshots and existing journal entries remain immutable.

- [x] R1: messages wait through idle close and recycle, with live admission rechecks and no failed Team turn.
- [x] R2: native Team actions validate strictly and accept launch aliases consistently.
- [x] R3: recycle and archive share confirmed shutdown, including recorded processes without a cached handle.
- [x] R4: Cursor exec-launcher identity, detached tools and orphan cleanup retain PID-reuse safeguards.
- [x] R5: preserve disclosed sending-chat attribution through action prompts and compatibility sends.
- [x] R6: shared agent/chat pending, offline, error and refresh states, without duplicate notices.
- [x] R7: contextual Restart chat, hidden on healthy idle and first-run chats.
- [x] R8: full-input CLI works without positional arguments and retains validation/override behavior.
- [x] R9: launch intent remains fixed after failed first sends; stable disabled-harness and model errors.
- [x] R10: retain published list_members schema and investigate slow lifecycle relay handling.
- [x] R11: unrecorded exited processes confirm shutdown after reaping without unsafe signals.
- [x] E1: strengthen teardown-trigger assertions, runner rejection retry, personal refresh tests and hook cleanup. Correct the unproved Electron overlap explanation.
- [x] Reconcile W00–W11 and docs, commit, then pass every immutable-source gate and package review evidence.

A checked implementation item requires focused behavioral evidence. Final
qualification separately requires a clean committed HEAD and all 13 gates at
exit zero, with sourceUnchanged and allPassed true in the external manifest.
Actual SDK tests use controlled local stand-ins and fake accounts. Upgrade
fixtures use populated synthetic Homes. Live accounts, signed releases,
microphone hardware and physical input remain unqualified. The accepted Team
server OS-account boundary remains unchanged.

## Finding-to-regression map

All paths below are under `src/`. Focused tests run against disposable Homes.
The final immutable-source manifest separately qualifies the delivered commit.

| Finding | Correction and behavioral evidence |
| --- | --- |
| R1 | Shared runner joins an in-flight idle close or settings recycle, reserves dispatch preparation, then rechecks the ordinary admission callback and cancellation before delivery. A failed close remains a refusal. `runner/idle-sweep-send.test.ts` uses real agentex 0.0.47 Claude and controlled slow-EOF/TERM-ignoring processes. `team/ai/idle-close-send.test.ts` holds a close in the ordinary Team queue and checks two authors, two successful turns and one delivery. |
| R2 | Native start and agent lookup actions parse strict inputs after common aliases. `permission_mode`, `harness`, `task_id`, `workspace_id` and request/device aliases retain their requested meaning. Conflicting aliases and unknown fields refuse before child creation. `team/team-native-input.test.ts` calls the real native MCP HTTP listener, checking Plan, selected Codex, task association, refusal and published discovery. Existing destination and broader alias matrices remain. |
| R3 | Settings recycle now joins the same confirmed close as lifecycle controls and retains its handle until shutdown succeeds. Close also verifies recorded processes when no handle remains. `sessions/recycle-then-archive.test.ts` uses the real SDK, a TERM-ignoring process and real Git worktrees for both model/mode and workspace-settings paths, requiring the process dead before successful removal. `runner/close-unrecorded.test.ts` adds lost-handle cleanup and an unrelated-process control. Explicit Close still cancels prompts if it joins a settings recycle. |
| R4 | Recorded harness identity uses PID, birth time and parent, permitting init adoption after parent exit. Exec may change argv. Owner identity retains its strict check. Generic worker matching is unchanged. `runner/cursor-exec-launcher.test.ts` uses actual SDK Cursor and a bash exec launcher with a detached tool, requiring confirmed archive, dead tool and removed worktree. `runner/cursor-launcher-orphan.test.ts` actually kills the server stand-in before boot cleanup, alongside direct-Node controls. Existing wrong-start, wrong-parent, foreign-owner and unrelated-process safeguards remain. |
| R5 | Shared action-message operation and compatibility Team send forward the disclosed sender to the member queue and ordinary prompt label. `trpc/team-action-sender.test.ts` uses actual WebSocket/appRouter and HTTP routes for ordinary sends, Commit, PR, resolve, help and compatibility send. It checks stored sender, member, successful outcome and delivered label. Personal action prompts also use ordinary sender attribution. |
| R6 | AgentView distinguishes an actual 404 from pending, offline and failed reads. HarnessChatSession uses shared lookup/retry states. A common refresh boundary retains mounted content and suppresses nested duplicate notices. `components/agents/agent-chat-recovery.test.tsx` mounts Team destination through actual AgentView/AgentChatPanel/HarnessChat, with leaf presentation/transport stubs, and checks offline, 503/404 controls, Retry, cached drafts and correct send target. `components/chat/harness-chat-refresh.test.tsx` checks both personal Home and personal-agent main-chat refresh failure and stable composer identity. |
| R7 | The existing recovery hook is labeled Restart chat and appears for running/background work, a failed send/New or an unconfirmed close. Healthy idle and empty first-run chats have no row. `components/chat/harness-chat-state.test.tsx` checks visibility and calls the real restart hook. Runtime status exposes only an optional closeUnconfirmed fact, shared by both Homes. |
| R8 | Commander collects optional positionals, then the existing full-input merge and Zod validator enforce required fields. `team/team-session-cli.test.ts` runs actual signed session CLI subprocesses for JSON-only get_task, original positional form, JSON override and missing-ID refusal, retaining unsigned/forged/expired controls. |
| R9 | A system metadata event stores the launch intent hash in the same transaction as child creation, before first send. A fixed primary-key read enforces the original prompt/task/label/settings after a failed send. Existing transcript system-subtype allowlisting keeps the metadata invisible, and normal event DTOs omit raw hashes. No schema or migration is added. Legacy accepted receipts retain their replay contract. A legacy unaccepted child without saved intent refuses reuse and asks for a new request ID. `sessions/team-launch-replay.test.ts` covers failed-send changed intent, same-intent recovery, simultaneous requests, archive replay, permission bounds and no-child failures. Disabled harness returns unsupported, and UI unknown-model errors return 400. |
| R10 | Empty raw MCP shapes keep their original discovery schema while strict empty Zod objects retain additionalProperties:false. `mcp/registry-schema.test.ts` checks both, and native MCP discovery checks list_members. Lifecycle relay calls now cover the existing 15 minute teardown budget plus close, ordinary reads remain 15 seconds and explicit caller timeout/cancellation wins. `spaces/lifecycle-relay.test.ts` uses the actual My Ri proxy and a separate slow HTTP fixture, requiring success after 16.1 seconds, member token forwarding, no cookie and an explicit-short-timeout control. It does not run a real teardown/provider over that relay. |
| R11 | After SDK SIGKILL delivery, the runner briefly observes the known ChildProcess exit/reap event before declaring the root live. It never signals an unrecorded PID. `runner/unrecorded-sigkill-reap.test.ts` checks recorded and unrecorded actual SDK Claude stand-ins on the first close. Existing live-unrecorded refusal remains. |
| E1 | The teardown test already had four assertions, contrary to the review's wording. It now additionally requires the actual teardown marker, dirty/uncommitted refusal and retained worktree. Runner-level rejection and synchronous-throw recovery are covered in `runner/rejected-close-retry.test.ts`. Personal refresh evidence is described above. `sessions/review-unconfirmed-close-retry.test.ts` owns its cleanup hook timeout and passes without the verifier's hook override. The earlier Electron failure was a document-focus/input setup failure. Timing does not show overlapping window tests, so concurrency is not established as its cause. The corrected focus/key-pair assertions and serialized window gates remain. |

## Data, policy and qualification limits

No migration or schema change. Released 0000–0021 SQL, snapshots and journal
entries are unchanged. The launch intent uses the existing system-event JSON
column and an indexed primary-key lookup, never a scan of chat history. Existing
personal and Team data is neither rewritten nor reset.

Confirmed personal close remains the accepted policy. Normal exits are fast,
while a TERM-ignoring CLI can take about five seconds. A close that cannot be
confirmed retains its process/worktree references and exposes retry recovery.
Unknown processes are never selected by name. The accepted Team server OS
account boundary, including identity omission/credential impersonation, is
unchanged. This pass adds no sandbox or permission framework.

Focused results and immutable-source results are distinct. Only the final
manifest with all 13 successful gates, allPassed:true and sourceUnchanged:true
qualifies delivery. The final review package includes the exact source, diff,
manifest, logs and captures. The previous ef30357b manifest remains historical
evidence for that source. Live accounts, signed releases, microphone hardware,
physical input and actual owner-data upgrades remain unqualified.


The first combined review7 run at `3ad664cc` retained clean, unchanged source.
Twelve gates passed. Full Vitest reported 7750 passes, five failed assertions and
one cleanup rejection, with 117 opt-in skips. The correction keeps all refusal,
permission and recovery assertions: partial model-catalog mocks retain the real
error class, the runtime fixture declares the new optional close fact, and the
recycle test requires retaining the failed handle followed by a successful
explicit close retry. The remote-device test now waits for the matching durable
permission request, since its live heartbeat may arrive before journal replay.
It still requires the request, person approval, allowed result and response.
Its dispatch rejection is observed immediately so a preceding assertion failure
cannot produce an unrelated unhandled cleanup rejection. No production change
was needed for these test corrections. The failed manifest/logs remain historical
evidence, and every gate is rerun at the follow-up committed HEAD.
