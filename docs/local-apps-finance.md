# Finances as the first included local app

October 7, 2026. Finances is implemented and fixture-qualified as an independent Ri local app whose source lives at `apps/finances` in this repository. Its own `docs/implementation.md` records standalone and managed qualification. [Verification evidence](local-apps-progress.md) and [the trial runbook](local-apps-runbook.md) cover the generic Ri adapter. Live account and bank setup remain separate.

Read with [the local-app implementation contract](local-apps-implementation.md) and [the modularity decision](local-apps-modularity.md). Finance is the first maintained service package using that contract. Ri should be able to uninstall it without losing tasks, notes, chat, or the ability to run another app. Extracting the reusable engine must preserve the same Finance experience and authority boundaries.

October 8 implemented mentions extension: [the source-mentions specification](app-connector-mentions-spec.md) defines **@Finances**, with **Finances** as its picker/chip/manifest display name. The packaged consumer test passes through the generic installed-app adapter. See [qualification evidence](chat-sources-progress.md). Preserve `ri-finance`, `/apps/finance` and `finance_*` identifiers. There is no dedicated Finances chat routing. Its example and package tests are optional consumers. If Finances is dropped or uninstalled, other app and Connector mentions continue to work. The independent shared suite runs without this package, its native dependencies, data or fixtures.

## Product experience

The app library contains an optional Finance starter with a short explanation, a fictional demo, and Add to Ri. Installed, `/apps/finance` opens its home inside Ri. It initially offers manual records and CSV import, then connection setup when the required broker operations are available. The user never supplies a server port, runs pnpm, or copies a key.

The person can open a saved budget/refund view, ask a question beside it, keep a new view, return later, or ask Ri to change the app. A saved Finance view is a record owned by the Finance app, not a new installed plugin. Changing a view definition, making a scenario, adopting a scenario, and changing app source are distinct actions. Reading or reopening a view never adopts a budget or applies a scenario.

Finance also opens beside an existing conversation from a protected view link or app picker. The current chat is retained. Selecting transactions or adjusting a proposed scenario updates that chat's bounded view context, so "explain these" refers to the visible selection. The interface refreshes after an authorized agent write, while an unapplied scenario stays visibly separate from the saved budget. The same resource/action implementation serves the app page and conversation panel.

Examples for product qualification use synthetic data: see refund gaps, compare a dining budget scenario, save the comparison, and reopen it after a restart. The existing server calculations remain authoritative. No model-generated arithmetic replaces them.

## Ownership stays intact

| Ri owns | Finance owns |
| --- | --- |
| Install, slug, app shell, supervision, builder integration | Its source, independent server and runtime artifact |
| Generic app actions, view host, initiating actor identity | Finance tools and saved-view renderer |
| Provider credentials, selected connector grants, approval policy | Its SQLite schema, migrations, transactions, accounts, budgets, receipts and evidence files |
| Scoped broker, user-visible process/job condition | Its durable sync queue, reconciliation, cursors, webhook verification and extraction rules |
| Generic task/note handoff through allowed operations | Findings, follow-up outbox, backup/restore and deletion semantics |

There are two separate credentials. **Ri → Finance** authenticates a particular user/chat scope to Finance tools. **Finance → Ri** permits selected connector operations for a bound account. Neither is a Home bearer token. Neither belongs in the browser resource or a distributable package. Revoking one direction does not silently broaden the other.

Ri must not import Finance queries, add finance tables back to its core schema, open `finance.db`, or own Finance business calculations. Finance must not import Ri source, read the Ri Home/database, or discover provider secrets on disk. Its existing standalone mode remains supported.

## What already exists, and what is missing

| Existing Finance seam | Integration use and remaining work |
| --- | --- |
| `src/lib/mcp/server.ts`, `/mcp` | Authenticated Streamable HTTP tools and UI resource already exist. Ri needs its server-side MCP adapter and preservation of UI metadata. |
| `finance_open_view` | Read-only open by saved view ID and optional revision. Use for `/apps/finance/views/<id>`. It does not provide complete first-run onboarding. |
| `ui://personal-finance/renderer-v1.html` | Self-contained standard MCP Apps renderer with no external resource/connect domains. Qualify it in Ri's opaque host rather than embedding the whole standalone website. |
| `src/lib/mcp/view-operations.ts` | Existing view callbacks check selected view, revisions and account scope. Preserve those checks and app-only visibility. |
| `src/lib/auth.ts`, `scripts/keys.ts` | Account-scoped `read`, `evidence`, `write`, `sync` client keys and revocation. Add managed-host provisioning without a user copying an owner key. |
| `FINANCE_ROOT` path helpers | Point at `<instance>/data`, containing Finance's own database, attachments and private config. Do not use its default personal root when managed by Ri. |
| `instrumentation.ts`, `src/lib/finance/worker.ts` | Finance starts its own worker with the server, independently of its iframe. Add managed shutdown/readiness and process ownership, preserve the queue. |
| `src/lib/connectors/contracts.ts`, `client.ts` | Versioned proposed broker contract, with explicit unavailable/manual mode. Ri does not yet implement that contract. |
| `src/lib/trpc/finance-router.ts` | Standalone onboarding/import/settings operations exist but are largely owner-bound. Extract/reuse shared operations and add authorized app callbacks, never proxy arbitrary owner tRPC. |
| `docs/implementation.md` | Reports standalone tests and an official AppBridge test, not Ri host qualification or real bank/mail access. |

## Managed package and runtime

Portable `plugin.json` name/package ID `ri-finance`, suggested slug `finance`, initial host API 1. Put runtime metadata under `extensions.com.ri`, with no duplicate `app.json`. Use `node` / `mcp-http-v1`, `/mcp`, `on-home-start`, and the `next-standalone-v1` build adapter. Build and runtime both require the initial `trusted-native` profile. Declare `global` and `thread` UI entrypoints. Reuse the same generic instance record, data layout, archive/export controls and process health as a generated app.

Finance must produce a relocatable artifact in its own repository. Add Next standalone output, bundle its management bootstrap, copy `public/renderer-sdk.js`, static assets and required migrations, and qualify `better-sqlite3` against Ri's pinned Node and target architecture. Its current `next start -p 42301` script and developer `node_modules` are not a deployable Ri package. Run builds with `FINANCE_BUILD=1` so packaging does not initialize a data root or start jobs. Manifest paths never point at `/Users/agent/code/finance-app` on a consumer machine.

The service entry receives Ri's private IPC initialization, sets `FINANCE_ROOT`, binds loopback on the assigned port, launches the packaged server, and reports readiness after database initialization. It stops the server and worker when the host disconnects or sends shutdown. The wrapper must not leave a grandchild Next process running. Only Ri talks to its `/mcp` endpoint. The viewer uses `/apps/finance`, even from another device.

Add a small **generic service bootstrap protocol**, not finance-specific code in Ri:

- `initialize`: host instance identity, data/cache directories, assigned port, ephemeral broker endpoint/credential and supported protocol version.
- `authorizePrincipal`: host-asserted actor ID and role (`owner-ui`, `agent`, `background`) plus an app-issued scope reference. Returns an opaque, short-lived service credential. Ri never invents a Finance account scope.
- `revokePrincipal`: invalidate the credential or actor's current leases. Revoking/closing a view must invalidate its lease.
- `status`: readiness, worker health, pending setup and bounded job summary. No private record payloads.
- `shutdown`: drain/stop and acknowledge.

These run only on the owned parent-child channel. No public unauthenticated endpoint may mint a Finance principal. `owner-ui` is available only to a human-authenticated Ri management view. Agent/background credentials remain least-privilege. The app performs scope selection and returns an opaque scope reference through its setup UI, which Ri binds to the initiating session/workspace in its generic grant store. Finance declares `ui.access` for its native account chooser. The host selects the actor, the opener binds it server-side, and native controls save the reference after human confirmation. No actor ID or credential needs to be copied. A background credential can perform only the account sync operations the owner enabled. Do not forward an owner credential when an agent or iframe asks for a tool.

In managed mode, the current process's bootstrap supplies broker credentials in memory and overrides any saved standalone broker configuration. Do not persist a Home token or revive an old process credential from Finance's config after restart. Standalone mode may keep its existing sealed, explicitly configured scoped credential.

The existing Finance client-key model needs this extension: it currently creates non-owner clients against accounts that already exist. First-run setup needs a human management principal and an empty-home UI. Each MCP callback must still revalidate the active principal, as the existing server already does. Calls carry a separate host invocation ticket in transport metadata for any subsequent broker access. It is not an account grant supplied by the guest.

## Completing the embedded experience

Keep `renderer-v1.html` for saved views. Add a network-free Finance home/setup resource and a read-only `finance_open_app` resolver taking the generic `{ path, query }` input. The manifest's `ui.resolveAction` points to it. Resolve `/` to home/setup, `/views/<id>` to `finance_open_view`, and unknown paths to a typed not-found result. View state lives in Finance, not a replayed tool call stored in Ri chat history.

Declare both the home resource and `renderer-v1.html` in `ui.resources`. Generate the installed contract, including output schemas and explicit effect/audience/retry metadata, from Finance's action registry. That registry currently supplies input schemas and mutation hints, so contract generation and output validation are real integration work, not an already available artifact.

Add app-visible callbacks for status/list saved views, initial settings, manual account creation, bounded CSV import, source setup/disconnect, and view creation/opening. Derive input schemas from existing Finance contracts and call shared Finance operations. Preserve optimistic revision checks and mutation keys for writes. Do not duplicate calculation or import logic in a second MCP implementation. Do not mark every callback agent-visible.

The parent mediates file selection/upload/download with the local-app file capability. Finance accepts the bounded bytes through its authenticated service adapter and stores its own evidence, while any file intentionally attached to a Ri task/note uses Ri's normal attachment system. Neither side passes arbitrary local paths. Manual CSV plus saved views must be usable end to end inside Ri before the integration is described as complete.

The Ri chat receives the selected Finance view reference, permitted tool descriptions, and authorized results. It does not receive every account, full receipt text, provider tokens, or the database path by default. Read, evidence access and edits remain distinct Finance permissions. Preserve integer minor-unit math, bounded account scope, selected view revision, budget revision and explicit apply/undo semantics.

Add a read-only `finance_describe_view_context` and name it in `ui.contextAction`. Its generated state schema covers selected record IDs, supported filters, the view/budget revisions and staged scenario parameters. Validate selection and scope server-side, recompute authoritative figures, and return the generic bounded context result. Never accept a browser-supplied total as an authoritative calculation. Staged values are explicitly identified as proposals. Unknown or inaccessible IDs fail without revealing their records. Use the standard MCP Apps context notification through the generic host, not a Finance-only chat API.

Package `skills/monthly-review/SKILL.md` and `skills/refund-investigation/SKILL.md` with concise workflow instructions, activation descriptions and synthetic examples. They use the current app binding and declared tools, distinguish read/evidence/write authority, and handle missing accounts or incomplete data without inventing results. Monthly review can work from manual records. Refund investigation explains when required evidence or a connector is missing. These are product workflow resources, distinct from Finance's maintainer AGENTS.md. Ri's skill manager supplies them only to authorized app-use chats. App activation, update and archive control their availability without a separate skill install.

## Connector broker: reuse the engine, fill actual gaps

Implement `/api/local-apps/broker/v1/capabilities` and `/call` as an app-authenticated compatibility facade. Finance's configured base URL points there, so there is no need to introduce its proposed example path `/api/plugin-connectors/v1`. Keep its version 1 request/result envelope and principal kind `plugin` at this adapter boundary. Internally use local-app instance/principal identity. Introduce the invocation ticket as authenticated request metadata rather than a caller-editable connection grant.

Return only operations that are fully implemented and granted. Bind connection IDs to the installed instance and recheck owner, operation, account scope and revocation for each call. Strictly validate each operation's input/output, pagination and response sizes. `input: Record<string, unknown>` and token-name filtering in the current client are not adequate server contracts. No arbitrary `fetch`, provider path, or raw tool dispatch endpoint. A missing operation leaves manual/CSV use available and clearly identifies what setup is unavailable.

| Finance operation | Ri code inspected | Required adapter work |
| --- | --- | --- |
| `gmail.messages.read` | `gmail.search_messages`, `gmail.get_message` | Current search omits page tokens, message output is normalized, and profile/history/attachment actions are absent. Add bounded provider actions for Finance's `profile`, `list`, `message`, `history`, `attachment` modes. Full receipt sync cannot be claimed from the existing two actions. |
| `outlook.messages.read` | Existing Microsoft mail toolkit | Qualify Finance's folder/message/delta/attachment modes separately. Omit the operation from capabilities until all required modes are covered. Not required for the Gmail-first slice. |
| `plaid.link.begin`, `plaid.link.complete` | Plaid provider/custom auth exists | Add Link setup/exchange, bind setup IDs to instance/account/environment, seal Item access tokens inside Ri's connector storage, return only opaque references and bounded account data. |
| `plaid.accounts.read`, `plaid.transactions.sync`, `plaid.liabilities.read` | Existing account/balance/dated-transaction/item tools | Existing tools take raw `access_token` input and do not implement sync/liabilities. Add provider operations which resolve the sealed Item token in the broker. Never pass a raw Item token to Finance or substitute dated reads for cursor sync. |
| `plaid.item.remove`, `plaid.webhook.key` | Not covered by existing toolkit actions | Add explicit operations. Item removal needs its own outward-effect policy and instance/Item binding. Webhook verification is optional until public intake is qualified. |
| `connection.release` | Existing connection management | Release this app's binding/grant. Do not globally disconnect a Gmail account used by other apps/chats. Delete an app-owned Plaid Item only through its explicit removal flow. |

Preserve existing public action IDs. New low-level actions should be generic provider operations, not `gmail.finance_read` or `plaid.finance_call`. Those names inside Finance currently map to its compatibility facade, not real Ri actions. Versioned Finance operation schemas can live in the facade and should share test fixtures with the Finance client. Gmail mode inputs come from `syncFinanceMailbox` and `decodeGmailReceipt`. Their actual required payloads must be tested, including stale history cursors, MIME parts, attachments and paging.

Mailbox consent must accurately say that granted reads may cover the mailbox. A receipt query is a relevance filter, not a mailbox security boundary. Gmail/Outlook grants never include sending mail just because Finance can read receipts. Plaid developer configuration and product/environment availability remain explicit setup. Its Link token is an intentionally short-lived setup artifact, distinct from a provider secret, and is shown only in the approved account-linking flow.

In managed mode, Ri's trusted Connectors setup surface owns Plaid Link and OAuth. Do not load Plaid's external script in the network-free guest or relax all app CSPs to make onboarding work. The app chrome's Manage access opens that host-owned setup. On completion, Finance can list the newly granted opaque connection and selected accounts. Add an authorized Finance `connectLinkedBank` operation that reads those accounts through the broker and reuses its existing source/account creation logic. No public token or long-lived Item token is needed in that guest flow. Preserve the begin/complete compatibility operations for Finance's standalone setup, with the same broker ownership checks.

First prove the broker with fixtures. Qualify live Gmail next if authorized. Bank linking is a separate Finance slice with sandbox-provider tests, complete disconnect/revoke handling, and its own live qualification. The generic app-builder trial does not wait for complete banking support. Do not advertise real receipt/bank monitoring on the strength of the fictional demo.

## Jobs, AI extraction, and follow-ups

Keep Finance's worker, leases, cursors and generation checks. Ri supervises the process, reports its condition, and starts it with the Home when enabled. It does not add a second sync schedule. Home sleep pauses work. Finance's existing catch-up behavior applies after wake. No public URL/webhook relay is necessary for first local integration.

Finance currently qualifies receipt extraction only with its restricted macOS Claude subscription profile. Keep that path and fail-closed/manual-review behavior. Do not replace it with Ri's ordinary full-authority chat helper and lose its no-tools/no-ambient-MCP restrictions. A future Ri bounded-extraction capability can replace it only after the same isolation probes pass. Packaging must detect missing harness/PDF tooling and show manual review or the documented limitation without claiming automatic extraction. No model API key is required.

Keep follow-ups in Finance's outbox initially. Add a generic `create_task` capability only with explicit owner authorization, neutral task text, and a protected app link. Avoid copying transactions or receipt content into Ri notes/tasks and their embeddings by default. A delivery must have a stable deduplication key and recorded task ID before automatic outbox retries are enabled. The current Finance outbox does not yet deliver Ri tasks. Manual Open finding is useful before this optional handoff exists.

## Included apps and a later marketplace

An included app is a maintained package in a small curated catalog, not privileged core code. Finance should be optional, independently versioned, removable, and subject to the same data ownership and capability rules as another app. Ship one catalog entry first. Add a small generated tracker as the second example so the host proves both runtime profiles before growing the catalog.

A catalog entry contains package ID/version, description, source/license, supported host/runtime/platforms, artifact digest, declared capabilities and fictional preview assets. An Add flow installs a fresh instance and requests its own grants. Merely opening the catalog does not run code or connect accounts. Read the artifact digest as an integrity check, not proof of a trustworthy publisher.

Change app creates a customized copy with its upstream package/version recorded. Never overwrite personal source changes with a silent catalog update. Initial updates are explicit replacement after validation, preserving data. Merging local and upstream changes is future work.

Finance's existing MCP tools and UI provide a path to another host, but portable packaging alone does not supply its runtime or Ri's connector grants there. Qualify a standalone capability provider or manual mode separately. An external client connecting to a Ri-managed instance gets a distinct principal through a future access adapter, never a second server writing the same database. Public ChatGPT publication also has deployment/review requirements described in the modularity decision. These do not become requirements for Finance to work well in Ri.

The package format and generic host are the foundation for a marketplace. Public submissions additionally need publisher identity, distribution integrity, dependency/build containment, malicious-code isolation, review and revocation. Curated starters are the first distribution experience. A public marketplace is not part of proving that people love creating and using local apps.

## Finance exit tests

- [x] A synthetic package installs on a clean qualified machine, opens at `/apps/finance`, and requires no terminal, copied key, fixed port, developer repo, or global package.
- [x] Empty-home setup, manual account/CSV import, saved views and one scenario work entirely inside Ri. Reopen/refresh never writes a budget.
- [x] The same saved view opens from Apps and beside an existing chat with no lost input. Selecting records, filtering and staging a scenario produces the correct per-turn context. An agent write refreshes authorized views and preserves conflicting unsaved edits for review.
- [x] Bundled workflows work from a fresh authorized chat for direct, indirect and follow-up requests. Missing evidence is identified, irrelevant requests do not activate Finance, and update/archive/revoke cannot leave a live stale skill/tool grant.
- [x] Two chat principals with different account/read/evidence/write scopes cannot borrow one another's tool results, view callbacks, service tokens or broker approval.
- [x] Scope revocation rejects the next callback and in-flight protected result. A stale budget/view revision fails with a useful refresh instruction.
- [x] Finance persists records across Home restart, its worker operates with the view closed, and disable/archive/Home termination stops its whole process tree and broker access.
- [x] Gmail and bank broker fixtures cover the complete operations actually advertised, with bounded payloads and zero credential leakage. Missing capabilities stay visibly unavailable.
- [x] Source changes preserve Finance data. Broken build/start/migration preserves a stopped snapshot and recoverable package rather than silently resetting records.
- [x] Export/import produces a fresh Finance instance with no personal data, client keys, provider bindings, setup tokens, or creation chats.
- [x] Ri's core contains no Finance schema/business/UI import. Removing this package leaves the library, tiny generated app, tasks, notes and chat working.
- [x] The packaged app-kit dependency supports these same flows through its exported API. A reference MCP host can render the qualified Finance resource with fixture data, without claiming Ri connector or public distribution compatibility.

Live connector coverage, extraction availability and platform qualification are recorded separately from these synthetic host tests. The synthetic MVP integration is implemented. Only fully qualified Gmail operations are advertised. Outlook/Plaid and live accounts remain separate gates.
