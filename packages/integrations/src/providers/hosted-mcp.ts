export type HostedMcpEndpoint =
  | { kind: 'region'; label: string; options: readonly { id: string; label: string; url: string }[] }
  | { kind: 'instance'; label: string; placeholder: string; path: string };

/** Public setup metadata. Saved endpoints are immutable until disconnected. */
export type HostedMcpEndpointSetup =
  | { kind: 'region'; label: string; options: readonly { id: string; label: string }[]; selectedId?: string; locked: boolean }
  | { kind: 'instance'; label: string; placeholder: string; selectedUrl?: string; locked: boolean };

/** Provider-maintained MCP services presented as ordinary built-in integrations. */
export interface HostedMcpProvider {
  id: string;
  displayName: string;
  /** Fixed service URL. Configurable services require an explicit endpoint selection instead. */
  url?: string;
  endpoint?: HostedMcpEndpoint;
  /** Omitted for existing catalog entries, which use public OAuth discovery. */
  auth?: {
    kind: 'oauth';
    /** Registered clients require operator-provided credentials, never dynamic registration. */
    registration?: 'registered';
    /** Catalog-selected OAuth profile, never selected by remote tools or user input. */
    grantTypes?: readonly ('authorization_code' | 'refresh_token')[];
    tokenEndpointAuthMethod?: 'none' | 'client_secret_post' | 'client_secret_basic';
    /** Client scope fallback, or explicit initial consent scopes with authorizeBeforeConnect. */
    scopes?: readonly string[];
    authorizationParams?: Readonly<Record<string, string>>;
    /** Start interactive OAuth from metadata, for explicit scopes or gateways without a 401 challenge. */
    authorizeBeforeConnect?: boolean;
  } | { kind: 'bearer'; label?: string; helpUrl?: string } | { kind: 'none' };
  /** Provider-specific write floor, for broad automation or administrative tools. */
  defaultMutationRisk?: 'medium' | 'high';
  /** A documented API-key path alongside OAuth, without changing saved accounts. */
  tokenAuth?: { label: string; helpUrl: string };
}

export const HOSTED_MCP_PROVIDERS: readonly HostedMcpProvider[] = [
  { id: 'slack', displayName: 'Slack', url: 'https://mcp.slack.com/mcp',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_post' }, defaultMutationRisk: 'high' },
  { id: 'notion', displayName: 'Notion', url: 'https://mcp.notion.com/mcp' },
  { id: 'linear', displayName: 'Linear', url: 'https://mcp.linear.app/mcp' },
  { id: 'atlassian', displayName: 'Atlassian', url: 'https://mcp.atlassian.com/v2/mcp?tools=all', defaultMutationRisk: 'high' },
  { id: 'calendly', displayName: 'Calendly', url: 'https://mcp.calendly.com', defaultMutationRisk: 'high' },
  { id: 'raindrop', displayName: 'Raindrop', url: 'https://api.raindrop.io/rest/v2/ai/mcp' },
  { id: 'zoom', displayName: 'Zoom', url: 'https://mcp.zoom.us/mcp/zoom/streamable',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_basic' }, defaultMutationRisk: 'high' },
  { id: 'hubspot', displayName: 'HubSpot', url: 'https://mcp.hubspot.com/',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_post' }, defaultMutationRisk: 'high' },
  { id: 'todoist', displayName: 'Todoist', url: 'https://ai.todoist.net/mcp' },
  { id: 'granola', displayName: 'Granola', url: 'https://mcp.granola.ai/mcp' },
  { id: 'sentry', displayName: 'Sentry', url: 'https://mcp.sentry.dev/mcp' },
  // Context7's browser sign-in is exposed on the OAuth-specific transport path.
  { id: 'context7', displayName: 'Context7', url: 'https://mcp.context7.com/mcp/oauth' },
  { id: 'tavily', displayName: 'Tavily', url: 'https://mcp.tavily.com/mcp' },
  { id: 'github', displayName: 'GitHub', url: 'https://api.githubcopilot.com/mcp/',
    auth: { kind: 'bearer', label: 'Personal access token', helpUrl: 'https://github.com/settings/personal-access-tokens/new' },
    defaultMutationRisk: 'high' },
  { id: 'zapier', displayName: 'Zapier', url: 'https://mcp.zapier.com/api/v1/connect',
    auth: { kind: 'bearer', label: 'Connection token', helpUrl: 'https://docs.zapier.com/mcp/get-started/connect/other' },
    defaultMutationRisk: 'high' },
  { id: 'clickup', displayName: 'ClickUp', url: 'https://mcp.clickup.com/mcp',
    auth: { kind: 'oauth', grantTypes: ['authorization_code'] } },
  { id: 'trello', displayName: 'Trello', url: 'https://mcp.trello.com/v1' },
  { id: 'make', displayName: 'Make', url: 'https://mcp.make.com',
    auth: { kind: 'oauth', tokenEndpointAuthMethod: 'client_secret_post' }, defaultMutationRisk: 'high' },
  { id: 'firecrawl', displayName: 'Firecrawl', url: 'https://mcp.firecrawl.dev/v2/mcp-oauth', defaultMutationRisk: 'high' },
  { id: 'fireflies', displayName: 'Fireflies', url: 'https://api.fireflies.ai/mcp' },
  { id: 'exa', displayName: 'Exa', url: 'https://mcp.exa.ai/mcp', auth: { kind: 'none' } },
  { id: 'microsoft_learn', displayName: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp', auth: { kind: 'none' } },
  { id: 'neon', displayName: 'Neon', url: 'https://mcp.neon.tech/mcp', defaultMutationRisk: 'high' },
  { id: 'supabase', displayName: 'Supabase', url: 'https://mcp.supabase.com/mcp',
    auth: { kind: 'oauth', tokenEndpointAuthMethod: 'client_secret_post' }, defaultMutationRisk: 'high' },
  { id: 'cloudflare', displayName: 'Cloudflare', url: 'https://mcp.cloudflare.com/mcp', defaultMutationRisk: 'high' },
  { id: 'fastmail', displayName: 'Fastmail', url: 'https://api.fastmail.com/mcp', defaultMutationRisk: 'high' },
  { id: 'fathom', displayName: 'Fathom', url: 'https://api.fathom.ai/mcp' },
  { id: 'otter', displayName: 'Otter', url: 'https://mcp.otter.ai/mcp' },
  { id: 'read_ai', displayName: 'Read AI', url: 'https://api.read.ai/mcp' },
  { id: 'miro', displayName: 'Miro', url: 'https://mcp.miro.com/',
    auth: { kind: 'oauth', tokenEndpointAuthMethod: 'client_secret_post' } },
  { id: 'craft', displayName: 'Craft', url: 'https://mcp.craft.do/my/mcp' },
  { id: 'mem', displayName: 'Mem', url: 'https://mcp.mem.ai/mcp' },
  { id: 'reclaim', displayName: 'Reclaim', url: 'https://mcp.reclaim.ai/',
    auth: { kind: 'oauth', tokenEndpointAuthMethod: 'client_secret_post' }, defaultMutationRisk: 'high' },
  { id: 'wrike', displayName: 'Wrike', url: 'https://mcp.wrike.com/v2',
    auth: { kind: 'bearer', label: 'Permanent access token', helpUrl: 'https://developers.wrike.com/docs/mcp-legacy-authentication-pat' } },
  { id: 'ticktick', displayName: 'TickTick', url: 'https://mcp.ticktick.com/',
    auth: { kind: 'oauth', grantTypes: ['authorization_code'] } },
  { id: 'intercom', displayName: 'Intercom', endpoint: { kind: 'region', label: 'Workspace region', options: [
    { id: 'us', label: 'United States', url: 'https://mcp.intercom.com/mcp' },
    { id: 'eu', label: 'Europe', url: 'https://mcp.eu.intercom.com/mcp' },
  ] }, defaultMutationRisk: 'high' },
  { id: 'n8n', displayName: 'n8n', endpoint: { kind: 'instance', label: 'Instance URL', placeholder: 'https://your-instance.app.n8n.cloud', path: '/mcp-server/http' }, defaultMutationRisk: 'high' },
  { id: 'airtable', displayName: 'Airtable', url: 'https://mcp.airtable.com/mcp', defaultMutationRisk: 'high' },
  { id: 'readwise', displayName: 'Readwise', url: 'https://mcp2.readwise.io/mcp' },
  { id: 'stripe', displayName: 'Stripe', url: 'https://mcp.stripe.com', defaultMutationRisk: 'high' },
  { id: 'gitlab', displayName: 'GitLab', url: 'https://gitlab.com/api/v4/mcp',
    auth: { kind: 'oauth', grantTypes: ['authorization_code'], tokenEndpointAuthMethod: 'none' }, defaultMutationRisk: 'high' },
  { id: 'asana', displayName: 'Asana', url: 'https://mcp.asana.com/v2/mcp',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_post' } },
  { id: 'figma', displayName: 'Figma', url: 'https://mcp.figma.com/mcp', defaultMutationRisk: 'high' },
  { id: 'dropbox', displayName: 'Dropbox', url: 'https://mcp.dropbox.com/mcp',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_post',
      authorizationParams: { token_access_type: 'offline' } }, defaultMutationRisk: 'high' },
  { id: 'box', displayName: 'Box', url: 'https://mcp.box.com/',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_post' }, defaultMutationRisk: 'high' },
  { id: 'resend', displayName: 'Resend', url: 'https://mcp.resend.com/mcp', defaultMutationRisk: 'high' },
  { id: 'twitter', displayName: 'X (Twitter)', url: 'https://api.x.com/mcp',
    auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_basic' }, defaultMutationRisk: 'high' },
  { id: 'robinhood', displayName: 'Robinhood', url: 'https://agent.robinhood.com/mcp/trading', defaultMutationRisk: 'high' },
  { id: 'posthog', displayName: 'PostHog', url: 'https://mcp.posthog.com/mcp', defaultMutationRisk: 'high',
    tokenAuth: { label: 'Personal API key', helpUrl: 'https://posthog.com/docs/api/personal-api-keys' } },
  // The vendor's older /http examples return 404. Live challenges advertise /mcp.
  { id: 'paypal', displayName: 'PayPal', endpoint: { kind: 'region', label: 'PayPal environment', options: [
    { id: 'production', label: 'Production', url: 'https://mcp.paypal.com/mcp' },
    { id: 'sandbox', label: 'Sandbox', url: 'https://mcp.sandbox.paypal.com/mcp' },
  ] }, defaultMutationRisk: 'high' },
  { id: 'docusign', displayName: 'Docusign', endpoint: { kind: 'region', label: 'Docusign environment', options: [
    { id: 'production', label: 'Production', url: 'https://mcp.docusign.com/mcp' },
    { id: 'demo', label: 'Developer demo', url: 'https://mcp-d.docusign.com/mcp' },
  ] }, auth: { kind: 'oauth', registration: 'registered', tokenEndpointAuthMethod: 'client_secret_basic', authorizeBeforeConnect: true },
    defaultMutationRisk: 'high' },
  { id: 'monday', displayName: 'monday.com', url: 'https://mcp.monday.com/mcp',
    auth: { kind: 'bearer', label: 'Personal API token', helpUrl: 'https://developer.monday.com/api-reference/docs/mcp-api-token' },
    defaultMutationRisk: 'high' },
  { id: 'smartsheet', displayName: 'Smartsheet', endpoint: { kind: 'region', label: 'Smartsheet region', options: [
    { id: 'us', label: 'United States', url: 'https://mcp.smartsheet.com' },
    { id: 'eu', label: 'Europe', url: 'https://mcp.smartsheet.eu' },
    { id: 'au', label: 'Australia', url: 'https://mcp.smartsheet.au' },
  ] }, auth: { kind: 'bearer', label: 'API token', helpUrl: 'https://developers.smartsheet.com/api/smartsheet/guides/getting-started' },
    defaultMutationRisk: 'high' },
  { id: 'fibery', displayName: 'Fibery', url: 'https://mcp.fibery.io/mcp', defaultMutationRisk: 'high' },
  { id: 'webflow', displayName: 'Webflow', url: 'https://mcp.webflow.com/mcp', defaultMutationRisk: 'high' },
  // Its generic resource metadata advertises all REST scopes. Use the vendor's
  // documented MCP scope explicitly during initial consent and registration.
  { id: 'wordpress', displayName: 'WordPress.com', url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
    auth: { kind: 'oauth', scopes: ['auth'], authorizeBeforeConnect: true }, defaultMutationRisk: 'high' },
  // Its live resource metadata omits scopes_supported. The 401 challenge and the
  // vendor's server source both require `api`, so keep it when no challenge applies.
  // Data requests go through one `api_request` tool, a paid read with no write floor.
  { id: 'dataforseo', displayName: 'DataForSEO', url: 'https://mcp.dataforseo.com/v3/mcp',
    auth: { kind: 'oauth', scopes: ['api'] } },
];

export function getHostedMcpProvider(id: string): HostedMcpProvider | undefined {
  return HOSTED_MCP_PROVIDERS.find((provider) => provider.id === id);
}
