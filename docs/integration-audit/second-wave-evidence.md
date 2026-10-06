# Second-wave hosted connector evidence

Reviewed September 28, 2026. This follows the user's decision to replace native tool surfaces without preserving old action contracts. Tool parity and legacy aliases are therefore not release gates for this shortlist. Authentication, client eligibility, account scope, approval policy and honest setup requirements still are.

This document records the second-wave decision. The [third delivery wave](../integration-implementation.md#third-delivery-wave) subsequently migrated Readwise, Raindrop and GitLab. Their earlier native-retention status below is historical.

The selected next batch is ClickUp, Trello, Make, Firecrawl, Fireflies, Exa, Microsoft Learn, Neon, Supabase and Cloudflare. Readwise and Raindrop have usable official servers but retain their existing native implementations in this batch. The explicit migration decision covered Linear, Notion, Calendly and Resend, and Raindrop's MCP requires Pro. GitLab.com remains a conditional candidate. Figma, Canva and Vercel require vendor admission before adding our app as a working connector.

## Evidence and limits

Read only public vendor documentation and public metadata. The [reusable discovery script](discover-second-wave.mjs) enforces GET requests and calls the installed MCP SDK's `discoverOAuthServerInfo`. The [capture](second-wave-discovery.json) contains 11 endpoints, request URLs/statuses, discovered resource and authorization metadata, timestamps and per-record hashes. It performed no client registration, account authorization, token exchange, MCP initialization or tool execution. Microsoft Learn's no-auth classification comes from its official documentation and repository, not authenticated testing.

“Ready” below means the official endpoint and generic-client eligibility match an available host authentication mode. It does not claim completed live sign-in or successful authenticated tool execution. Metadata advertising a registration endpoint does not override a vendor's client allowlist. Providers that require a dynamically registered client secret now use a trusted catalog profile, without asking users to register an OAuth application manually.

## Ranked additions and replacements

| Rank | Connector | Exact endpoint and selected auth | Readiness and conditions |
| --- | --- | --- | --- |
| 1 | ClickUp | `https://mcp.clickup.com/mcp`, OAuth DCR with PKCE | Ready with the implemented authorization-code-only registration profile. Generic custom clients explicitly supported. Tasks, assignees, lists, docs, time and chat are strong product fit. All plans, public beta. Without Everything AI: 50 calls per rolling 24 hours on Free, 300 on paid plans. No permanent-delete tools. API keys are unsupported. [Official guide](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server) |
| 2 | Trello | `https://mcp.trello.com/v1`, OAuth DCR with PKCE | Ready. Any MCP-capable app and all Trello plans documented. One workspace per authorization. Cards can move across lists, be updated, completed or archived. Read, Write and Search grants plus organization domain/permission policies apply. Planner focus-time creation requires Premium/Enterprise. OAuth only, no API-token path. [Official repository](https://github.com/atlassian/trello-mcp-server) |
| 3 | Readwise | `https://mcp2.readwise.io/mcp`, OAuth DCR with PKCE | Technically ready, native retained in this batch. “Other apps” are explicitly supported. This combined server covers Readwise highlights and Reader documents, including search and changes. Use `mcp2`, not the deprecated Readwise-only server. Index updates happen in the background. [Official guide](https://docs.readwise.io/tools/mcp) |
| 4 | Raindrop | `https://api.raindrop.io/rest/v2/ai/mcp`, OAuth DCR with PKCE | Technically ready for **Pro users**, native retained. MCP is beta and Pro-only, so replacement would change account eligibility. Generic compatible clients documented. Bearer REST access tokens are an alternative, but OAuth avoids asking for an existing token. Streamable HTTP only. [Official guide](https://developer.raindrop.io/mcp/mcp) |
| 5 | Cloudflare | `https://mcp.cloudflare.com/mcp`, OAuth DCR with PKCE | Ready. Generic SDKs/clients documented, with user-selected permissions during OAuth. The API-wide code-execution tool can mutate infrastructure, so use high mutation risk by default. Keep the base URL's compact code-mode surface rather than exposing roughly 2,500 tools using `codemode=false`. API tokens are also supported. [Official guide](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/), [official repository](https://github.com/cloudflare/mcp) |
| 6 | Neon | `https://mcp.neon.tech/mcp`, OAuth DCR with PKCE | Ready for development/test database work. At the base URL, consent lets the user select one project, categories and read-only access. Read/write scopes advertised. Vendor does not recommend production use. Organization projects require organization/project context. API-key bearer auth also supported. IP-allowlisted projects need Neon's MCP egress IPs allowed. [Official repository](https://github.com/neondatabase/mcp-server-neon) |
| 7 | Microsoft Learn | `https://learn.microsoft.com/api/mcp`, no auth | Ready with F05. Documentation search, article fetch and code-sample search. No private Microsoft account data, user sign-in or Microsoft 365 scope. Generic clients and no-auth setup explicitly documented. Adds Microsoft/Azure/.NET reference material alongside Context7. [Official reference](https://learn.microsoft.com/en-us/training/support/mcp-developer-reference), [official repository](https://github.com/microsoftdocs/mcp) |
| 8 | Supabase | `https://mcp.supabase.com/mcp`, OAuth DCR with PKCE and `client_secret_post` | Ready with the implemented catalog registration profile. Generic clients and automatic DCR are documented. Browser consent authorizes an organization. The base URL covers its projects, without forced project scope or read-only mode. Use high mutation risk. PAT bearer is a documented alternative, not the selected onboarding path. [Official guide](https://supabase.com/docs/guides/ai-tools/mcp) |
| 9 | GitLab.com | `https://gitlab.com/api/v4/mcp`, OAuth DCR with PKCE | Generic clients and public non-confidential OAuth apps are documented. Metadata advertises only secret basic/post token auth. The new profile makes a confidential DCR path feasible, but GitLab's returned registration contract needs its own verification before adding it. Request `mcp`, not every OAuth scope. Top-level group Owner must enable MCP client access. Self-managed/Dedicated need instance configuration and F07 endpoint selection. [Official guide](https://docs.gitlab.com/user/model_context_protocol/mcp_server/), [group controls](https://docs.gitlab.com/user/group/access_and_permissions/#allow-access-to-the-mcp-server) |

The parallel public-source review supplied four more ready additions:

| Connector | Exact endpoint and selected auth | Scope and conditions |
| --- | --- | --- |
| Make | `https://mcp.make.com`, OAuth DCR with PKCE and `client_secret_post` | Generic OAuth clients use this universal URL. Consent selects the organization and scopes. Scenario execution can reach all active/on-demand scenarios in the authorized organization. Team-restricted users need the appropriate Teams-or-higher plan. Broad automation uses high mutation risk. [Official guide](https://developers.make.com/mcp-server/connect-using-oauth) |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp-oauth`, OAuth DCR with PKCE | Browser sign-in selects a team and exposes tools available on its plan. The vendor provides generic client JSON configuration. The separate API-key path is `/v2/mcp`. Paid usage and browser/automation tools warrant high mutation risk. [Official guide](https://docs.firecrawl.dev/mcp-server) |
| Fireflies | `https://api.fireflies.ai/mcp`, OAuth DCR with PKCE | Generic custom MCP connection documented. Requires an active Fireflies account and exposes meeting information the signed-in user can access. Google/Microsoft sign-in supported. [Official guide](https://guide.fireflies.ai/articles/3039542843-learn-about-fireflies-mcp-server-connect-your-ai-tool) |
| Exa | `https://mcp.exa.ai/mcp`, no auth | Generic clients receive rate-limited keyless search and page fetching. This is not the paid Exa Agent surface. OAuth at `?login` and the vendor's `x-api-key` header are separate account-backed options. [Official guide](https://exa.ai/docs/get-started/exa-mcp) |

## Public discovery observations

Every OAuth endpoint below advertised a registration endpoint and S256. These are actual public GET observations in the capture, not inferred from a directory listing.

| Connector | Registration endpoint | Advertised token authentication | Resource scopes / implementation note |
| --- | --- | --- | --- |
| ClickUp | `https://mcp.clickup.com/oauth/register` | `none` | `read write`. **Only `authorization_code` is advertised as a grant type.** Configure this provider's registration declaration accordingly, instead of assuming refresh-token support. |
| Trello | `https://auth.atlassian.com/VCeDsk8ZHncYF1g234fKtc4lNipbBhu3/dcr/register` | `none`, secret post/basic, private-key JWT | Resource metadata lists offline access and granular account/board/organization/member/Inbox/Planner grants. Follow resource metadata and the user's consent. |
| Readwise | `https://readwise.io/o/register/` | `none`, secret basic/post | `openid read write`. The authorization server has a path: issuer `https://readwise.io/o/`, discovery at `https://readwise.io/.well-known/oauth-authorization-server/o`. SDK discovery handled it. |
| Raindrop | `https://api.raindrop.io/v2/oauth/register` | secret post, `none` | `read write`. Resource identifier is `https://api.raindrop.io/rest/v2`, an ancestor of the MCP path. |
| Cloudflare | `https://mcp.cloudflare.com/register` | secret basic/post, `none` | Resource metadata requests `user:read account:read`. Authorization metadata lists a large product permission catalog. Do not mechanically request every authorization-server scope. |
| Neon | `https://mcp.neon.tech/api/register` | secret post/basic, `none` | Authorization metadata lists `read write`. Resource metadata does not provide a scope list. Consent can select access. |
| Supabase | `https://api.supabase.com/platform/oauth/apps/register` | secret basic/post | Resource metadata includes organization, project, database, secrets, functions, environment, analytics and storage permissions. Catalog selects secret post. |
| GitLab | `https://gitlab.com/oauth/register` | secret basic/post | Resource metadata limits MCP to `mcp`. `none` absent despite documented non-confidential apps. DCR is rate-limited to 10 registrations/hour/IP. Instances can disable DCR and require a pre-registered app. |
| Figma | `https://api.figma.com/v1/oauth/mcp/register` | secret basic/post | `mcp:connect`. Metadata is publicly readable, but our client still requires catalog approval. |
| Canva | `https://mcp.canva.com/register` | secret basic/post, `none` | Resource grants cover profile, designs, folders, templates, comments, assets and brand kits. Existing DCR is deprecated in favor of CIMD. Public metadata does not waive admission. |
| Vercel | `https://api.vercel.com/login/oauth/register` | secret basic/post, client-secret JWT, private-key JWT | Resource metadata requests `openid`. App review remains required. |

Our SDK chooses resource-metadata scopes ahead of a client fallback. Preserve that distinction from authorization-server `scopes_supported`, which can list unrelated API capabilities.

## Scope and region decisions

For **Supabase**, the selected base URL authorizes an organization, including its projects. It is not advertised as read-only or project-scoped. Optional `read_only=true`, `project_ref=<id>` and `features=<groups>` can narrow the server. Project scope disables account tools. Per-user project/feature selection belongs to F07's trusted parameter model. The vendor recommends restricted project/read-only access for production data. Its PAT alternative uses `Authorization: Bearer <PAT>`, generated at `https://supabase.com/dashboard/account/tokens`. [Official configuration and PAT instructions](https://supabase.com/docs/guides/ai-tools/mcp)

For **Neon**, the exact names are `readonly`, `projectId` and repeatable `category`, which differ from Supabase's parameter names. OAuth stores the selected grant, so changing a URL cannot silently broaden an existing token. The base endpoint's editable consent is sufficient for a first named connector. An organization API key limits bearer access to that organization. [Official scope documentation](https://github.com/neondatabase/mcp-server-neon#scopes-and-read-only-mode)

For **Cloudflare**, both user and account API tokens are documented. Account tokens need Account Resources Read for automatic account identification. Tokens with Client IP Address Filtering are unsupported by this server. OAuth avoids manual token setup and allows permission selection. [Official authentication instructions](https://github.com/cloudflare/mcp#option-2-api-token)

No alternate regional hosted URL is prescribed in the reviewed ClickUp, Trello, Readwise, Raindrop, Cloudflare, Neon or Supabase setup guides. This is not a claim about data residency. GitLab is explicitly instance-specific outside GitLab.com. Do not route an existing self-managed GitLab user to the cloud endpoint silently.

## Vendor approval gates

| Connector | Exact official endpoint | Why it should not be presented as ready for our app |
| --- | --- | --- |
| Figma | `https://mcp.figma.com/mcp` | Only clients admitted to Figma's MCP Catalog may connect. New clients must join the waitlist. Figma for Government supports only its desktop server, which is outside this hosted implementation. [Eligibility](https://developers.figma.com/docs/figma-mcp-server/), [endpoint setup](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/) |
| Canva | `https://mcp.canva.com/mcp` | Client must be recognized. The access page describes future Developer Portal enablement but explicitly says self-service is not yet available. Use the waitlist meanwhile. CIMD clients also require redirect-URI allowlisting. Approved portal clients use ID/secret, while CIMD needs a public metadata document. Advanced brand/resizing/autofill features have paid-plan conditions. [Access](https://www.canva.dev/docs/apps/mcp/access/), [endpoint](https://www.canva.dev/docs/apps/quickstart/#step-2-configure-your-ai-assistant) |
| Vercel | `https://mcp.vercel.com` | Vendor explicitly restricts access to reviewed/approved clients. Approval of Claude, Codex or another execution harness does not grant approval to this app's independent host client. Public documentation tools do not establish account-data access. All plans can use the beta through an eligible client. [Official eligibility](https://vercel.com/docs/agent-resources/vercel-mcp#connecting-to-vercel-mcp) |

## Implementation and verification

The selected ten additions are now catalog entries. The OAuth provider accepts catalog-selected `grantTypes` and `tokenEndpointAuthMethod` declarations. Defaults remain authorization code plus refresh and public `none`. Runtime obtains exceptions only from the pinned hosted definition, not a request or custom-server setting. ClickUp requests only authorization code. Make and Supabase request `client_secret_post`, with dynamically issued client secrets sealed in the existing OAuth store.

An actual SDK fixture rejects any ClickUp registration that requests refresh support. Separate SDK fixtures for Make and Supabase cover DCR, encrypted client-secret persistence, PKCE, callback code exchange and refresh. They also check that the secret is sent only in token POST bodies and does not appear in consent URLs, public metadata or plaintext storage. All network calls in these tests are synthetic. Live user sign-in remains unverified.

The root implementation additionally initialized Exa and Microsoft Learn without credentials and read their public tool lists, discovering two and three tools respectively. One public search on each service succeeded. These unauthenticated smoke checks are separate from the GET-only discovery capture and accessed no connected account data.

Remaining decisions are vendor admission for Figma/Canva/Vercel, explicit instance selection for GitLab, and optional per-user project/feature parameters. Readwise and Raindrop retain native registration for now. These endpoint findings do not depend on historical native action parity.
