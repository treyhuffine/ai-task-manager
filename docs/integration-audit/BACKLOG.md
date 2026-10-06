# Connector implementation backlog

Generated from [audit.json](audit.json). Snapshot: September 28, 2026. These are research and implementation recommendations, not completed integrations. Checkboxes are intentionally open except no implementation work is inferred from this audit. Todoist code is already present and still needs live validation.

Track delivery in the [implementation checklist](../integration-implementation.md). This generated file remains the original audit backlog. The user subsequently waived old-action compatibility, so alias and parity recommendations below are historical, not current migration requirements.

Relative effort: S is catalog/setup and verification, M includes auth or a typed adapter, L changes shared runtime behavior. Vendor review time is additional. P4 is a separate local-runtime track, not a claim of low product value.


## P0: Finish validation and remove migration blockers

- [ ] **F01 · Native OAuth migration identity** (Platform, M). Fix migration path.
  - Why: Existing OAuth authConfigId is incompatible with the ingested bearer strategy. Clearing it blindly would break saved scope pins.
  - Next / acceptance: Separate MCP transport credentials from account/client identity. Verify pinned scopes and rollback for an existing OAuth connection.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **F02 · Task/calendar contract adapters** (Platform, M). Preserve product contracts.
  - Why: Agent tool discovery does not preserve deterministic task picker or calendar/deck behavior.
  - Next / acceptance: Typed adapters and parity checks for output fields, pagination, recurrence, time zones and source links.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **F03 · Stable action names and approvals** (Platform, M). Preserve policy contracts.
  - Why: Renamed, bulk and newly introduced tools can invalidate saved policies and learned action names.
  - Next / acceptance: Alias or migrate old IDs; preserve stricter overrides and test sends, bulk writes, retry/partial failures.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **M-todoist · Todoist** (Existing connector, S-M plus prerequisites). Hosted MCP implemented, validate live connection.
  - Why: Preserve five compatibility aliases and the typed task-picker contract. MCP tools are workflow-oriented, not necessarily one tool per REST endpoint. Legacy action compatibility and task-picker normalization remain app responsibilities.
  - Next / acceptance: Use current implementation and its mocked protocol tests. Any future live OAuth/account validation is separate from this documentation audit.
  - [Evidence](https://github.com/Doist/todoist-mcp). Status: Implemented; live validation pending.


## P1: First delivery wave, after its prerequisites

- [ ] **F04 · Registered-client OAuth and auth profiles** (Platform, M-L). Extend catalog setup.
  - Why: Many vendors require our own registered OAuth app. Built-in hosted setup currently assumes public OAuth discovery.
  - Next / acceptance: Declare auth profiles and securely configure client ID/secret without embedding confidential secrets in public distributed clients.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **F05 · Named bearer / no-auth connectors** (Platform, S-M). Extend catalog setup.
  - Why: Generic custom MCP has these modes, but named built-in hosted onboarding requires OAuth.
  - Next / acceptance: Add trusted per-provider modes, encrypted keys where needed and matching setup UI.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **F06 · Multiple accounts and multiple toolkits** (Platform, L). Extend runtime routing.
  - Why: Google has five toolkits, Microsoft two. Connections must retain account and scope identity.
  - Next / acceptance: Dispatch through ctx.connection; discover user/tenant identity and preserve all existing account pins.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **M-notion · Notion** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 7 native actions. Hosted service does not yet support noninteractive authentication. MCP file-upload workflow is limited to 20 MiB. Larger uploads require REST. Legacy local Notion MCP is no longer maintained and should not be the migration target.
  - Next / acceptance: Validate public-DCR login and discovered workflows using the hosted endpoint, then preserve legacy action names through aliases.
  - [Evidence](https://developers.notion.com/guides/mcp/overview). Status: Not started.

- [ ] **M-linear · Linear** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 6 native actions. SSE endpoint is deprecated. Use Streamable HTTP. Exact current REST action mapping remains unverified.
  - Next / acceptance: Validate public-DCR sign-in and issue/task-picker compatibility. Keep stable issue IDs and existing action names.
  - [Evidence](https://linear.app/docs/mcp). Status: Not started.

- [ ] **M-calendly · Calendly** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 5 native actions. Existing REST OAuth registrations cannot simply be reused because MCP requires DCR. Scheduling tools are not proof of every Calendly API operation.
  - Next / acceptance: Validate public-DCR flow, requested mcp:scheduling:read/write scopes, then map existing event/scheduling actions.
  - [Evidence](https://developer.calendly.com/docs/mcp/calendly-mcp-server). Status: Not started.

- [ ] **M-readwise · Readwise** (Existing connector, S-M plus prerequisites). Validate auth, then migrate.
  - Why: Preserve 4 native actions. Search index synchronizes in the background, so immediate consistency should not be assumed. Older Readwise-only MCP is deprecated.
  - Next / acceptance: Verify metadata/public-client registration and map existing highlight/book workflows to the combined server.
  - [Evidence](https://docs.readwise.io/tools/mcp). Status: Not started.

- [ ] **M-resend · Resend** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 2 native actions. Use current documented /mcp path rather than assume directory root URL equivalence. Capability expansion includes credential-management tools that need appropriate risk policy.
  - Next / acceptance: Validate DCR with rotating refresh tokens and preserve existing email action contracts.
  - [Evidence](https://github.com/resend/resend-mcp). Status: Not started.

- [ ] **N-granola · Granola** (New connector, S-M). Validate and add hosted MCP.
  - Why: Turn meeting decisions into tasks with source context.
  - Next / acceptance: Validate consent, note search, transcript access and links to source meetings. Workspace, plan and admin limits apply.
  - [Evidence](https://docs.granola.ai/help-center/sharing/integrations/mcp). Status: Not started.

- [ ] **N-clickup · ClickUp** (New connector, S-M). Validate and add hosted MCP.
  - Why: Extend task assignment, project work and completion to another core task system.
  - Next / acceptance: Validate custom-client registration, task create/update/assign/move/complete and task picker mapping. Beta call quotas; delete tools absent. Native task picker requires an adapter.
  - [Evidence](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server). Status: Not started.

- [ ] **N-trello · Trello** (New connector, S-M). Validate and add hosted MCP.
  - Why: Boards, lists and cards match the task organization users requested.
  - Next / acceptance: Validate moving cards across lists, ownership and task links. Implement task picker adapter. One workspace per authorization; comments, attachments and membership operations not all present.
  - [Evidence](https://github.com/atlassian/trello-mcp-server). Status: Not started.

- [ ] **N-sentry · Sentry** (New connector, S-M). Validate and add hosted MCP.
  - Why: Turn production issues into actionable investigation and fix tasks.
  - Next / acceptance: Validate organization/project scope, issue search, error context and outbound issue links. Account permissions and project scope still apply.
  - [Evidence](https://mcp.sentry.dev/). Status: Not started.

- [ ] **N-context7 · Context7** (New connector, S). Validate and add hosted MCP.
  - Why: Ground agent execution in current library documentation.
  - Next / acceptance: Use documented OAuth URL; validate library resolution and documentation retrieval. OAuth endpoint differs from the endpoint in Claude directory.
  - [Evidence](https://context7.com/docs/howto/oauth). Status: Not started.

- [ ] **N-zapier · Zapier** (New connector, M). Validate and add hosted MCP.
  - Why: One integration opens user-selected actions across many services.
  - Next / acceptance: Test Other-client flow, curated actions, refresh, tool discovery changes and approvals. Extra Zapier setup and usage charges; tool set varies by user.
  - [Evidence](https://docs.zapier.com/mcp/quickstart). Status: Not started.

- [ ] **N-github-supplemental · GitHub** (New connector, M). Validate and add hosted MCP.
  - Why: Connect tasks to issues, pull requests and repository execution. Not in this Claude directory snapshot.
  - Next / acceptance: Register our client or offer encrypted scoped PAT, validate issue/PR operations and tool permissions. Needs registered-client OAuth or named bearer onboarding. Verify overlap with existing repository integration.
  - [Evidence](https://github.com/github/github-mcp-server). Status: Not started.

- [ ] **N-tavily · Tavily** (New connector, S-M). Validate and add hosted MCP.
  - Why: Provide portable web research and page extraction across harnesses.
  - Next / acceptance: Compare with Exa and Firecrawl on representative research tasks; validate OAuth and citations. Usage tied to user account; choose one web provider initially.
  - [Evidence](https://github.com/tavily-ai/tavily-mcp). Status: Not started.


## P2: Next wave, partner access or targeted research

- [ ] **F07 · Tenant/region endpoint configuration** (Platform, M). Extend trusted endpoint policy.
  - Why: n8n, Intercom and enterprise SaaS cannot all use one fixed URL.
  - Next / acceptance: Validate provider-owned hosts or explicitly approved self-hosted URLs; preserve tenant identity and annotation trust.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **F08 · Remote tool-change monitoring** (Platform, M). Operate shared connector platform.
  - Why: Upstream tool schemas can change independently of our releases.
  - Next / acceptance: Record capability snapshots, flag changes and provide health/reconnect diagnostics and per-tool controls.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **M-google · Google** (Existing connector, M-L). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 25 native actions. Current Gmail MCP reference does not list a send tool. Current Drive MCP reference does not list move, delete, or permission-mutation tools. Current app has Calendar, Gmail, Drive, Docs and Sheets toolkits. Replacing only the three directory entries loses two scopes. Docs/Sheets create workflows may require Drive create_file. Their tool references use /mcp while general setup examples may use versioned URLs, so verify the exact endpoint during integration.
  - Next / acceptance: Add or reuse static Google OAuth configuration and coordinate five MCP connections under one provider. Validate all five toolkit workflows and retain native operations for documented gaps until an equivalent path exists.
  - [Evidence](https://developers.google.com/workspace/guides/configure-mcp-servers). Status: Not started.

- [ ] **M-slack · Slack** (Existing connector, S-M plus prerequisites). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 5 native actions. Access follows granular scopes and workspace user permissions. Native bot-token workflows are not automatically equivalent to MCP user-token workflows. Streamable HTTP only, no SSE.
  - Next / acceptance: Choose internal deployment or Marketplace distribution, register a Slack app, and support its static confidential OAuth flow before migration.
  - [Evidence](https://docs.slack.dev/ai/slack-mcp-server/). Status: Not started.

- [ ] **M-microsoft · Microsoft 365** (Existing connector, M-L). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 7 native actions. Current Work IQ API uses Copilot Credits usage billing and tenant governance. Delegated user context required, application-only authentication unsupported. Older Agent365/Frontier product-specific servers and newer unified Work IQ are distinct onboarding surfaces. Do not apply old gating claims indiscriminately. Current app exposes Outlook Mail and Calendar, both must remain available.
  - Next / acceptance: Evaluate unified Work IQ with a registered Entra app, tenant enablement and billing. Do not configure the Anthropic-specific endpoint as a generic provider without explicit access documentation.
  - [Evidence](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview). Status: Not started.

- [ ] **M-jira · Jira** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 6 native actions. delete_jira and manage_jira groups disabled by default pending admin enablement. Some Jira Service Management tools require API-token authentication, while code search/Teams groups require OAuth. Some tools consume Rovo credits.
  - Next / acceptance: Model shared Atlassian connection ownership and preserve separate jira/confluence action contracts. Validate all paginated discovery results against permissions.
  - [Evidence](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/). Status: Not started.

- [ ] **M-raindrop · Raindrop** (Existing connector, S-M plus prerequisites). Validate auth, then migrate.
  - Why: Preserve 4 native actions. Pro subscription newly required for MCP compared with some native API workflows.
  - Next / acceptance: Verify public-DCR discovery, or support bearer/static OAuth reuse, then map collection/bookmark workflows.
  - [Evidence](https://developer.raindrop.io/mcp/mcp). Status: Not started.

- [ ] **M-zoom · Zoom** (Existing connector, S-M plus prerequisites). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 6 native actions. Directory aggregate URL and product-specific example URLs differ. Select server/tool coverage deliberately. API and MCP share account rate limits.
  - Next / acceptance: Support Zoom static confidential OAuth with PKCE, verify aggregate versus product endpoint and preserve existing meeting workflows.
  - [Evidence](https://developers.zoom.us/docs/mcp/servers/). Status: Not started.

- [ ] **M-hubspot · HubSpot** (Existing connector, S-M plus prerequisites). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 7 native actions. Sensitive Data accounts cannot expose activity and conversation data through MCP even where REST supports it. Expanded scopes can require reauthentication. Local developer MCP is for app/CMS development, not the remote CRM replacement.
  - Next / acceptance: Support registered confidential OAuth, use generic root endpoint rather than directory's Anthropic path, and map current CRM actions against the latest scope set.
  - [Evidence](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server). Status: Not started.

- [ ] **M-salesforce · Salesforce** (Existing connector, M-L). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 5 native actions. Directory Headless360 beta is not automatically the correct replacement for a CRM data toolkit. Per-user interactive authentication required, machine-to-machine support not established. Sandbox uses a different URL path.
  - Next / acceptance: Add registered public-client configuration, choose sObject/custom server coverage for existing workflows, and evaluate entitlement/credits before retiring native actions.
  - [Evidence](https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/hosted-mcp-servers-overview.html). Status: Not started.

- [ ] **M-airtable · Airtable** (Existing connector, S-M plus prerequisites). Validate auth, then migrate.
  - Why: Preserve 6 native actions. Record creation batches limited to 10. Cannot activate automations or create/edit script actions. Cannot edit existing interfaces or add their filters. Development bases return 403, unlike installed production instances.
  - Next / acceptance: Verify registration protocol or use supported PAT configuration, then validate existing base/table/record workflows.
  - [Evidence](https://support.airtable.com/articles/9897799762-using-the-airtable-mcp-server). Status: Not started.

- [ ] **M-gitlab · GitLab** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 5 native actions. DCR limited to 10 registrations per hour per IP. Toolset selection and availability vary by GitLab version and feature settings. Self-managed host must remain configurable.
  - Next / acceptance: Validate against target GitLab version/instance, preserve hostname configuration, and support preregistered public app fallback if administrator disables DCR.
  - [Evidence](https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/). Status: Not started.

- [ ] **M-confluence · Confluence** (Existing connector, S-M plus prerequisites). Prioritize migration validation.
  - Why: Preserve 4 native actions. Some attachment/whiteboard workflows require additional Atlassian media domains. Some searches/reasoning tools consume Rovo credits. Shared service must not erase separate existing provider/action contracts.
  - Next / acceptance: Coordinate with Jira migration, model one shared login with explicit toolkit scope mapping and validate page/content workflows.
  - [Evidence](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/). Status: Not started.

- [ ] **M-asana · Asana** (Existing connector, S-M plus prerequisites). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 6 native actions. Existing PAT-based native connection cannot become public-DCR login by changing only the URL. Task-picker filters, pagination and result normalization require explicit adaptation.
  - Next / acceptance: Support registered confidential OAuth, then validate task/project actions and picker integration.
  - [Evidence](https://developers.asana.com/docs/mcp-server). Status: Not started.

- [ ] **M-zendesk · Zendesk** (Existing connector, S-M plus prerequisites). Keep native pending vendor verification.
  - Why: Preserve 5 native actions. MCP client GA does not supply a remote Zendesk data server.
  - Next / acceptance: Verify current server EAP/public release and custom-client onboarding, preserving native support meanwhile.
  - [Evidence](https://community.zendesk.com/zendesk-eap-mcp-client-156/what-is-the-mcp-client-eap-21756). Status: Not started.

- [ ] **M-dropbox · Dropbox** (Existing connector, S-M plus prerequisites). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 5 native actions. Extracted text and UTF-8 file creation documented with 5 MB limits. Claude-specific directory path differs from generic endpoint.
  - Next / acceptance: Use generic endpoint with registered app credentials or obtain DCR client approval. Do not impersonate an allowlisted client.
  - [Evidence](https://help.dropbox.com/integrations/connect-dropbox-mcp-server). Status: Not started.

- [ ] **M-box · Box** (Existing connector, S-M plus prerequisites). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 5 native actions. docgen.readwrite depends on Enterprise Advanced licensing. Community local server DCR support does not prove hosted Box supports public DCR.
  - Next / acceptance: Support Box static confidential OAuth and admin setup, then validate existing file/search workflows.
  - [Evidence](https://developer.box.com/guides/box-mcp/setup). Status: Not started.

- [ ] **N-exa · Exa** (New connector, S-M). Evaluate web provider alternative.
  - Why: Alternative web search and content research provider.
  - Next / acceptance: Add explicit no-auth catalog mode if chosen; test limits, retrieval and attribution. Named connector currently requires OAuth; starter rate limits differ from an account-backed integration.
  - [Evidence](https://exa.ai/mcp). Status: Not started.

- [ ] **N-firecrawl · Firecrawl** (New connector, S-M). Evaluate web provider alternative.
  - Why: Alternative focused on web scraping and extraction for research tasks.
  - Next / acceptance: Evaluate full OAuth endpoint and scrape/search parity before selecting research provider. Directory publishes search-specific endpoint; full OAuth path is different. Usage limits apply.
  - [Evidence](https://www.firecrawl.dev/blog/best-mcp-servers-for-developers). Status: Not started.

- [ ] **N-fireflies · Fireflies** (New connector, S-M). Add meeting provider on demand.
  - Why: Alternative meeting transcript and action-item source.
  - Next / acceptance: Validate custom consent, meeting search, transcript access and source links. Plan, transcript permissions and overlap with Granola need evaluation.
  - [Evidence](https://guide.fireflies.ai/articles/3039542843-learn-about-fireflies-mcp-server-connect-your-ai-tool). Status: Not started.

- [ ] **N-intercom · Intercom** (New connector, M). Validate and add hosted MCP.
  - Why: Convert customer conversations and support work into tasks.
  - Next / acceptance: Support region choice, validate OAuth eligibility, conversations, contacts and ticket operations. US and EU endpoints differ; Australian workspaces unsupported in current docs.
  - [Evidence](https://developers.intercom.com/docs/guides/mcp). Status: Not started.

- [ ] **N-make · Make** (New connector, M). Validate and add hosted MCP.
  - Why: Run user-authored workflows and connect otherwise unsupported services.
  - Next / acceptance: Prefer scenario-run scopes; verify organization selection and selected workflow behavior. Scenario setup and scope choice required. Management tools can be broad.
  - [Evidence](https://help.make.com/make-mcp-server). Status: Not started.

- [ ] **N-n8n · n8n** (New connector, M-L). Validate and add hosted MCP.
  - Why: Support local-first and self-hosted automation without hand-building every service.
  - Next / acceptance: Add validated tenant URL setup; test /mcp-server/http and explicit workflow permissions. Tenant-specific URL, instance admin enablement and allowed callback configuration required.
  - [Evidence](https://docs.n8n.io/connect/connect-to-n8n-mcp-server). Status: Not started.

- [ ] **N-supabase · Supabase** (New connector, S-M). Validate and add hosted MCP.
  - Why: Give execution agents project schema and database context.
  - Next / acceptance: Start project-scoped/read-only and verify separation of user accounts before enabling writes. Project scoping and write-capable database tools require explicit permissions.
  - [Evidence](https://supabase.com/docs/guides/ai-tools/mcp). Status: Not started.

- [ ] **N-miro · Miro** (New connector, M). Validate and add hosted MCP.
  - Why: Turn planning boards into task context and update diagrams.
  - Next / acceptance: Confirm eligible plans and multi-client sessions, then test reading and updating a board. Documentation conflicts on plan eligibility; session replacement behavior needs checking.
  - [Evidence](https://developers.miro.com/docs/miro-mcp). Status: Not started.

- [ ] **N-figma · Figma** (New connector, M + external wait). Request access, then add.
  - Why: Design context is valuable for agents implementing product tasks.
  - Next / acceptance: Apply for client access, then validate scope, design reads and canvas writes. Our client needs admission to Figma MCP Catalog.
  - [Evidence](https://developers.figma.com/docs/figma-mcp-server/). Status: Not started.

- [ ] **N-vercel · Vercel** (New connector, M + external wait). Request access, then add.
  - Why: Link deployment and runtime context to execution tasks.
  - Next / acceptance: Apply with our redirect URIs; validate team/project access and tool set. Reviewed-client requirement; our app is not automatically covered by a harness vendor approval.
  - [Evidence](https://vercel.com/docs/agent-resources/vercel-mcp). Status: Not started.

- [ ] **N-canva · Canva** (New connector, M + external wait). Request access, then add.
  - Why: Create visual deliverables directly from tasks.
  - Next / acceptance: Join client-access waitlist; implement supported registered OAuth/CIMD path when available. Developer Portal self-serve registration not yet available in reviewed docs; waitlist required.
  - [Evidence](https://www.canva.dev/docs/apps/mcp/access/). Status: Not started.

- [ ] **N-monday · monday.com** (New connector, M + external wait). Request access, then add.
  - Why: Broaden task/project support for team users.
  - Next / acceptance: Apply for public client registration and map board/item semantics to task adapters. Public integration must be reviewed; private token testing does not authorize public rollout.
  - [Evidence](https://developer.monday.com/api-reference/re/docs/mcp-dynamic-client-registration). Status: Not started.

- [ ] **R-microsoft-learn · Microsoft Learn** (Discovery, Research first). Investigate.
  - Why: Official technical knowledge for execution agents.
  - Next / acceptance: Verify no-auth support and overlap with Context7 before adding.
  - [Evidence](https://claude.com/marketplace/connectors/microsoft-learn). Status: Not started.

- [ ] **R-smartsheet · Smartsheet** (Discovery, Research first). Investigate.
  - Why: Project tracking for larger teams.
  - Next / acceptance: Resolve tenant endpoint and verify row/project permission semantics.
  - [Evidence](https://claude.com/marketplace/connectors/smartsheet). Status: Not started.

- [ ] **R-fathom · Fathom – Your Meeting Intelligence Layer** (Discovery, Research first). Investigate.
  - Why: Additional meeting-to-task input.
  - Next / acceptance: Compare transcript/summary availability and onboarding with Granola.
  - [Evidence](https://claude.com/marketplace/connectors/fathom). Status: Not started.

- [ ] **R-read-ai · Read AI** (Discovery, Research first). Investigate.
  - Why: Meeting and work context for task creation.
  - Next / acceptance: Confirm generic MCP access and meeting retrieval coverage.
  - [Evidence](https://claude.com/marketplace/connectors/read-ai). Status: Not started.

- [ ] **R-otter-ai · Otter.ai** (Discovery, Research first). Investigate.
  - Why: Additional meeting-to-task input.
  - Next / acceptance: Confirm custom-client eligibility, plans and transcript permissions.
  - [Evidence](https://claude.com/marketplace/connectors/otter-ai). Status: Not started.

- [ ] **R-ticktick · TickTick** (Discovery, Research first). Investigate.
  - Why: Personal task coverage adjacent to Todoist.
  - Next / acceptance: Verify official endpoint/client access and assignment, dates, recurring tasks and completion.
  - [Evidence](https://claude.com/marketplace/connectors/ticktick). Status: Not started.

- [ ] **R-wrike · Wrike** (Discovery, Research first). Investigate.
  - Why: Team project management coverage.
  - Next / acceptance: Validate assignment, status, folder/project movement and OAuth.
  - [Evidence](https://claude.com/marketplace/connectors/wrike). Status: Not started.

- [ ] **R-craft · Craft** (Discovery, Research first). Investigate.
  - Why: Bring personal documents and structured notes into agent context.
  - Next / acceptance: Verify OAuth/custom-client support and document write scope.
  - [Evidence](https://claude.com/marketplace/connectors/craft). Status: Not started.

- [ ] **R-mem · Mem** (Discovery, Research first). Investigate.
  - Why: A relevant knowledge source for a notes-centric product.
  - Next / acceptance: Verify search, fetch, writes and account availability.
  - [Evidence](https://claude.com/marketplace/connectors/mem). Status: Not started.

- [ ] **R-reclaim-ai · Reclaim.ai** (Discovery, Research first). Investigate.
  - Why: Scheduling could close the loop between tasks and available time.
  - Next / acceptance: Verify plans and scheduling controls; compare against our calendar/deck model.
  - [Evidence](https://claude.com/marketplace/connectors/reclaim-ai). Status: Not started.

- [ ] **R-fastmail · Fastmail** (Discovery, Research first). Investigate.
  - Why: Add a non-Google, non-Microsoft mailbox option.
  - Next / acceptance: Verify OAuth/client registration and mail versus calendar tool coverage.
  - [Evidence](https://claude.com/marketplace/connectors/fastmail). Status: Not started.

- [ ] **R-fibery · Fibery** (Discovery, Research first). Investigate.
  - Why: Connect product plans and knowledge to work.
  - Next / acceptance: Verify tenant setup, entity types and safe write policies.
  - [Evidence](https://claude.com/marketplace/connectors/fibery). Status: Not started.

- [ ] **R-roam-research · Roam Research** (Discovery, Research first). Investigate.
  - Why: Graph notes can enrich task context for existing Roam users.
  - Next / acceptance: Verify workspace endpoint, auth and block/page write semantics.
  - [Evidence](https://claude.com/marketplace/connectors/roam-research). Status: Not started.


## P3: Demand-led, retain native or specialist long tail

- [ ] **M-discord · Discord** (Existing connector, S-M plus prerequisites). Keep native adapter.
  - Why: Preserve 4 native actions. No vendor-published account-data MCP endpoint found in this audit. Third-party wrappers do not establish an official migration target.
  - Next / acceptance: Retain Discord API adapter and monitor vendor account-data MCP documentation.
  - [Evidence](https://discord.com/blog/building-on-the-social-layer-of-games-whats-new-from-gdc-2026). Status: Not started.

- [ ] **M-stripe · Stripe** (Existing connector, S-M plus prerequisites). Validate auth, then migrate.
  - Why: Preserve 6 native actions. From 2026-10-31, ordinary secret/restricted keys without an Agent tag are no longer supported for MCP. Use OAuth or agent keys. Generic write tools have broad effects, so existing risk/approval metadata cannot assume all calls are low risk.
  - Next / acceptance: Verify public-DCR behavior or agent-key support and map existing payment/customer workflows with correct mutation policy.
  - [Evidence](https://docs.stripe.com/mcp). Status: Not started.

- [ ] **M-plaid · Plaid** (Existing connector, S-M plus prerequisites). Keep native bank data, optional developer MCP separately.
  - Why: Preserve 4 native actions. Documented MCP catalog does not provide linked-bank transactions, balances and accounts from the native Plaid product-data connector. A developer diagnostics MCP is not an account-data replacement.
  - Next / acceptance: Keep native bank-data toolkit. Offer official MCP separately if developer diagnostics are useful, with credential/token support.
  - [Evidence](https://plaid.com/docs/resources/mcp/). Status: Not started.

- [ ] **M-telegram · Telegram** (Existing connector, S-M plus prerequisites). Keep native adapter.
  - Why: Preserve 4 native actions. No verified official MCP target to compare.
  - Next / acceptance: Keep native Bot API integration and monitor official releases.
  - [Evidence](https://core.telegram.org/bots/api). Status: Not started.

- [ ] **M-whatsapp · WhatsApp** (Existing connector, S-M plus prerequisites). Keep native pending vendor verification.
  - Why: Preserve 2 native actions. Do not infer production send-message replacement from a setup/development MCP announcement.
  - Next / acceptance: Read the official Business Messaging MCP article and tool reference when available, confirm endpoint/auth and production messaging coverage before selecting a migration.
  - [Evidence](https://developers.meta.com/). Status: Not started.

- [ ] **M-quickbooks · QuickBooks** (Existing connector, S-M plus prerequisites). Keep native until partner onboarding.
  - Why: Preserve 4 native actions. Partner pilot tool list is curated, not the full accounting API. Intuit explicitly recommends REST for deterministic code-orchestrated integrations. Directory endpoint is not the developer pilot endpoint.
  - Next / acceptance: Confirm partner eligibility and desired workflow coverage. Local official server is an alternative only if local execution becomes supported and its operational cost is accepted.
  - [Evidence](https://github.com/IntuitDeveloper/intuit-3p-ai-pilot/blob/main/README.md). Status: Not started.

- [ ] **M-mailgun · Mailgun** (Existing connector, S-M plus prerequisites). Keep native, local MCP is a separate option.
  - Why: Preserve 1 native actions. Current technical docs exclude delete operations. Older support article says read-only except send, while newer technical docs describe additional writes. Validate the selected package version.
  - Next / acceptance: Do not add a fictional hosted URL. Retain native adapter unless adopting supervised local MCP processes is a deliberate engine feature.
  - [Evidence](https://documentation.mailgun.com/docs/mailgun/mcp). Status: Not started.

- [ ] **M-twitter · X (Twitter)** (Existing connector, M-L). Migrate after auth, access and parity prerequisites.
  - Why: Preserve 135 native actions. Direct app-only bearer path is read-only and cannot act as the user. Docs MCP at docs.x.com/mcp is a different documentation-only server. Full write/user-context integration requires replicating supported OAuth handling or running local xurl.
  - Next / acceptance: Evaluate direct registered user-token support or local bridge integration, preserve current user identity and write scope, and validate existing posting actions.
  - [Evidence](https://docs.x.com/tools/mcp). Status: Not started.

- [ ] **N-paypal · PayPal** (New connector, M). Investigate supplemental payment connector.
  - Why: Supplemental payment-platform candidate. Prioritize only with a concrete user workflow.
  - Next / acceptance: Resolve canonical current endpoint and public-client auth before adding provider, and select appropriate transaction risk policy. Public-client registration and required transaction permissions need validation.
  - [Evidence](https://developer.paypal.com/ai-tools/mcp-server). Status: Not started.


## P4: Local-runtime track; separate platform project

- [ ] **F09 · Local MCP packages / stdio** (Platform, L). Add local runtime lifecycle.
  - Why: 132 Claude entries are local extensions, outside our hosted Streamable HTTP ingestion.
  - Next / acceptance: Review install/runtime metadata, secret environment, process supervision and platform support before adding local packages.
  - [Evidence](local-analysis.md). Status: Not started.

- [ ] **R-fantastical · Fantastical** (Discovery, Research first). Investigate local integration.
  - Why: Local calendar context and scheduling.
  - Next / acceptance: Verify OS/app dependencies and contract with existing calendar/deck behavior.
  - [Evidence](https://claude.com/marketplace/connectors/fantastical). Status: Not started.

- [ ] **R-read-and-write-apple-notes · Read and Write Apple Notes** (Discovery, Research first). Investigate local integration.
  - Why: Local notes are a good fit for a local-first app.
  - Next / acceptance: Review AppleScript/package permissions, macOS support and local MCP lifecycle.
  - [Evidence](https://claude.com/marketplace/connectors/read-and-write-apple-notes). Status: Not started.

- [ ] **R-things-applescript · Things (AppleScript)** (Discovery, Research first). Investigate local integration.
  - Why: Local personal task coverage.
  - Next / acceptance: Review third-party package provenance, macOS runtime and task import contract.
  - [Evidence](https://claude.com/marketplace/connectors/things-applescript). Status: Not started.


## Default route for the remaining directory

Every one of the 861 inventory rows includes a bucket, delivery type, priority, current-support match, evidence level and next step. The long tail is demand-led. Promote a row when a user workflow justifies it, then complete the eligibility and parity gates in [README.md](README.md). A published URL alone is not a ready-to-ship connector.
