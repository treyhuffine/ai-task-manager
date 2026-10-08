# Handoff and review preferences

Ri supplies the built-in method for preparing a durable handoff and independently reviewing saved work. Optional preferences customize those two operations. They are loaded at the workflow boundary, rather than injected into every conversation or background job. Existing agent standing instructions remain in `workspaces.instructions`.

## Storage and editing

| Scope | UI | Nullable TEXT column |
| --- | --- | --- |
| Shared | Settings, General, Handoff and review preferences | `user_state.work_result_guidance` |
| Agent | Agent setup, Handoff review, Handoff and review preferences | `workspaces.work_result_guidance` |

Both columns have no database default. `NULL` means no preference at that scope. They add no table, foreign key, or ownership relationship. Types derive from the Drizzle schema. Agent preferences supplement shared preferences. Where they conflict, the current request takes precedence over agent preferences, which take precedence over shared preferences. App authorization, assigned roles and targets, and read-only restrictions remain authoritative.

An explicit save sends only changed fields. Blank text or `null` clears guidance. Text is trimmed, with a 20,000-character limit. The query layer validates guidance before writing any part of a patch, so an invalid preference cannot partially commit another setting. Editors preserve dirty drafts, failures, and edits made during a save. A clean editor follows refreshed saved values. Clearing agent preferences restores shared inheritance.

Owner REST writes use the existing user-state and workspace routes. Direct signed harness REST writes cannot change these preferences. A user can also explicitly ask a chat to remember a preference for future handoffs or reviews. The existing `update_user_state` and `update_workspace` actions expose the optional `work_result_guidance` parameter for that purpose. Shared writes require the app main chat or trusted human local CLI. An agent chat can remember preferences only for its own recorded agent association. Reviewers, background runs, unavailable contexts, and unsigned remote callers cannot remember preferences. App main chat and trusted human CLI can edit an agent preference. One-off feedback is not implicitly remembered.

## Trigger and delivery

1. While handoffs are enabled, an ordinary producing turn receives a short rule: after completing a meaningful deliverable, read `get_handoff_context` before preparing or reporting it. Progress, questions, discussion, and small confirmations stay ordinary chat.
2. The signed producer calls the read-only `get_handoff_context` action. Ri returns its built-in reporting method plus the current shared and associated-agent preferences. The caller cannot select another agent or source. The method explains the stable report contract, retries, real uploaded files, links, provenance, and scope limits.
3. The producer calls the existing `report_result` action with the finished handoff. Its public parameters remain unchanged. Saving does not accept work, complete a task, or authorize delivery.

The completion trigger is an instruction followed by the model, not a backend classifier or a guaranteed automatic report. **Prepare handoff** and **Update handoff** provide explicit recovery paths. Those requests include the full method and captured preferences directly in the durable author assignment, including a taskless app chat or an associated agent. They do not need another live context lookup. **Save as handoff** retains the chosen answer verbatim rather than rewriting it according to preferences.

Independent review has a backend trigger. The human can request it explicitly, or the producing agent's existing `review_before_handoff` preference can opt into automatic review when both feature switches permit it. Saving a new handoff admits that review transactionally, and dispatch waits for the author to finish its turn. Preferences alone never start review or change the feature switches.

A review assignment captures shared and producing-agent preferences in its saved brief. Queued, resumed, and retried reviews keep that exact brief even if preferences later change. A fresh reviewer receives the built-in review method, the assigned request and exact saved handoff, and the captured preferences. Its existing authority remains limited to inspecting that work and reporting review evidence. It cannot recursively request reviews, accept, complete, merge, publish, or automatically repair work. The reviewer does not receive the producer's general standing instructions.

Background one-shot calls receive no handoff preferences. Ordinary turns receive the small discovery rule, not the full preference text. Existing native and fallback delivery of general agent instructions remains intact across supported harnesses, including cached and resumed contexts and clearing or reversing an instruction change. Connected sessions use the home's validated session-token identity and session-pinned CLI rather than another device's local data or paths.

No new skill-management layer or MCP server is needed. Ri owns the built-in method and trigger. The existing CLI and MCP action registry exposes `get_handoff_context` and the unchanged reporting and review actions. Optional skills can still be referenced in preferences when a particular workflow needs them.

## Schema integration

The schema source and all runtime, query, API, and UI code use the two new columns. Integration preserves main's released migration history through `0009_linked_folder_read_only`. The feature branch's conflicting development migrations are excluded from the squash, and the obsolete uncommitted broad-global-instructions migration was removed. Once this work was on main, the release migration `0010_many_captain_universe` was generated. It adds both guidance columns and the reviewer preferences as nullable columns with no default, alongside the result tables described in [durable result storage](durable-results-storage.md).

Vitest builds the result tables and preference columns from the release history like any home. Production database bootstrap and the safe migration runner are unchanged. An existing home applies 0010 the next time its server starts.

## Acceptance checks

- [x] Shared and agent preferences use separate nullable TEXT columns with no policy defaults.
- [x] Explicit UI and conversational editing preserve scope, partial patches, and draft state.
- [x] Producers discover current guidance through signed, feature-gated context reads.
- [x] Manual preparation and independent review retain the captured assignment context.
- [x] Ordinary chats and background jobs do not automatically inherit preference text.
- [x] Existing report, review, acceptance, and task lifecycle authority remains intact.
- [x] No real home data changed for this follow-up. Its release migration is `0010_many_captain_universe`.

Automated evidence covers mounted editors, optimistic cache concurrency, query normalization, API ownership, signed action scope, feature gates, all harness instruction surfaces, background-call exclusion, immutable review assignments, and manual handoff preparation. Historical pilot and preview evidence in the durable-results documents describes the earlier builds. It does not claim a live trial of this schema change.

Before integration with the newer main branch, the repository suite passed 3,028 tests with 26 skipped across 323 passing files and two skipped files. Typecheck, the Next.js production build, and the CLI build passed. The build used an isolated temporary home and a separate output directory. Final API and background-call regression checks passed another 25 tests after test-only cleanup. Targeted lint passed with existing unused-import warnings. A broader check of 157 changed TypeScript files found 11 errors, all reproduced in the unchanged HEAD versions of those files. No real home or running preview was migrated for this follow-up.

## Main integration

The result UI uses typed tRPC procedures over the same domain operations as the REST compatibility API. Signed reporting and review completion retain their existing CLI and MCP contracts. Shared preferences and per-agent review policy remain owner-only through both transports, including creation of a new agent. An assigned reviewer may read only its exact target, nested report, and retained previews through the typed context adapter. Agent instructions and result operation metadata travel through main's runner session specifications, with process-wide state and current homes placement checks preserved.

Independent reviewers run separately on the home. A path recorded on another device is not opened as a local path. If the original code is unavailable on the reviewing machine, the retained scope reports that limitation. Review requests do not take ownership of a producing execution or implicitly move it between devices.

Final integration verification passed 5,811 tests with 36 skipped across 612 passing files and two skipped files. Typecheck, the Next.js production build, and the CLI build passed after runtime sources were frozen. Targeted lint and mounted Chromium regressions passed. Builds used a temporary home and separate output directory. Main's released migration files and production database bootstrap remain unchanged. No real home or running preview was migrated.
