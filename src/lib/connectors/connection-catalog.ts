/**
 * Plain-language side of connecting accounts from chat (docs/connecting-from-chat.md): turning what
 * an agent asks for ("Gmail", "my calendar", "Slack") into a real service, the views the Connect
 * card and its decision rows carry, and the notes the asking agent receives. Pure, so it
 * unit-tests without the runtime. connection-requests.ts feeds it the live catalog.
 *
 * The agent never sees the catalog. It names what the user's request needs, and the server decides:
 * one service matches, several could (ask the user which), or Ri can't connect to it.
 */

/** A toolkit as the matcher needs it: the unit an agent's tools and an agent's access come in. */
export interface CatalogToolkit {
  id: string;
  providerId: string;
  displayName: string;
}

/** A provider as the matcher needs it: the unit an account is connected at. */
export interface CatalogProvider {
  id: string;
  displayName: string;
  /**
   * `oauth2` signs in on the provider's page. `api_key` / `custom` paste credentials. `mcp` is a
   * hosted MCP server, which signs in from Settings: a card sends the person there.
   */
  method: 'oauth2' | 'api_key' | 'custom' | 'mcp';
  credentialFields?: string[];
}

export interface ServiceMatch {
  providerId: string;
  providerName: string;
  /** The toolkits the request is about (one for "Gmail", all of Google's for "Google"). */
  toolkitIds: string[];
  /** What to call it in the card and notes: "Gmail", "Google". */
  label: string;
}

export type ServiceResolution =
  | { kind: 'match'; match: ServiceMatch }
  | { kind: 'ambiguous'; options: ServiceMatch[] }
  | { kind: 'unsupported' };

function normalize(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[_\-./()]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\b(my|the|our|account|accounts|app|connector|integration)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
}

/**
 * Generic words for a kind of service, mapped to the toolkits that provide it. A generic word with
 * one candidate resolves, with several it's ambiguous: the agent should ask which one the user uses.
 * Ri's own tasks, notes and calendar-free planning never need a connector, so "tasks" and "notes"
 * point only at outside services the user would have named on purpose.
 */
const GENERIC: Record<string, string[]> = {
  email: ['gmail', 'outlook_mail'],
  'e mail': ['gmail', 'outlook_mail'],
  mail: ['gmail', 'outlook_mail'],
  inbox: ['gmail', 'outlook_mail'],
  calendar: ['google_calendar', 'outlook_calendar'],
  meetings: ['google_calendar', 'outlook_calendar', 'zoom'],
  drive: ['google_drive', 'dropbox', 'box'],
  files: ['google_drive', 'dropbox', 'box'],
  'cloud storage': ['google_drive', 'dropbox', 'box'],
  docs: ['google_docs'],
  sheets: ['google_sheets'],
  spreadsheet: ['google_sheets', 'airtable'],
  spreadsheets: ['google_sheets', 'airtable'],
  outlook: ['outlook_mail', 'outlook_calendar'],
  office: ['outlook_mail', 'outlook_calendar'],
  issues: ['linear', 'jira', 'gitlab'],
  tickets: ['linear', 'jira', 'zendesk'],
  wiki: ['notion', 'confluence'],
  crm: ['hubspot', 'salesforce'],
  payments: ['stripe'],
  bank: ['plaid'],
  banking: ['plaid'],
  video: ['zoom'],
  bookmarks: ['raindrop'],
  highlights: ['readwise'],
  accounting: ['quickbooks'],
  invoices: ['quickbooks', 'stripe'],
  tweets: ['twitter'],
  x: ['twitter'],
};

/**
 * Several options that are all one provider ("outlook": Outlook Mail and Outlook Calendar) are one
 * sign-in, so they resolve to that provider instead of making the user pick.
 */
function settle(options: ServiceMatch[]): ServiceResolution {
  if (options.length === 0) return { kind: 'unsupported' };
  if (options.length === 1) return { kind: 'match', match: options[0]! };
  const providerIds = new Set(options.map((o) => o.providerId));
  if (providerIds.size === 1) {
    const first = options[0]!;
    return {
      kind: 'match',
      match: {
        providerId: first.providerId,
        providerName: first.providerName,
        toolkitIds: options.flatMap((o) => o.toolkitIds),
        label: first.providerName,
      },
    };
  }
  return { kind: 'ambiguous', options };
}

function toolkitMatch(t: CatalogToolkit, providers: Map<string, CatalogProvider>): ServiceMatch {
  const provider = providers.get(t.providerId);
  return {
    providerId: t.providerId,
    providerName: provider?.displayName ?? t.displayName,
    toolkitIds: [t.id],
    label: t.displayName,
  };
}

/**
 * Resolve an agent's words to a service. Most specific wins: a toolkit named in the request
 * ("gmail", "google calendar"), then a provider ("google", "slack"), then a generic word
 * ("calendar"), which may be ambiguous. Anything else is unsupported.
 */
export function resolveService(
  query: string,
  toolkits: readonly CatalogToolkit[],
  providers: readonly CatalogProvider[],
): ServiceResolution {
  const q = normalize(query);
  if (q.trim() === '') return { kind: 'unsupported' };
  const byProvider = new Map(providers.map((p) => [p.id, p]));
  const contains = (name: string) => {
    const n = normalize(name).trim();
    return n.length > 0 && q.includes(` ${n} `);
  };

  // 1. A toolkit by name or id. Longest name first, so "google calendar" beats "google".
  const namedToolkits = toolkits
    .filter((t) => byProvider.has(t.providerId))
    .filter((t) => contains(t.displayName) || contains(t.id))
    .sort((a, b) => b.displayName.length - a.displayName.length);
  if (namedToolkits.length > 0) {
    const best = namedToolkits[0]!;
    const sameLength = namedToolkits.filter((t) => t.displayName.length === best.displayName.length);
    return settle(sameLength.map((t) => toolkitMatch(t, byProvider)));
  }

  // 2. A provider by name or id: all of its toolkits.
  const namedProvider = providers
    .filter((p) => contains(p.displayName) || contains(p.id))
    .sort((a, b) => b.displayName.length - a.displayName.length)[0];
  if (namedProvider) {
    const ids = toolkits.filter((t) => t.providerId === namedProvider.id).map((t) => t.id);
    if (ids.length > 0) {
      return {
        kind: 'match',
        match: { providerId: namedProvider.id, providerName: namedProvider.displayName, toolkitIds: ids, label: namedProvider.displayName },
      };
    }
  }

  // 3. A generic word for a kind of service.
  const word = Object.keys(GENERIC)
    .filter((w) => q.includes(` ${w} `))
    .sort((a, b) => b.length - a.length)[0];
  if (word) {
    const options = GENERIC[word]!
      .map((id) => toolkits.find((t) => t.id === id))
      .filter((t): t is CatalogToolkit => t !== undefined && byProvider.has(t.providerId))
      .map((t) => toolkitMatch(t, byProvider));
    if (options.length > 0) return settle(options);
  }
  return { kind: 'unsupported' };
}

/** What the card offers. The live provider status decides sign-in vs setup vs key at render. */
export type ConnectionRequestKind = 'connect' | 'reconnect' | 'more_access' | 'allow_agent';

/** `tool_input` of a `connection_request` chat event. */
export interface ConnectionRequestView {
  kind: ConnectionRequestKind;
  providerId: string;
  providerName: string;
  /** "Gmail" or "Google": what the card and notes call it. */
  label: string;
  toolkitIds: string[];
  method: CatalogProvider['method'];
  credentialFields: string[];
  /** The agent's own words, shown attributed. Null for cards the app raised itself. */
  reason: string | null;
  requestedBy: 'agent' | 'app';
  /** The agent the connection is for (the asking one, or another it named). Null = the main chat. */
  agent: { workspaceId: string; name: string } | null;
  /** The asking chat named another agent: it learns the outcome but gets no new tools itself. */
  onBehalf: boolean;
  /** Reconnect / more access: the connection involved. */
  connectionId: string | null;
  account: string | null;
  /** More access: what's missing. Connect: omitted, the provider's defaults apply. */
  scopes: string[] | null;
  authConfigId: string | null;
}

export type ConnectionOutcome = 'connected' | 'allowed' | 'declined';

/** `tool_input` of a `connection_response` chat event. */
export interface ConnectionResponseView {
  requestEventId: string;
  outcome: ConnectionOutcome;
  providerId: string;
  label: string;
  account: string | null;
  agent: { workspaceId: string; name: string } | null;
}

const NOTE_HEADER = "[Connection, from the app on the user's behalf]";

function toolHint(toolkitIds: readonly string[]): string {
  return toolkitIds.map((id) => `${id}__…`).join(', ');
}

/**
 * The note the asking agent receives once the user acts on a Connect card, so its waiting task
 * moves again. `forOtherAgent` is set when the request was on another agent's behalf: the asking
 * chat doesn't get those tools, it just learns the outcome.
 */
export function connectionNote(
  outcome: ConnectionOutcome,
  view: Pick<ConnectionRequestView, 'kind' | 'label' | 'toolkitIds' | 'account'>,
  opts: { account?: string | null; forOtherAgent?: string | null } = {},
): string {
  const account = opts.account ?? view.account;
  const as = account ? ` (account ${account})` : '';
  if (outcome === 'declined') {
    return `${NOTE_HEADER}\n\nThe user chose not to connect ${view.label} for now. Don't ask for it again in this chat unless they bring it up. Continue without it, or tell them what you couldn't do.`;
  }
  if (opts.forOtherAgent) {
    const verb = outcome === 'allowed' ? `allowed the "${opts.forOtherAgent}" agent to use` : 'connected';
    return `${NOTE_HEADER}\n\nThe user ${verb} ${view.label}${as}${outcome === 'connected' ? ` for the "${opts.forOtherAgent}" agent` : ''}. That agent's sessions pick it up on their next turn.`;
  }
  const what =
    view.kind === 'reconnect'
      ? `reconnected ${view.label}${as}. Retry the call that failed.`
      : view.kind === 'more_access'
        ? `gave ${view.label}${as} the extra access it needed. Retry the call that failed.`
        : outcome === 'allowed'
          ? `allowed this agent to use ${view.label}${as}. Its tools (${toolHint(view.toolkitIds)}) are available now. Continue the task you were doing.`
          : `connected ${view.label}${as}. Its tools (${toolHint(view.toolkitIds)}) are available now. Continue the task you were doing.`;
  return `${NOTE_HEADER}\n\nThe user ${what}`;
}

/**
 * Where to register a sign-in app for a provider that has none configured yet. Only providers
 * with a stable console page are listed. The card falls back to Settings for the rest.
 */
export const DEVELOPER_CONSOLES: Record<string, string> = {
  google: 'https://console.cloud.google.com/apis/credentials',
  microsoft: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  slack: 'https://api.slack.com/apps',
  notion: 'https://www.notion.so/profile/integrations',
  linear: 'https://linear.app/settings/api/applications/new',
  jira: 'https://developer.atlassian.com/console/myapps/',
  confluence: 'https://developer.atlassian.com/console/myapps/',
  discord: 'https://discord.com/developers/applications',
  zoom: 'https://marketplace.zoom.us/develop/create',
  dropbox: 'https://www.dropbox.com/developers/apps',
  box: 'https://app.box.com/developers/console',
  hubspot: 'https://developers.hubspot.com/',
  salesforce: 'https://login.salesforce.com/lightning/setup/NavigationMenus/home',
  calendly: 'https://developer.calendly.com/',
  raindrop: 'https://app.raindrop.io/settings/integrations',
  quickbooks: 'https://developer.intuit.com/app/developer/dashboard',
  twitter: 'https://developer.x.com/en/portal/dashboard',
};
