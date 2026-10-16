# Travel, Job Search and People: build record

October 15, 2026. Working checklist and decision record for the [included apps foundation](included-apps-foundation.md), [Travel](travel-app-spec.md), [Job Search](job-search-app-spec.md) and [People](people-app-spec.md). An item is checked only after its stated proof passes. Fixture and synthetic qualification is never described as live provider qualification.

## Decisions

These resolve points the specs leave open. Each is reversible without a data migration unless noted.

| Topic | Decision | Why |
| --- | --- | --- |
| Shared code | Generic pieces live in `packages/app-kit` as new public exports: `data` (migrations, scopes, jobs, cursors, blobs), `sources` (Gmail and Google Calendar bounded sync and message parsing), `time` (zone-aware dates) and `ui` (neutral React shell and styles). Domain code stays in each app. | The foundation asks for scope, sync and ingestion rules to be built and tested once. Each app bundles its own pinned copy at build time, so apps still ship and update independently. |
| Node data scope | Manifests opt in with `runtime.access: "ri-access-v1"`. The host sends `{ actorId, scopeRef, accounts }` beside each IPC invocation, the SDK must confirm the protocol at `initialize`, and an app that declares `ui.access` must declare it. Older packages are unchanged. | Satisfies the versioned, negotiated Node scope gate without changing the strict invocation context older SDKs parse. |
| Multiple accounts | A grant may bind several connections to one binding. A capability call names its account, and an ambiguous call fails. Apps learn their bound accounts from the invocation access record. | Two accounts per app are a release case. Grants already store a connection list. |
| Automatic updates | A per-app job grant plus one five-minute schedule calling `run_background_step`, managed from the native Sources dialog. The job grant names the accounts that update automatically. | Reuses existing grants and the scheduler participant. No timer inside an app. |
| Write idempotency | The view bridge carries a guest-chosen invocation ID (`_meta["ri/invocationId"]`) to the host, so a retried write reuses its ID. | "App writes take an invocation ID through the SDK." Fresh host IDs per click cannot deduplicate a retry. |
| Ri follow-ups | `create_task` accepts `dueAt` and an app `operationId`. The operation ID alone derives the task ID, so retries and repeated clicks return one task. | Foundation table: validated `dueAt` and durable operation IDs. |
| File text | New Ri capability `extract_text` reads PDF and Word text through Ri's existing parsers, bounded. Apps keep the original file by digest. | Keeps parsers and native dependencies out of app packages. |
| Styles | Each app view is one self-contained HTML resource. Shared CSS is a string from `@ri/app-kit/ui`, injected at startup. | The view CSP allows inline styles and the build adapter inlines one script. |
| Preview data | A draft preview (fixture principal) seeds the app's synthetic fixture records into its independent preview data. Installed instances start empty. | Try shows the real workflow without touching live records. |
| People context engine | Ri connectors, app-owned SQLite and optional bounded extraction. No gbrain dependency, independent memory server or automatic chat capture. | Adopt evidence, dated facts, durable corrections and waiting-on context without another operational stack. |
| Catalog compatibility | Catalog entry JSON keeps its original strict shape. Ri maps its included package IDs to icons for catalog tiles, and installed apps use their manifest icon. | A Home on older code reads `release/local-apps/catalog` live from the same checkout. A new field there would hide its whole catalog until restart. |
| Development artifacts | `pnpm --filter ri-<app> package` writes to `release/local-apps/dev-catalog`. Release staging (`pnpm apps:catalog`, `pnpm build`) still writes the real catalog. A development start skips a portable app that does not build yet instead of failing. | Keeps work in progress out of a running Home and keeps other sessions' `pnpm dev` starts working. |
| Qualification catalog | `RI_LOCAL_APPS_CATALOG_DIR` points a disposable Home at its own catalog. | Native smoke runs without touching the checkout's live catalog. |
| Portable kit dependencies | Packaging packs every `workspace:` dependency of the kit beside the kit tarball and pins it with a pnpm override, and ships each app's `tsconfig.json` so JSX uses the automatic runtime. | The portable install must never ask the registry for an unpublished workspace package. |
| Access intents | `/__host/manage-access` and `/__host/sources` both open the app's native Sources dialog when the app page hosts it. It links on to Ri's account settings for Connect and Reconnect. | One per-app access surface instead of the global settings page. |
| People CRM scope | Core people and companies, dated affiliations, saved views/lists and optional small opportunity pipelines in the first release. Companies and Pipelines are explicitly added to navigation when needed. | A personal setup and a professional CRM use the same records without a mode migration or mandatory sales workflow. See the revised People spec for actions and release gates. |

## Checklist

### Platform

- [x] Gmail `list_history` requests additions, deletions and label changes, with tests
- [x] Google Calendar typed participants, organizer, recurrence, original zone, updated time, cancellation, pagination and `sync_events`, preserving existing fields, with tests
- [x] app-kit access protocol: manifest opt-in, initialize negotiation, per-invocation access, account-selected capability calls, tests
- [x] app-kit bridge invocation IDs and widened file types, tests
- [x] app-kit `data`, `sources`, `time`, `ui` exports with tests
- [x] Ri adapter: access record, account selection, grant checks, `create_task` `dueAt` and `operationId`, `extract_text`, scope-aware grant editor, tests
- [x] Native Sources dialog: connected vs granted vs automatic, Reconnect, automatic-update schedule, Ri capability choices
- [x] Library icons per app, catalog staging and packaging for all three

### Apps

- [x] People: synthetic CRM workflow, people/companies and dated affiliations, directories and saved views/lists, optional pipelines/stage history, imports, merge/undo, commitments and waiting-on, opted-in briefings, Gmail/Calendar ingestion, scoped caches, export/restore and scale tests
- [x] Travel: synthetic workflow, trips, bookings, chronology, coverage, review, ideas, import, Gmail ingestion, calendar conflicts, scope, tests
- [x] Job Search: synthetic workflow, pipeline, postings, materials, submissions, interviews, preparation, matching, scope, tests

### Qualification

- [x] Each packaged app passes the official MCP Apps bridge test
- [x] Native disposable-Home smoke for each app
- [x] Visual inspection: populated, empty, loading, partial, error, disconnected, dark, 390 px and 360 px container widths
- [x] Typecheck, lint (changed Ri files and scripts, the root config excludes `apps/**`), app and platform tests
- [ ] Live provider qualification with owner-authorized Gmail and Google Calendar accounts (not started, needs the owner)

## Evidence

Recorded as items are checked. Synthetic data and fake providers only. No live account was read.

- Integrations: `packages/integrations` full suite 426 passed, typecheck clean. New `google-calendar-sync.test.ts` (typed sync page, both cursors, 410, unchanged `list_events` keys) and Gmail history change-type tests.
- app-kit: `test/access.test.ts` (manifest rules, negotiation, per-invocation access, account routing, refusal of an SDK that does not confirm, refusal on a host without support, guest invocation IDs through the real opaque bridge in Chrome), `test/time.test.ts` (overnight Denver to Lisbon, DST gap and ambiguous hour, ranges without dashes), `test/data.test.ts` (migrations, cursors, scopes for owner, job and chats, fair job queue, blobs, settings, transactions), `test/sources.test.ts` (message parsing, alternating history and backfill with a ten-body budget, resume without rereading, history expiry rescan, window widening, deadline yield, calendar pages, sync token, 410 reset, window advance, account store, message index). Full kit suite: 52 passed.
- Ri end to end: `src/lib/local-apps/access-protocol.test.ts` builds and activates a real generated package that declares `ri-access-v1`, then proves negotiation, the preview's fixture access, owner and job records, a capability routed to the named account, the native access page binding the intended chat over a forged actor, scope-required chat grants, two chats receiving different scopes, and a disconnected account leaving every access record.
- Ri: `src/lib/local-apps/included-access.test.ts` (access record from grants, automatic accounts, account routing and refusals, mapped provider failures, scope required for chat grants, duplicate accounts, Sources save with one five-minute schedule), `ri-capabilities.test.ts` (dated task per operation ID, invalid dates, bounded text extraction, a real PDF through Ri's parser). `pnpm ts` reports no errors in changed files.
- Apps, each from its own packaged artifact (`release/local-apps/dev-catalog`), typecheck clean and all tests passing: Travel 85 (domain, parsing, workflow, scope, sync, contract, packaged view in Chromium), Job Search 86 (domain, every stage-rule row, every release bullet, scopes, sync, workflow, contract, packaged view), People 83 (every release bullet, identity, merge and undo, imports, pipelines, follow-ups, extraction with AI off, scopes, sync, contract, packaged view, performance). People at 10,000 people, 1,000 companies and 100,000 interactions measured p95 from 0.5 to 38.8 ms for list, search, detail and Today on this machine, against a 300 ms target. Each packaged view test drives the real `dist/ui.html` through the MCP Apps bridge and reviews screenshots at 1280, 760, 390 and 360 px, light and dark, empty, partial, error and reconnect states. Screenshots stay in each app's ignored `artifacts/` folder.
- UI kit: `test/ui.test.tsx` (32) and `test/ui-gallery.test.ts` (9 in Chromium: no overflow at 1280, 760, 390 and 360 px in both themes, keyboard paths, focus, Escape, the real bridge with retry invocation IDs and coalesced context). Full kit suite after the UI kit and fixes: 93 passed.
- Self-contained change set: a detached worktree at `45682d07` with only this work applied (other sessions' uncommitted connected-apps, coordination and connector work excluded) passed `pnpm ts` with 0 errors, the kit suite (93), integrations (426), Ri local-apps, components and client suites (202 passed, 1 skipped as before), and all three apps' package, typecheck and test runs.
- Native disposable Home (`scripts/local-apps-included-browser-smoke.ts`, fresh Home from that worktree, private catalog through `RI_LOCAL_APPS_CATALOG_DIR`): for Travel, Job Search and People, the Discover tile shows its purpose icon, Preview app shows the fictional records, Use app installs it, the installed app shows its empty state, Connect email opens Ri's native Sources dialog (no account connected), a record written through the app's own action appears through the host refresh without navigation, the chosen section survives a page reload without the view reopening, an Ask button stages a scoped question in the native composer with no message sent, and the 390 px phone layout has no sideways scroll. A first run found that People's Connect email opened global settings, fixed before the final run.
- Not separately qualified per app: whole-Home backup and restore and app removal (covered by the shared local-apps lifecycle tests, plus People's own export and restore), approval wait and cancel (no included app action needs approval, all connector actions are reads), and the 360 px companion thread panel inside a chat (360 px container widths are covered by each app's packaged view test).

## Review fixes

An independent review of `b8e90a75` reproduced nine defects with synthetic probes. All nine were confirmed against the code, plus one related leak found while checking them (People list and board views showed stage labels from a private pipeline). Each fix lands with a regression test that fails on `b8e90a75`.

| Finding | Fix |
| --- | --- |
| Write receipts replayed after a chat's scope narrowed returned data from the old scope | `openAppDatabase` keys each receipt to the caller's data authority (`useAuthority`, the scope fingerprint in all three apps). A non-owner replay under different or revoked authority is refused. The write is never repeated. |
| `forgetSource` cleared at most 200 scopes | Every matching scope, in one transaction. |
| A message deleted later in the same Gmail history page stalled sync | Ri maps a message 404 to `not_found`, and `gmailSyncStep` records the message as gone and completes the page and checkpoint. |
| People schedules ran owner-scope briefings | A schedule only generates briefings inside its own account sources. Owner briefings run on the owner's Prepare. |
| Job Search shared generated prose by its citations | Visibility uses every source supplied to the model for that run. |
| Job Search showed contacts learned from hidden accounts | Contacts and other learned fields are projected by their stored source. |
| Travel showed private trip titles through shared bookings | Booking views use the scoped trip projection everywhere. |
| People exposed private pipelines through shared opportunities | An opportunity is visible only when its collection and its pipeline's collection are both allowed, in every read. |
| People indexed private company names under shared sources | Names are indexed only under sources that may see them, with a one-time reindex. |

The builders' audits closed further leaks of the same kind: Job Search no longer lets a narrower chat delete contacts it cannot see, and a contact learned in one account is no longer matching evidence for another account. Travel stops naming other trips in booking history, review reasons, import previews and import results (migration 3 rewrites stored reasons). People applies the pipeline rule to every opportunity reference, keeps an owner-only search row so the owner still finds records by a private company name, and stores briefing scope sources (migration V2) so a briefing a schedule generated from its accounts can be shown to any reader who holds all of those sources.

Behavior changes from these fixes: People's scheduled extraction no longer sees opportunities (they live in collections a schedule never holds), so stage suggestions come from the owner's own update step. In Job Search, a recruiter known only from one account no longer helps match mail in another account. Two remaining design questions were recorded, not changed: Job Search merges an interview first seen in email with its calendar event by invitation ID, so mail-derived interview details become visible to readers of that calendar account, and an automatic stage change from an account still bumps the opportunity's revision and update time that a narrower chat can see.

Verification after the fixes: app-kit 96, Ri local-apps and components 51 (1 skipped as before), Travel 92, Job Search 97, People 94, every app typecheck clean, all three packaged into the dev catalog with unchanged contracts.
