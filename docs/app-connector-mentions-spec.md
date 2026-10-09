# @ mentions for apps and Connectors

October 8, 2026. Sections 1 through 8 are implemented in the opt-in plugins worktree. See [qualification and delivery notes](chat-sources-progress.md). Section 9 remains a separate, pending delivery under the parent plugin-platform task. Companion to [the local-apps handoff](local-apps-handoff.md), [runtime contract](local-apps-implementation.md) and [Finances integration](local-apps-finance.md).

This adds a Ri-owned source-mentions capability with an optional local-app adapter. It also defines how connected MCP apps join the same app experience in section 9. It supersedes the earlier mandatory-view, deferred-composer and local-only app-catalog assumptions. The runtime contract still governs Ri-managed app processes, storage and grants. Broad record search remains outside this slice.

October 8 ownership clarification: develop this in the existing plugins worktree on `local-apps-mvp`. The shared mentions and Connector implementation must remain usable if Finances is dropped or the entire local-app builder/runtime experiment is removed. Finances is an optional consumer and integration example. Association with the plugins and Finances tasks does not create a runtime or release dependency on Finances.

October 8 connected-app correction: an externally connected MCP service can provide both tools and UI. It is an app in the user experience and an integration in the account/transport implementation. Being locally managed is not a prerequisite for appearing in Apps or opening a protected view. A shared UI protocol does not give these two origins the same process, storage, installation or trust model.

## 1. Product outcome and naming

A person can bring an installed app or a connected account into any supported Ri chat by selecting it from `@`. It works for apps with an interface, apps that expose only tools/data, and existing Connectors. An interface is an optional way to use the same underlying capability.

The maintained starter's display name is **Finances**. Its mention chip reads **@Finances**, its picker row reads **Finances**, and its manifest sets `extensions.com.ri.displayName` to `Finances`. Preserve the internal package ID `ri-finance`, default slug `finance`, `/apps/finance`, repository name and existing `finance_*` action/resource identifiers. This display-name change requires no protocol or data migration. Searching `finance` can match `Finances` by prefix, but the selected chip uses the current display name.

| Example composed message | Expected experience |
| --- | --- |
| `@Finances What changed in my spending this month?` | Ri uses authorized Finances actions and answers in the existing conversation. The app view need not open. |
| `@Gmail · Work Find the receipt for this purchase.` | Calls made through this reference use the selected Work account. |
| `@Package tracker Which deliveries are late?` | A tools-only app works without an iframe or a dummy page. |
| `Compare these charges in @Finances with receipts in @Gmail · Personal.` | The agent can use both authorized sources in the same request. Mentioning Gmail does not grant the Finances backend direct mailbox access. |
| `@Finances Open my dashboard.` | Ri offers an explicit Open app control and uses the existing protected view host when the person opens it. |

The examples describe selected chips, not a special meaning for every plain-text word starting with `@`. Free text remains valid conversation. Selecting a picker result creates the precise reference.

## 2. MVP scope

Required: mention installed apps and connected accounts, distinguish multiple accounts, retain references through send/reload/retry, resolve them for the receiving chat, call their existing actions, and offer an optional view without moving to a new conversation. Support multiple source mentions alongside files, tasks, notes, scratchpad and PRs.

Use one **Apps** picker group for local apps and connected accounts, whether or not they have a view. Show small **Chat** and **View** capability pills instead of asking the person to choose between Apps, plugins and Connectors. View appears as available only when Ri can open it. An externally advertised view without a qualified host is described as unavailable here yet. Status is separate: Ready, Allow access, Reconnect or Unavailable in this chat. Keep the existing Settings account-management experience and its `INTEGRATION_LABELS` wording. A connected source projects its existing account into Apps without another installation or credential store. A local app uses its installed instance. Deduplicate by canonical source reference. `@app:` searches both origins. `@connector:` remains a filter alias for integration-backed sources. Multiple accounts still require exact account selection.

Use two independent Home-evaluated flags. `RI_CHAT_SOURCES` defaults off and `RI_CHAT_SOURCES=1` enables source chips, discovery and source-bound calls, including the existing Connector adapter. Local apps are enabled by default, with `RI_LOCAL_APPS=0` disabling their runtime, builder and app routes. Register the optional app source adapter only when source mentions and local apps are both enabled. Do not infer either flag from the other or let a browser request enable it.

| Chat sources | Local apps | Required behavior |
| --- | --- | --- |
| Off | Off | Existing chat, mention picker and Connector access remain unchanged. |
| On | Off | Connector and connected MCP-app mentions work without importing or starting the local-app runtime. Apps may contain connected apps, but no Ri-managed packages. |
| Off | On | Existing local-app surfaces and authorized tools work. New source discovery and dispatch are unavailable. |
| On | On | Connector, connected MCP-app and Ri-managed app mentions work together. Finances appears only if it is installed and available. |

The current harness registry qualifies the strict MCP transport only for Claude Code, with an additional installed-runtime check on send and calls. Other harnesses, including the current Codex adapter, show references as unavailable. The CLI does not bypass that boundary.

These flags describe mentions and the local runtime. The independently qualified connected-view host in section 9 uses `RI_MCP_APPS=1`, default off. Turning it off makes connected views unavailable without disabling their authorized tools or mentions. Turning off `RI_LOCAL_APPS` must not disable connected views. The Apps destination can therefore be present for connected apps even when the local builder is disabled.

Retain the inert source-marker parser and transcript renderer when either flag is off so historical chips remain readable with an unavailable state. A draft containing an unavailable source keeps its input and offers repair/remove. Do not silently dispatch it as an authorized binding. Removing Finances affects only its own references. Removing local apps leaves Connector references and their dispatch intact. Mention discovery never auto-installs an app, and `@Finances` is not a hardcoded special handler.

Do not search every mailbox, database or app's records on each keystroke. MVP searches installed-app metadata and the connected-account catalog only. Specific records/views continue to use declared entity references, protected links and the existing view-context protocol. An app-specific record picker can be added when that adapter supplies authorized, bounded search. Universal external-content search and per-message permission grants are not prerequisites.

## 3. Picker and chip behavior

Extend the existing `MentionMenuExtension` and popup. Preserve current keyboard navigation, Enter-to-select, Escape, backspace-to-edit, focus, IME behavior and narrow-screen placement. Add `@app:` and `@connector:` filters, following the existing task/note filter pattern. Titles/account labels can contain spaces within those filters.

- Search apps by display name and package identity. Search Connectors by service name and user-visible account label. Rank exact/prefix matches first, then substring matches. Bound preview groups to five results with the existing More/narrow pattern and narrowed pages to twenty.
- A service with one connected account selects that exact account. With several, selecting the service reveals account rows with identifying labels. An account-name search may return those rows directly. Never choose the first account or interpret an empty selection as all accounts. To use two accounts, insert two explicit chips.
- The human picker may show a connected account or installed app that needs access for this chat, labeled Allow access. Use the existing native access flow. Account labels visible to the human are not automatically delivered to an agent without access.
- Disconnected or uninstalled targets already present in a draft remain visible as unavailable chips with repair/remove controls. They do not silently retarget to another account or an app with the same name. If a chat's harness cannot use the required qualified tool transport, show Unavailable in this chat.
- An app row can show Open app when it has a supported view, while tools-only apps remain ordinary selectable results. The default selection inserts a source chip. It does not launch a view, invoke a tool, start an app process, change a grant or submit the message.

The chip shows an app icon and canonical display label. Connector chips include the account label, such as `Gmail · Work`. Clicking opens a small native detail popover with the current target/access status and, where available, Open app or Manage access. Removing a composer chip removes that reference from the unsent message. It does not disconnect the account or revoke an existing grant.

Once sent, the transcript keeps the chip in place. Follow-up messages can refer to that source through conversation history. Every new call still checks live access. A mention does not persistently change an agent's access settings or force all future requests to use that source.

## 4. Stable reference and persistence contract

Use a dedicated source-chip node and a shared strict parser/serializer. Keep display labels out of the authoritative identity. The stored reference is this versioned union, with TypeScript types derived from its Zod schema:

```ts
type SourceReferenceV1 =
  | { v: 1; kind: 'app'; instanceId: string }
  | {
      v: 1;
      kind: 'integration';
      toolkitId: string;
      account: { accountId: string; authConfigId: string | null };
    };
```

`instanceId` is the Ri-managed installed UUID, never a slug/package name. The wire kind `app` identifies that local installation, not every item shown in the Apps UI. A connected MCP app uses `kind: 'integration'`, the same identity as its existing tools/account, even when shown in Apps. The Connector pin reuses the exact `(accountId, authConfigId)` identity from `scope-pins.ts`, resolving the provider and exact MCP server entry from the registered toolkit/account. `authConfigId: null` means the default client. An ephemeral connection ID, email, server URL, UI resource URI or display label alone is insufficient. This includes the same account connected through two clients. Native account-free MCP connections use their host-assigned stable account identity, never a fabricated Gmail-style account.

Serialize as `[[source:<base64url>]]`, where the payload is UTF-8 JSON from one canonical serializer: fields ordered as in the union above, no optional/unknown fields, no whitespace. `source_ref` in the API is the encoded payload without the marker wrapper. This encoding is not a credential or signature. Validate all decoded fields and resolve their authority server-side. Maximum decoded payload is 2 KiB, with at most sixteen distinct source references per submitted message. Identical repeats resolve once while retaining their positions in the displayed text.

Persist these markers in the existing message `content` and composer draft representation. No new core database column/table or source-reference file store is required. Do not materialize them as task/note `chat_refs` rows. Read an exact message by ID when resolving its references, never scan or rank a chat's event history. Preserve existing file/entity marker behavior and both composer output modes.

The transcript resolves current labels/status through a bounded batch metadata lookup. An inaccessible/deleted target gets an unavailable placeholder without private metadata. Rendering a chip alone never reads app records or invokes provider tools. New malformed or unknown-version source references fail send preflight with a repair/remove error and preserved input. Existing historical content always remains readable, even when its reference cannot resolve.

Only references in submitted message content participate in source resolution. Text returned by a tool, app resource or model response cannot acquire authority, create a source binding or raise a permission grant. A cross-agent message retains its verified sender attribution and never counts as the human approving access. A pasted valid marker is still only a reference and passes the same live checks as a selected chip.

## 5. Send, access and source-bound calls

For a new send, validate and resolve source references before accepting the message or dispatching the harness. Use the receiving chat's actor, agent scope, app grants, harness capability and live connection state. The human's picker visibility does not give that chat the owner's authority. Return structured availability results so the composer can retain input and show Connect/Reconnect, Allow access or Remove reference as appropriate. A repaired draft is revalidated before send.

Connectors reuse [the existing Connect/Allow flow](connecting-from-chat.md). Source-picker requests carry a trusted exact account/client pin into the card. Reconnect targets that same connection. Approval must intersect the offered connection IDs and account pins with live metadata, never grant another client sharing the same email or label. That flow currently grants selected accounts to an agent, so the card must state that scope. Do not label it temporary access for one message. App access uses the local-app contract's native grant management. Picking a mention never grants writes, bypasses approvals or installs a package. After access changes, use the existing safe harness refresh/recycle path where necessary, retaining the conversation and unsent message.

After acceptance, retain the original markers in the event. Supply the model a bounded source-context block with the canonical label, target kind, message ID, `source_ref`, availability of a view and instructions for discovering/calling that source. Limit this initial block to 16 KiB across all sources. It contains no credentials, full data dump or automatic record fetch. Descriptions remain lower-trust app/provider data.

Add a thin domain layer at `src/lib/chat-sources/`, with the existing integrations adapter and an optional installed-app adapter. Gate the following orchestrator actions on `RI_CHAT_SOURCES`, independently of the local-app action registry. Recheck names for collisions before implementation. Their parameter validators are Zod raw shapes, and the same domain operations serve tRPC, CLI and MCP:

| Action | Input and behavior |
| --- | --- |
| `describe_chat_source` | `message_id`, `source_ref`, optional `action` or `cursor`. Read that chat message by ID, require the exact normalized reference to occur in it, and return the currently authorized source/action descriptions. Page action summaries at twenty. An `action` selects one full input/output schema. Bound a description response to 64 KiB. |
| `call_chat_source` | `message_id`, `source_ref`, `action`, schema-validated `input`, `invocation_id`. Resolve the same reference and live caller rights, then dispatch through the existing app operation or integration engine. Preserve action IDs, idempotency, approval, cancellation and result/error semantics. |

Both actions require a verified calling chat matching the referenced message's chat. The referenced row must be a submitted user message (`role: 'user'`, `source: 'user'`), not an assistant/tool event, and the chat must not be an imported read-only mirror. Preserve any verified cross-agent sender attribution. Never accept a caller-supplied chat/owner identity as authority or fall back to anonymous owner access. Human tRPC preflight similarly derives the target chat and checks access server-side. The tRPC namespace `chatSources` provides `search`, `resolve`, `describe` and `invoke` using those shared domain operations. The internal mutation is named `invoke` because tRPC reserves `call`. `enabled`, human-only `requestAccess` and human-only `openView` support the native UI. An explicit open uses the optional adapter to open the existing chat panel and never navigates away from the conversation. Search/metadata paths read trusted registries only and never execute package code.

For a Connector, resolve the stored pin to exactly one currently authorized connection and inject it through the existing engine's trusted connection selection. Reject conflicting `account`/connection overrides in tool input. Run the existing validation, approval and audit path. For an app, reuse `describe_app`/`call_app_action` domain operations and installed-contract checks, without HTTP calls between server modules. No direct provider fetch, alternate approval store or duplicate business logic belongs in this adapter.

Account pinning is enforced for calls through the source reference. Mentions express routing/context and do not remove unrelated tools the chat already has permission to use. Instruct the agent to use the source-bound operations for the referenced request. This is not a claim that mentioning one account creates a chat-wide sandbox. Existing harness availability restrictions remain authoritative, including on the CLI path.

Recheck authorization before execution and before releasing protected results. Follow-ups may cite an older message's reference but receive current grants, current contracts and current availability. Store no mutable "last mentioned account" on the session. Concurrent sends, two browser tabs and two references to different accounts must carry distinct explicit reference identities through dispatch and approval matching.

Accepted send retries acknowledge the original event, preserving existing send semantics. Reject reuse of its ID with changed source/content rather than silently replacing the binding. Any actual redispatch resolves the persisted references under current authority. Source resolution does not itself replay effects. Local apps retain the runtime receipt path. The integration adapter adds a durable Home-owned attempt ledger at `getIntegrationsDir()/source-invocations`, since the previous integration engine did not deduplicate invocation IDs. The key binds the chat and invocation, and the fingerprint includes the message, source, exact connection, action, input and authorization revision. Coalesce concurrent retries. Preserve completed results up to 512 KiB, retaining a non-replayable tombstone for larger results. An indeterminate attempt after a crash or thrown transport error must never automatically replay. Only pre-effect authorization/approval pauses can retry. This ledger does not replace existing validation, redaction, approvals or audit. A removal/revocation race after send yields a typed unavailable/revoked result, never a substituted source.

## 6. Optional views and existing view context

For Ri-managed packages, amend the runtime manifest as follows. Connected MCP apps use standard tool/resource discovery and section 9, without a synthetic Ri package manifest:

| Package shape | UI contract |
| --- | --- |
| Static app | `ui` remains required, with one resource and at least one supported entrypoint. No backend actions or resolver. |
| Node app with views | `ui` declares one to eight resources, supported entrypoints and a read-only `resolveAction`. Mutable view context requires `contextAction` as before. |
| Node app with only tools/data | Omit `ui` entirely, including resources, entrypoints and resolvers. Require at least one declared action. Both existing Node backend adapters support this shape. |

Entity descriptors can expose read/list/search actions without an open-path template. An open-path template is optional and requires a corresponding supported view. Existing Connectors retain their own tool/connection model and need no synthetic local-app manifest or process.

Ri-managed apps with views retain one package, one installed instance, one data store and the same actions for chat/UI. Connected apps retain their existing connection and provider-owned data. Either source can be mentioned without an iframe. Opening a view uses the protected host, never an arbitrary URL supplied by a mention. The model can return an Open app control, and the human's explicit open mounts the panel. Multiple sources may be mentioned while MVP still permits one app panel per chat, shared by both origins.

For a tools-only app, `/apps/<slug>` opens Ri's native app summary with Ask Ri, available workflows, access and activity. Its tools do not depend on mounting that page. `open_app` can return a native summary link identified as such, while the UI omits guest-view launch controls and never attempts to resolve missing HTML. Builder Try for tools-only apps shows fixture actions/results in the existing try chat rather than an empty iframe. The default generated template can continue to include a view.

A source mention identifies an app/account. It does not implicitly identify a saved record or copy selection from another tab. An already-bound chat panel may separately contribute its acknowledged view snapshot through the existing context resolver, under the receiving chat's scope. Deduplicate source descriptions while preserving the distinction between app identity and selected records, filters or staged values. Existing stale-context and approval-wait behavior applies without dropping typed input.

## 7. Ownership and code touchpoints

Ri owns the picker, chips, message persistence, chat authority and Connector source adapter. The reusable app kit supplies optional-UI validation, app descriptors and existing invocation/view mechanisms. It must not import Ri's editor, chat schema or integration runtime. No external repository, new daemon or separate public protocol is required.

Keep the dependency direction explicit. The shared reference schema, UI, send preparation and Connector operations must not import `packages/app-kit`, `src/lib/local-apps`, `apps/finances` or Finances contracts. Ri's server composition supplies source adapters through a small internal interface for search, resolution, action discovery and invocation. Keep the local-app implementation under `src/lib/local-apps/`, and load it only when enabled. Removing that implementation requires removing its registration, not rewriting the shared chat or Connector paths. The persisted `kind: 'app'` variant can remain inert without any app-kit dependency. This is an internal TypeScript seam, not a new external protocol or separately published package.

The common MCP Apps browser host must also survive removal of the local builder. Factor its protocol/containment primitives into the small internal workspace library `packages/mcp-apps-host`, consumed by both view adapters. Keep local process management, package manifests and Ri-specific account authority out of that library. `packages/app-kit` can re-export its existing browser entrypoint for compatibility. Ri's connected adapter lives at `src/lib/mcp-apps/` and reuses integrations. This is extraction of the shared renderer, not a second renderer, daemon or repository. Text-only source mentions have no dependency on the view host.

Use the existing plugins worktree at `/Users/agent/worktrees/ri-local-apps`, branch `local-apps-mvp`, so app integration changes meet the actual runtime. Its companion documents and implementation evidence take precedence over older snapshots in the main checkout. The worktree now maintains the Finances package at `apps/finances`. Keep shared mentions/Connector changes, the optional local-app adapter and manifest changes, and Finances-specific examples/tests in separable patches or commits. The shared patch must be reviewable and retainable without bringing along the builder, app-kit or Finances. The shared change is also assembled and verified against the main baseline in a separate disposable checkout. The delivery notes identify a retainable patch. These worktree changes do not imply a production merge or restart.

| Existing seam | Required change |
| --- | --- |
| `src/components/chat/editor/mention-menu/` | Add bounded app/Connector source search, account drill-down, filters and selection. |
| `src/components/chat/editor/chat-input-editor.tsx` | Source-chip node, marker serialization in both output modes and draft rehydration. Preserve other chip behavior. |
| `src/lib/entity-refs/` and transcript reference rendering | Shared source parser and native chip interaction, without coercing sources into task/note reference rows. |
| `src/lib/server/operations/sessions/[id]/messages.ts` and shared send preparation | Source preflight, stable accepted-message identity and bounded harness context on all send/redispatch paths. |
| `src/lib/chat-sources/`, tRPC router and orchestrator registry | Shared source contract, Connector adapter and two public actions, gated independently by `RI_CHAT_SOURCES`. Read core entities through queries, never raw SQL in transport handlers. |
| `src/lib/integrations/scope-pins.ts`, `workspace-filter.ts`, connection requests and engine | Reuse exact account pins, current scopes, action dispatch, access cards and approval identity. |
| Existing MCP client/capability snapshots, account-view evaluation and shared view host | Project connected apps into the catalog, preserve standard results/resources, and bind the common host to the exact authorized connection. See section 9. |
| `src/lib/local-apps/`, manifest/operations and app-kit public exports | Optional app source adapter/registration, optional UI, tools-only fixture, native summary link and current authorized descriptors. |
| Harness capability/session delivery and conversation panels | Genuine tool availability, safe refresh after access changes and optional explicit view opening. |

Keep mutable transient state in the existing `processState` pattern. Cancel stale picker requests and isolate caches by chat and permission/catalog revision. Invalidate on account changes, grant changes, app rename/update/archive and harness changes. No personal data, request bodies or decoded source payloads in diagnostic logs by default.

## 8. Implementation sequence and acceptance

Work in the existing plugins worktree and a disposable Home. Use fixture accounts and synthetic app records. The shared mentions/Connector slice can ship independently of local apps. Its optional app adapter extends local-app slices A through D. Finances-specific qualification belongs to the Finances integration slice and does not block the shared capability if Finances is dropped. Existing checked A through G evidence covers the earlier runtime only and does not qualify this new extension. Record actual commands and harness/browser versions alongside this checklist.

1. Implement source schemas/serialization, the internal adapter seam and the Connector adapter under `RI_CHAT_SOURCES`. Extend the picker, chips, drafts, transcript, send resolution and source-bound calls. Prove the complete Connector path with local apps disabled.
2. Add the optional local-app adapter in a separate change. Amend optional-UI validation and add generic view and tools-only app fixtures. Qualify app/Connector combinations and optional view opening without installing Finances.
3. Verify removal and independent delivery in a disposable checkout containing the shared mentions change without the local-app runtime, builder, app-kit or Finances. Typecheck, build and exercise Connector send/resolve/call plus historical app chips there. Also test both feature flags in all four combinations in the combined checkout.
4. Exercise `@Finances` through the same generic path while that package remains in scope. Keep its package fixture and end-to-end checks separate from the shared qualification suite. Dropping Finances removes only this consumer-specific slice.

Connected-app classification and stable identity are part of step 1. Production connected-view hosting is a separate, required delivery slice under the parent plugin-platform task, with the checklist in section 9. It may proceed alongside the optional local-app adapter and cannot depend on Finances or the builder. Do not mark connected UI support shipped merely because mention dispatch or the existing evaluation works.

Shared Ri/Connector requirements, independently shippable:

- [x] Keyboard, IME, mobile popup, filters, account drill-down, backspace, pasted references, draft reload and both composer output modes work alongside every existing mention kind.
- [x] Two same-provider accounts and the same account connected through two clients resolve exactly. Renamed labels and reconnects preserve stable identity. Missing/ambiguous pins never widen or silently change accounts.
- [x] Picking, hovering, rendering and searching trigger no app startup, provider query, automatic view opening or grant change. Slow/stale search results cannot overwrite another chat's picker.
- [x] New-send validation preserves input on missing access, malformed references, unavailable harnesses and revoked sources. Accepted retries cannot change a binding or duplicate invocation effects.
- [x] Two chats, two tabs and mid-turn follow-ups retain the correct message/source/account association. Forged cross-chat references, unauthorized schemas/results and source markers in tool output cannot expand access.
- [x] The action path enforces account pins and current actor/app grants, rejects conflicting account inputs, preserves approvals/cancellation and handles revocation before execution or result delivery.
- [x] A human with broad account access cannot leak data through a narrower chat. Access cards describe their real grant scope and refresh tools safely on each advertised harness.
- [x] Connector mentions work with local apps disabled, with no app metadata initialization or runtime imports/startup from the source path. Disabling `RI_CHAT_SOURCES` preserves existing chat/Connector access and readable historical source chips. Historical app chips remain readable and unavailable.
- [x] A separate disposable checkout builds and passes Connector mention/send/resolve/call checks with the shared change and without local apps, builder, app-kit or Finances. No Finances imports, IDs, schemas, installation step or fixture is required by the shared implementation and suite.
- [x] Feature-off and app removal preserve core chat/Connector behavior and readable historical messages without starting a runtime. Relevant unit/integration/browser checks, `pnpm ts`, scoped lint and isolated build verification pass.

Optional local-app adapter requirements, qualified without Finances installed:

- [x] A UI app, tools-only app, static view and existing Connector work through their supported paths. Multiple source mentions do not create extra chats or panels. Headless builder Try shows useful fixture results.
- [x] Opening a generic app view is explicit, and its existing-chat view context distinguishes selected records and staged changes from the app-level mention. A tools-only app needs no HTML or dummy resolver.
- [x] All four feature-flag combinations match section 2 in the combined checkout. The app source adapter is unavailable unless both flags are enabled. The shared actor, retry and revocation checks above also pass against generic app fixtures.

Finances consumer requirements, applicable while the Finances package is in scope:

- [x] Finances can be absent, uninstalled or archived while other app/Connector mentions continue to work. Old Finances references stay bound to their original instance and become unavailable, never retargeting or reinstalling it.

- [x] `@Finances` is the canonical picker/chip/manifest display name. Existing internal IDs, URL and actions remain stable. It resolves through the generic installed-app adapter with no special dispatch path.
- [x] Opening Finances is explicit, and its existing-chat view context still distinguishes selected records and staged changes from the app-level mention. The same request can reference Finances and an exact Gmail account without widening either source's grants.

Checked boxes are backed by the [recorded fixture, browser, SDK, Finances and isolated-build checks](chat-sources-progress.md). Browser qualification uses the real editor in a narrow Chromium fixture. It is not a new full desktop release or live Gmail/bank qualification. Existing view-host qualification is retained, while section 9 production remote views remain unchecked. Follow-on record search requires an adapter's explicit bounded search contract and is not part of this MVP checklist.

## 9. Connected MCP apps and a common view host

### One app experience, distinct origins

| Source | Tool path | UI path | Lifecycle owner |
| --- | --- | --- | --- |
| Ri-managed small app | Ri action adapter and supervised IPC | MCP Apps bridge through the shared host | Ri builds, installs and supervises the backend and app data |
| Ri-managed service, such as Finances | Private MCP service adapter | MCP Apps resources and shared bridge | Ri supervises the packaged service, which owns its data |
| Connected MCP app | Existing integration engine to the selected server/account | MCP Apps resources and the same shared bridge | Provider owns deployment, storage and jobs. Ri owns connection access and the view session |
| Tools-only Connector | Existing integration engine | No view unless one is actually advertised and qualified | Existing connection lifecycle |

MCP Apps supplies tool-associated `ui://` HTML resources, `resources/read`, and JSON-RPC messages between an embedded view and its host. This is the common UI protocol. Small local apps can adapt their IPC actions to it without running a public MCP server. MCP itself does not standardize Ri's package installation, builder, database directory, supervision, global launcher or account grants. [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview), [pinned specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

Use one Apps destination, common source chips and one app-panel experience. The catalog combines local installations with connected app descriptors derived from the existing integration registry. Show Local or Connected provenance in details when it helps. Creation/editing and package export belong to Ri-managed apps. Connected apps offer account management and provider-supported operations. Ri must not pretend it can edit or export a provider's backend. Connecting an external app does not install a local process or allocate a local app database. Disconnecting it does not delete provider data.

Derive tool/UI capabilities from the exact account's cached, reviewed definitions. A UI association is advertised, qualified or unavailable, not proof that a view has already rendered. Multiple resources or tools from one service are workflows of the same connected app. The normal picker renders one source/account row, with the same identity used by its tools. Do not merge a local package and an external account merely because their names match. Do not contact upstream servers or fetch HTML during picker search/hover. Refresh discovery through the existing connection lifecycle and revalidate before use.

### Opening and invoking a connected view

1. Preserve `_meta.ui.resourceUri` and tool visibility through discovery, using the compatibility alias only where the qualified adapter supports it. UI-only resources need not appear in `resources/list`. Authorize a declared resource on that exact account and fetch it through the Home's existing MCP transport, never a browser-supplied proxy URL.
2. Run the selected model-visible tool once through the existing integration engine and account pin. Keep its original MCP result for the view through the existing `captureOriginalResult` seam, with current redaction and authorization checks. Preserve `content`, `structuredContent`, `isError` and UI-only `_meta` for the proper recipient. Private UI metadata never enters model context, transcript text, embeddings or generic logs. A canceled, approval-required or failed call must not appear as a successful view.
3. Offer an explicit Open view control for a successful UI-bearing result. Bind a host-issued opaque view handle to the authenticated viewer, initiating chat/actor if any, normalized source reference, exact server/account, capability/credential revision, resource identity/hash and invocation ID. Reopening that captured result or remounting a frame never repeats the originating tool. A missing/expired capture shows an unavailable state and requires a distinct explicit new invocation to run again.
4. Route every iframe tool call through the same integration engine and bound account with app visibility enforced. App-only tools remain hidden from the model. A view cannot call another connection, the general Ri broker, or local app tools by supplying their names. Approval identity includes the actual source, view, actor and invocation, with the existing direct approval/cancel experience. Do not copy the evaluation's anonymous app approval identity into the production host. Recheck grants and revisions before execution and before delivering a result.
5. Disconnect, revocation, disabled tools, credential/capability changes and view expiry invalidate that handle. Stop frame callbacks and clear its transient context. A global human view never lends owner access to a narrower chat. Attaching it to a chat creates a newly checked binding. Closing a view ends its view-owned reads/polling, while already accepted server work follows existing cancellation and outcome rules.

For the first production slice, reuse the evaluation's bounded capture model with state moved into `processState`: at most 32 active view sessions per Home, a 30-minute lifetime, at most 80 captured invocations and 8 MiB of captured results per session, and at most 512 KiB per result. Expiry or Home restart loses the interactive capture and leaves readable chat text. This does not claim durable remote document/view restoration. Never store executable HTML or private UI metadata in ordinary chat content. A later durable result store is a separate extension, not a prerequisite for mentions. These are view-capture limits, not a license to replay a completed call whose capture failed.

A standard MCP App may only supply tool-result views, with no standalone home screen. An Apps row therefore opens Ri's native connected-app summary, showing the selected account and Ask Ri. Open last result is available only for an authorized live capture. A launch action requires an explicit host-qualified entrypoint and valid inputs. Never guess a tool by name or call the first tool with `{}`. Keep local `/apps/<slug>` routes. Use `/apps/~connected/<server-entry-id>` for the native connected summary, resolving the canonical account on the server. The `~connected` segment cannot collide with the existing local slug grammar. Route dispatch and the shared Apps navigation must work without initializing local apps.

### Reuse the protocol without imposing Ri's private conventions

The current local `AppViewController` wraps business-action replies and expects Ri's JSON context envelope. The connected adapter must preserve ordinary MCP tool-result envelopes and standard bounded `ui/update-model-context` content without requiring a provider to implement Ri's `resolveAction`, `contextAction`, revision envelope or package manifest. Keep local business-result wrapping and authoritative selection resolution in the local adapter. A remote context update is lower-trust, attributed view content, capped at 8 KiB and ten updates per second, attached only to its verified chat on the next human send. It is not a grant, verified database record or instruction. It must not submit a message automatically.

Use one shared `AppBridge` implementation and a common conformance suite with origin-specific resource and authority adapters. Preserve the local host's containment regressions when factoring it out. Connected HTML remains external content even though no server code runs locally. The first connected-view profile supports self-contained resources through the qualified network-free host, capped at the existing 12 MiB prepared-view bound. Validate resource MIME, metadata, HTML and actual required capabilities before mounting. A view requiring external scripts, network access, an unsupported sandbox/domain feature or host extension gets a specific unsupported-view state while its authorized tools/text remain usable. Do not silently broaden CSP or load the provider website as Ri's page. Additional network-enabled profiles require separate browser, desktop and remote-viewer qualification. Protocol compatibility alone does not establish provider client admission, authentication, licensing or UI compatibility.

`RI_MCP_APPS=1` enables the production connected-view adapter independently of `RI_LOCAL_APPS` and `RI_CHAT_SOURCES`. It does not replace the existing experimental example launcher or grant accounts. Negotiate only the capabilities actually supported by the qualified host. With connected views off, source mentions and normal tool calls still work. With local apps off or their code removed, connected views still work using the retained shared browser host. Keep the local runtime, reusable browser host and connected adapter in separable changes.

### Existing evidence and required qualification

The [account/public-app evaluations](plugins-evaluation-accounts.md) already exercise external MCP Apps, original-result capture and exact-account transport. They are valuable fixtures and evidence, not production ordinary-chat support. Their separate temporary host/tunnels, in-memory evaluation sessions and limited account candidates must not become hidden runtime dependencies. Existing local-app tests do not qualify arbitrary remote HTML or generic MCP context/results either.

- [ ] A connected UI-bearing MCP source appears once in Apps and `@`, with its exact existing account pin. A tools-only server stays usable. Multiple tool resources do not become duplicate installed apps, and a local/connected name collision remains distinguishable.
- [ ] One shared bridge renders an independent MCP Apps fixture with no Ri manifest or context envelope and a generated local fixture. Preserve original result fields, app/model visibility and UI-private metadata boundaries. No second renderer or direct provider access from the iframe is introduced.
- [ ] Browser refresh, remount, delayed response, two viewers and expired/restarted captures never replay the originating call. A contextual-only app has useful Ask Ri/Open result behavior without a fabricated launcher. Unsupported views preserve useful tool/text behavior.
- [ ] Two accounts, two views and a narrower chat retain distinct authority. Cover revocation before result delivery, changed tool/resource definitions, approval wait/cancel, forged resource/view handles, cross-account callbacks and context attribution.
- [ ] With local-app runtime, builder, app-kit and Finances removed, retain the shared host and prove connected views and Connector mentions in an isolated build. With `RI_MCP_APPS` off, tool use still works. With `RI_CHAT_SOURCES` off, a supported view can still open from an ordinary authorized tool result. Verify local app views independently retain their existing flag behavior.
- [ ] Qualify the packaged host in browser, desktop and an ordinary remote viewer without evaluation tunnels or provider credentials in frames. Record unsupported capability states and actual tested versions. Prior experimental evidence alone does not check this box.
