# Eighth review corrections

Reviewed source: `cead026f`. Continue on `refactor/unified-home-experience`.
Main through `15d733e1` is merged in `a8ab94e8`. HUD ancestor `acae188a`
is preserved. This pass does not access production, restart, deploy, push,
merge to main, run Docker or change released migrations.

- [x] Resolve all four main conflicts, preserving shared components and Home authority.
- [x] Successful settings and shared-skill writes remain successful after an idle recycle fails. Retain the handle, refuse sends and expose Restart recovery.
- [x] Recognize Linux subreaper adoption with a kernel birth fingerprint. Retain ambiguous legacy records and refuse cleanup confirmation without signalling them.
- [x] Scope transient send and Restart state to the displayed chat. Refresh recovery after header New, pinned New, provider changes and History Resume failures.
- [x] Preserve published migrations and update the regression map and immutable-source verifier.

Implementation checks above have focused behavioral evidence. Final acceptance
separately requires all 13 gates at a clean committed HEAD, with `allPassed`
and `sourceUnchanged` true in the external manifest. A prior manifest does not
qualify this source. The final response links the new manifest, source diff,
review diff and archive.

## Main integration

Personal Tasks uses main's Board overlay with Agent Activity and Tasks tabs,
column preferences and HUD focus. TaskSurface accepts a host navigation control
for opening that overlay. Team Tasks keeps the same TaskSurface, TaskList and
TaskKanban inline, with assignee, Area, creation defaults and member metadata.
Inline column preferences are scoped by Home and viewer. No second Team board
implementation or new `isTeam` branches were introduced.

Rail navigation and search use main's remembered Board entry. The common rail
operation adds main's pending summary only after Team catalog filtering and
retains private current-chat pointers and live turn/control filtering.
`components/tasks/task-surface.home.test.tsx` checks the two host contracts. Main's real
`components/board/board.browser.test.ts` is now included explicitly in the browser gate,
in addition to its ordinary broad-suite run. Existing Team navigation, task
controls and rail authority coverage remains.

## Corrections and evidence

Paths below are relative to `src/`.

| Finding | Correction and behavioral evidence |
| --- | --- |
| Saved settings reported failure | `recycleWhenIdle` treats an unconfirmed close as runtime recovery after persistence. Strict `recycleForModeChange`, explicit close and archive still require confirmation. `lib/executor/settings-recycle.integration.test.ts` calls actual agent settings and connector-scope operations repeatedly, checks saved values, retained handle, blocked send and explicit recovery. `lib/skills/team-home.test.ts` uses the real Team tRPC skill create/hash-checked save paths and failed runner close. `lib/executor/adapter.recycle.test.ts` retains deferred/background and retry controls. |
| Idle recovery was invisible | Close-flag transitions report the existing runtime signal. The session stream refreshes the full runtime snapshot even when running stays false. `hooks/use-session-stream.recovery.test.tsx` mounts the actual stream/runtime hooks and checks both flag transitions. The settings integration test requires the published idle frame. The chat explains that the previous harness has not confirmed it stopped and saved changes are preserved. |
| Linux subreaper adoption | Process records optionally store Linux boot ID plus `/proc/<pid>/stat` start ticks, stable across exec and adoption by any parent PID. Different births, boots and PIDs refuse identity. An unreadable recorded birth or unexplained legacy parent change remains ambiguous, never signalled or forgotten as gone. Generic worker identity retains its previous strict command rule. `lib/worker/process-lifetime.test.ts` checks parsing, precision, reuse and legacy cases. `lib/runner/harness-processes.identity.test.ts` runs real stop operations over fixture records with synthetic process observations for startup, start and confirmed close, alongside unrelated-process controls. |
| Unsafe archive on uncertain identity | The actual archive operation runs against a real Git worktree and live Node process with an ambiguous legacy record. It refuses, preserves the active chat/worktree/record and never signals the uncertain process. `lib/executor/settings-recycle.integration.test.ts`. Existing actual SDK Cursor exec, detached tool, parent-crash, lost-handle and PID-reuse tests remain. |
| Stale or missing Restart row | The common chat body and Restart feedback are keyed by chat ID. New/Resume errors invalidate authoritative runtime, including a pinned source distinct from the current pointer. Successful Restart clears the displayed send error. `components/chat/harness-chat-recovery.test.tsx` mounts real AgentChatPanel, History, HarnessChat and mutation hooks with synthetic transport/composer leaves. It checks failed send, pointer switch, Restart error isolation, header New, pinned New, History Resume and recovery. Existing healthy/first-run and cached-refresh checks remain. |

The review's claim that all header New failures hid recovery was too broad:
ordinary unpinned New already refreshed runtime. It remains a positive control.
The existing remote permission notification/history-order reports are not changed
by this pass. Squash landing, live-checkout edits and production migration hash
inspection remain later owner-controlled work, outside this authorization.

## Migration and qualification limits

No database migration is added. Released 0000–0021 SQL, snapshots and existing
journal entries remain byte-identical to `b2495707`, enforced by the verifier.
`birthId` is an optional field in the local process JSON record, not a schema
column. Old records remain readable and uncertain ancestry fails closed.

This host is macOS. Linux parser/adoption/ambiguity fixtures run here. In this
review, actual Linux birth capture is exercised only by the skipped native
Linux tests. Review9 adds real ps/process operations with injected `/proc` birth
observations on this host.
`lib/runner/harness-processes.linux.test.ts` adds actual `PR_SET_CHILD_SUBREAPER`
startup and tracked-close probes, enabled on Linux with Python 3, but they are
skipped here. Native Linux kernel qualification is therefore still outstanding.
The Linux parent behavior follows [the kernel subreaper contract](https://www.man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html).
Fake provider/account, unsigned source Electron, synthetic Home data and no
microphone-hardware limits from the prior ledger remain. No live provider,
production-data migration or signed-release qualification is claimed.


## Final verification follow-up

The first attempt at `6087547a` hit ENOSPC during the desktop app build and
manifest write. Its logs and partial manifest are retained separately. Only
this worktree's generated outputs were compressed or removed, with SHA-256
checks for the compressed files. Production and other checkouts were untouched.

The next run completed every gate, with twelve passing. The broad suite found
an old History test mock missing the `trpc` export needed by the new Resume
recovery invalidation, producing an unhandled rejection. The mock now preserves
the actual query-key factory, and the test checks that only the current chat's
runtime is invalidated. It also found the reviewer cancellation test exceeded
its five-second deadline. The isolated diagnostic passed in
1.90 seconds overall, including setup. That is not the individual cancellation
case's execution time. The precise cause of the broad-suite timeout is not established. A scoped
15-second test budget retains every assertion: one close, no submitted message,
and cancelled status. No reviewer production behavior is changed. The complete
failed manifest and broad-suite log remain evidence, and all thirteen gates
must run again against the follow-up committed source.


The follow-up run at `362f8455` caught an incomplete typed runtime cache seed
in that History test. It now supplies the complete runtime DTO, with no cast
or weakened type. Disk exhaustion also interrupted migration checks in that
run. The verifier was stopped after these failures. Its partial evidence is
retained separately. Typechecking, targeted tests and lint must pass before the
next commit and another complete immutable-source run.
