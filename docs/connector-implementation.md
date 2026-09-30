# Connector implementation progress

Started September 28, 2026 from the [ranked audit](connector-audit/README.md). The audit files remain a dated research snapshot. This file tracks implementation and evidence that changes the original ranking.

**Current direction:** Build a broadly useful connector catalog across personal and business services. The user explicitly broadened the scope beyond productivity tools and endorsed the ten candidates below. Rank additions by useful capabilities, likely use, incremental coverage and integration effort. Prefer vendor-maintained hosted MCP where available. QuickBooks remains paused at the user's request. Do not pursue its setup or live account acceptance until the user resumes it.

## Seventh delivery wave

The user requested the next high-leverage connectors. Recheck the remaining cross-category queue first, then select useful additions with a documented custom-client path. Vendor admission is distinct from code support. QuickBooks remains paused.

- [x] Recheck Ramp, Figma, Canva, Vercel, Shopify and monday.com against current primary sources and qualify additional ready hosted candidates.
- [x] Implement the selected usable connectors with named catalog entries, setup guidance and per-account authentication.
- [x] Verify endpoint and credential isolation, setup behavior and the existing approval policy with meaningful regressions.
- [x] Record concrete remaining vendor requirements, reconcile the catalog and run relevant checks.

**Delivered:** five official hosted connectors. The current catalog contains **65 providers: 55 external MCP and 10 native**.

| Connector | Useful coverage | Connection |
| --- | --- | --- |
| Webflow | Website pages, CMS content, assets and publishing | Browser OAuth, one workspace per authorization |
| WordPress.com | Content, media, comments and site administration | Browser OAuth, eligible sites and MCP enabled |
| monday.com | Boards, items, projects and customer workflows | Personal API token for personal/internal use |
| Smartsheet | Sheets, rows, reports and project workflows | Explicit US/EU/AU region and its API token |
| Fibery | Databases, records, documents and schema workflows | Browser OAuth with workspace selection |

Webflow and WordPress.com add website and publishing capabilities beyond the existing productivity catalog. monday.com is the ready addition from the remaining cross-category queue. Smartsheet and Fibery also have documented custom-client access and reuse existing connection infrastructure. All five expose canonical upstream tools, support separate labeled accounts and retain the high mutation-risk approval defaults. No SQLite schema change, native adapter or compatibility alias was introduced.

Smartsheet reuses the finite region selector with an encrypted token per account. Its region must be chosen explicitly, and reconnect cannot change it before replacing a token. WordPress.com's resource metadata advertises broader REST permissions than its MCP guide requests. The catalog therefore starts explicit SDK authorization with only the documented `auth` scope. Normal refresh remains automatic, but a rejected client or a need for new consent returns to interactive setup. It cannot silently re-register with broader permissions during background recovery.

**Remaining vendor requirements:** Ramp requires callback approval, Figma requires client admission, Canva's announced self-service enablement is not yet available, and Vercel requires an approved client. Their [current profiles and access requirements](connector-audit/seventh-wave-admission.md) are recorded, including a supplemental Square check. Shopify now has a real hosted Admin MCP, correcting the earlier native-only assessment, but its [custom-client registration path remains unestablished](connector-audit/seventh-wave-shopify.md). These services are not advertised as connectable. No applications or admission requests were submitted.

Provider evidence: [Webflow](connector-audit/seventh-wave-webflow.md), [WordPress.com](connector-audit/seventh-wave-wordpress.md), [monday.com](connector-audit/seventh-wave-monday.md), [Smartsheet](connector-audit/seventh-wave-smartsheet.md), and [Fibery](connector-audit/seventh-wave-fibery.md). The [public capture](connector-audit/seventh-wave-discovery.json) and [reproduction script](connector-audit/discover-seventh-wave.mjs) record unauthenticated discovery. Additional anonymous initialization observations are documented separately. No real account was connected, no OAuth client registered remotely, and no private business action performed.

**Validation:** 1,325 tests pass: 389 engine tests, 929 host/Settings/picker tests and 7 desktop OAuth tests. Coverage includes real-SDK discovery, PKCE, code exchange and refresh for the new OAuth services, actual intercepted bearer transport for monday.com, encrypted regional Smartsheet credentials, immutable reconnects, explicit region selection, setup requirements and high-risk write policy. WordPress recovery tests reject hidden background registration and consent after invalid client/grant errors, then verify a narrow interactive restart. Engine typecheck passes. ESLint across 117 changed TypeScript files reports no errors and the same two existing warnings. Full app typecheck retains 115 baseline desktop/service diagnostics, with none in connector files. Catalog counts, local documentation links and `git diff --check` pass. Independent review's scope-recovery finding is fixed and verified. Live account acceptance remains untested.

## Sixth delivery wave

The user authorized implementing Robinhood, PostHog, PayPal and Docusign. Hosted agent tools are the deliverable. Existing task-picker qualification remains a separate work item, and QuickBooks stays paused.

- [x] Verify official endpoints and custom-client authentication for all four services using vendor sources and public discovery.
- [x] Add named hosted catalog entries, categories, descriptions and required setup metadata without compatibility aliases.
- [x] Implement any required environment/region and OAuth setup, preserving per-account credential and endpoint isolation.
- [x] Add protocol and host regressions for the new profiles, including financial and agreement write policy.
- [x] Reconcile catalog counts, provider evidence and setup guidance, and run relevant engine, host, desktop, lint and type checks.

**Delivered:** all four named hosted connectors, bringing the catalog to **60 providers: 50 external MCP and 10 native**. Robinhood, PostHog and PayPal use discovered browser OAuth. Docusign uses a registered integration key and secret. PayPal and Docusign require an explicit production or test environment, saved independently for each account. Existing endpoint configuration supports this without a SQLite schema change or database migration. No native adapters or compatibility aliases were added.

Public verification found two provider-specific details. PayPal's documented `/http` endpoints return 404, while the live service's `/mcp` endpoints return matching OAuth challenges and resource metadata. The catalog uses `/mcp`. Docusign returns an unchallenged 403 before sign-in, so its trusted catalog profile starts standard SDK OAuth discovery before opening the transport. That opt-in does not change how arbitrary 403 responses are handled.

Settings explains Robinhood's desktop Agentic onboarding, PostHog's organization AI requirements, and Docusign's application registration and environment requirements. All four apply a high mutation-risk floor through the existing approval policy. Their tools and schemas are discovered per connected account.

Public sources, exact profiles and acceptance limits are recorded for [Robinhood](connector-audit/sixth-wave-robinhood.md), [PostHog](connector-audit/sixth-wave-posthog.md), [PayPal](connector-audit/sixth-wave-paypal.md) and [Docusign](connector-audit/sixth-wave-docusign.md). The [capture script](connector-audit/discover-sixth-wave.mjs) and [public metadata](connector-audit/sixth-wave-discovery.json) are reproducible. Protocol tests use the installed SDK with intercepted registration and token responses. No live OAuth app was registered, vendor account connected, private data read, or business action performed.

**Validation:** 1,268 tests pass: 388 engine tests, 873 host/Settings/picker tests and 7 desktop OAuth tests. SDK fixtures cover each new authentication profile, both PayPal and Docusign environments, PKCE, code exchange, refresh and callback persistence. Host coverage checks required environment selection, separate accounts and app bindings, pinned reconnects, Docusign preauthorization and secret redaction, setup guidance and write policy. Engine typecheck passes. ESLint across 113 changed TypeScript files reports no errors and the same two existing unused-symbol warnings. Full app typecheck retains its 115 baseline desktop/service diagnostics, with no connector diagnostics. Catalog counts, local documentation links and `git diff --check` pass. Independent review found no blocking issue. Live account consent and workflows remain unverified.

## Next connector queue

This supersedes the original audit's productivity-first ranking. The first four and monday.com are delivered, while five candidates require vendor qualification or admission. The seventh wave also delivered Webflow, WordPress.com, Smartsheet and Fibery. The current catalog contains 65 providers. An app-specific task picker is not a prerequisite for adding a hosted connector. Account access is needed for live acceptance, and sometimes to discover undocumented contracts for a fixed app feature, but it is not a general prerequisite for writing connector setup code.

| Order | Connector | Added capability | Integration path and next step |
| --- | --- | --- | --- |
| 1 | Robinhood | Investment accounts, holdings, activity and trading tools | Delivered with official hosted OAuth. Desktop Agentic onboarding is required, while documented reads span Robinhood accounts. Trading is restricted to the Agentic account. |
| 2 | PostHog | Product analytics, experiments, feature flags and errors | Delivered with official hosted OAuth and automatic region selection during vendor login. |
| 3 | PayPal | Merchant invoicing and payment workflows | Delivered with official hosted OAuth and separately bound production/sandbox accounts. |
| 4 | Docusign | Agreement search, signature status and agreement workflows | Delivered with official hosted MCP, registered application credentials and separately bound production/demo accounts. |
| 5 | Ramp | Business spending, reimbursements and accounting follow-up | [Official hosted MCP](https://support.ramp.com/ramp-mcp). Custom callback approval is a vendor access requirement. |
| 6 | Figma | Design context, components and canvas editing | [Official hosted MCP](https://developers.figma.com/docs/figma-mcp-server/). Our client needs admission to Figma's approved catalog. |
| 7 | Canva | Designs, presentations and marketing materials | [Official hosted MCP](https://www.canva.dev/docs/apps/quickstart/?app-surface=Canva+for+your+platform). Custom-client enablement currently requires waitlist onboarding. |
| 8 | Vercel | Deployments, projects, logs and web analytics | [Official hosted MCP](https://vercel.com/docs/agent-resources/vercel-mcp). Vercel requires client approval. |
| 9 | Shopify | Store orders, products, inventory and customers | Real hosted Admin MCP verified at `https://setup.shopify.com/mcp`. Obtain a documented custom-client registration path before adding it. [Qualification](connector-audit/seventh-wave-shopify.md). |
| 10 | monday.com | Boards, projects and CRM workflows | Delivered through the official hosted MCP with a personal API token. Public product distribution remains subject to vendor registration and approval. |

Vendor access work for Ramp, Figma, Canva, Vercel and Shopify can proceed when required application details are available. A named catalog entry alone would not supply their upstream admission. The ready services above were implemented while those requirements remain. No provider admission, account creation or live acceptance is implied by this queue.

## Shared connector improvements

The user approved all three improvements: detect upstream tool changes, support multiple accounts for hosted connectors, and add task-picker consumers for ClickUp, Trello, TickTick and Wrike.

- [x] Persist canonical capability snapshots per connection and report added, removed and changed tools, including schema and permission changes. Review acknowledgments must not erase newer changes.
- [x] Refresh discovery on upstream tool-list notifications and bounded freshness checks, preserving credential authority and safe execution policy.
- [x] Route canonical hosted actions through the explicitly selected account, with independent credentials, tool availability, schemas, approvals and saved account scopes.
- [x] Add independent account creation, labels, reconnect, test, cancellation and disconnect in Settings and account selection in agent-requested setup. Registered OAuth callbacks resolve the correct pending account by state.
- [ ] Implement all four task-picker consumers using verified vendor tool contracts, bounded pagination, due dates, priorities, source links, account-qualified identities and visible partial failures.
- [x] Verify account isolation, capability changes, stale callbacks, concurrent discovery and existing picker behavior. Reconcile documentation and record real-account acceptance limits.

Implementation choices: existing encrypted connector files remain the source of connection state. Hosted action names stay canonical, with no compatibility aliases. Capability changes are visible per connection. The picker reads each connected account explicitly rather than choosing an arbitrary default. QuickBooks is excluded from this work.

**Delivered:** tool-change tracking and hosted multi-account support. Capability snapshots include input/output schemas, descriptions, titles and annotations. Settings shows changes since the last reviewed snapshot. A review only acknowledges the exact revision displayed. Discovery refreshes after upstream tool-list notifications and when the cached runtime is next requested after five minutes. A changed tool list invalidates captured transports, requiring callers to refresh before executing again. Repeated changes during discovery are bounded to three attempts per account.

Each account has an independent credential, label, endpoint and registered OAuth app binding. Adding an account uses a stable setup ID so retries reuse the same pending setup. Reconnect, test, cancellation and disconnect target a specific connection. Simultaneous registered OAuth callbacks resolve by their saved state, and browser-return success requires the exact consent completion marker rather than old valid tokens. Agent-requested connection pages explicitly choose among existing accounts. Settings creates additional accounts.

The shared engine publishes one canonical provider containing the union of account tools. It validates each call against the selected account's advertised schema and enabled tools before requesting approval. When accounts disagree about risk, the union uses the more conservative classification. Existing account/client scope restrictions remain enforced. These changes extend the existing connector file records and their in-memory types. **No SQLite schema change or database migration is required.**

**Picker delivery is partial:** Todoist and Jira now read each connected account independently, retain successful results when another account or later page fails, and preserve account identity and source links in the launcher. ClickUp, Trello, TickTick and Wrike remain pending because official public docs do not establish their exact tool input/output contracts, anonymous discovery did not return schemas, and no connected accounts for them were available. Their hosted agent tools remain available. The [picker evidence and capture guide](connector-audit/task-picker-expansion.md) documents the missing contracts and an opt-in command for discovering them from an existing account. No authenticated task reads were performed during this work.

**Validation:** 1,216 tests pass: 385 engine tests, 824 host/Settings/picker tests and 7 desktop OAuth tests. Coverage includes ambiguous selection, cross-account credentials and schema validation, overlapping reconnects, stale capability reviews, tool-list notification races and partial picker failures. Engine typecheck passes. ESLint reports no errors in 109 changed TypeScript files, with two existing unused-symbol warnings in launcher/ranking files. The app typecheck retains its 115 baseline desktop/service diagnostics from missing Electron and tar dependencies, with no connector diagnostics. Local documentation links and `git diff --check` pass. These checks use fixtures and do not establish live vendor-account acceptance.

## Fifth delivery wave

The user approved registered-client support and the next migration batch, with X included. Existing native tool names do not constrain adoption of the vendor's hosted surface.

- [x] Add registered OAuth clients to hosted MCP using the existing encrypted app credential store, with stable callbacks and no fallback to dynamic registration.
- [x] Bind connections to their selected client, enforce ownership/status and prevent stale credentials, cross-client reuse or removal while setup is pending.
- [x] Add Settings and agent-requested setup for registered clients, preserving reconnect and cancellation behavior.
- [x] Verify current official profiles and migrate X, Slack, Asana, HubSpot, Box, Zoom and Dropbox where custom-client access is documented.
- [x] Retire native adapters and obsolete consumers without compatibility aliases, and document any app feature that needs a verified upstream consumer.
- [x] Check QuickBooks setup readiness and record the remaining real-account acceptance step.
- [x] Run engine, host, desktop, lint and type checks, then reconcile the catalog and next queue.

**Catalog after the fifth wave: 56 providers, with 46 external MCP integrations and 10 native providers.** The [current catalog summary](connectors-current.md) groups every connector by setup mode and includes later additions. The external count includes n8n on the user's selected instance.

| Connector | Hosted setup requirement |
| --- | --- |
| X | OAuth 2.0 developer app, client ID and secret, eligible account/API access |
| Slack | Registered internal or published Marketplace app, user scopes and PKCE |
| Asana | MCP app in Asana's developer console, with workspace distribution permitted |
| HubSpot | MCP connector created in Development, using its client credentials |
| Box | Admin-created Box MCP integration credentials and permitted scopes |
| Zoom | General app, product scopes, licenses and accepted callback |
| Dropbox | Scoped Full Dropbox app with required permissions and offline access |

All seven use the exact stable callback displayed in Settings. The shared host resolves registered credentials from the existing OAuth app registry, stores the selected app ID in the MCP server and derived connection records, and keeps secrets encrypted in the existing stores. No SQLite schema or migration changes are required. App identity, ownership, status and secret rotation are checked again whenever credentials are used. A connected or pending connector prevents deletion of its bound app. Disconnecting permits selecting a different app.

Settings and agent-requested connection pages expose registered app setup, the authoritative callback and the saved app selection. Desktop authorization uses that same stable web callback, with refresh on return to the app. Providers that support dynamic registration keep their existing setup. Registered providers never fall back to dynamic registration. Asana's challenge-specific discovery metadata is preserved with encrypted OAuth state so a fresh callback can exchange the code correctly. Dropbox's catalog requests offline access for refresh tokens.

The seven native adapters, X's generated API surface and its media helper are removed. No compatibility aliases were introduced. Asana's old task-picker consumer is removed because public documentation does not establish the hosted input/output schemas. Its agent tools remain available through discovery. Todoist and Jira retain their canonical hosted picker consumers. Existing native credentials require hosted authorization rather than being silently reused.

The [provider evidence](connector-audit/fifth-wave-provider-evidence.md) and [GET-only discovery capture](connector-audit/fifth-wave-discovery.json) document the supported registration paths, endpoints, plan requirements and limits. X now publishes OAuth discovery metadata despite its older guide describing discovery as absent. These are official hosted services of the kind used by Claude, but our app has its own client credentials and eligibility. Claude-specific HubSpot and Dropbox paths are deliberately replaced by the vendors' generic client endpoints.

QuickBooks has no environment credentials or saved OAuth app/company connection in the configuration checked. Its native reads and reports remain implemented. The next account-dependent step is configuring an eligible Intuit app and validating a familiar invoice and report. No secrets should be shared in chat. See the [setup guide](connector-audit/quickbooks-implementation.md).

## Fourth delivery wave

Continue with Airtable and Atlassian, then explicit region and instance selection. Hosted integrations continue to expose vendor tools directly, with no compatibility aliases.

- [x] Verify Airtable and Atlassian generic-client OAuth against official documentation and public SDK discovery.
- [x] Replace native Airtable, Jira and Confluence implementations with Airtable and one shared Atlassian connector. Use Atlassian's full paginated tool discovery endpoint.
- [x] Preserve the Jira task picker using canonical hosted tools, with site-qualified issue identities and explicit partial failures.
- [x] Add region and instance setup in Settings and agent-requested connection flows, with immutable endpoint binding and cleanup of unfinished setup.
- [x] Add Intercom US/EU and n8n instance endpoint definitions after verifying supported authentication and account setup.
- [x] Verify URL validation, credential isolation, reconnect, concurrency and conservative treatment of user-selected server annotations.
- [x] Run engine, host, desktop and type checks, reconcile documentation and record account-dependent acceptance separately.

**Catalog after the fourth wave: 56 providers, with 39 hosted MCP integrations and 17 native providers.**

| Connector | Change | Setup and conditions |
| --- | --- | --- |
| Airtable | Replaces the native adapter | Browser OAuth, selected bases/workspaces, possible organization client allowlist |
| Atlassian | Replaces native Jira and Confluence with one connector | Browser OAuth, full paginated tool discovery, organization callback and product permissions apply |
| Intercom | New connector | Explicit US or EU selection, browser OAuth. Australian workspaces are unsupported |
| n8n | New connector | Instance address and browser OAuth. Owner/admin enables instance MCP and workflow access |

[Airtable and Atlassian authentication evidence](connector-audit/fourth-wave-auth.md) records public discovery and actual SDK fixtures. Atlassian uses the documented `?tools=all` endpoint so ordinary paginated discovery exposes its full available catalog. The three native adapters are deleted. Saved Jira and Confluence credentials remain removable under Previous connections, but are not converted into MCP authorization or exposed through compatibility aliases.

The Jira picker calls canonical Atlassian resource and search tools, queries authorized Jira sites, and uses site-qualified issue IDs. Partial failures remain visible alongside successful results. Its [contract evidence and acceptance checklist](connector-audit/atlassian-task-picker.md) distinguish published shapes from normalization assumptions that require a real account capture.

The shared endpoint setup supports catalog-allowlisted regions and instance addresses in both Settings and agent-requested connection pages. The selected URL is stored in the existing MCP server record. It stays locked until disconnect, with cancellation available for unfinished setup. Endpoint-derived account identity, serialized creation and existing credential authority checks prevent credentials crossing regions or instances. User-selected instance hosts receive conservative tool treatment rather than inheriting trusted vendor annotations. There are no SQLite schema changes or migrations. [Intercom and n8n evidence](connector-audit/fourth-wave-endpoints.md) includes official setup requirements and regional discovery captures.

## Third delivery wave

The user confirmed that hosted migrations should not retain compatibility aliases. Todoist was the one remaining exception, with five legacy actions. Remove those actions and their approval-name inheritance while preserving the task picker against canonical hosted tools.

- [x] Remove Todoist compatibility actions, unused ingestion extension hooks and legacy approval mappings. Verify direct hosted task-picker behavior.
- [x] Migrate Readwise and Raindrop to verified official hosted endpoints, retire native adapters, and make Raindrop's Pro requirement visible.
- [x] Verify GitLab and Stripe authentication and migrate both to hosted OAuth.
- [x] Continue the ranked new-provider queue with ten verified generic-client hosted services.
- [x] Reconcile the tracker and documentation, then run connector, host, desktop and type checks. Record live account acceptance separately.

**Catalog after the third wave: 55 providers, with 35 hosted MCP integrations and 20 native providers.** All migrated hosted providers expose discovered vendor actions directly. No connector compatibility aliases or legacy action-name approval mappings remain. Todoist's task picker uses canonical `todoist.find-tasks` directly, with its existing pagination, normalization and stable task IDs. The unused ingestion hook that injected extra legacy actions is also removed.

Four more native connectors are retired:

| Connector | Hosted setup | Material condition |
| --- | --- | --- |
| Readwise | Browser OAuth at `https://mcp2.readwise.io/mcp` | Combined Readwise highlights and Reader documents |
| Raindrop | Browser OAuth at `https://api.raindrop.io/rest/v2/ai/mcp` | Requires Pro, stated in the catalog description |
| GitLab | Browser OAuth at `https://gitlab.com/api/v4/mcp` | GitLab.com only, with top-level group MCP access enabled |
| Stripe | Browser OAuth at `https://mcp.stripe.com` | Authorized account/sandbox, without Stripe Connect account impersonation |

Readwise and Raindrop use the public profiles captured in [second-wave discovery](connector-audit/second-wave-discovery.json). Their [SDK fixtures](../src/lib/connectors/mcp-oauth-knowledge.test.ts) cover Readwise's path-qualified issuer and Raindrop's ancestor resource identifier. [GitLab and Stripe evidence](connector-audit/third-wave-auth.md) documents GitLab's public DCR response despite general metadata advertising secret-based auth, and Stripe's scope discovery. GitLab explicitly requests a public, code-only client. Both services use high mutation-risk defaults.

Ten new connectors are added:

| Connector | Setup | Main use and conditions |
| --- | --- | --- |
| TickTick | Browser OAuth | Tasks, lists, sections, assignments and habits |
| Wrike | Encrypted permanent access token | Tasks and projects within the user's existing permissions |
| Fastmail | Browser OAuth | Mail, contacts and calendars, with permissions chosen during consent |
| Craft | Browser OAuth | Documents in the space selected during consent |
| Mem | Browser OAuth | Notes and collections |
| Miro | Browser OAuth | Boards in the authorized team, with possible enterprise admin controls |
| Reclaim | Browser OAuth | Scheduling and task planning, requires Reclaim 2.0 |
| Fathom | Browser OAuth | Meeting summaries, transcripts and action items |
| Read AI | Browser OAuth | Meeting reports and transcripts, requires workspace Downloads enabled |
| Otter | Browser OAuth | Meeting transcripts visible to the account |

[Third-wave provider evidence](connector-audit/third-wave-new-providers.md) records official generic-client setup, public discovery, plan caveats and exact endpoints. TickTick uses the existing code-only registration profile. Miro and Reclaim use the existing encrypted dynamic-client-secret profile. Fastmail and Reclaim have high mutation-risk defaults. Wrike has a guided token form because its public server does not advertise DCR. No additional platform auth feature or database migration was required.

## Second delivery wave

The user explicitly waived backward compatibility for Linear, Notion, Calendly and Resend. Replace their native integrations with the vendor-hosted tool surface. Differences in action names, inputs and outputs are accepted. Authentication, approval controls and working setup remain required. Remove obsolete native adapters instead of maintaining compatibility aliases.

- [x] Verify the four official endpoints and public-client OAuth requirements.
- [x] Switch Linear, Notion, Calendly and Resend to hosted catalog entries and browser sign-in.
- [x] Remove the four retired native adapters and their obsolete tests. Remove the old Linear task-picker calls rather than leave a broken feature.
- [x] Apply appropriate write approvals and verify setup, discovery, reconnect and registration behavior with automated tests.
- [x] Continue the ranked list: verify ClickUp, Trello, Readwise, Raindrop and the highest-value next hosted services, then add ten services with a documented usable authentication path.
- [x] Reconcile documentation and run package, host and relevant desktop checks. Record account-dependent validation separately.

Linear, Notion, Calendly and Resend now use official hosted MCP endpoints and browser sign-in. Their native implementations are deleted, with no compatibility aliases. Linear remains available through discovered agent tools, but its old deterministic task-picker adapter is removed. No SQLite schema change or migration was needed.

Ten more named marketplace connectors are implemented:

| Connector | Setup | Main use |
| --- | --- | --- |
| ClickUp | Browser OAuth | Tasks, assignments, documents and chat |
| Trello | Browser OAuth, one workspace per authorization | Boards, lists and cards |
| Make | Browser OAuth | Active/on-demand scenarios and automation management |
| Firecrawl | Browser OAuth | Web search, scraping and extraction |
| Fireflies | Browser OAuth | Meeting transcripts, summaries and action items |
| Exa | No account, within starter limits | Public web search and page fetching |
| Microsoft Learn | No account | Microsoft documentation and code samples |
| Neon | Browser OAuth, access selected during consent | Development database work |
| Supabase | Browser OAuth, organization selected during consent | Development database and project work |
| Cloudflare | Browser OAuth, permissions selected during consent | Infrastructure and API operations |

The marketplace at the end of this wave had **45 providers: 21 hosted and 24 native**. Hosted tools are discovered from the vendor rather than reimplemented in this repository. The ten additions expose agent tools, not new task-picker adapters. The [second-wave evidence](connector-audit/second-wave-evidence.md) records plan limits, scope, eligibility and exact endpoints.

This wave also adds small, trusted OAuth registration profiles. ClickUp requests only the authorization-code grant it advertises. Make and Supabase use dynamically issued client secrets with `client_secret_post`, stored through the existing encrypted OAuth store. Users do not need to create developer applications for these integrations. The profile comes only from the pinned catalog definition.

Calendly, Resend, Make, Firecrawl, Neon, Supabase and Cloudflare use high mutation-risk defaults. Read-only tools retain their read classification. Supabase's base endpoint covers projects in the authorized organization, without forced project scoping or read-only mode. User-selected project/feature URL parameters remain separate future work.

## First delivery batch

QuickBooks is elevated to the first batch by explicit user request. Prioritize a usable, supported connection and useful financial reads while vendor-hosted MCP access remains restricted.

- [x] F01: preserve native account/client scope pins when MCP transport owns authentication. Reject calls bound to a different connected transport.
- [x] QuickBooks: confirm the available official integration path, improve financial/reporting reads, validate company identity and sandbox/production routing, and document connection setup.
- [x] New OAuth connectors: Granola, Sentry, Context7 and Tavily in the named marketplace with pinned official endpoints, discovered tools and existing approval controls.
- [x] F05: named bearer and unauthenticated MCP onboarding, encrypted credentials, reconnect/test/disconnect behavior and protection against stale token discovery.
- [x] GitHub: official hosted MCP with a user-supplied scoped personal access token.
- [x] Zapier: official hosted MCP with the documented connection token for unlisted clients. Require approval for mutating automation tools by default.
- [x] Review the first native migration candidates against actual input/output contracts, preserving native functionality when parity is not established.
- [x] Run package and host checks, update documentation, and record remaining live-account validation honestly.

## Verified public authentication evidence

Public metadata was read without account credentials or registering OAuth clients. The following advertise dynamic registration, authorization code with PKCE S256, and public-client token authentication:

| Service | Transport | Public auth metadata |
| --- | --- | --- |
| Granola | `https://mcp.granola.ai/mcp` | [metadata](https://mcp-auth.granola.ai/.well-known/oauth-authorization-server) |
| Sentry | `https://mcp.sentry.dev/mcp` | [metadata](https://mcp.sentry.dev/.well-known/oauth-authorization-server) |
| Context7 | `https://mcp.context7.com/mcp/oauth` | [metadata](https://clerk.context7.com/.well-known/oauth-authorization-server) |
| Tavily | `https://mcp.tavily.com/mcp` | [metadata](https://mcp.tavily.com/.well-known/oauth-authorization-server) |

Context7's OAuth path differs from its generic path. Granola has plan/workspace limits. These endpoints still require a user to authorize an account before functional tools can be tested. This evidence confirms protocol metadata, not a completed live sign-in.

Zapier publishes OAuth metadata, but its current [instructions for unlisted clients](https://docs.zapier.com/mcp/get-started/connect/other) explicitly use a bearer connection token. Use the fixed endpoint `https://mcp.zapier.com/api/v1/connect` and an Authorization header, never a token in the URL. GitHub likewise documents a [hosted bearer-token path](https://github.com/github/github-mcp-server).

## Initial compatibility review, superseded by the user decision

The initial review found differences in existing operation contracts. Those differences no longer block the four replacements because the user explicitly accepted the hosted tool surface:

- Resend's hosted tool requires text for sending and returns prose for email lookup. The old native input and output formats are retired.
- Notion's hosted tools use their own content and property formats. The old REST block/property/query actions are retired.
- Linear and Calendly expose vendor-defined tools. No old action aliases are retained, and the old Linear task-picker adapter is removed.

The [initial compatibility review](connector-audit/first-migration-parity.md) remains historical evidence. The [hosted replacement verification](connector-audit/hosted-replacements.md) records the integration decision now implemented.

## What the first batch provides

| Connector | Setup | Implemented coverage |
| --- | --- | --- |
| QuickBooks | Existing native OAuth using an Intuit app | 13 read-only actions: existing query/customer/company reads, complete invoice reads, paginated customers and invoices, profit and loss, balance sheet, cash flow, trial balance, general ledger, receivables aging and payables aging |
| GitHub | Scoped personal access token | Official hosted MCP tools available to that token, with writes requiring approval by default |
| Zapier | Connection token from the server's Connect tab | Actions the user enables in Zapier, with writes requiring approval by default |
| Granola | Browser OAuth | Vendor-discovered meeting context tools |
| Sentry | Browser OAuth | Vendor-discovered issue and debugging tools |
| Context7 | Browser OAuth | Vendor-discovered library documentation tools |
| Tavily | Browser OAuth | Vendor-discovered web research tools |

All six new providers appear in the ordinary Connectors catalog. Users do not need to create a generic custom MCP server. Remote tool availability depends on the connected account and vendor plan. This batch exposes agent tools, not new deterministic task-picker adapters.

QuickBooks setup is documented [here](connector-audit/quickbooks-implementation.md). Production remains the default. `CONNECTORS_QUICKBOOKS_ENVIRONMENT=sandbox` selects sandbox for new authorizations. Each saved company retains its environment, and production callbacks must satisfy Intuit's HTTPS requirement. The existing four action names remain available. No accounting writes were added.

There are no SQLite schema changes or migrations. Catalog and authentication behavior are defined in TypeScript. Connection files now retain a credential revision so discovery using an older bearer token cannot overwrite a newer connection. Secrets continue to be encrypted in the existing connector store. Sealed OAuth state also stores a revision and session identity so a delayed refresh or invalidation cannot overwrite a newer sign-in.

Every captured MCP client checks current connection authority before executing. Disabling a server, replacing a token or changing tool overrides invalidates older clients, including clients cached in other processes. Typed SDK authorization failures return the host reconnect flow. Network failures after writes remain indeterminate, so callers are not told that repeating a write is safe.

Definitions live in the [hosted service catalog](../packages/connectors/src/providers/hosted-mcp.ts) and [provider catalog](../packages/connectors/src/providers/index.ts). The [host setup helper](../src/lib/connectors/hosted-mcp.ts), [lifecycle checks](../src/lib/connectors/mcp-lifecycle.ts) and [runtime](../src/lib/connectors/runtime.ts) connect them to the app. QuickBooks operations live in its [toolkit](../packages/connectors/src/providers/quickbooks/toolkit.ts).

## First batch validation

- Connector engine: **431 tests passed across 52 files**, including 32 QuickBooks cases, migration identity, stale transport binding and typed authorization failures. Command: `pnpm --filter @connectors/engine test`.
- Host, API routes and UI: **216 tests passed across 18 files**. Command: `pnpm exec vitest run src/lib/connectors src/app/api/connectors src/components/settings/sections/connectors/provider-detail.test.ts src/app/connect/request-connection.test.ts`.
- Desktop/web OAuth fixtures: **7 tests passed across 2 files**. Command: `pnpm exec vitest run --config desktop/vitest.config.ts desktop/mcp-oauth.test.ts desktop/mcp-web.test.ts`. These use a local mock server, not vendor accounts.
- Connector package TypeScript, ESLint for changed connector source/tests and `git diff --check` passed.
- Full app `pnpm ts` remains blocked by **115 pre-existing errors**, primarily missing `electron`, `electron-updater` and `tar` dependencies/types and the resulting desktop/service errors. The final run reported **zero errors in changed files**. No successful full application build is claimed.
- The installed MCP SDK completed public GET-only OAuth discovery for Granola, Sentry, Context7 and Tavily. No dynamic clients were registered and no live consent, vendor account reads or writes were performed.

Live acceptance remains open: QuickBooks company/report checks, each new provider's sign-in or token validation, tool discovery and representative account workflows. Vendor plan and organization restrictions may still affect account-level availability. The later second wave replaces native Linear, Notion, Calendly and Resend.

## Second-wave validation

- Connector engine: **424 tests across 49 files passed**. Retired native tests were removed along with their adapters. Command: `pnpm --filter @connectors/engine test`.
- Host, API routes and UI: **295 tests across 20 files passed**. Command: `pnpm exec vitest run src/lib/connectors src/app/api/connectors src/components/settings/sections/connectors/provider-detail.test.ts src/app/connect/request-connection.test.ts`.
- Desktop/web OAuth: **7 tests across 2 files passed**. Command: `pnpm exec vitest run --config desktop/vitest.config.ts desktop/mcp-oauth.test.ts desktop/mcp-web.test.ts`. The local mock callback listener requires execution outside the restricted sandbox. No vendor account is involved.
- Total: **726 passing tests**. Coverage includes all catalog setup modes and high-risk write defaults, endpoint pinning, OAuth registration profiles, encrypted dynamic-client secrets, code exchange, refresh, state/replay checks, connection lifecycle and native adapter retirement.
- `pnpm --filter @connectors/engine typecheck` and `git diff --check` passed. ESLint across 67 changed TypeScript files reported zero errors and two pre-existing unused-variable warnings.
- Full app `pnpm ts` still reports **115 pre-existing errors**, primarily missing Electron and `tar` dependencies/types. There are **zero errors in changed files**. A full application build is not claimed.
- Actual public GET-only SDK discovery verified the official authentication profiles. No live OAuth client was registered, no account was authorized and no private data was accessed.
- Exa and Microsoft Learn passed live unauthenticated MCP initialization and tool discovery, exposing two and three tools respectively. One public documentation search through each also succeeded with content and no error. These ephemeral public sessions did not create saved app connections.

Live account acceptance remains open for OAuth and token-backed services, including provider-specific callback acceptance and plan/organization permissions. This is distinct from the completed implementation and automated validation. QuickBooks remains first in that account-dependent queue.

## Third-wave validation

- **766 tests passed**: 396 connector-engine tests across 46 files, 363 host/API/UI tests across 22 files, and 7 desktop/web OAuth tests across 2 files. Commands are the same as the second-wave validation above.
- Tests verify removed aliases return unknown-action errors, no retired native actions register, Todoist assignment/movement tools and task-picker pagination remain available, and approval preferences use canonical action names.
- Catalog-derived tests cover all OAuth, bearer and public setup routes, including Wrike's encrypted token form, credential replacement, testing and disconnect. High-risk policies are verified against each provider's catalog declaration.
- Actual SDK fixtures cover Readwise/Raindrop discovery, GitLab's public DCR metadata mismatch, Stripe's omitted resource scope, TickTick's code-only grant declaration, and Miro/Reclaim confidential registration, code exchange, encrypted state and refresh.
- Connector package TypeScript, local documentation links and `git diff --check` passed. ESLint across 67 changed TypeScript files reported zero errors and two pre-existing unused-variable warnings. Full app TypeScript still reports 115 pre-existing dependency/type errors, with none in changed files.
- Public GET-only OAuth metadata and official setup instructions were verified. No new vendor account was connected and no authenticated tool execution was performed. Live account acceptance remains open.

## Fourth-wave validation

- **915 tests passed**: 391 connector-engine tests across 43 files, 517 host/API/UI/picker tests across 28 files, and 7 desktop/web OAuth tests across 2 files. Native test files retired with their adapters account for the smaller engine suite.
- Engine command: `pnpm --filter @connectors/engine test`.
- Host command: `pnpm exec vitest run src/lib/connectors src/lib/client/connector-endpoint.test.ts src/app/api/connectors src/components/settings/sections/connectors/provider-detail.test.ts src/app/connect/request-connection.test.ts src/lib/deck/connector-tools.test.ts src/lib/executions/task-rank.test.ts src/components/workspaces/launcher/launch-paging.test.ts`.
- Desktop command: `pnpm exec vitest run --config desktop/vitest.config.ts desktop/mcp-oauth.test.ts desktop/mcp-web.test.ts`. The mock loopback listener required execution outside the restricted sandbox.
- Coverage includes Airtable/Atlassian SDK discovery, registration, PKCE, scopes, code exchange and refresh. Endpoint cases cover explicit selection, URL validation, credential isolation, reconnect, concurrent creation using the file lock, disconnect/reselection, unfinished setup cleanup and conservative instance tool policy.
- Connector package TypeScript passed. Full app TypeScript still reports **115 pre-existing dependency/type errors**, with **zero in changed files**. A full application build is not claimed.
- ESLint across 75 changed TypeScript files reported zero errors and two pre-existing unused-variable warnings. Local documentation links and `git diff --check` passed. A separate final code review found no blocking issues in endpoint persistence, credential isolation, setup refresh or native retirement.
- Public documentation and GET-only discovery establish authentication profiles. No live OAuth client was registered, no vendor account was connected, and no private account data was read or changed. n8n authentication was checked against official source without contacting a user's instance.
- Live account acceptance remains open, including Airtable base access, Atlassian callback approval and actual picker response shapes, both Intercom regions, and a configured n8n instance. QuickBooks remains first in the account-dependent queue.

## Fifth-wave validation

- **1,071 tests passed**: 367 connector-engine tests across 38 files, 697 host/API/UI/picker tests across 35 files, and 7 desktop/web OAuth tests across 2 files. Deleted native adapters account for the smaller engine suite.
- Engine command: `pnpm --filter @connectors/engine test`.
- Host command: `pnpm exec vitest run src/lib/connectors src/lib/client/connector-endpoint.test.ts src/app/api/connectors src/components/settings/sections/connectors src/app/connect/request-connection.test.ts src/lib/deck/connector-tools.test.ts src/lib/executions/task-rank.test.ts src/components/workspaces/launcher/launch-paging.test.ts`.
- Desktop command: `pnpm exec vitest run --config desktop/vitest.config.ts desktop/mcp-oauth.test.ts desktop/mcp-web.test.ts`. The mock loopback listener required execution outside the restricted sandbox.
- Registered OAuth fixtures exercise all seven captured provider profiles through the actual SDK's initial authorization, a fresh callback transport and refresh. They cover Basic/Post/public clients, sealed challenge discovery, immutable consent parameters, no fallback to dynamic registration, credential rotation and stale writes.
- Real host-store tests cover stable callback routing, encrypted state, binding to a selected app, pending deletion locks, ownership/status, concurrent setup and cancellation. Callback tests reject replay, foreign states, removed/recreated setup and custom servers claiming reserved built-in callbacks. UI tests cover registered desktop focus recovery and required client secrets.
- Regression checks cover invalid migrated defaults no longer masking usable apps, while explicitly pinned apps never switch silently. Both runtime and interactive authorization redact raw secrets and reversible Basic credentials from remote errors.
- Connector package TypeScript passed. Full app TypeScript still reports **115 pre-existing desktop/service dependency and type errors**, with no errors in the changed connector files. A full application build is not claimed.
- ESLint across 91 changed TypeScript files reported zero errors and two pre-existing unused-variable warnings. Local documentation links and `git diff --check` passed.
- Public documentation and unauthenticated GET discovery were checked. No live OAuth app was registered, no vendor account was connected and no private data was read or changed. Real-account consent, tool discovery, refresh and representative operations remain the acceptance boundary. QuickBooks remains first in that queue.

## Next ranked work

1. **Next additions.** The ready seventh-wave services are delivered. Prioritize vendor access for Ramp, Figma, Canva, Vercel and Shopify to unlock finance, design and commerce coverage. Roam Research and other providers remain in the wider backlog for fresh qualification.
2. **Vendor admission.** Registered OAuth support is delivered, including X, Slack, Asana, HubSpot, Box, Zoom and Dropbox. Figma still requires client admission. Canva's documentation describes a registered-app path but explicitly says self-service enablement is not available yet. Vercel documents an approved-client allowlist. monday.com allows personal/internal API-token or own-app access, while public product/marketplace distribution requires approval. Public metadata alone does not establish eligibility. [Figma](https://developers.figma.com/docs/figma-mcp-server/), [Canva](https://www.canva.dev/docs/apps/mcp/access/), [Vercel](https://vercel.com/i/mcp-server-oauth-authorization), [monday.com](https://developer.monday.com/api-reference/re/docs/mcp-dynamic-client-registration).
3. **Extend endpoint configuration.** Region, instance and environment selection are delivered for Intercom, n8n, PayPal, Docusign and Smartsheet. Reuse this where appropriate for self-managed GitLab, and add documented optional project/feature constraints for Supabase. Verify each provider's authorization and URL rules before broadening its catalog definition.
4. **F08, upstream changes, delivered.** Capability snapshots, bounded discovery refresh and per-account review now surface changed tools, schemas and permissions. See the shared improvements above.
5. **Task-picker expansion.** ClickUp, Trello, TickTick and Wrike are agent connectors. Deterministic picker support can follow with typed consumers of their canonical tools, based on authorized current schemas.
6. **Live account acceptance, excluding paused QuickBooks.** Verify connected providers' consent, discovery, reconnect and representative operations when account access is available. Fixture tests and public OAuth discovery do not replace this step. QuickBooks setup and its live invoice/report check remain paused.

The complete research queue stays in the [audit backlog](connector-audit/BACKLOG.md), which is a dated snapshot. This implementation tracker supersedes its status for the delivered providers. Old-action compatibility is not a migration gate, and implemented hosted connectors contain no compatibility aliases.
