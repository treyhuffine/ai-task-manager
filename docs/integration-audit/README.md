# Claude connector audit and implementation roadmap

Snapshot: **September 28, 2026**. This audit inventories every connector in Claude's public directory, compares our current catalog with official vendor MCP offerings, and proposes a worklist for this app. No accounts were connected and no connector implementation was changed by this audit.

Implementation has since begun. See the [live implementation checklist](../integration-implementation.md) and [current catalog](../integrations-current.md) for implemented code, setup modes, revised migration priorities and validation status. Counts and recommendations below remain the original research snapshot. The user subsequently accepted vendor-defined tool surfaces without compatibility aliases, so the original parity requirements below no longer block those replacements.

**Recommendation: make vendor-hosted MCP the default for new agent-facing integrations, and migrate existing connectors only after authentication and product-feature parity are proven.** There is a large opportunity to retire hand-maintained wrappers. The remaining work is our connector platform, account setup, permissions and the small adapters used by app features.

## Open the results

- [Filterable workbook](claude-integrations-audit.xlsx): ranked backlog, all 861 connector records, and methodology. Filter by bucket, external MCP type, priority, existing support or evidence level.
- [Implementation checklist](BACKLOG.md): 75 platform, migration, addition and investigation tasks, with next steps and evidence.
- [Complete machine-readable audit](audit.json): all inventory rows and backlog entries, suitable for future marketplace work.
- [Our catalog at audit time](current-integrations.json) and [code constraints](local-analysis.md): 29 providers, 34 toolkits, 285 native actions, plus Todoist's dynamically discovered tools.
- [Existing-provider evidence](migration-evidence.json), [vendor research notes](notes.md), and [new-provider evidence](new-integration-evidence.json).

## What “external MCP” means in this inventory

The [public directory](https://claude.com/marketplace/connectors-plugins) contains **861 connectors**. The independently fetched [sitemap](https://claude.com/sitemap.xml) contains exactly the same 861 connector slugs. The page also advertises 340 plugins, a separate collection excluded here. Details and capture hashes are in [directory-discovery.md](directory-discovery.md) and [capture-manifest.json](capture-manifest.json).

| Delivery classification | Count | What we can conclude |
| --- | ---: | --- |
| Published remote MCP URL outside Anthropic's MCP host domain | 677 | There is an external endpoint to investigate. Client eligibility, publisher ownership, auth and tool parity are separate checks. |
| Anthropic-hosted remote MCP | 9 | The listing is not evidence that our product can reuse that host. Find an independently available upstream service. |
| Remote MCP, no endpoint published in directory metadata | 43 | Could require tenant-specific setup or onboarding. This does not mean “no MCP.” |
| Local MCP extension | 132 | Requires a local package/runtime path. It cannot be installed by adding one hosted URL to our catalog. |
| **Total** | **861** | **729 remote and 132 local** |

The nine Anthropic-hosted entries are Microsoft 365, PubMed, Clinical Trials, bioRxiv, Anthropic Economic Index, ChEMBL, NPI Registry, ICD-10 Codes and CMS Coverage. Microsoft separately offers Work IQ, which has different authentication, tenancy and billing requirements. [Microsoft Work IQ](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview).

“External” describes the delivery mechanism, not permission to reuse it. Some directory URLs also target Claude specifically. Our inventory preserves the directory URL and separately records vendor-documented alternatives. Examples include HubSpot, Dropbox, QuickBooks and Context7. [Endpoint differences](notes.md).

## How the list is bucketed

Each connector has exactly one editorial product bucket, so these counts sum to 861. Original Claude categories remain in a separate field because they are multi-label. All local listings and one remote listing lacked official categories, so their assignments are explicitly marked as inferred.

| Bucket | Count |
| --- | ---: |
| Automation/platform | 24 |
| Commerce/travel/local | 61 |
| Communication/calendar | 51 |
| Data/analytics | 86 |
| Design/media | 49 |
| Developer tools/operations | 113 |
| Education/nonprofit | 28 |
| Finance/accounting | 134 |
| Health/science | 46 |
| Legal/security/compliance | 57 |
| Notes/documents/knowledge | 46 |
| Other/specialist | 3 |
| People/hiring | 14 |
| Sales/marketing/support | 122 |
| Tasks/projects | 27 |

Listings carrying only a broad productivity tag were grouped using their names and stated function. These editorial assignments remain separate from official source categories. Duplicate display names are retained as separate listings when their slugs differ. Local and remote versions may have different publishers and capabilities.

## Existing connectors: what should change

Our catalog has 29 providers. Google contains five toolkits and Microsoft two. The 285 native-action count is not a usage measure or a migration-effort estimate: X alone contributes 135 actions. Todoist's remote tools are discovered at runtime and are not included in that count. [Source inventory and app dependencies](local-analysis.md).

| Group | Existing providers | Recommendation |
| --- | --- | --- |
| Already moved to hosted MCP | Todoist | Complete live connection and workflow validation. |
| Public dynamic client registration documented | Linear, Notion, Calendly, Resend | First migration candidates after shared migration fixes. Preserve each old action contract. |
| Public registration documented, with extra routing or instance work | Jira, Confluence, GitLab | Good candidates. Atlassian combines two existing connectors. GitLab has instance/version/admin conditions. |
| Generic OAuth documented, registration details need validation | Readwise, Raindrop, Airtable, Stripe | Investigate auth before committing. Readwise is especially relevant to our notes workflow. |
| Registered credentials, tenant setup or client approval required | Asana, Slack, Zoom, HubSpot, Salesforce, Dropbox, Box | Feasible conditional migrations after setup support and access are established. |
| Multiple toolkits or product parity concerns | Google, Microsoft | Plan per toolkit. Preserve calendar/deck behavior and existing account selection. |
| Restricted developer pilot | QuickBooks | Keep native until partner access and coverage are confirmed. |
| Official MCP serves a different purpose | Plaid, Discord | Keep native bank-data/message functionality. Developer diagnostics or documentation MCP does not replace it. |
| Official local MCP only | Mailgun | Keep native unless local MCP execution becomes a deliberate platform feature. |
| Official hosted service, documented user OAuth uses local bridge | X / Twitter | Evaluate separately. Preserve identity, media handling, posting coverage and policies. |
| Endpoint or public account-data onboarding unresolved | Telegram, WhatsApp, Zendesk | Keep native. Follow the exact evidence gaps in the migration records. |

All 29 providers have their own task in the [backlog](BACKLOG.md), including those absent from Claude's directory. “Not found in the directory” and “no vendor MCP exists” are different findings.

The strongest low-friction auth evidence is [Linear](https://linear.app/docs/mcp), [Notion](https://developers.notion.com/guides/mcp/build-mcp-client), [Calendly](https://developer.calendly.com/docs/mcp/calendly-mcp-server), and [Resend](https://github.com/resend/resend-mcp). Exact source URLs, auth requirements and parity concerns for every provider are recorded in [migration-evidence.json](migration-evidence.json).

Two migrations particularly need care:

- Google has official hosted MCP servers, but its published Gmail tools omit sending and its Drive tools omit some existing mutations. It also needs configured Google OAuth and coordination across five toolkit identities. Keep native operations where the documented remote surface has gaps. [Google setup](https://developers.google.com/workspace/guides/configure-mcp-servers), [Gmail tools](https://developers.google.com/workspace/gmail/api/reference/mcp), [Drive tools](https://developers.google.com/workspace/drive/api/reference/mcp).
- Slack explicitly excludes dynamic client registration and limits access to Marketplace or internal apps. Dropbox restricts dynamic registration to approved clients. A working Claude connection does not grant our app equivalent access. [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server/), [Dropbox MCP](https://help.dropbox.com/integrations/connect-dropbox-mcp-server).

## Highest-leverage additions

These priorities are product judgments based on our tasks, notes and agent-execution workflow, not on user telemetry or vendor popularity scores. First-wave candidates have a useful concrete workflow and documented custom-client access. They still require our own integration tests.

| Priority | New connector | Why it matters | Main prerequisite |
| --- | --- | --- | --- |
| P1 | Granola | Meeting decisions and context can become tasks with source links. | Validate workspace access and plan limits. [Docs](https://docs.granola.ai/help-center/sharing/integrations/mcp) |
| P1 | ClickUp | Strong task/project coverage, including assignment and updates. | OAuth, quotas and typed task-picker adapter. [Docs](https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server) |
| P1 | Trello | Boards, lists and cards directly match the requested organization workflow. | One workspace per authorization and a task adapter. [Official server](https://github.com/atlassian/trello-mcp-server) |
| P1 | Sentry | Turn production issues into investigation and implementation tasks. | Verify organization/project scope. [Docs](https://mcp.sentry.dev/) |
| P1 | Context7 | Current library documentation improves agent execution. | Use the OAuth-specific endpoint. [Docs](https://context7.com/docs/howto/oauth) |
| P1 | Zapier | Broad access to user-selected actions without one native wrapper per service. | User setup, dynamic tool sets and paid usage. [Setup](https://docs.zapier.com/mcp/quickstart) |
| P1 | GitHub, supplemental | Connect issues, pull requests and repository work. | Registered OAuth app or scoped PAT. Absent from this Claude directory snapshot. [Official server](https://github.com/github/github-mcp-server) |
| P1 | Tavily, as the initial research-provider candidate | Portable search and extraction across harnesses. | Compare representative tasks with Exa and Firecrawl, then choose one initially. [Official server](https://github.com/tavily-ai/tavily-mcp) |

Second-wave candidates with vendor documentation reviewed: **Fireflies, Intercom, Make, n8n, Supabase and Miro**, plus **Exa and Firecrawl** as research-provider alternatives. n8n needs a user/instance URL. Intercom needs regional endpoint selection. Miro's reviewed documentation conflicts on plan eligibility, and multi-client session behavior needs testing. These are explicit work items rather than assumed details. [Evidence and next steps](new-integration-evidence.json).

Start access investigations for **Figma, Canva, Vercel and monday.com** in parallel. Their product value is high, but our own client must satisfy approval or registration requirements. Approval of Claude, Codex or another host does not transfer to our host. [Figma](https://developers.figma.com/docs/figma-mcp-server/), [Canva](https://www.canva.dev/docs/apps/mcp/access/), [Vercel](https://vercel.com/i/mcp-server-oauth-authorization), [monday.com](https://developer.monday.com/api-reference/re/docs/mcp-dynamic-client-registration).

Directory-only discovery candidates include **TickTick, Reclaim.ai, Craft, Mem, Roam Research, Fastmail, Fathom, Otter.ai, Read AI, Wrike, Smartsheet, Fibery and Microsoft Learn**. Their backlog tasks are to verify eligibility and scope, not immediately ship them. Local **Apple Notes, Things and Fantastical** deserve a separate evaluation because they fit a local-first product, but require local runtime support.

## Work in this order

1. **Finish the Todoist baseline and fix reusable migration contracts.** Verify real consent, reconnect/refresh and the requested assignment/section workflows. Fix the native-OAuth identity mismatch before moving OAuth providers. Test account pins, old action names, task adapters and approval inheritance.
2. **Deliver a small first wave.** Migrate Linear, Notion, Calendly and Resend, then validate Readwise. Add Granola and a task system, followed by the developer/research/automation candidates above. Each connector can be delivered independently once its prerequisites pass.
3. **Expand authentication and account routing.** Support registered OAuth clients, named bearer/no-auth setup, multiple accounts, multiple toolkits and tenant/region endpoints. Then move Asana, Atlassian, GitLab and other conditional providers according to demand. Seek partner access in parallel.
4. **Handle Google and Microsoft as product integrations.** Their calendar data drives the deck. Validate recurrence, time zones, all-day events, cancellations and source links, and preserve existing operations before removing native toolkits.
5. **Grow the long tail on demand.** Promote relevant inventory rows, monitor upstream tool changes and add local MCP package execution only as an explicit platform project.

The main code issue found during this audit is concrete: MCP ingestion preserves a native connection's `authConfigId` while registering its provider with a bearer strategy. The runtime rejects an old OAuth configuration against that strategy. Todoist's previous token-based connection avoids this case. Merely adding another catalog URL is therefore insufficient for migrating a native OAuth provider. [Detailed code evidence](local-analysis.md).

The named hosted path also currently supports one fixed URL, one account and one same-ID toolkit. Generic custom MCP already supports bearer and no-auth modes, but named onboarding only permits OAuth. These are platform work items, not requests to change the SQLite schema. Any future account/pin migration needs explicit design and tests.

## Completion criteria for each connector

A connector is ready when our own client can authorize and refresh, the correct user/tenant identity is preserved, required tools and pagination work, and app-specific contracts pass. Reauthorization and disconnect must leave account scopes and saved permissions correct. Writes need the intended approval policy, including bulk operations and indeterminate failures. New upstream tool schemas should be visible to us before they silently change a deterministic app feature.

For existing connectors, compare against the full native action inventory and validate required workflows before retiring a wrapper. A different tool shape can provide equivalent functionality, so comparison must include behavior rather than names alone. Keep a native fallback for a documented gap. For new connectors, validate a specific end-to-end user workflow rather than counting discovered tools.

Vendor maintenance reduces our endpoint-wrapper work. It does not eliminate our responsibilities for authentication, account routing, typed app adapters, tool permissions, provider changes or usage costs. Some servers also require paid plans, credits or separate automation subscriptions.

## Coverage and reproduction

The **861-row directory inventory is complete for this public snapshot**. We reviewed vendor feasibility for **all 29 existing providers and 21 new candidates**, including supplemental GitHub and PayPal research. The remaining rows are explicitly marked directory-only. No authenticated tool discovery or account-level functional testing was performed, so neither an endpoint nor reviewed documentation is labeled live-verified.

`extract-directory.py` extracts factual fields from saved HTML and reconciles the set with a saved sitemap. `build-audit.py` joins those facts, the source-code inventory and reviewed evidence. `build-backlog.py` regenerates the Markdown checklist and `build-workbook.mjs` builds the filterable artifact using the Codex spreadsheet runtime. Capture hashes, source URLs and metadata provenance are preserved. Marketing descriptions and opaque directory popularity scores are deliberately excluded from the delivered inventory.

```sh
python3 docs/integration-audit/extract-directory.py /tmp/claude-connectors-directory.html /tmp/claude-sitemap.xml
python3 docs/integration-audit/build-audit.py
python3 docs/integration-audit/build-backlog.py
```

Extraction relies on the site's current embedded page structure, not a supported directory API. A future snapshot may change counts, endpoints, access rules and plans. Reconcile again before using this as a release-time eligibility check.
