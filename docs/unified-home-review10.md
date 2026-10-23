# Unified Home tenth review

Current implementation supersedes review9, including its migration workaround.
The sole owner explicitly confirmed that none of the refactor migrations had
been applied and authorized deleting and regenerating conflicting numbers.
Main `9528aabd` is incorporated on `refactor/unified-home-experience` and HUD
ancestor `acae188a` is preserved. No push, merge to main, deploy, production
restart or real Home access is part of this pass. Real harness qualification is excluded.

## Completion and regression map

All implementation items below are complete. Final acceptance requires a fresh
external manifest at this committed source with every gate passing and
`sourceUnchanged: true`. Previous manifests do not qualify this source.

| Finding | Implementation and evidence |
| --- | --- |
| Migration conflict | Restore main's complete 0000–0023 SQL, snapshots and journal entries. Delete unpublished branch migrations and the alternate lineage. Restore main's safe runner without the model-speed exception. Generate exactly one 0024 using the CLI. Independent generation from main snapshots produces identical SQL. Populated personal and Team upgrade fixtures cover main 0018, 0019, 0020, 0021 and 0023, preserving rowids, FTS, links, sealed credentials, native/legacy history and original receipts. `area-defaults-migration.test.ts`, `coordination-migration.test.ts`, `p8-migration.test.ts`, compiled `startup-migrations.test.ts` and real-main skew tests exercise the safe migration path. |
| Latest main | Merge `9528aabd`, preserving coordination admission, reservations, producing-run authorship, new model controls and empty-chat switches. Keep actual shared transcript/composer implementations. Linked personal chats retain ordinary link navigation when no contextual current-chat callback is installed. Port linked coordination messages into the common transcript and Home storage scoping into main's extracted launcher model control. Shared live feeds retain authority filtering. The contextual chat capability keeps personal coordination controls off the existing restricted Team native surface. Preserve baseline API callers alongside API 2, plus main's required coordination capability. |
| Speed authorization | Include `serviceTier` in the common Team send-authority check on session updates. AI off, archived and closing chats refuse selection changes without saving or recycling. `team-selection-authority.test.ts` and `team-member-selection.test.ts` exercise real Team tRPC operations. |
| Hidden models | One contextual model policy validates members against the owner's enabled list at launch, update and dispatch admission, including native tools and later queued turns. Owners retain model administration. Unsupported speeds remain refused by model discovery and the runner. `team-selection-authority.test.ts` verifies launch, update, native start and actual dispatch. |
| Personal stale model | Restore main's repair behavior for explicit remembered personal model selections. Team explicit selections stay strict. `personal-stale-model.test.ts`. |
| Manage models | Resolve the destination from the live Home capability in `TeamWorkBoundary`. Members receive no destination. The real boundary is mounted in `team-work-boundary.test.tsx`. |
| Native launch speed | Native `start_execution` accepts speed and includes it in the durable intent hash. Shared Home launch policy inherits a sending chat's speed only for its harness and an advertised speed on the destination model. Changed retry settings conflict. `team-selection-authority.test.ts`. |
| False undelivered notices | `dispatchSessionTurn` tracks native `onTaken`. A subsequent turn failure or Stop cannot report an already received notification as undelivered. `decision-recovery.test.ts`. |
| Decision recovery | Connection and approval failures preserve the complete decision through the existing coordination delivery records. Context-only records never start work or enter the automatic delivery loop. The next human message claims and supplies them, and native acceptance consumes them exactly once. A later user message cannot duplicate the context. Connected views retain their exact invocation retry. `decision-recovery.test.ts`, `settings-recycle.integration.test.ts` and existing coordination runtime tests. |
| Accurate owner errors | Strict close errors identify a saved chat label, with a human fallback, instead of raw IDs. Settings admission reports an agent update and keeps the draft. `settings-save.test.ts` and existing lifecycle operations. |
| Failed-close cancellation | Lifecycle stop intent waits for the close result. A refused close clears intent and cannot relabel a later runtime failure as cancellation. Confirmed stops retain cancellation semantics, while dirty/teardown refusals preserve queued work. `stop-collision.test.ts`, `archive-late-dirty.test.ts`, `archive-teardown-dirty.test.ts`, `refused-archive-queue.test.ts`. |
| Transient self lookup | Rejecting or empty self identity lookups are not cached indefinitely. The next inspection retries. `harness-processes.identity.test.ts` retains bystander and unknown-identity controls. |
| Quarantined personal health | Health checks return unknown activity without transcript reconciliation, orphan replay or a false refusal while shutdown is unconfirmed. `decision-recovery.test.ts`. |
| Personal execution recovery | The common `ChatRecovery` displays the actual process diagnostic and current-chat Restart on both execution and content/main-chat surfaces. `chat-recovery.test.tsx`, `harness-chat-recovery.test.tsx` and actual runtime status tests. |
| Browser coverage | The verifier explicitly enables and lists main's markdown-link suite, model menu and usage suite. All gallery examples include main's coordination approval, hold, forwarding and long-message journeys. Window tests run serially. |

## Migration provenance

`pnpm iso /private/tmp/ri-unified-review10-dev --port 42971 -- pnpm db:generate`
generated `0024_breezy_rawhide_kid.sql`, snapshot and journal entry. No SQL file
was edited directly. An independent CLI run in a disposable directory seeded
with main `9528aabd` snapshots generated byte-identical SQL.

SQL SHA-256: `59bf92220f2bffbdccd66d6ba05557a98be3aae9de41adc5b9d3900dc800ce5a`.

The delta adds six tables (`member_chat_views`, `member_execution_views`,
`member_preferences`, `personal_area_defaults`, `reference_area_choices`,
`team_activity`), nullable author/key columns on shared records, and a virtual
result-operation message column/index on runs. Private current-chat pointers
are member preferences, scoped by agent. They do not adopt another member's
chat and do not change the shared transcript. There is no table rebuild,
content backfill, dropped existing row or model-speed migration duplication.
Main's 0020 already owns the speed fields.

Current final migrations:

- `0000_typical_shockwave`
- `0001_late_magus`
- `0002_curvy_magma`
- `0003_right_black_tarantula`
- `0004_ambitious_zemo`
- `0005_grey_ultragirl`
- `0006_integration_names`
- `0007_rare_event_indexes`
- `0008_abandoned_mentallo`
- `0009_linked_folder_read_only`
- `0010_many_captain_universe`
- `0011_team_spaces`
- `0012_team_connections`
- `0013_team_connection_url`
- `0014_opposite_gorgon`
- `0015_team_shared_context`
- `0016_team_ai_auth_mode`
- `0017_agent_coordination`
- `0018_home_default_variant`
- `0019_groovy_may_parker`
- `0020_aspiring_rocket_raccoon`
- `0021_polite_spyke`
- `0022_agent_coordination_controls`
- `0023_coordination_system_authorship`
- `0024_breezy_rawhide_kid`

The safe runner still disables FK enforcement around its transaction, checks
links before committing, refuses unknown histories and refuses pending
migrations outside server startup. Its existing retired skill-scope exception
is unchanged from main. There is no new migration runner compatibility path.

## Final qualification

Run `scripts/verify-unified-home.py` after committing every source change,
using `/private/tmp/ri-review10-main-9528aabd` as the detached main baseline.
The fresh output is `/private/tmp/ri-unified-review10-final` (or a new numbered
attempt if a gate finds a defect). The manifest records the exact commit,
commands, logs, counts and clean-tree checks. Its 14 gates include production,
desktop web/app builds, schema generation/check, types, lint, desktop tests,
explicit browser suites, migration/restart journeys, both production-build
Team desktop journeys, the complete gallery and full Vitest suite.

Focused checks use fake providers and isolated synthetic Homes. Real Node
stand-ins and process observations cover shutdown. Linux kernel-specific
subreaper checks remain host-gated on macOS. No signed release, physical
microphone, real-account or owner-data qualification is claimed. Final
acceptance and exact test totals are supplied by the external manifest linked
in delivery, without changing the already verified source.

## Verification isolation correction

A preliminary broad run was invalidated when a package-manager check in the
baseline checkout changed the shared agentex dependency link during the suite.
That broke mock module identity. One synthetic title test reached a signed-in
CLI and returned a subscription-limit error. The run was stopped. No real Home
data or service was changed. The patched dependency was restored with a forced
frozen-lockfile install, and baseline dependencies now live in their own tree.
The 39 focused runtime, cancellation, title and clock tests then passed.

The final verifier refuses shared baseline dependency links, requires the
patched agentex package, and checks its resolved path remains unchanged. Test
setup points every native harness command at a nonexistent local path until a
fixture explicitly supplies a controlled stand-in. This prevents a missed mock
from reaching the operator's signed-in CLI. Invalidated logs remain in the
external evidence and do not qualify the final source.

Main's new usage browser fixture now supplies the shared cache-key factories,
uses the selected browser, and writes captures outside source. Its blue-color
assertion permits one channel rounding unit for browser color-space conversion.
The application color code is unchanged. The shared gallery interaction waits
for the model-menu animation before clicking and retains the real selected-model
assertion, including a focused desktop/phone journey in both themes.

## Final main integration regressions

The broad suite found seven failures across five files. Exact chat source links
now use the dashboard's complete history/message navigation callback. Documents
without it retain their native scoped link instead of losing its query fields.
Personal launch permission and delegation checks run before catalog discovery,
matching main's validation order. Child coordination policy initialization is
personal-only, preserving the Team native launch contract and intent-only audit.
Main-chat replacement remains person-only in either Home, with Team errors
naming `start_execution` for separate work. The real Team WebSocket test checks
that refusal and the permitted launch's inherited authority. Owner settings-link
fixtures now supply their authenticated Home capability. The seven affected
suites and related launch regressions pass all 28 focused tests. Exact-source
acceptance still depends on the final external 14-gate manifest.
