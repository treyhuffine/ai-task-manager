# Fifth review corrections

Historical evidence for the review5 source. [Sixth review corrections](unified-home-review6.md) supersede the shutdown, CLI and evidence claims noted there.

Reviewed source: `ab3e54bf`. Findings: owner-supplied review of 21 October.
Continue on `refactor/unified-home-experience`, preserving the HUD ancestor and
current main. All tests use disposable Homes and fake provider availability.
No production access, restart, Docker, push, merge to main or deployment.
No migration changes. Existing 0000–0021 artifacts remain immutable.

Unchecked work remains required. A checked implementation item requires focused
verification. The final delivery additionally requires all final-source gates
to pass at a clean committed HEAD, with the external manifest reporting
`sourceUnchanged: true` and `allPassed: true`.

- [x] R1: confirmed close for dead unrecorded roots, exact tracked cleanup and concurrent close safety, with real-process archive/Restart/AI-off variants.
- [x] R2: preserve personal remote queued-stop semantics and retrospective labels.
- [x] R3: preserve viewed conversation through tool tabs, New and model changes, including source-chat resource checks and mounted real AgentView coverage.
- [x] R4: inline missing/unavailable chat state with Retry and retained navigation.
- [x] R5: post-close archive preflight, wake preserved queues after failed archive/close, and shared dispatch admission for personal sends during teardown.
- [x] R6: validate launch prompt before writes and revalidate replay permission bounds with stable public errors.
- [x] R7: repair/update CLI remains available with an invalid Team declaration while Home operations fail closed.
- [x] P1: one legacy Plan return policy for persisted state and live runner behavior.
- [x] P2: idle-close admission rechecks after asynchronous preparation and prevents new sends during the close.
- [x] P3: preserve valid entries in a partly malformed private current-chat map.
- [x] P4: restore CLI/MCP alias, override, receipt and parameterless-schema compatibility with actual transport/CLI tests.
- [x] P5: stable lifecycle collision codes and Home-aware current-chat links.
- [x] P6: investigate stale workspace/session invalidations and fix demonstrated mismatches.
- [x] GitHub: consistently use the Team server account for the shared controls, including Open PR, under named capabilities and attribution. Name GitHub in the existing shared-computer warning.
- [x] Evidence: strengthen destination mutation controls, URL reload sensitivity, delivery gating, CLI paths, non-default WebSocket inheritance, Resume/archive overlap and positive preview controls.
- [x] Reconcile W00–W11/§11, review map and evidence limits. Final verification is a separate required delivery gate below.

GitHub follows the already accepted Team-server OS-account policy. Real provider,
physical input, microphone and signed-release qualification remain separate from
fake-provider, Brave component, real-process/HTTP and source Electron evidence.

## Finding-to-regression map

All paths below are under `src/`. Focused verification passed in disposable Homes before the final verifier. The external final manifest is the authority for the combined committed source.

| Finding | Correction and focused evidence |
| --- | --- |
| R1 | Exact process records still govern cleanup. A missing record confirms only an exited ChildProcess or ESRCH. A live unrecorded root stays retryable when its handle cannot confirm close. Fallback cleanup never signals that unrecorded PID. Concurrent closes join one confirmation. `lib/runner/close-unrecorded.test.ts` uses real roots, including a live refusal control. `lib/sessions/review-ai-off-background.test.ts` covers real-root archive, Restart and AI-off. |
| R2 | Common retirement accepts personal remote queued stops, archives and requests the retrospective label. Team still requires confirmed local close. `lib/sessions/personal-remote-stop.test.ts` uses actual tRPC, remote worker-command fixtures and a local control. |
| R3/R4 | Shared AgentView tool tabs retain the viewed ID. New/model requests carry sourceChatId with same-agent/readability checks. Inline unavailable state has Retry and keeps navigation. `components/team/team-chat-navigation.browser.test.ts` mounts the actual destination, AgentView, tool tabs, chat panel and New hook at 390px/1280px. `lib/sessions/team-member-selection.test.ts` checks permission source and foreign-agent refusal. |
| R5 | Post-close archive preflight precedes queue withdrawal. Finally releases admission and wakes preserved work. Ordinary personal and Team dispatch both recheck lifecycle admission. `lib/sessions/archive-late-dirty.test.ts`, `refused-archive-queue.test.ts` and `personal-archive-send.test.ts` use actual operations, real Git worktrees and held fake-provider effects. |
| R6 | Prompt validation precedes child creation. Replay checks current sender mode and Plan return bounds before dispatch. Public errors retain stable codes. `lib/sessions/team-launch-replay.test.ts` covers failure after child creation, narrowed senders, Plan return escape and no-effect invalid prompts. |
| R7 | Only CLI catalog registration falls back if the declaration is invalid. Actual Home actions still refuse. `cli/commands/agent-declaration.test.ts` runs CLI subprocess help, doctor, update and Home operations with bad permissions/version. |
| P1/P2 | Plan specs carry the resolved return mode, matching the query/apply policy. The legacy runtime fallback is conservative. Idle cleanup captures identity first, then rechecks busy state and closes admission without another asynchronous gap. `lib/team/ai/legacy-plan-runner.test.ts` checks a second permission prompt after human approval. `lib/runner/idle-close-window.test.ts` holds the process-record queue during real capture. |
| P3 | Valid private pointers survive another malformed entry. Reads leave stored text unchanged. The next deliberate write retains valid entries. `lib/sessions/team-member-selection.test.ts`. |
| P4 | Destination normalization and alias-group JSON override are common. Numeric receipt flags remain strings. Registry MCP validation runs after alias/destination admission. Empty schemas retain the published shape. `lib/orchestrator/mcp-destinations.test.ts`, `lib/spaces/native-cli-flags.test.ts`, `native-access.test.ts`, `lib/team/team-session-cli.test.ts` and `lib/mcp/registry-schema.test.ts` cover real MCP/CLI/HTTP paths, including connected-Home numeric receipt replay. |
| P5 | Lifecycle collisions use a domain conflict and render 409. Legacy current-chat links use Home navigation. `lib/sessions/team-member-selection.test.ts` checks actual Restart/Close chat collisions and an asynchronous archive/Resume overlap. `components/home/team-work-boundary.test.tsx` mounts the legacy link. |
| P6 | Investigation confirmed mixed cache families. Existing workspace update was already correct. Create/archive/reorder and related execution events missed typed agent lists, and several session mutations missed typed runtime status. Common invalidation covers both consumers without touching editor bodies. `hooks/use-work-view-invalidation.test.tsx` mounts actual hooks with a real QueryClient and tests per-chat scope. |
| GitHub A | Open PR now uses shared action-message submission under send and terminal capabilities and records one member activity entry. All GitHub controls use the Team server’s gh account. Existing shared-computer notice names GitHub. `lib/home/shared-git-controls.test.ts` covers denial, accepted shared queue submission and receipt replay with fake Git/provider effects. |
| Evidence | MCP coordination includes a readable private-history positive control. Reload persists a different saved pointer. Receipt tests exercise DeliveryLine gating and both Home capability defaults. WebSocket inherits non-default Auto edits. Preview list/restore includes allowed shared work. The guide explicitly distinguishes synthetic upgraded Homes and automated journeys from owner data or an independent new-human walkthrough. |

## Shared implementation and migration provenance

Personal main-chat replacement, execution tab Close and Team compatibility retirement now call the same retirement operation. Removed duplicate personal close/withdraw/archive sequences. The ordinary executor owns lifecycle admission for both Home kinds. The shared runner owns concurrent/idle/dead-root close behavior. Shared navigation and New hooks carry an optional source chat rather than introducing another Team chat component. Small Home adapters retain the actual differences: serialized member queues, private selection and remote personal queued stops.

No migration was added or changed. All released 0000–0021 SQL, snapshots and existing journal entries must match b2495707 in the verifier. Current main 1133959c is merged as 8900895c. Its agentex 0.0.47 upgrade retains the existing OpenCode port patch, applied by pnpm, with the real process/protocol regression passing. HUD ancestor acae188a remains preserved.

## Required final delivery gate

The verifier includes the new real-AgentView Brave suite and compares against main 1133959c. Only a clean committed HEAD with all 13 gates passing, sourceUnchanged true and allPassed true completes delivery. The exact HEAD, commands, counts, logs and captures are external artifacts linked in the final response. This source checklist does not claim that a preliminary focused run qualifies the final commit.

Initial focused integration setup mistakes were corrected without removing assertions: the cache test now drains notifications before removing its DOM, and lifecycle collision coverage now uses an actual multi-chat execution. The connected CLI numeric-receipt control and live unidentified-root refusal pass. Prior review4 manifests remain historical evidence for their named source only.

Remaining qualification limits: fake providers and availability, no real account or microphone, Brave component transports, source Electron and built-app smoke without signed-release or physical-input qualification. An external filesystem write after the last preflight cannot be made transactional with process shutdown. An unobserved orphan cannot safely be found by process name. The accepted shared OS account can access its files and signed-in accounts. No production Home was opened or migrated, and nothing was pushed, merged to main, deployed or restarted in production.

The first combined verifier at 2a331292 passed twelve gates and reported three failures in the older personal main-chat route fixture, whose executor mock returned void. The fixture now returns the actual StopReport contract and adds a failed-close refusal check proving the current chat remains active with no replacement. The existing successful New/Resume assertions are retained. Final qualification is rerun at the follow-up commit, with the first manifest retained as historical evidence.
