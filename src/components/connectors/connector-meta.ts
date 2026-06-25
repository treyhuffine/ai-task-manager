// Presentation metadata for the connector catalog: which group a provider shows
// under, a one-line description, a brand color for the monogram fallback tile
// (see connector-icon-data.ts), and optional setup help (where to get
// credentials + numbered steps) rendered in the connect panel. The connect
// mechanics (method, credential fields, OAuth readiness) come from the API, not
// from here, so this file is purely cosmetic and safe to import on the client.

export type ConnectorCategory =
  | 'Workspace'
  | 'Communication'
  | 'Email'
  | 'Productivity'
  | 'Developer'
  | 'Sales & CRM'
  | 'Storage'
  | 'Finance';

/** The order categories render in the catalog. */
export const CATEGORY_ORDER: ConnectorCategory[] = [
  'Workspace',
  'Communication',
  'Email',
  'Productivity',
  'Developer',
  'Sales & CRM',
  'Storage',
  'Finance',
];

export interface ConnectorMeta {
  category: ConnectorCategory;
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
   * Numbered "how to get your credential" steps for paste-key providers,
   * shown above the fields. No dashes (project copy rule).
   */
  setup?: string[];
}

export const CONNECTOR_META: Record<string, ConnectorMeta> = {
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
    docsUrl: 'https://api.slack.com/apps',
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
    docsUrl: 'https://marketplace.zoom.us/develop/create',
  },

  resend: {
    category: 'Email',
    description: 'Send transactional email.',
    docsUrl: 'https://resend.com/api-keys',
    setup: ['Open the Resend dashboard, then API Keys.', 'Create a key and copy it.'],
  },
  mailgun: {
    category: 'Email',
    description: 'Send transactional email.',
    docsUrl: 'https://app.mailgun.com/settings/api_security',
    setup: ['Open the Mailgun dashboard, then API security keys.', 'Copy your private API key.'],
  },

  notion: {
    category: 'Productivity',
    description: 'Read and update pages and databases.',
    docsUrl: 'https://www.notion.so/my-integrations',
  },
  todoist: {
    category: 'Productivity',
    description: 'Sync tasks and projects.',
    docsUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    setup: ['In Todoist, open Settings, then Integrations, then Developer.', 'Copy your API token.'],
  },
  asana: {
    category: 'Productivity',
    description: 'Track tasks and projects.',
    docsUrl: 'https://app.asana.com/0/my-apps',
    setup: ['In Asana, open My Settings, then Apps, then Developer apps.', 'Create a personal access token and copy it.'],
  },
  airtable: {
    category: 'Productivity',
    description: 'Read and write base records.',
    docsUrl: 'https://airtable.com/create/tokens',
    setup: [
      'Open Airtable, then Builder hub, then Personal access tokens.',
      'Create a token with the scopes and bases you need.',
      'Copy the token and paste it below.',
    ],
  },
  confluence: {
    category: 'Productivity',
    description: 'Read and edit wiki pages.',
    docsUrl: 'https://developer.atlassian.com/console/myapps/',
  },
  calendly: {
    category: 'Productivity',
    description: 'Read scheduled events and invitees.',
    docsUrl: 'https://calendly.com/integrations/api_webhooks',
  },
  raindrop: {
    category: 'Productivity',
    description: 'Save and search bookmarks.',
    brandHex: '1A7CFF',
    docsUrl: 'https://app.raindrop.io/settings/integrations',
  },
  readwise: {
    category: 'Productivity',
    description: 'Pull in your highlights.',
    brandHex: 'E0703A',
    docsUrl: 'https://readwise.io/access_token',
    setup: ['Open readwise.io/access_token while signed in.', 'Copy the token shown and paste it below.'],
  },

  gitlab: {
    category: 'Developer',
    description: 'Manage issues, merge requests, and pipelines.',
    docsUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    setup: [
      'In GitLab, open Preferences, then Access tokens.',
      'Create a token with the api scope.',
      'Copy the token and paste it below.',
    ],
  },
  linear: {
    category: 'Developer',
    description: 'Create and update issues.',
    docsUrl: 'https://linear.app/settings/api',
  },
  jira: {
    category: 'Developer',
    description: 'Track issues and sprints.',
    docsUrl: 'https://developer.atlassian.com/console/myapps/',
  },

  hubspot: {
    category: 'Sales & CRM',
    description: 'Manage contacts and deals.',
    docsUrl: 'https://developers.hubspot.com/',
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
    docsUrl: 'https://www.dropbox.com/developers/apps',
  },
  box: {
    category: 'Storage',
    description: 'Browse and manage files.',
    docsUrl: 'https://app.box.com/developers/console',
  },

  stripe: {
    category: 'Finance',
    description: 'Read customers, charges, and invoices.',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    setup: ['Open the Stripe Dashboard, then Developers, then API keys.', 'Copy a secret key (starts with sk_).'],
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
    description: 'Read invoices and accounting data.',
    docsUrl: 'https://developer.intuit.com/app/developer/dashboard',
  },
};

/** Fallback bucket for any provider missing from CONNECTOR_META. */
export const DEFAULT_CATEGORY: ConnectorCategory = 'Productivity';

export function connectorMeta(providerId: string): ConnectorMeta {
  return CONNECTOR_META[providerId] ?? { category: DEFAULT_CATEGORY, description: '' };
}
