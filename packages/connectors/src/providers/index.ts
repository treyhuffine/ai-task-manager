/**
 * Provider barrel — every first-party connector's `register*` function, a catalog describing how
 * each one connects (so a host can render the right UI), and `registerAllProviders` to wire them
 * all in one call. OAuth providers accept an injectable `fetch`; direct (API-key/custom) ones
 * connect via `runtime.connectDirect`.
 */
import type { Registry } from '../core/registry';
import type { AuthConfigInput } from '../auth-configs';

import { registerGoogle } from './google';
import { registerMicrosoft } from './microsoft';
import { registerDiscord } from './discord';
import { registerSalesforce } from './salesforce';
import { registerPlaid } from './plaid';
import { registerTelegram } from './telegram';
import { registerWhatsapp } from './whatsapp';
import { registerZendesk } from './zendesk';
import { registerQuickbooks, type QuickbooksProviderOptions } from './quickbooks';
import { registerMailgun } from './mailgun';

export { registerGoogle } from './google';
export { registerMicrosoft } from './microsoft';
export { registerDiscord } from './discord';
export { registerSalesforce } from './salesforce';
export { HOSTED_MCP_PROVIDERS, getHostedMcpProvider } from './hosted-mcp';
export type { HostedMcpProvider, HostedMcpEndpoint, HostedMcpEndpointSetup } from './hosted-mcp';
export { registerPlaid } from './plaid';
export { registerTelegram } from './telegram';
export { registerWhatsapp } from './whatsapp';
export { registerZendesk } from './zendesk';
export { registerQuickbooks } from './quickbooks';
export type { QuickbooksProviderOptions } from './quickbooks';
export { registerMailgun } from './mailgun';

/** How a provider is connected — drives the host's connect UI. */
export type ConnectMethod = 'oauth2' | 'api_key' | 'custom' | 'mcp';

export interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  /** `mcp` uses the hosted catalog's auth mode. Other methods select OAuth or direct credential setup. */
  method: ConnectMethod;
  /** For `custom`/`api_key`, the credential fields a host should prompt for. */
  credentialFields?: string[];
}

/** Static description of every first-party provider and how it connects. */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'google', displayName: 'Google', method: 'oauth2' },
  { id: 'slack', displayName: 'Slack', method: 'mcp' },
  { id: 'notion', displayName: 'Notion', method: 'mcp' },
  { id: 'microsoft', displayName: 'Microsoft 365', method: 'oauth2' },
  { id: 'linear', displayName: 'Linear', method: 'mcp' },
  { id: 'atlassian', displayName: 'Atlassian', method: 'mcp' },
  { id: 'discord', displayName: 'Discord', method: 'oauth2' },
  { id: 'calendly', displayName: 'Calendly', method: 'mcp' },
  { id: 'raindrop', displayName: 'Raindrop', method: 'mcp' },
  { id: 'zoom', displayName: 'Zoom', method: 'mcp' },
  { id: 'hubspot', displayName: 'HubSpot', method: 'mcp' },
  { id: 'salesforce', displayName: 'Salesforce', method: 'oauth2' },
  { id: 'todoist', displayName: 'Todoist', method: 'mcp' },
  { id: 'granola', displayName: 'Granola', method: 'mcp' },
  { id: 'sentry', displayName: 'Sentry', method: 'mcp' },
  { id: 'context7', displayName: 'Context7', method: 'mcp' },
  { id: 'tavily', displayName: 'Tavily', method: 'mcp' },
  { id: 'github', displayName: 'GitHub', method: 'mcp' },
  { id: 'zapier', displayName: 'Zapier', method: 'mcp' },
  { id: 'clickup', displayName: 'ClickUp', method: 'mcp' },
  { id: 'trello', displayName: 'Trello', method: 'mcp' },
  { id: 'make', displayName: 'Make', method: 'mcp' },
  { id: 'firecrawl', displayName: 'Firecrawl', method: 'mcp' },
  { id: 'fireflies', displayName: 'Fireflies', method: 'mcp' },
  { id: 'exa', displayName: 'Exa', method: 'mcp' },
  { id: 'microsoft_learn', displayName: 'Microsoft Learn', method: 'mcp' },
  { id: 'neon', displayName: 'Neon', method: 'mcp' },
  { id: 'supabase', displayName: 'Supabase', method: 'mcp' },
  { id: 'cloudflare', displayName: 'Cloudflare', method: 'mcp' },
  { id: 'fastmail', displayName: 'Fastmail', method: 'mcp' },
  { id: 'fathom', displayName: 'Fathom', method: 'mcp' },
  { id: 'otter', displayName: 'Otter', method: 'mcp' },
  { id: 'read_ai', displayName: 'Read AI', method: 'mcp' },
  { id: 'miro', displayName: 'Miro', method: 'mcp' },
  { id: 'craft', displayName: 'Craft', method: 'mcp' },
  { id: 'mem', displayName: 'Mem', method: 'mcp' },
  { id: 'reclaim', displayName: 'Reclaim', method: 'mcp' },
  { id: 'wrike', displayName: 'Wrike', method: 'mcp' },
  { id: 'ticktick', displayName: 'TickTick', method: 'mcp' },
  { id: 'intercom', displayName: 'Intercom', method: 'mcp' },
  { id: 'n8n', displayName: 'n8n', method: 'mcp' },
  { id: 'airtable', displayName: 'Airtable', method: 'mcp' },
  { id: 'readwise', displayName: 'Readwise', method: 'mcp' },
  { id: 'stripe', displayName: 'Stripe', method: 'mcp' },
  { id: 'plaid', displayName: 'Plaid', method: 'custom', credentialFields: ['client_id', 'secret'] },
  { id: 'telegram', displayName: 'Telegram', method: 'custom', credentialFields: ['token'] },
  { id: 'whatsapp', displayName: 'WhatsApp', method: 'custom', credentialFields: ['access_token', 'phone_number_id'] },
  { id: 'gitlab', displayName: 'GitLab', method: 'mcp' },
  { id: 'asana', displayName: 'Asana', method: 'mcp' },
  { id: 'figma', displayName: 'Figma', method: 'mcp' },
  { id: 'zendesk', displayName: 'Zendesk', method: 'custom', credentialFields: ['subdomain', 'email', 'api_token'] },
  { id: 'dropbox', displayName: 'Dropbox', method: 'mcp' },
  { id: 'box', displayName: 'Box', method: 'mcp' },
  { id: 'quickbooks', displayName: 'QuickBooks', method: 'oauth2' },
  { id: 'resend', displayName: 'Resend', method: 'mcp' },
  { id: 'mailgun', displayName: 'Mailgun', method: 'custom', credentialFields: ['api_key'] },
  { id: 'twitter', displayName: 'X (Twitter)', method: 'mcp' },
  { id: 'robinhood', displayName: 'Robinhood', method: 'mcp' },
  { id: 'posthog', displayName: 'PostHog', method: 'mcp' },
  { id: 'paypal', displayName: 'PayPal', method: 'mcp' },
  { id: 'docusign', displayName: 'Docusign', method: 'mcp' },
  { id: 'monday', displayName: 'monday.com', method: 'mcp' },
  { id: 'smartsheet', displayName: 'Smartsheet', method: 'mcp' },
  { id: 'fibery', displayName: 'Fibery', method: 'mcp' },
  { id: 'webflow', displayName: 'Webflow', method: 'mcp' },
  { id: 'wordpress', displayName: 'WordPress.com', method: 'mcp' },
];

/**
 * Bundled default PUBLIC OAuth clients (PKCE, no confidential secret) — ship a provider's public
 * client id here and users connect with **zero config**, the way the `gh` CLI / Claude Code do.
 * Composed as the `bundled` layer of `storeAuthConfigRegistry`.
 *
 * Empty by default: real client ids require registering an app with each vendor, so they are
 * operator-supplied (drop them here in a fork/build, or feed them via the host from env). Providers
 * that require a CONFIDENTIAL secret can't be safely bundled in an open-source binary — those are
 * connected BYO (the admin service) or through the hosted plane. Each entry is a `global`,
 * `isDefault: true` config with `oauth.clientId` set and NO `clientSecret`.
 */
export const DEFAULT_AUTH_CONFIGS: AuthConfigInput[] = [
  // Example — fill in a registered public client id to make Google zero-config:
  // {
  //   id: 'google', providerId: 'google', scheme: 'oauth2', scope: 'global', isDefault: true,
  //   oauth: { clientId: '<PUBLIC_CLIENT_ID>.apps.googleusercontent.com',
  //            redirectUri: 'http://localhost:4224/api/connectors/callback' },
  //   status: 'active',
  // },
];

/** Register every first-party provider. OAuth providers receive the injectable `fetch`. */
export function registerAllProviders(
  registry: Registry,
  opts: { fetch?: typeof fetch; quickbooks?: QuickbooksProviderOptions } = {},
): void {
  registerGoogle(registry, opts);
  registerMicrosoft(registry, opts);
  registerDiscord(registry, opts);
  registerSalesforce(registry, opts);
  // Hosted MCP providers are registered after sign-in, from their discovered tools.
  registerPlaid(registry);
  registerTelegram(registry);
  registerWhatsapp(registry);
  registerZendesk(registry);
  registerQuickbooks(registry, { ...(opts.fetch ? { fetch: opts.fetch } : {}), ...opts.quickbooks });
  registerMailgun(registry);
}
