/**
 * Provider barrel — every first-party connector's `register*` function, a catalog describing how
 * each one connects (so a host can render the right UI), and `registerAllProviders` to wire them
 * all in one call. OAuth providers accept an injectable `fetch`; direct (API-key/custom) ones
 * connect via `runtime.connectDirect`.
 */
import type { Registry } from '../core/registry';
import type { AuthConfigInput } from '../auth-configs';

import { registerGoogle } from './google';
import { registerSlack } from './slack';
import { registerNotion } from './notion';
import { registerMicrosoft } from './microsoft';
import { registerLinear } from './linear';
import { registerJira } from './jira';
import { registerDiscord } from './discord';
import { registerCalendly } from './calendly';
import { registerRaindrop } from './raindrop';
import { registerZoom } from './zoom';
import { registerHubspot } from './hubspot';
import { registerSalesforce } from './salesforce';
import { registerTodoist } from './todoist';
import { registerAirtable } from './airtable';
import { registerReadwise } from './readwise';
import { registerStripe } from './stripe';
import { registerPlaid } from './plaid';
import { registerTelegram } from './telegram';
import { registerWhatsapp } from './whatsapp';
import { registerGitlab } from './gitlab';
import { registerConfluence } from './confluence';
import { registerAsana } from './asana';
import { registerZendesk } from './zendesk';
import { registerDropbox } from './dropbox';
import { registerBox } from './box';
import { registerQuickbooks } from './quickbooks';
import { registerResend } from './resend';
import { registerMailgun } from './mailgun';
import { registerTwitter, type RegisterTwitterOptions } from './twitter';

export { registerGoogle } from './google';
export { registerSlack } from './slack';
export { registerNotion } from './notion';
export { registerMicrosoft } from './microsoft';
export { registerLinear } from './linear';
export { registerJira } from './jira';
export { registerDiscord } from './discord';
export { registerCalendly } from './calendly';
export { registerRaindrop } from './raindrop';
export { registerZoom } from './zoom';
export { registerHubspot } from './hubspot';
export { registerSalesforce } from './salesforce';
export { registerTodoist } from './todoist';
export { registerAirtable } from './airtable';
export { registerReadwise } from './readwise';
export { registerStripe } from './stripe';
export { registerPlaid } from './plaid';
export { registerTelegram } from './telegram';
export { registerWhatsapp } from './whatsapp';
export { registerGitlab } from './gitlab';
export { registerConfluence } from './confluence';
export { registerAsana } from './asana';
export { registerZendesk } from './zendesk';
export { registerDropbox } from './dropbox';
export { registerBox } from './box';
export { registerQuickbooks } from './quickbooks';
export { registerResend } from './resend';
export { registerMailgun } from './mailgun';
export { registerTwitter } from './twitter';
export type { RegisterTwitterOptions } from './twitter';

/** How a provider is connected — drives the host's connect UI. */
export type ConnectMethod = 'oauth2' | 'api_key' | 'custom';

export interface ProviderCatalogEntry {
  id: string;
  displayName: string;
  /** `oauth2` → redirect flow; `api_key`/`custom` → paste credentials via `connectDirect`. */
  method: ConnectMethod;
  /** For `custom`/`api_key`, the credential fields a host should prompt for. */
  credentialFields?: string[];
}

/** Static description of every first-party provider and how it connects. */
export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  { id: 'google', displayName: 'Google', method: 'oauth2' },
  { id: 'slack', displayName: 'Slack', method: 'oauth2' },
  { id: 'notion', displayName: 'Notion', method: 'oauth2' },
  { id: 'microsoft', displayName: 'Microsoft 365', method: 'oauth2' },
  { id: 'linear', displayName: 'Linear', method: 'oauth2' },
  { id: 'jira', displayName: 'Jira', method: 'oauth2' },
  { id: 'discord', displayName: 'Discord', method: 'oauth2' },
  { id: 'calendly', displayName: 'Calendly', method: 'oauth2' },
  { id: 'raindrop', displayName: 'Raindrop', method: 'oauth2' },
  { id: 'zoom', displayName: 'Zoom', method: 'oauth2' },
  { id: 'hubspot', displayName: 'HubSpot', method: 'oauth2' },
  { id: 'salesforce', displayName: 'Salesforce', method: 'oauth2' },
  { id: 'todoist', displayName: 'Todoist', method: 'api_key', credentialFields: ['token'] },
  { id: 'airtable', displayName: 'Airtable', method: 'api_key', credentialFields: ['token'] },
  { id: 'readwise', displayName: 'Readwise', method: 'api_key', credentialFields: ['apiKey'] },
  { id: 'stripe', displayName: 'Stripe', method: 'api_key', credentialFields: ['token'] },
  { id: 'plaid', displayName: 'Plaid', method: 'custom', credentialFields: ['client_id', 'secret'] },
  { id: 'telegram', displayName: 'Telegram', method: 'custom', credentialFields: ['token'] },
  { id: 'whatsapp', displayName: 'WhatsApp', method: 'custom', credentialFields: ['access_token', 'phone_number_id'] },
  { id: 'gitlab', displayName: 'GitLab', method: 'api_key', credentialFields: ['token'] },
  { id: 'confluence', displayName: 'Confluence', method: 'oauth2' },
  { id: 'asana', displayName: 'Asana', method: 'api_key', credentialFields: ['token'] },
  { id: 'zendesk', displayName: 'Zendesk', method: 'custom', credentialFields: ['subdomain', 'email', 'api_token'] },
  { id: 'dropbox', displayName: 'Dropbox', method: 'oauth2' },
  { id: 'box', displayName: 'Box', method: 'oauth2' },
  { id: 'quickbooks', displayName: 'QuickBooks', method: 'oauth2' },
  { id: 'resend', displayName: 'Resend', method: 'api_key', credentialFields: ['apiKey'] },
  { id: 'mailgun', displayName: 'Mailgun', method: 'custom', credentialFields: ['api_key'] },
  { id: 'twitter', displayName: 'X (Twitter)', method: 'oauth2' },
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
  opts: { fetch?: typeof fetch; twitter?: RegisterTwitterOptions } = {},
): void {
  registerGoogle(registry, opts);
  registerSlack(registry, opts);
  registerNotion(registry, opts);
  registerMicrosoft(registry, opts);
  registerLinear(registry, opts);
  registerJira(registry, opts);
  registerDiscord(registry, opts);
  registerCalendly(registry, opts);
  registerRaindrop(registry, opts);
  registerZoom(registry, opts);
  registerHubspot(registry, opts);
  registerSalesforce(registry, opts);
  registerTodoist(registry);
  registerAirtable(registry);
  registerReadwise(registry);
  registerStripe(registry);
  registerPlaid(registry);
  registerTelegram(registry);
  registerWhatsapp(registry);
  registerGitlab(registry);
  registerConfluence(registry, opts);
  registerAsana(registry);
  registerZendesk(registry);
  registerDropbox(registry, opts);
  registerBox(registry, opts);
  registerQuickbooks(registry, opts);
  registerResend(registry);
  registerMailgun(registry);
  registerTwitter(registry, { ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.twitter ?? {}) });
}
