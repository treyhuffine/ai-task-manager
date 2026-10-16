# Foundation for Travel Job Search and People

October 15, 2026. Implementation requirements for three included apps. The apps are implemented in `apps/travel`, `apps/job-search` and `apps/people` and qualified with synthetic data only. Live provider qualification is still open. See the [build record](included-apps-progress.md). Read this alongside the individual [Travel](travel-app-spec.md), [Job Search](job-search-app-spec.md) or [People](people-app-spec.md) spec. Each app can ship independently.

The product precedent is the [Finances experience](finances-experience.md): a useful visual workspace, neutral styling, durable app records and Ri's existing chat. The existing [local app contract](local-apps-implementation.md) and [source mentions](app-connector-mentions-spec.md) remain authoritative for host permissions and protocols. This document adds requirements for these apps and identifies platform work they need. It does not mark proposed capabilities as shipped.

People uses Ri's own lightweight relationship context. It has no gbrain dependency, separate memory MCP server, global chat capture or additional background service. Its companies, lists and optional opportunity pipelines live inside that app. They do not introduce a universal CRM database into Ri or require changes to Travel and Job Search.

## Experience shared by all three apps

Open apps from the existing Apps library. Keep Settings access to account connections. An app's Sources screen reuses Ri's connection picker and access controls, including existing accounts and Reconnect. It must distinguish an account connected to Ri from access granted to this app and automatic updates enabled for that account. Setup is remembered by installed instance ID, never inferred from whether the view is mounted.

Use the app name and a purpose-specific icon in the library. The default names and suggested slugs are Travel (`travel`), Job Search (`job-search`) and People (`people`). Mentions use the same names, including the two-word Job Search picker label. Persist source references, never parse display text as identity. Suggested slugs may change on install. Generate all deep links from the actual installed route.

Reuse the native app header, navigation and Ask Ri pane. An app may have section navigation within its content. Do not add another permanent rail, model selector, chat history or chat engine. The product's most useful records should occupy the first screen, with setup and diagnostics under Sources.

### Visual system

| Element | Requirement |
| --- | --- |
| Surfaces and type | Match Finances: neutral white, gray and charcoal in light and dark themes. No app-wide green, blue or purple tint. |
| Hierarchy | One clear page title, short context line, one primary creation/import action, then the working view. Avoid a row of generic KPI cards. |
| Color | Use sparingly for a meaningful warning, failure or completed state. Always pair with text or shape. Ordinary navigation, text, charts and avatars remain neutral. |
| Density | Comfortable 14 px body text, 12 px secondary metadata, 28 to 30 px main title, restrained borders, 16 to 24 px spacing. Aim for useful records visible without scrolling at desktop sizes. |
| Detail | Selecting a record opens an inspector in the app area. At narrower widths it becomes a dedicated detail screen with Back preserving filters and selection. |
| Chat | On a wide screen, Ask Ri is the existing native pane, approximately 360 px wide. At smaller widths, use Ri's existing app/chat switch. Avoid squeezing list, inspector and chat into three unreadable columns. |
| Narrow app frame | Respond to the actual app container, including a 360 px companion frame. Below 700 px use one content column. Essential actions remain reachable at 390 px and with 200% text zoom. |
| Accessibility | Semantic lists/tables, labeled controls, visible focus, keyboard alternatives to dragging, text alternatives for charts and no hover-only information. Use Ri's Tip component in native chrome. |

The companion mockups use fictional records. They specify hierarchy and selected interactions, not production components or a second design system. The current neutral Finances styles take precedence over older tinted mockups.

### Conversation and record changes

`Ask Ri` stages editable text in the intended native composer using the existing host chat intent. It preserves other draft text, attachments and source chips. It does not send a message or grant access. Selection and filter state travel through the existing MCP Apps context path and are re-resolved by the backend when used. A label in a prompt is never authority.

Context contains the installed app reference, resource, selected entity IDs, filters and record revisions. Keep updates within app-kit limits, including 50 selected records and 8 KiB context snapshots. The backend returns a bounded summary of authorized records and source references. It never sends a whole mailbox, every contact, raw file bytes or hidden UI metadata to the model. A reference to another app does not automatically grant access to it.

Distinguish recorded facts, user corrections and AI suggestions. An AI suggestion must name its evidence or explain what is missing. Model output is validated against a strict domain schema. The model cannot set grants, choose arbitrary capabilities, execute embedded instructions from a source or apply external writes by generating a plan.

Local record edits use revision checks and durable mutation IDs. Refresh and background ingestion preserve a typed form and do not silently overwrite a user correction. A conflict lets the user compare current values and retry. All outbound sends, bookings, applications and invitations stay outside the initial app releases. A draft is editable text until a separately authorized action executes.

## Runtime and storage

Create independent pnpm workspaces under `apps/travel`, `apps/job-search` and `apps/people`, with package names `ri-travel`, `ri-job-search` and `ri-people`. Each contains its own domain implementation, schema, forward migrations, tests, README, AGENTS.md, generated contract and fixture data. Ri imports no app domain module. Finances is not a runtime dependency.

Use the existing native Node `ri-ipc-v1` profile and `ri-esbuild-v1` build adapter first. The backend uses app-kit's public `openAppDatabase` wrapper and qualified Node SQLite runtime. The view is a bundled, self-contained MCP Apps HTML resource, authored with React to reuse the team's UI approach. There is no new Next server, database server, container or third-party daemon. Follow the current package/runtime qualification rules and fail unsupported targets before execution.

Persist data only under host-resolved instance data directories. SQLite stores domain records, source references, cursors, jobs and mutation results. Large imported content lives in app-owned files addressed by digest. Every domain table has immutable IDs and created/updated timestamps. App policy defaults are supplied in the app query layer. Ri core schema changes are not required by the domain models below.

Views use the standard MCP Apps bridge and the existing opaque, network-free containment. File selection, export and external links use native host controls. Do not introduce guest fetch, CDN dependencies, remote images, map tiles, arbitrary filesystem paths or provider credentials in browser code. Use existing file-transfer hooks, qualifying any missing generic adapter rather than importing Finance code.

Exports of an app package contain reusable code and fictional fixtures only. Personal record exports are a separate human action. Archive stops schedules and revokes active authority while retaining records. Delete data removes the instance's records after writers stop. Removing an app preserves Ri tasks it deliberately created. Whole-Home backup and restore use the existing app snapshot boundary, including SQLite WAL consistency and permission review after restore.

## Connector and host work required before release

The current checkout supplies useful adapters, but their presence is not evidence that every new workflow works. Extend the shared integration package once and reuse the extension across these apps.

| Existing seam | Required work |
| --- | --- |
| `packages/integrations/src/providers/google/gmail.ts` | Reuse `gmail.search_messages`, `gmail.get_profile`, `gmail.read_message` and `gmail.get_attachment`. Extend `gmail.list_history` compatibly to request deletions and relevant label changes, since its current request only asks for `messageAdded`. Preserve pagination and provider errors. |
| Google Calendar adapter | Add typed participant, organizer, recurrence identity, original time zone, updated time and cancellation fields. Expose pagination and a separately qualified sync action or compatible optional sync mode. Current event summaries omit those fields and cursors. Preserve existing callers' response fields. |
| Microsoft mail and calendar adapters | Before advertising automatic Outlook support, qualify recipients, sent mail, thread identity, stable item identity across moves, attachments, full pagination, incremental updates and calendar participants. Current summaries do not supply the full contract. |
| `src/lib/local-apps/service.ts` | Use the existing `AppInvocation.capability` dispatcher, exact action IDs, selected bindings and current grant intersection. The separate Finance HTTP compatibility broker currently qualifies Gmail reads only and is not the API for these Node apps. |
| `src/lib/local-apps/ri-capabilities.ts` | `ai_text` currently requires the qualified Claude subscription harness, with bounded input/output and a tool-free run. Use it as qualified or expand harness support through the one-shot helper and tests. Never add model API keys to an app. Show extraction unavailable when unsupported. |
| Ri task capability | `create_task` exists but its app schema currently omits due dates. Add a validated `dueAt` field before offering a dated Ri follow-up. Call existing queries and preserve idempotency. App-local task links retain a durable operation ID so a retry uses the same host invocation. |
| Source setup and scheduling | Reuse existing grants and scheduler registration. Remember initial import bounds, account selection and the separate automatic-update grant. Verify the scheduled principal has only its selected read and AI capabilities. |
| App data scope for Node IPC | Existing service apps receive the host-selected `serviceScopeRef`. The current Node `InvocationContext` carries a principal but no scope reference. Qualify a versioned, negotiated equivalent for Node apps before enabling agent access to their private records. Preserve old package compatibility and reject unsupported scope requirements. |

Google is the first live provider target for each app. Microsoft is the next adapter, not an MVP prerequisite. Manual/import workflows remain first-class. Display only qualified connection choices, with useful unsupported and reconnect states. A provider appearing elsewhere in Ri does not justify a working button here.

## Bounded ingestion and background behavior

Use one host-owned schedule per app, initially every five minutes while enabled, calling `run_background_step`. That action chooses one due sync or enrichment job and runs one bounded step. Alternate ingestion and enrichment when both have pending work, and rotate accounts so a large mailbox cannot starve another one. There is no independent cron loop. On restart, catch up from committed checkpoints and run at most one overdue slot. Opening a view reads saved records immediately without starting a full sync.

Separate ingestion from enrichment. `sync_step` reads at most one provider page and ten new bodies, yielding at a record boundary before a 20-second work budget. Network operations respect the remaining deadline. `enrich_step` processes one bounded extraction batch with a 40-second action timeout. Persist progress after each committed batch. Background jobs never send messages or change external records. Large initial imports show progress and can be paused. User-requested Continue import runs the same bounded actions. Do not spin an unbounded chain in the browser.

Use the current scheduler's supported interval/dispatch mechanics. If an app needs faster backfill continuation, add a bounded continuation through that scheduler with fairness and cancellation tests before claiming it exists. Do not hide a second timer in the app process. While a serialized action is running, the mounted view retains its last snapshot. Refresh coalesces, and first-open busy/approval screens use native cancel controls. Test this interaction early so initial import cannot make the app feel frozen.

For each account, checkpoint means the last fully committed page sequence, not the newest ID observed halfway through a page. Upsert sources by provider, connection and external ID. Store a payload digest, observed time, source timestamp, extraction version and retained evidence. Jobs record their source key, pending/running/completed/failed state, attempt count, next eligible time and redacted error. Recover interrupted running jobs as pending only when their step is idempotent. Persist cursor and source changes transactionally. Expired provider cursors trigger a bounded rescan of the configured history window with explicit coverage, never an unbounded mailbox scan. Gmail documents full and incremental sync with history-expiration recovery. Calendar documents page and sync-token handling. [Gmail sync](https://developers.google.com/workspace/gmail/api/guides/sync), [Calendar sync](https://developers.google.com/workspace/calendar/api/guides/sync)

Keep AI work proportional to new relevant content. Use structured provider data and deterministic parsers first. Skip unchanged content hashes, bulk mail and already rejected suggestions. Bound text before sending to `ai_text`, validate results and preserve source passages. Invalid extraction leaves a reviewable source, never a fabricated record. Sources state the history range, last successful update, pending count and whether coverage is partial.

People explicitly separates read-only sync from opted-in relationship extraction. Its extraction switch starts off, uses a separate AI capability grant and can be paused without stopping sync. Manual records, deterministic linking, search and timeline views remain useful without AI. Current deltas take precedence over historical backfill within the existing fair schedule. This does not add a second ingestion engine or another timer.

Disconnect immediately stops future reads and queued enrichment for that connection, and invalidates relevant view/context authority. In Sources, distinguish Disconnect from Delete imported data. Disconnect preserves the owner's existing local records by default. Rebinding or sharing an app with a chat always requires explicit app data scope, including any retained imported records. Delete imported data removes cached content, derived fields supported only by that source and their search entries, while preserving explicitly authored user notes. Existing chat messages and external backups are not silently rewritten.

## Common action contract

Every app generates its contract from typed action definitions. Define strict schemas, effect, allowed audience, retry behavior, errors and fixture examples. Common proposed actions are `open_view`, `describe_view_context`, `create_scope`, `list_sources`, `run_background_step`, `sync_step`, `enrich_step`, `preview_import`, `apply_import` and `create_follow_up`. They are local to the app instance, not new hardcoded Ri orchestrator actions. The background dispatcher is schedule-only, has a 40-second timeout and invokes internal domain operations rather than recursively invoking the host action queue. Interactive sync/import continuations have user audience. Source selection, scope creation and destructive source management are user-only.

List actions take an opaque cursor and limit, default 50 and maximum 100, and return items, next cursor, coverage and revision. Detail actions take an entity ID and return only its authorized data. App writes take an invocation ID through the SDK and an expected revision for updates. Import apply takes an expiring preview ID and digest, not a client-supplied replacement parse. Reads are `read_safe`, local writes are `idempotent`, and AI calls may retry only within their bounded job budget. `sync_step` and `enrich_step` have `app_write` effect and explicit schedule audience. Read-only context resolution never initiates ingestion or enrichment.

Scope app data at least by source account and explicit manual collection. The owner can share all or selected collections with a chat. Every query, search, export and context resolver applies that scope before assembling results. A mixed-source record exposes only fields and events supported by allowed sources, plus explicitly shared user notes. If the initial app cannot safely project a mixed record, exclude it and offer a human sharing choice rather than leaking the other account.

Apply the same rule to derived counts, sort keys, snippets, company rollups and cached AI prose. Cache generated summaries by exact scope fingerprint and evidence revisions, invalidating them on correction, deletion, source changes or revoked access. A broad owner briefing cannot be served to a narrower chat by merely hiding its source links.

For the Node scope extension, reuse the existing native `ui.access` workflow and host grant record. Each app supplies a user-only `create_scope` action taking the host-bound actor ID, selected source/collection IDs and allowed operations, and returning an opaque `scopeRef`. The app stores the immutable scope definition and its actor. The Node invocation must receive the reference selected by the current host grant over trusted IPC, never a reference supplied by ordinary action input or view state. Verify actor, operations, scope revision/revocation and instance on every read. Creating a scope during access review does not make it effective until the host saves the corresponding grant. A chat with no selected scope is denied. The owner UI retains its explicit owner context. This is a release gate, not existing Node behavior to assume. Implement and test it in app-kit and the Ri adapter once for all three apps.

Keep connection authority and stored-data authority separate. A scheduled read grant authorizes its named account actions and the corresponding app collection. It does not grant the job access to arbitrary existing records or confer those records on a chat. Export and source deletion use the same app data scope rules and owner-only management gates.

## Shared release checks

Each app must pass its own domain fixtures, adapter fixtures, packaged official MCP Apps bridge test and native disposable-Home smoke. Required cases include two accounts, two chats with different grants, revoked access during a request, stale edits, interrupted imports, cursor expiration, duplicate delivery, approval wait/cancel, offline reopen, backup/restore and removal. Prove no source payload leaks into logs or another chat.

Visually inspect populated, empty, loading, partial, error, disconnected, dark, 390 px mobile and 360 px companion states. Check keyboard interaction, text zoom, source links, preserved drafts and native chat handoff with no automatic send. Qualify actual connector behavior separately from fixtures, with owner-authorized accounts. Do not describe fixture results as live provider qualification.

The individual specs define domain exit scenarios and sequencing. Build one app at a time, starting with a full synthetic workflow, then its first live read connector. No shared People database, universal ingestion service or marketplace is a prerequisite.

## Design artifact review

The three linked HTML concepts share `docs/mockups/included-app-concepts.css`. Travel and Job Search use `included-app-concepts.js`. The expanded People CRM concept uses `people-app-concept.js` and `people-app-concept.css` beside its HTML file. Open any HTML file directly in a browser with those companion files present. Section navigation, record selection, theme switching, review decisions and draft staging demonstrate the intended interactions. Inputs and changes remain in memory and reset on reload. Creation, file import, permission and task dialogs illustrate their review steps without accessing a Home or account.

On October 15, the initial three concepts passed 78 section/width layout checks from 320 to 1,500 px, with no page overflow, browser script errors or external requests. Desktop, mobile and dark/chat renders were visually inspected. Targeted interactions covered booking change review, a narrow booking inspector, pipeline filtering and stage changes, interview preparation, saved note edits and native-chat draft preservation.

The expanded People concept subsequently passed 96 section/width checks across the same width range, including its company sections, directory, optional pipeline and follow-up views. Interaction checks covered adding/hiding views without losing records, filtering and saving a view, notes, stage movement/history, dismissal, independent sync/extraction switches and preserved chat drafts. Keyboard dialog access and 200% zoom were checked. Desktop, mobile and dark renders were inspected. The screenshots in the People spec show this expanded fictional preview. These are documentation checks, not implementation, performance or connector qualification.
