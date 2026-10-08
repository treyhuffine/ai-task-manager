// Presentation metadata for the integration catalog: which group a provider shows
// under, a one-line description, a brand color for the monogram fallback tile
// (see integration-icon-data.ts), and optional setup help (where to get
// credentials + numbered steps) rendered in the connect panel. The connect
// mechanics (method, credential fields, OAuth readiness) come from the API, not
// from here, so this file is purely cosmetic and safe to import on the client.
// Provider-owned menu labels and credential names use the provider's wording,
// such as Wrike's Apps & Integrations or Docusign's integration key.

export type IntegrationCategory =
  | 'Workspace'
  | 'Communication'
  | 'Email'
  | 'Productivity'
  | 'Developer'
  | 'Sales & CRM'
  | 'Storage'
  | 'Documents & agreements'
  | 'Websites & publishing'
  | 'Finance';

/** The order categories render in the catalog. */
export const CATEGORY_ORDER: IntegrationCategory[] = [
  'Workspace',
  'Communication',
  'Email',
  'Productivity',
  'Developer',
  'Sales & CRM',
  'Storage',
  'Documents & agreements',
  'Websites & publishing',
  'Finance',
];

export interface IntegrationMeta {
  category: IntegrationCategory;
  /** One line, shown under the name. No dashes (project copy rule). */
  description: string;
  /** Brand color (6-digit hex, no #) for the monogram fallback tile. */
  brandHex?: string;
  /**
   * Where to get credentials (paste-key providers) or register an OAuth app
   * (OAuth providers). Rendered as a link in the connect panel.
   */
  docsUrl?: string;
  /**
   * Numbered credential setup steps, shown in direct or OAuth app setup.
   * No dashes (project copy rule).
   */
  setup?: string[];
}

export const INTEGRATION_META: Record<string, IntegrationMeta> = {
  google: {
    category: 'Workspace',
    description: 'Gmail, Calendar, Drive, Docs, and Sheets.',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  microsoft: {
    category: 'Workspace',
    description: 'Outlook mail and calendar across Microsoft 365.',
    brandHex: '0078D4',
    docsUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  },

  slack: {
    category: 'Communication',
    description: 'Send messages and read channels.',
    brandHex: '4A154B',
    docsUrl: 'https://docs.slack.dev/ai/slack-mcp-server/',
    setup: [
      'Create an internal Slack app or use an app published in the Slack Marketplace.',
      'Register the callback address below and enable PKCE for local or desktop redirects.',
      'Add the user scopes listed in the setup guide and obtain any required workspace approval.',
      'Paste the client ID and client secret, then sign in with your Slack account.',
    ],
  },
  discord: {
    category: 'Communication',
    description: 'Post to servers and channels.',
    docsUrl: 'https://discord.com/developers/applications',
  },
  telegram: {
    category: 'Communication',
    description: 'Send messages through a Telegram bot.',
    docsUrl: 'https://t.me/BotFather',
    setup: [
      'Open @BotFather in Telegram and send /newbot.',
      'Follow the prompts to name your bot.',
      'Copy the bot token it gives you and paste it below.',
      'After connecting, link a chat in Notifications.',
    ],
  },
  whatsapp: {
    category: 'Communication',
    description: 'Send messages via the WhatsApp Business API.',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started',
    setup: [
      'In Meta for Developers, open your app, then WhatsApp, then API Setup.',
      'Copy the temporary or permanent access token.',
      'Copy the phone number ID shown on the same page.',
    ],
  },
  zoom: {
    category: 'Communication',
    description: 'Create and manage meetings.',
    docsUrl: 'https://developers.zoom.us/docs/mcp/servers/connect-to-zoom-mcp-servers/',
    setup: [
      'Create a General app in the Zoom App Marketplace with the product scopes you need.',
      'Register the exact callback address below. Your app may require an HTTPS callback.',
      'Paste the client ID and client secret, then authorize the app with your Zoom account.',
      'Your available tools depend on your Zoom licenses, scopes, and app approval.',
    ],
  },
  granola: {
    category: 'Communication',
    description: 'Search meeting notes, transcripts, and decisions.',
    brandHex: '66A47F',
    docsUrl: 'https://docs.granola.ai/help-center/sharing/integrations/mcp',
  },
  fireflies: {
    category: 'Communication',
    description: 'Search meeting transcripts, summaries, and action items.',
    brandHex: '7A5AF8',
    docsUrl: 'https://guide.fireflies.ai/articles/3039542843-learn-about-fireflies-mcp-server-connect-your-ai-tool',
  },
  fathom: {
    category: 'Communication',
    description: 'Search meeting recordings, transcripts, and summaries.',
    brandHex: '6851FF',
    docsUrl: 'https://help.fathom.video/en/articles/11497793',
  },
  otter: {
    category: 'Communication',
    description: 'Search and read meeting transcripts available to your Otter account.',
    brandHex: '3367D6',
    docsUrl: 'https://help.otter.ai/hc/en-us/articles/35287607569687-Otter-MCP-Server',
  },
  read_ai: {
    category: 'Communication',
    description: 'Search meeting reports and transcripts. Requires workspace downloads to be enabled.',
    brandHex: '246BFD',
    docsUrl: 'https://support.read.ai/hc/en-us/articles/49381158409491-MCP-Server',
  },

  fastmail: {
    category: 'Email',
    description: 'Read, organize, and send mail with permissions you choose during sign-in.',
    brandHex: '007DAA',
    docsUrl: 'https://www.fastmail.help/hc/en-us/articles/15869557281295-Connecting-AI-tools-via-Fastmail-s-MCP-server',
  },

  resend: {
    category: 'Email',
    description: 'Manage email, contacts, domains, and delivery through Resend.',
    docsUrl: 'https://resend.com/docs/mcp-server',
  },
  mailgun: {
    category: 'Email',
    description: 'Send transactional email.',
    docsUrl: 'https://app.mailgun.com/settings/api_security',
    setup: ['Open the Mailgun dashboard, then API security keys.', 'Copy your private API key.'],
  },

  notion: {
    category: 'Productivity',
    description: 'Search and work with pages, databases, and workspace content.',
    docsUrl: 'https://developers.notion.com/guides/mcp/overview',
  },
  monday: {
    category: 'Productivity',
    description: 'Manage boards, items, projects and customer workflows.',
    brandHex: '6161FF',
    docsUrl: 'https://developer.monday.com/api-reference/docs/mcp-api-token',
    setup: [
      'Create a personal API token in monday.com and paste it below.',
      'Your token uses your account permissions. An administrator may need to enable MCP access.',
      'This connection supports personal and internal use. Public integrations require monday.com approval.',
    ],
  },
  smartsheet: {
    category: 'Productivity',
    description: 'Search and manage sheets, rows, reports and project workflows.',
    brandHex: '005EE0',
    docsUrl: 'https://developers.smartsheet.com/ai-mcp/smartsheet/install-the-smartsheet-mcp-server',
    setup: [
      'Use a Business, Enterprise or Advanced Work Management plan.',
      'Choose the region that hosts your Smartsheet account.',
      'Generate an API token for that region and paste it below. Each regional account connects separately.',
    ],
  },
  fibery: {
    category: 'Productivity',
    description: 'Search databases, manage records and documents, and update workflows.',
    brandHex: 'F9D100',
    docsUrl: 'https://the.fibery.io/@public/User_Guide/Guide/Fibery-MCP-Server-401',
    setup: [
      'Enter your Fibery workspace name on the sign-in page and authorize access.',
      'Your workspace permissions and IP restrictions apply to connected tools.',
      'Add another account to connect a different Fibery workspace.',
    ],
  },
  webflow: {
    category: 'Websites & publishing',
    description: 'Manage sites, pages, CMS content, assets and publishing.',
    brandHex: '146EF5',
    docsUrl: 'https://developers.webflow.com/mcp/reference/getting-started',
    setup: [
      'Sign in to Webflow and authorize the sites you own or administer in one workspace.',
      'Add another account to connect a different Webflow workspace.',
      'For visual snapshots or the current Designer selection, keep the site open in Designer with the MCP Bridge App connected.',
    ],
  },
  wordpress: {
    category: 'Websites & publishing',
    description: 'Manage site content, media, comments and publishing across your sites.',
    brandHex: '21759B',
    docsUrl: 'https://developer.wordpress.com/docs/mcp/',
    setup: [
      'Enable MCP in your WordPress.com account settings, then sign in and authorize access.',
      'Use a paid WordPress.com plan, or a free site within its first 30 days.',
      'Self-hosted sites need Jetpack with a Jetpack AI or Jetpack Complete plan. One connection reaches your eligible sites.',
    ],
  },
  dataforseo: {
    category: 'Websites & publishing',
    description: 'Research keywords, search results, backlinks and competitor rankings.',
    brandHex: '87C000',
    docsUrl: 'https://dataforseo.com/help-center/setting-up-the-official-dataforseo-mcp-server-simple-guide',
    setup: [
      'Sign in to DataForSEO and approve access, or choose Use API key.',
      'For an API key, enter the API login and API password from API Access as login:password. The API password is not your account password. After its first day, API Access sends it by email.',
      'Each data request spends your DataForSEO balance at standard API prices. Documentation lookups are free.',
      'Data requests run without approval. Turn on Ask first for api_request to approve each one.',
    ],
  },
  todoist: {
    category: 'Productivity',
    description: 'Manage tasks, projects, sections, and assignments.',
  },
  zapier: {
    category: 'Productivity',
    description: 'Run actions across the apps you connect in Zapier.',
    brandHex: 'FF4F00',
    docsUrl: 'https://docs.zapier.com/mcp/get-started/connect/other',
    setup: [
      'Open mcp.zapier.com, add an MCP server, and choose Other.',
      'Open its Connect tab and generate a connection token.',
      'Copy the token by itself and paste it below.',
      'Choose the apps and actions to enable in Zapier. Calls use your Zapier plan.',
    ],
  },
  clickup: {
    category: 'Productivity',
    description: 'Manage tasks, documents, and chat in ClickUp.',
    brandHex: '7B68EE',
    docsUrl: 'https://developer.clickup.com/docs/connect-an-ai-assistant-to-clickups-mcp-server',
  },
  trello: {
    category: 'Productivity',
    description: 'Work with boards, lists, and cards in a selected workspace.',
    brandHex: '0052CC',
    docsUrl: 'https://github.com/atlassian/trello-mcp-server',
  },
  make: {
    category: 'Productivity',
    description: 'Run your active, on-demand scenarios and manage automations.',
    brandHex: '6D00CC',
    docsUrl: 'https://developers.make.com/mcp-server/connect-using-oauth',
  },
  firecrawl: {
    category: 'Productivity',
    description: 'Search, scrape, and extract web content using your Firecrawl team.',
    brandHex: 'FF6600',
    docsUrl: 'https://docs.firecrawl.dev/mcp-server',
  },
  exa: {
    category: 'Productivity',
    description: 'Search and fetch web pages without an account, within starter limits.',
    brandHex: '265AFF',
    docsUrl: 'https://exa.ai/mcp',
  },
  miro: {
    category: 'Productivity',
    description: 'Read and update boards in your authorized Miro team.',
    brandHex: 'FFD02F',
    docsUrl: 'https://developers.miro.com/docs/miro-mcp',
  },
  craft: {
    category: 'Productivity',
    description: 'Search, read, and edit documents in a selected Craft space.',
    brandHex: '336BEE',
    docsUrl: 'https://www.craft.do/imagine/guide/mcp/opencode_mcp',
  },
  mem: {
    category: 'Productivity',
    description: 'Search, create, and organize your notes in Mem.',
    brandHex: '5850EC',
    docsUrl: 'https://docs.mem.ai/mcp/setup',
  },
  reclaim: {
    category: 'Productivity',
    description: 'Plan tasks and schedule time with Reclaim 2.0.',
    brandHex: '6B4EFF',
    docsUrl: 'https://help.reclaim.ai/en/articles/15280604-reclaim-2-0-faq',
  },
  wrike: {
    category: 'Productivity',
    description: 'Manage tasks, projects, and work available to your Wrike account.',
    brandHex: '08CF65',
    docsUrl: 'https://developers.wrike.com/docs/mcp-legacy-authentication-pat',
    setup: [
      'In Wrike, open Apps & Integrations from your profile, then API.',
      'Open or create an app and find Permanent access token.',
      'Create or get a token, then save the app.',
      'Copy the token and paste it below. It inherits your Wrike permissions.',
    ],
  },
  ticktick: {
    category: 'Productivity',
    description: 'Manage tasks, lists, sections, assignments, and habits.',
    brandHex: '4777F5',
    docsUrl: 'https://help.ticktick.com/articles/7438129581631995904',
  },
  n8n: {
    category: 'Productivity',
    description: 'Run workflows enabled for AI on your n8n instance.',
    brandHex: 'EA4B71',
    docsUrl: 'https://docs.n8n.io/connect/connect-to-n8n-mcp-server',
    setup: [
      'Ask an instance owner or admin to enable Instance-level MCP in n8n Settings.',
      'Open Connect a client and copy the instance address or MCP endpoint below.',
      'Enable the workflows you want to access through MCP.',
      'Sign in with your n8n account. Your instance may require approval for this app’s callback address.',
    ],
  },
  intercom: {
    category: 'Sales & CRM',
    description: 'Work with conversations and customer context in a US or European workspace.',
    brandHex: '286EFA',
    docsUrl: 'https://developers.intercom.com/docs/guides/mcp',
    setup: [
      'Choose United States for app.intercom.com or Europe for app.eu.intercom.com.',
      'Australian workspaces are not currently supported by this service.',
    ],
  },
  asana: {
    category: 'Productivity',
    description: 'Track tasks and projects.',
    docsUrl: 'https://developers.asana.com/docs/integrating-with-asanas-mcp-server',
    setup: [
      'Create an MCP app in the Asana developer console.',
      'Register the exact callback address below and allow your workspace in the app’s distribution settings.',
      'Paste the client ID and client secret, then sign in and select your Asana workspace.',
    ],
  },
  airtable: {
    category: 'Productivity',
    description: 'Manage bases, records, and comments in your authorized Airtable workspaces.',
    docsUrl: 'https://airtable.com/developers/agents/mcp/other',
  },
  calendly: {
    category: 'Productivity',
    description: 'Manage availability, bookings, and scheduled events.',
    docsUrl: 'https://developer.calendly.com/docs/mcp/calendly-mcp-server',
  },
  raindrop: {
    category: 'Productivity',
    description: 'Save, organize, and search bookmarks. Requires Raindrop Pro.',
    brandHex: '1A7CFF',
    docsUrl: 'https://developer.raindrop.io/mcp/mcp',
  },
  readwise: {
    category: 'Productivity',
    description: 'Search and manage Readwise highlights and Reader documents.',
    brandHex: 'E0703A',
    docsUrl: 'https://docs.readwise.io/tools/mcp',
  },

  gitlab: {
    category: 'Developer',
    description: 'Work with GitLab.com projects, issues, and merge requests. Group access must be enabled.',
    docsUrl: 'https://docs.gitlab.com/user/model_context_protocol/mcp_server/',
  },
  github: {
    category: 'Developer',
    description: 'Work with repositories, issues, and pull requests.',
    brandHex: '24292F',
    docsUrl: 'https://github.com/settings/personal-access-tokens/new',
    setup: [
      'Create a GitHub personal access token with access to the repositories you need.',
      'Grant only the repository and organization permissions you want agents to use.',
      'Copy the token and paste it below. Your organization may require approval.',
    ],
  },
  linear: {
    category: 'Developer',
    description: 'Manage issues, projects, documents, and team workflows.',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  atlassian: {
    category: 'Developer',
    description: 'Work with Jira issues and Confluence pages. Your organization may require admin approval.',
    brandHex: '0052CC',
    docsUrl: 'https://developer.atlassian.com/cloud/rovo-mcp/',
  },
  sentry: {
    category: 'Developer',
    description: 'Investigate errors, issues, and application performance.',
    brandHex: '362D59',
    docsUrl: 'https://mcp.sentry.dev/',
  },
  context7: {
    category: 'Developer',
    description: 'Find current library documentation and code examples.',
    brandHex: '1B5E46',
    docsUrl: 'https://context7.com/docs/howto/oauth',
  },
  microsoft_learn: {
    category: 'Developer',
    description: 'Search official Microsoft documentation and code samples.',
    brandHex: '0078D4',
    docsUrl: 'https://learn.microsoft.com/en-us/training/support/mcp',
  },
  neon: {
    category: 'Developer',
    description: 'Work with Neon development databases, projects, and branches.',
    brandHex: '00A67D',
    docsUrl: 'https://neon.com/docs/ai/neon-mcp-server',
  },
  supabase: {
    category: 'Developer',
    description: 'Work with development databases in your authorized Supabase organization.',
    brandHex: '3ECF8E',
    docsUrl: 'https://supabase.com/docs/guides/ai-tools/mcp',
  },
  cloudflare: {
    category: 'Developer',
    description: 'Manage Cloudflare services within your authorized account permissions.',
    brandHex: 'F38020',
    docsUrl: 'https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/',
  },
  tavily: {
    category: 'Productivity',
    description: 'Search the web and extract content for research.',
    brandHex: '316CF4',
    docsUrl: 'https://github.com/tavily-ai/tavily-mcp',
  },

  hubspot: {
    category: 'Sales & CRM',
    description: 'Manage contacts and deals.',
    docsUrl: 'https://developers.hubspot.com/docs/apps/developer-platform/build-apps/integrate-with-the-remote-hubspot-mcp-server',
    setup: [
      'In HubSpot Development, open MCP Connectors and create a connector.',
      'Register the callback address below and copy its client ID and client secret.',
      'Sign in to select an account and approve access. Account permissions and subscriptions determine available tools.',
    ],
  },
  salesforce: {
    category: 'Sales & CRM',
    description: 'Read and update records.',
    brandHex: '00A1E0',
    docsUrl: 'https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm',
  },

  dropbox: {
    category: 'Storage',
    description: 'Browse and manage files.',
    docsUrl: 'https://help.dropbox.com/integrations/connect-dropbox-mcp-server',
    setup: [
      'Create a scoped Full Dropbox app in the Dropbox App Console.',
      'Register the callback address below and enable the account, file, and sharing permissions in the setup guide, including files.metadata.write.',
      'Paste the app key as the client ID and the app secret as the client secret, then sign in.',
      'Your team admin may need to approve app creation or access.',
    ],
  },
  box: {
    category: 'Storage',
    description: 'Browse and manage files.',
    docsUrl: 'https://developer.box.com/guides/box-mcp/setup',
    setup: [
      'Ask a Box admin to create integration credentials under Box MCP server in Admin Console.',
      'Register the callback address below and choose the file and AI permissions your integration needs.',
      'Paste the client ID and client secret, then sign in. Some tools require additional Box licenses.',
    ],
  },

  twitter: {
    category: 'Communication',
    description: 'Read and publish posts using your authorized X account.',
    brandHex: '000000',
    docsUrl: 'https://docs.x.com/tools/mcp',
    setup: [
      'Create an OAuth 2.0 Web App or Automated App in the X Developer Console.',
      'Register the exact callback address below and configure the permissions you need.',
      'Paste the client ID and client secret, then authorize your X account.',
      'Your plan, app enrollment, and granted permissions determine available tools.',
    ],
  },

  stripe: {
    category: 'Finance',
    description: 'Work with Stripe customers, payments, invoices, and account operations.',
    docsUrl: 'https://docs.stripe.com/mcp',
  },
  robinhood: {
    category: 'Finance',
    description: 'Read investment accounts and holdings, and trade through your Agentic account.',
    brandHex: '00C805',
    docsUrl: 'https://robinhood.com/us/en/support/articles/agentic-trading-overview/',
    setup: [
      'Sign in from a desktop browser with a primary Robinhood individual investing account in good standing.',
      'Complete Robinhood’s Agentic account onboarding during authorization.',
      'Connected tools can read your Robinhood accounts. Trading is limited to your Agentic account.',
    ],
  },
  paypal: {
    category: 'Finance',
    description: 'Manage merchant invoices, payments and related account workflows.',
    brandHex: '003087',
    docsUrl: 'https://developer.paypal.com/ai-tools/mcp-server',
    setup: [
      'Choose Production for your real PayPal account or Sandbox for test accounts.',
      'Sign in to PayPal and authorize access to the selected environment.',
    ],
  },
  posthog: {
    category: 'Developer',
    description: 'Query analytics, investigate errors, and manage feature flags and experiments.',
    brandHex: 'F9BD2B',
    docsUrl: 'https://posthog.com/docs/model-context-protocol',
    setup: [
      'Sign in to PostHog and authorize the organizations and projects you want to use.',
      'PostHog selects your US or European region during sign-in.',
      'AI-powered tools require organization AI processing to be enabled and may incur PostHog AI charges.',
    ],
  },
  figma: {
    category: 'Developer',
    description: 'Read design context and work with Figma and FigJam files.',
    docsUrl: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
    setup: [
      'Figma admits approved MCP clients. Ri may need approval before you can sign in.',
      'Check Figma’s client requirements and join its new-client waitlist if needed.',
      'An account connection is followed by a separate check for supported interactive views.',
    ],
  },
  docusign: {
    category: 'Documents & agreements',
    description: 'Find agreements, check signature status and run agreement workflows.',
    brandHex: '4C00FF',
    docsUrl: 'https://developers.docusign.com/platform/mcp-server/',
    setup: [
      'Create an integration key and secret in Docusign and enable the confidential authorization code flow.',
      'Register the exact callback address shown below.',
      'Use a Developer demo account while testing. Production requires a production-enabled integration.',
      'Paste the integration key as the client ID and its secret as the client secret, then choose the matching environment and sign in.',
    ],
  },
  plaid: {
    category: 'Finance',
    description: 'Access linked bank accounts.',
    brandHex: '111111',
    docsUrl: 'https://dashboard.plaid.com/team/keys',
    setup: ['Open the Plaid Dashboard, then Team Settings, then Keys.', 'Copy your client_id and a secret.'],
  },
  quickbooks: {
    category: 'Finance',
    description: 'Read financial reports, invoices, customers, and accounting records.',
    docsUrl: 'https://developer.intuit.com/app/developer/dashboard',
    setup: [
      'Create a QuickBooks Online app in the Intuit Developer dashboard with Accounting access.',
      'Use production keys for your real company. Development keys work only with a sandbox company.',
      'Register the exact callback address shown below. Intuit requires HTTPS for production.',
      'Paste both the client ID and client secret, then connect and choose your company.',
    ],
  },
};

/** Fallback bucket for any provider missing from INTEGRATION_META. */
export const DEFAULT_CATEGORY: IntegrationCategory = 'Productivity';

export function integrationMeta(providerId: string): IntegrationMeta {
  return INTEGRATION_META[providerId] ?? { category: DEFAULT_CATEGORY, description: '' };
}
