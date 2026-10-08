# Current integration catalog

After the eighth delivery wave: **67 integrations, comprising 57 external MCP integrations and 10 native integrations.** Reconciled against the TypeScript catalog on October 8, 2026. Implementation and validation details are in the [delivery tracker](integration-implementation.md).

**Hosted/external MCP** means the service supplies tool names, schemas and execution. We maintain connection setup, encrypted credentials, permissions and any typed app consumers. n8n connects to the user-selected instance, which may be self-hosted. **Native** means our code implements operations against the service API. Native does not imply the same tool surface Claude exposes.

The eight registered-app integrations use official services of the kind exposed through Claude, with our own client registration. Hosted service adoption does not transfer Claude's app admission, account permissions or commercial terms. Generic client endpoints may differ from Claude-specific endpoints. No integration compatibility aliases remain.

These entries are implemented and fixture-tested. They are not a claim that all 67 have passed real-account sign-in and workflow acceptance.

## Hosted MCP with browser sign-in (42)

| Integration | Endpoint or setup |
| --- | --- |
| Airtable | `https://mcp.airtable.com/mcp` |
| Atlassian | `https://mcp.atlassian.com/v2/mcp?tools=all` |
| Calendly | `https://mcp.calendly.com` |
| ClickUp | `https://mcp.clickup.com/mcp` |
| Cloudflare | `https://mcp.cloudflare.com/mcp` |
| Context7 | `https://mcp.context7.com/mcp/oauth` |
| Craft | `https://mcp.craft.do/my/mcp` |
| DataForSEO | `https://mcp.dataforseo.com/v3/mcp`, or its API login and password |
| Fastmail | `https://api.fastmail.com/mcp` |
| Fathom | `https://api.fathom.ai/mcp` |
| Fibery | `https://mcp.fibery.io/mcp` |
| Figma | `https://mcp.figma.com/mcp`, after Figma admits this client |
| Firecrawl | `https://mcp.firecrawl.dev/v2/mcp-oauth` |
| Fireflies | `https://api.fireflies.ai/mcp` |
| GitLab | `https://gitlab.com/api/v4/mcp` |
| Granola | `https://mcp.granola.ai/mcp` |
| Intercom | Choose United States or Europe |
| Linear | `https://mcp.linear.app/mcp` |
| Make | `https://mcp.make.com` |
| Mem | `https://mcp.mem.ai/mcp` |
| Miro | `https://mcp.miro.com/` |
| n8n | Enter the instance URL |
| Neon | `https://mcp.neon.tech/mcp` |
| Notion | `https://mcp.notion.com/mcp` |
| Otter | `https://mcp.otter.ai/mcp` |
| PayPal | Choose Production or Sandbox |
| PostHog | `https://mcp.posthog.com/mcp` |
| Raindrop | `https://api.raindrop.io/rest/v2/ai/mcp` |
| Read AI | `https://api.read.ai/mcp` |
| Readwise | `https://mcp2.readwise.io/mcp` |
| Reclaim | `https://mcp.reclaim.ai/` |
| Resend | `https://mcp.resend.com/mcp` |
| Robinhood | `https://agent.robinhood.com/mcp/trading` |
| Sentry | `https://mcp.sentry.dev/mcp` |
| Stripe | `https://mcp.stripe.com` |
| Supabase | `https://mcp.supabase.com/mcp` |
| Tavily | `https://mcp.tavily.com/mcp` |
| TickTick | `https://mcp.ticktick.com/` |
| Todoist | `https://ai.todoist.net/mcp` |
| Trello | `https://mcp.trello.com/v1` |
| Webflow | `https://mcp.webflow.com/mcp` |
| WordPress.com | `https://public-api.wordpress.com/wpcom/v2/mcp/v1` |

## Hosted MCP with a registered OAuth app (8)

| Integration | Endpoint or setup |
| --- | --- |
| Asana | `https://mcp.asana.com/v2/mcp` |
| Box | `https://mcp.box.com/` |
| Docusign | Choose Production or Developer demo, with an integration key and secret for that environment |
| Dropbox | `https://mcp.dropbox.com/mcp` |
| HubSpot | `https://mcp.hubspot.com/` |
| Slack | `https://mcp.slack.com/mcp` |
| X (Twitter) | `https://api.x.com/mcp` |
| Zoom | `https://mcp.zoom.us/mcp/zoom/streamable` |

## Hosted MCP with a token (5)

| Integration | Endpoint or setup |
| --- | --- |
| GitHub | `https://api.githubcopilot.com/mcp/` |
| monday.com | `https://mcp.monday.com/mcp`, personal API token for personal/internal use |
| Smartsheet | Choose United States, Europe or Australia, then supply that region's API token |
| Wrike | `https://mcp.wrike.com/v2` |
| Zapier | `https://mcp.zapier.com/api/v1/connect` |

## Hosted MCP without an account (2)

| Integration | Endpoint or setup |
| --- | --- |
| Exa | `https://mcp.exa.ai/mcp` |
| Microsoft Learn | `https://learn.microsoft.com/api/mcp` |

Registered apps require the exact callback shown in Settings and the provider-specific setup described in the [registration guide](integration-audit/fifth-wave-provider-evidence.md) and [Docusign guide](integration-audit/sixth-wave-docusign.md). GitHub uses a scoped personal access token, Zapier a connection token, and Wrike a permanent access token. Tokens are encrypted. Plan and organization requirements still apply, including Raindrop Pro, GitLab group MCP enablement and n8n instance access.

Robinhood requires desktop Agentic account onboarding. Its documented reads span Robinhood accounts, while trading is limited to the Agentic account. PostHog chooses the region during login and some AI tools require organization permission and may incur vendor charges. PayPal and Docusign require an explicit environment selection, with separate credentials and tools per connected account. All four use a high risk floor for mutations and the existing approval policy. See the provider evidence for [Robinhood](integration-audit/sixth-wave-robinhood.md), [PostHog](integration-audit/sixth-wave-posthog.md), [PayPal](integration-audit/sixth-wave-paypal.md) and [Docusign](integration-audit/sixth-wave-docusign.md).

The seventh wave adds website and publishing coverage through [Webflow](integration-audit/seventh-wave-webflow.md) and [WordPress.com](integration-audit/seventh-wave-wordpress.md), plus [monday.com](integration-audit/seventh-wave-monday.md), [Smartsheet](integration-audit/seventh-wave-smartsheet.md) and [Fibery](integration-audit/seventh-wave-fibery.md). Webflow authorizes one workspace per connection, with an open Designer and Bridge App required for current visual context. WordPress.com requires MCP enabled and an eligible WordPress.com or Jetpack plan. Its sign-in requests the documented `auth` scope rather than all advertised REST scopes. Smartsheet requires a supported paid plan and keeps regional tokens separate. monday.com's personal-token route covers personal/internal use, while public distribution requires vendor approval. All five retain per-account credentials, canonical tools and high mutation-risk approval defaults.

The eighth wave adds SEO research through [DataForSEO](integration-audit/eighth-wave-dataforseo.md): keyword volumes and difficulty, search results, backlinks and competitor rankings. It signs in with browser OAuth and the `api` scope, or takes the API login and password as Basic credentials. Agents read the API documentation through three free read-only tools and request data through one `api_request` tool, which spends the account's prepaid DataForSEO balance. That tool runs without approval by default, like other paid research reads, and Ask first can gate it in Settings.

Ramp, Canva and Vercel remain outside the connectable catalog because of [documented client-admission requirements](integration-audit/seventh-wave-admission.md). Figma is listed for the [plugins evaluation](plugins-evaluation-accounts.md), and its sign-in works only once Figma admits this client. Shopify has a real [hosted Admin MCP](integration-audit/seventh-wave-shopify.md), but a supported custom-client registration path has not been established for this app. Native API credentials do not automatically qualify as hosted MCP client credentials.

## Native API integrations (10)

| Integration | Authentication |
| --- | --- |
| Discord | Registered OAuth app |
| Google | Registered OAuth app |
| Mailgun | Provider-specific credentials |
| Microsoft 365 | Registered OAuth app |
| Plaid | Provider-specific credentials |
| QuickBooks | Registered OAuth app |
| Salesforce | Registered OAuth app |
| Telegram | Provider-specific credentials |
| WhatsApp | Provider-specific credentials |
| Zendesk | Provider-specific credentials |

QuickBooks has 13 read-only accounting actions, including invoices, customers and financial reports. Its current vendor-hosted routes do not establish general onboarding eligibility for this app. See [QuickBooks setup](integration-audit/quickbooks-implementation.md). Google and Microsoft data also drive app calendar/deck features, so their migration requires validating those consumers.

## App feature coverage

Hosted integrations support multiple labeled accounts with separate credentials, endpoint and OAuth app bindings, and targeted reconnect, test and disconnect. Settings also reports added, removed and changed upstream tools per account. Discovery refreshes on tool-list notifications and on runtime access after five minutes. No SQLite migration is needed for these features.

Todoist and Jira have typed consumers for the task picker using canonical hosted tools. They read accounts independently and preserve account labels, source links and partial results. ClickUp, Trello, TickTick and Wrike picker consumers remain pending authenticated contract capture. The [evidence and capture guide](integration-audit/task-picker-expansion.md) records the exact gaps. The retired Linear and Asana picker consumers are removed. These services remain available to agents through hosted tools, but their task-picker support needs validated current input/output schemas. Other hosted additions likewise expose agent tools without automatically adding deterministic picker integrations.
