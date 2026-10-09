# Local apps implementation evidence

Implementation lives in `/Users/agent/worktrees/ri-local-apps`, on `local-apps-mvp`. Finances source is maintained at `apps/finances` in the same checkout. Initial qualification used the separate Finance worktree before this consolidation. See [the shared development guide](finances-development.md). Original checkouts and production were left untouched. All records, accounts, mail replies and backups used for qualification are synthetic.

The normative requirements are in [the implementation contract](local-apps-implementation.md). This checklist records verified slices. The initial release qualification is complete. Shared-checkout qualification is recorded below.

The October 8 [source-mentions extension](app-connector-mentions-spec.md), optional tools-only apps and remembered catalog setup are implemented. Their separate checks are recorded in [chat source qualification](chat-sources-progress.md). Production external MCP views in ordinary chats remain pending in section 9. Existing [external-app evaluations](plugins-evaluation-accounts.md) remain experimental evidence for that future host.

- [x] A1: built public app-kit exports, pinned portable schema, artifact and safe archive validation
- [x] A2: opt-in owner registry, revisions, corruption preservation, export/archive
- [x] A3: Apps rail/library/deep links, mode switches, collapsed chooser and retained existing-chat input
- [x] B1: shared opaque HTML/React controller, global and existing-chat views, permitted MCP Apps callbacks
- [x] B2: real Chromium and Electron containment, forged messages, two tabs, files, theme and teardown
- [x] C1: owned IPC/service processes, actual executable qualification, deadlines, queue/log bounds and restart limits
- [x] C2: durable SQLite receipts, restart persistence, timeout and abrupt parent death with stubborn descendants
- [x] C3: authoritative context, per-turn freezing, entity references and cross-chat/revoked/forged selection rejection
- [x] C4: standard MCP projection, independent packed consumer and official reference Finance AppBridge
- [x] D1: scoped Ri/Gmail broker, exact approval continuation, independent apps, denial, expiry and restart cancellation
- [x] D2: existing scheduler participant, bounded overdue claims, overlap/active-hours skips and actual closed-view SDK action
- [x] E1: builder/try chats, frozen pinned builds, separate fixtures, reviewed digest, updates and failed-build isolation
- [x] E2: skill-manager authoring/delivery, supporting resources and five fresh live workflow sessions
- [x] E3: failed activation repair, stopped WAL snapshots, live/offline Home backup and safe restore
- [x] F1: relocatable Finance service, private bootstrap and account-scoped short-lived principals
- [x] F2: native empty setup, CSV/file download, saved views and explicit budget scenario with retained conflicting edits
- [x] F3: Finance contexts/workflows, advertised Gmail fixtures and worker catch-up without an open view
- [x] G1: clean-home export/import, independent kit tarball and core build with the feature absent
- [x] G2: final typechecks, changed-surface lint, integration/browser/desktop checks and isolated production artifacts

## Initial release verified results

- App kit: 24 tests across seven files, including safe contracts/archives, SQLite deduplication, actual Node target checks, revocation before returning results, overload, readiness/restart bounds, hanging descendants, hard parent death during builds and runtime work, real browser containment, and a clean consumer installing the same tarball. The status test also rejects private payloads and changed process generations without starting a stopped service. Latest focused runtime and browser suites pass.
- Ri: 70 tests pass across 16 files, with the explicit Finance artifact test separately qualified. These include local app metadata, authorization, files, preview isolation, broker fixtures, workflows, approval expiry/cancellation, stopped backups, core process-state rules, active-view URLs and 26 WebSocket tests. A 2 MiB reply followed by a mutation passes on the same socket.
- Finance: 64 tests pass across nine files. The optional official reference-browser test passes separately. The worker test uses a real private HTTP broker fixture, no view, durable Gmail history cursors, reconnection after revocation and no credential file. A two-account lease test rejects the completed result after a partial grant change during its callback.
- Actual Ri Finance artifact integration passes: authenticated service import, manual CSV, saved views, source rebuild inside Ri, preserved records, failed-build protection, two-chat context isolation, forged selection, revocation between acknowledgement and send, clean export/import and explicit grant review after archive.
- Chromium 151 and Electron 44.4.5 pass the common adversarial fixture using the shipped desktop preload and trust policy. Guest origin is opaque. Parent DOM/cookies/storage, Node/Electron APIs, fetch/images/forms and network self-navigation are blocked. Forged callbacks, separate tabs, native file mediation, theme and disposal are exercised.
- Native browser checks pass create/build/preview/activate, separate preview records, guest input across polling, refresh and Back. Finance passes native catalog/manual setup, CSV upload, record download, two-record selection, saved views, retained input, explicit budget adoption/scenario/apply/undo, conflict retention, service health and expired-view recovery. Existing-chat checks pass a scoped Finance saved view, selection, rail mode switches, collapsed chooser, global opening, Back and composer retention.
- Five real fresh Claude subscription sessions pass direct monthly review, indirect spending analysis, refund follow-up with missing evidence, missing-input handling, and an irrelevant poem request with zero Finance calls. Grants are revoked between cases, removing discovery and workflow reads. No ambient skill installs occur. A separate fresh live builder reads the installed source/guides, updates the tracker through its public build action and preserves the existing record without a creation transcript.
- A real bounded Claude app-AI probe passes no tools, no ambient instructions/MCP, no unrelated file reads and no writes.
- A running disposable Home quiesces Finance and owned builds before backup, resumes the service, and restores the exact records with all app grants/jobs disabled. Hard-killing that Home during a build also stops its stubborn descendant. The offline backup then verifies that no owned writer survives. Evidence: `/var/folders/0f/kt2pkmp53f5g33pyjw3wzvc40000gp/T/ri-live-app-backup-y5Tb3J`.
- Starting the same Home with the flag off preserves metadata byte-for-byte, creates no app writers and rejects app operations. Tasks, notes and chat API calls still work.
- An isolated checkout at `4e6a4506219f`, before this feature, builds successfully. No local-app core schema migration was added.
- Current Ri, Finance and kit typechecks pass. Changed Ri surfaces have zero lint errors. All new local-app/kit surfaces and Finance local-app surfaces have zero lint errors or warnings. Ri's isolated production build passes with two existing broad-file-tracing warnings.
- The final unsigned runtime starts on a fresh Home with its bundled official Node executable, loads the final catalog, activates Finance through native tRPC and reports the real worker as ready with account setup pending. It works without importing either source checkout.
- Final teardown closes all three qualification ports and verifies each recorded app owner plus the process table. No owned app writer remains after the shutdown grace period. The failed generated package staging directory was removed. Disposable Homes and backup evidence remain available for inspection.

## Release boundaries and refinements

Qualified target: macOS arm64, actual Node 26.5.0, native module ABI 147. Service artifacts are rejected before package execution if the launched executable differs. Builds/dependencies are owner-trusted native code. No hostile-code sandbox or additional platform qualification is claimed.

Gmail's five receipt modes are implemented and fixture-qualified. Outlook and bank operations are omitted from managed capabilities until separately complete and qualified. Live mailbox/bank access, public intake, public ChatGPT distribution and marketplace execution remain outside this MVP. Bounded app AI is qualified for the restricted Claude subscription profile only. Other harnesses fail closed for this capability.

Management edits increment the registry revision. Activity, schedule claims and auto-created builder/try chat bindings use the same atomic writer without invalidating an activation review. Fixture UI authority is explicit and separate from preview agent authority and live grants.

The qualified service build declares a package-owned recipe and a `release/...` output. Frozen dependency installation disables lifecycle scripts. An exact-version native addon may be reused only from that package's already qualified runtime and must pass an actual executable probe. Generated `.ri-build`, `.next` and `release` folders are excluded outside the declared runtime artifact. Managed workflow files/indexes survive a source rebuild.

App views are capped at 12 MiB including their wrapper. WebSocket queued output is capped at 16 MiB. File selection/download is declared per package, native-mediated, MIME-limited and capped at 512 KiB. Download resource names never become fetch URLs or filesystem paths. Inline JavaScript, including modules, is parsed before activation.

Initial separately packaged Finance artifact digest: `478906773da580ce03508e8203be424bfcec1850dc70cf783fe0cf6aea0452f3`, 3,108 files, staged in the curated catalog with matching archive digest. The final artifact passes the actual Ri rebuild/import/revoke integration and official reference AppBridge. The integrations package’s 25 Gmail tests pass separately from Ri’s suite.

Native Chat access now opens the app’s account chooser and binds its opaque reference without copied IDs or credentials. Selection persists across polling. The actual service test proves the access view allows only its declared setup callback and overwrites a forged actor with the host-selected actor.

The CLI keeps the existing whole-request `--input` envelope. An action parameter named `input` uses `--action-input` and parses its JSON independently. A regression test and the actual packaged CLI help both pass. The unsigned macOS arm64 runtime build includes the final Finance/tracker catalog, verifies 3,960 portable resource links and probes SQLite/vector plus the bundled CLI under official Node 26.5.0. It is a local test artifact, without publisher signing or deployment.


## October 8 shared checkout qualification

The owner requested one worktree and chose Finances as the name. Source now lives in `apps/finances`, in the same Ri worktree and pnpm workspace. The imported 126 source files retain their own service, database and migration history. The old Finance checkout and worktree remain intact as provenance. No generated packages, dependencies, nested Git metadata or private data were imported as source. Changes remain uncommitted.

The root commands are `finances:test`, `finances:typecheck`, `finances:lint`, `finances:package`, `apps:catalog` and `apps:dev`. A frozen workspace install passes. Packaging exports a current public SDK tarball into an isolated project with the reviewed standalone resolution, then builds and validates that independent project. Both app packaging and catalog staging reject concurrent builds before changing outputs. The one-command isolated trial starts successfully and rejects an already occupied macOS IPv4 port before building.

Finances is the catalog and manifest display name and the managed/standalone heading. Installed app lists, the rail and chat chooser use the validated manifest's name while retaining stable URL slugs. Existing `ri-finance`, `finance_*`, renderer resource URIs and data roots remain compatible.

Shared-checkout verification passes: root, app and SDK typechecks, changed-surface lint plus the full Finances lint command, 64 Finances tests, 24 app-kit tests, and 20 Ri local-app/process-state tests with the optional artifact test skipped there. The real artifact integration passes separately, including a source rebuild inside Ri, failed-build protection, preserved records, account scopes, context isolation, revocation and clean export/import. The official reference AppBridge and Electron containment checks pass separately. The production build passes with 24 broad-file-tracing warnings from existing dynamic filesystem paths. Ri's compiled JavaScript does not import Finances business code. The earlier unsigned release bundle is historical qualification and has not been rebuilt for this source consolidation.

Native Chromium qualification imports the previous archive through the real bounded multipart route, creates an account and transaction, selects Review update, verifies that preview does not activate, then selects Use app. The instance, account and transaction IDs survive. The final package passes native manual setup, CSV upload, download, saved views, input retention, budget scenarios, conflict retention, explicit apply/undo, expired-view recovery and Back/Forward. The proxy now buffers up to the existing 51 MiB multipart bound so it does not truncate a valid app package at Next's 10 MiB default.

A rapid view transition exposed an asynchronous open/dispose race. A real browser regression failed before the fix because a disposed opening left an iframe attached. The controller now invalidates pending openings and tears down only its captured generation. React ignores callbacks from a canceled view and closes a canceled opening. The regression, full SDK suite and full native Finances qualification pass after the fix.

Current Finances artifact: `5e2109aa8252a2b9593777f5f5ad12e7fc712e4525d7703bad1043c75fbd494b`, 3,101 files. Its archive digest is `40416afbacb4961ea6fe220e26053120533da73eb9d2f1d7205b9e58a4e1df2f`. The source package and staged catalog match. Evidence logs are ignored outputs under `release/local-apps/consolidation-*.log`. Native browser screenshots remain in the disposable consolidation Home.

The final existing-chat browser check also passes scoped account setup, selection, rail mode switching, the collapsed chooser, global opening, Back and composer retention with the Finances label. The user trial Home was preserved and its development server refreshed on port 42251. The Beamd route remains the same.

The consolidation fixture is stopped. Every recorded app owner is gone and no process runs from that Home. The separate user trial remains running, its catalog lists Finances and Personal tracker, and the Beamd health route returns HTTP 200. Production and the original source checkouts were not changed.

## October 8 navigation and surface redesign

The rail's Agents / Apps mode switch and its Apps-mode list were replaced by an Apps place row whose flyout (hover or click, in both rails) lists your apps with All apps and New app ([rail.md](rail.md)). The same pass turned the rail's Create and Search buttons into New chat and Search chats rows at the top, merged the Agents | Recent tabs with the Agents group label into one list header, and renamed the visible noun "execution" to "chat" (code keeps `execution`, see AGENTS.md). Folding the rail's two verbs into the header's CREATE and ⌘K was tried and taken out the same day: they stay separate for now. The library, the builder, an installed app's page, its settings and the app beside a chat were rebuilt in Ri's own header, tile, chip and menu grammar, with the same tRPC operations underneath. The composer's app button replaced the select that sat above every chat. Ask Ri and the companion now hand the view to the chat only once the chat is allowed in, where before they opened as the chat at once and showed a grant error until access was saved.

Verified on the preserved user trial Home (port 42251) in headless Chromium: the rail and strip with zero and one app, the library with drafts and the catalog, Use app on a validated tracker draft, the installed app's page, Ask Ri beside it, the More menu, the companion opened from the composer, and the tablet layout at 1000px. `pnpm ts` passes, the touched files lint clean apart from a pre-existing rule hit in the palette, and `app-places.test.ts` covers the rail's rows and routes. The chat browser smoke's rail steps were rewritten for the new structure and have not been re-run, since the trial Home has no enabled Finances instance. The earlier A3 line's "mode switches, collapsed chooser" wording describes the replaced rail.


## October 8 squash integration with main

The combined platform, navigation and source-mention changes were integrated against main `cb996c47`, from feature checkpoint `2a4d6766`. Verification ran in `/Users/agent/worktrees/ri-plugins-squash`, with its own frozen dependency installation and disposable Homes. No production Home was opened or restarted for verification.

The integration retains main's Saved results surfaces and exact saved-request validation. Reviewers receive no app context and cannot discover or invoke chat sources, including when both app flags are enabled. App context loads only after synchronous transfer holds and duplicate-send reservation, preserving recovery of held messages. Existing navigation fixtures cover both Apps and Saved results. The route inventory documents the six new CLI, broker, package-byte and backup-lease endpoints. The all-provider smoke fixture now covers the new Gmail profile, attachment and history actions.

| Check | Result |
| --- | --- |
| Full Ri suite, `pnpm test --maxWorkers=4` | 5,871 pass, 37 skip, across 635 files |
| App SDK suite | 26 pass in 8 files |
| Finances suite | 64 pass, 1 optional reference-host test skipped |
| Connector engine suite | 398 pass in 39 files, all 75 registered native actions covered by synthetic smoke fixtures |
| Packaged Finances integration | Pass, including import, source rebuild, scoped access, revocation and clean export/import |
| Typechecks | Ri, app SDK, Finances and connector engine pass |
| Production build with both feature flags | Pass using an isolated Home |
| CLI and service bundle build | Pass |
| Merge-fix ESLint | Clean |
| Broad changed-file ESLint | Four existing effect-state errors and ten warnings. All four errors reproduce using unchanged main source. They are in preview settings, general settings and the search palette. |

The full suite was rerun after the transfer fix and fixture updates. Original run logs are `/tmp/ri-plugins-merge-tests-final.log`, `/tmp/ri-plugins-merge-kit-tests.log`, `/tmp/ri-plugins-merge-finances-tests.log`, `/tmp/ri-plugins-merge-integrations-final.log`, `/tmp/ri-plugins-merge-finances-artifact.log` and `/tmp/ri-plugins-merge-build-final.log`. Retained copies, including baseline lint evidence, are in `/Users/agent/worktrees/ri-plugins-merge-backup.hp8ilho1/merge-evidence`.

The squash adds no core Ri schema changes or migrations and preserves main's newer migration history. Finances retains its separate app-owned migration history. `RI_LOCAL_APPS` and `RI_CHAT_SOURCES` remain off by default. Connected external MCP UI hosting and additional harness qualification remain outside this delivery.
