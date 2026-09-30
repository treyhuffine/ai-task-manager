# Current connectors and migration constraints

Source snapshot: 2026-09-28, after the Todoist hosted MCP migration. This is a code audit, with no account-store reads or live provider calls. [current-connectors.json](current-connectors.json) contains every provider, toolkit, static action ID, input-field list, scope, risk classification, identity model, and source path. Counts describe declared capabilities, not live operational verification.

The catalog has **29 providers and 34 toolkits**, not 34 independent integrations. There are **285 native actions: 165 reads and 120 writes**. X contributes 135 of those actions. Todoist now discovers its tools at runtime, with five deprecated native-name forwarding aliases. Its remote count is intentionally unknown in this static snapshot. Native sign-in has 17 OAuth providers, six API-key providers, and five custom-credential providers. Todoist adds one MCP provider. The bundled OAuth-client list is empty, so native OAuth requires operator environment configuration or a stored BYO client. Sources: [catalog](../../packages/connectors/src/providers/index.ts), [host runtime](../../src/lib/connectors/runtime.ts).

| Provider | Toolkits and native action counts | Current sign-in | Main parity concern |
| --- | --- | --- | --- |
| Google | Calendar 6, Gmail 7, Drive 5, Docs 3, Sheets 4 | OAuth + PKCE | Five scope surfaces, shared accounts, calendar/deck contract |
| Slack | Slack 5 | OAuth | Workspace/user identity and outward sends |
| Notion | Notion 7 | OAuth | Page/block semantics and integration page grants |
| Microsoft 365 | Outlook Mail 3, Calendar 4 | OAuth + PKCE | Shared accounts, recurring calendar/deck contract |
| Linear | Linear 6 | OAuth | Launcher task adapter |
| Jira | Jira 6 | OAuth | Launcher task adapter and cloud-site identity |
| Discord | Discord 4 | OAuth user token | Source warns posting usually requires a bot token |
| Calendly | Calendly 5 | OAuth | User/organization URI identity and cancellation |
| Raindrop | Raindrop 4 | OAuth | Bookmark/collection identity |
| Zoom | Zoom 6 | OAuth | App-level grants and meeting mutations |
| HubSpot | HubSpot 7 | OAuth | CRM portal identity |
| Salesforce | Salesforce 5 | OAuth + PKCE | Per-org instance URL, SOQL and generic CRUD |
| Todoist | Runtime discovery + 5 compatibility aliases | Official hosted MCP OAuth | One account, typed tasks, preserved old names |
| Airtable | Airtable 6 | PAT | Base/table grants and record mutations |
| Readwise | Readwise 4 | API token | Highlights, books, Reader documents, no identity probe |
| Stripe | Stripe 6 | Bearer API key | Five reads and customer creation, no payment mutations |
| Plaid | Plaid 4 | App ID + secret | Per-item access token inputs, sandbox default, read-only |
| Telegram | Telegram 4 | Bot token | Notification delivery, polling, and chat-claim flow |
| WhatsApp | WhatsApp 2 | Business token + phone ID | Business outbound messaging, not personal account access |
| GitLab | GitLab 5 | PAT | Project grants, public-host default |
| Confluence | Confluence 4 | OAuth | Cloud-site identity and page format |
| Asana | Asana 6 | PAT | Launcher workspace/task adapter |
| Zendesk | Zendesk 5 | Subdomain + email + API token | Tenant host, account ID lacks tenant qualification |
| Dropbox | Dropbox 5 | OAuth + PKCE | File identity, app-folder/full-account grants |
| Box | Box 5 | OAuth | File/folder identity and enterprise context |
| QuickBooks | QuickBooks 4 | OAuth | Callback realmId, company identity, read-only surface |
| Resend | Resend 2 | API key | Outbound sends, no identity probe |
| Mailgun | Mailgun 1 | API key | Per-action domain and regional host |
| X / Twitter | Twitter 135 | OAuth + PKCE | Large generated surface, media workflow, filtering |

## App contracts that need explicit adapters

**Calendar and deck planning are the strongest migration constraint.** [calendar/service.ts](../../src/lib/calendar/service.ts) enumerates every connected Google/Microsoft account and calls `google_calendar.list_events` or `outlook_calendar.list_events`, pinned to that connection. The result is normalized by [calendar/events.ts](../../src/lib/calendar/events.ts) and consumed by [deck/calendar-connector.ts](../../src/lib/deck/calendar-connector.ts), `/api/calendar`, and the day-shape action. Preserve recurring occurrences, time zones, all-day events, cancellation, RSVP, availability, join links, and source URLs. Google uses expanded single events. Outlook uses `calendarView` for date-window reads. A failed fetch can degrade planning to an open day, so an apparently successful connector swap can silently distort the schedule.

**The launcher reads task data without an LLM.** [task-sources.ts](../../src/lib/connectors/task-sources.ts) calls Todoist `find-tasks`, Linear `list_issues`, Jira `search_issues`, and Asana `list_workspaces` then `list_tasks`. It expects specific IDs, titles, state, assignee, priority, dates, URLs, and pagination behavior. Jira filters current-user unfinished tasks. Asana currently chooses the first workspace. Stable picker keys use `toolkitId:externalId`. Notion pages are deliberately excluded from this adapter. Todoist now validates MCP `structuredContent` and cursor pagination, which is the pattern to carry to other migrations.

**Telegram supports product functionality beyond agent tools.** The [notification adapter](../../src/lib/notifications/adapters/telegram.ts) calls `telegram.send_message` and expects `messageId`. Bot setup and chat linking call `telegram.get_me` and `telegram.get_updates` through the [Telegram routes](../../src/app/api/notifications/telegram). Saved channels contain connection IDs and chat IDs. The [notifier approval exemption](../../src/lib/notifications/caller.ts) permits only that caller's `telegram.send_message`. A Telegram MCP authenticated as a personal account would not preserve this contract. There is no equivalent Slack notification adapter currently registered.

**At this audit snapshot, X had more than generated endpoint wrappers.** The former `packages/connectors/src/providers/twitter/toolkit.ts` implemented chunked media initialize/append/finalize. The 135-action count was the unfiltered default, excluding streams and webhooks. Runtime environment allowlist, denylist, and tag filters could reduce it. `live-checks.ts` also referenced three fixed X read actions. These native files and fixed read checks were retired in the fifth delivery wave. See the [current X integration](../connectors-twitter.md).

**All providers carry persisted identity and policy contracts.** Agent scope rows store toolkit IDs and `(accountId, authConfigId)` pins. [scope-pins.ts](../../src/lib/connectors/scope-pins.ts) and [workspace-filter.ts](../../src/lib/connectors/workspace-filter.ts) resolve these without broadening access. [write-policy.ts](../../src/lib/connectors/write-policy.ts) stores overrides by action ID and defaults high-risk or outward sends to approval. Approval grants also bind action, input, connection, and action version. Preserve public names through aliases or explicit migrations, and preserve stricter user choices when a one-item action becomes a bulk tool. Todoist currently provides that policy inheritance for its three legacy task writes.

## Platform work before broad replacement

The existing hosted path is a reusable foundation for fixed-endpoint public OAuth MCP services. It is not yet a universal directory installer. A directory entry or endpoint does not establish whether our app can register, whether the same principal is available, or whether its tools match our contracts.

1. **Authentication profiles and registered clients.** [mcp-oauth.ts](../../src/lib/connectors/mcp-oauth.ts) supplies public-client metadata with token-endpoint auth method `none`, authorization code, refresh tokens, and PKCE. The product flow relies on SDK discovery and dynamic registration. There is no user/operator setup path for pre-registered MCP client IDs/secrets, provider allowlists, or client-metadata documents. Saved SDK client information can represent registration state, but that is not a configured BYO-client feature. Keep confidential-client secrets on the proper host and support explicit auth profiles before adding services that require them.
2. **Built-in bearer and unauthenticated services.** Generic custom MCP supports `none`, bearer, a custom header, and OAuth in [mcp-servers.ts](../../src/lib/connectors/mcp-servers.ts). Built-in [HostedMcpProvider](../../packages/connectors/src/providers/hosted-mcp.ts) only declares ID, name, and fixed URL, while [hosted-mcp.ts](../../src/lib/connectors/hosted-mcp.ts) requires OAuth. Add trusted auth metadata and matching setup UX instead of assuming custom-server options already cover built-ins.
3. **Tenant URLs and tenant/account discovery.** Exact URL equality currently protects built-in identity and annotation trust. Support validated tenant parameters or provider-controlled discovery without losing that boundary. New hosted connections default to `provider:default`. Reconnecting preserves the old account ID without proving the remote account is the same. Salesforce instances, Atlassian cloud sites, QuickBooks realms, Zendesk subdomains, and Slack workspaces need explicit mapping and reauthorization behavior.
4. **Multiple accounts and toolkit routing.** Built-in setup allows one entry per provider and rejects multiple old accounts. [ingest.ts](../../packages/connectors/src/mcp/ingest.ts) creates one provider and one same-ID toolkit. Every action closes over one connected client rather than routing through `ctx.connection`. Supporting multiple accounts requires per-connection client dispatch, not simply deleting the setup guard. Google needs five stable toolkit IDs, Microsoft two, and a combined Jira/Confluence server may need to map to two existing provider identities.
5. **Native OAuth migration has an auth-config mismatch.** Ingestion preserves an existing `authConfigId` but registers the MCP provider with a bearer strategy. [core/runtime.ts](../../packages/connectors/src/core/runtime.ts) loads the old minting config and [auth-config-validate.ts](../../packages/connectors/src/core/auth-config-validate.ts) rejects an OAuth config against a bearer provider. Todoist's old direct-token connections avoid this case. Resolve transport authentication separately from persisted account/client pins before migrating native OAuth providers. Blindly clearing the field would break pin matching.
6. **Local and legacy transports.** [client.ts](../../packages/connectors/src/mcp/client.ts) supports Streamable HTTP. It does not launch stdio servers or provide a legacy SSE transport path. Local directory packages would require install/runtime declarations, process supervision, per-server environment secrets, and lifecycle handling. They cannot be added as hosted URL entries.
7. **Stable contracts and changing remote schemas.** Tools are rediscovered on runtime rebuild. There is no app-level tool-list-change refresh mechanism or reviewed capability snapshot. Add schema/capability comparison, deprecated forwarding aliases, per-tool disabling, and provider-specific typed adapters. Tests must exercise data pagination and error/partial-success behavior, not just successful `tools/list` discovery. MCP responses preserve both content and structuredContent today, but deterministic app consumers still need a known output contract.
8. **Permission semantics when coverage expands.** Trusted annotation handling is opt-in for catalog-pinned providers. Generic MCP stays conservative. Read-only/destructive hints and action-name heuristics are not enough to establish money-moving, bulk-sharing, admin, or message-send intent. Explicitly review policies and preserve stricter existing overrides before exposing a larger upstream toolkit. Keep read-only Plaid/QuickBooks and limited Stripe behavior in mind.

Existing reusable infrastructure already covers sealed OAuth state, redaction, gated/audited dispatch, tool-list pagination with loop detection, remote error propagation, indeterminate mutation transport failures, callback validation, connection cleanup, and a cross-process disconnect/ingestion lifecycle lock. Those features reduce host work, but upstream maintenance does not remove our responsibility for auth onboarding, accounts, scope controls, app adapters, and regression tests.

## Product order from local evidence

Todoist is already migrated. For tasks, notes, and agent execution, prioritize **Linear and Asana with task-adapter parity**, then **Notion and Readwise** for notes and **GitLab** for execution. This is a local product ranking, not a claim that matching public vendor MCP endpoints exist or accept our OAuth client. Jira and Confluence are valuable after tenant mapping and auth prerequisites are settled. Raindrop, Dropbox, and Box are adjacent document sources.

Google and Microsoft have high product value but require shared-toolkit, multiaccount, and calendar-contract support first. Keep Telegram on its native bot path until notification parity is demonstrated. Preserve X's broad coverage and media workflow before replacing it. Give Stripe, Plaid, QuickBooks, Salesforce, and other tenant or administrative systems explicit identity and permission review. Agent-only wrappers have fewer hardcoded app dependencies, but still need action, principal, authentication, and policy parity checks.

Validation: the JSON was generated by registering source definitions in an empty in-memory registry, with no runtime or network calls. Totals and source paths were checked locally. No claim is made about which services the current user connected or which upstream operations their plan permits.
