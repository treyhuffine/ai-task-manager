/**
 * What an app may reach through the hub (docs/personal-apps.md "The hub"): which of the person's
 * accounts, which tools on each, and which of Ri's own services. The consent screen offers these
 * and the hub serves exactly what was chosen, checked again on every call. The app's own words
 * about what it's for are shown apart from this, and promise nothing.
 */
import { toToolName, type Connection, type Toolkit } from '@integrations/engine';
import type { HubGrant } from '@/lib/db/schema';
import { isAppToolkitId } from '../app-ids';
import { RI_SERVICE_CONSENT_LABELS, RI_SERVICE_NAMES, RI_SERVICE_WRITES, type RiServiceName } from './ri-services';

/** The prefix Ri's own services carry as hub tools: `ri__ai_text`. */
export const RI_SERVICE_TOOL_PREFIX = 'ri__';
export const riServiceTool = (name: RiServiceName) => `${RI_SERVICE_TOOL_PREFIX}${name}`;

/**
 * What the kit's connector client asks for by capability, as the hub's tool names. An app that
 * names tools directly asks for those instead. This only decides what the screen pre-selects.
 */
const CAPABILITY_TOOLS: Record<string, string[]> = {
  'mail.read': ['gmail__search_messages', 'gmail__get_message'],
  'calendar.read': ['google_calendar__list_events'],
};

export interface HubConsentTool {
  name: string;
  description: string;
  /** A write that reaches outside: it asks the person every time. */
  write: boolean;
  requested: boolean;
}
export interface HubConsentAccount {
  connectionId: string;
  toolkitId: string;
  service: string;
  account: string;
  tools: HubConsentTool[];
}
export interface HubConsentOptions {
  accounts: HubConsentAccount[];
  services: { name: RiServiceName; tool: string; description: string; write: boolean; requested: boolean }[];
}

function requestedNames(scope: string | null | undefined): Set<string> {
  const words = (scope ?? '').split(/\s+/).filter(Boolean);
  return new Set(words.flatMap((word) => CAPABILITY_TOOLS[word] ?? [word]));
}

/** The person's connected accounts an app could be granted, each with its tools. Never other apps. */
export function hubConsentOptions(
  toolkits: readonly Toolkit[],
  connections: readonly Connection[],
  scope?: string | null,
  current?: HubGrant | null,
): HubConsentOptions {
  const wanted = requestedNames(scope);
  const granted = new Map((current?.accounts ?? []).map((account) => [account.connectionId, new Set(account.tools)]));
  const accounts: HubConsentAccount[] = [];
  for (const toolkit of toolkits) {
    if (isAppToolkitId(toolkit.id)) continue;
    for (const connection of connections.filter((c) => c.providerId === toolkit.providerId && c.status === 'active')) {
      const tools = toolkit.actions.filter((action) => action.modelVisible !== false).map((action): HubConsentTool => {
        const name = toToolName(action.id);
        return { name, description: action.description, write: action.mutating === true, requested: wanted.has(name) || !!granted.get(connection.id)?.has(name) };
      });
      if (!tools.length) continue;
      accounts.push({
        connectionId: connection.id, toolkitId: toolkit.id, service: toolkit.displayName,
        account: connection.email || connection.label || connection.accountId, tools,
      });
    }
  }
  const services = RI_SERVICE_NAMES.map((name) => ({
    name, tool: riServiceTool(name), description: RI_SERVICE_CONSENT_LABELS[name], write: RI_SERVICE_WRITES.has(name),
    requested: wanted.has(riServiceTool(name)) || wanted.has(name) || !!current?.services.includes(name),
  }));
  return { accounts: accounts.sort((a, b) => a.service.localeCompare(b.service) || a.account.localeCompare(b.account)), services };
}

/**
 * The grant a submitted consent form stands for: only tools of accounts the screen offered, and
 * only Ri services that exist. Anything else in the form is dropped.
 */
export function grantFromChoice(options: HubConsentOptions, choice: { tools: Record<string, readonly string[]>; services: readonly string[] }): HubGrant {
  const accounts = options.accounts.flatMap((account) => {
    const picked = new Set(choice.tools[account.connectionId] ?? []);
    const tools = account.tools.filter((tool) => picked.has(tool.name)).map((tool) => tool.name);
    return tools.length ? [{ connectionId: account.connectionId, toolkitId: account.toolkitId, tools }] : [];
  });
  const services = RI_SERVICE_NAMES.filter((name) => choice.services.includes(name));
  return { accounts, services };
}

/** A short sentence of what a grant reaches, for lists. */
export function grantSummary(grant: HubGrant, options?: HubConsentOptions): string {
  const names = grant.accounts.map((account) => {
    const offered = options?.accounts.find((item) => item.connectionId === account.connectionId);
    return offered ? `${offered.service} (${offered.account})` : account.toolkitId;
  });
  const parts = [...new Set(names)];
  if (grant.services.length) parts.push(`Ri's ${grant.services.length === 1 ? 'service' : 'services'}: ${grant.services.join(', ')}`);
  return parts.length ? parts.join(', ') : 'Nothing yet';
}
