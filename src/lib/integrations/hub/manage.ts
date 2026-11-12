/**
 * The person's view of the hub (docs/personal-apps.md "The hub"): one place that shows what every
 * app can reach through Ri, with one switch that turns an app off, a way to narrow what it was
 * allowed, its pending approvals and its audit log.
 */
import { getHubApp, listHubApps, listHubCalls, revokeHubApp, setHubAppGrant, type HubAppRecord } from '@/lib/db/queries';
import type { HubGrant } from '@/lib/db/schema';
import { registeredClient } from '@/lib/oauth/clients';
import { listPendingApprovals, revokeHubApprovals } from '../approval';
import { getMcpServerStore, getIntegrationOwnerId, getIntegrationRuntime } from '../runtime';
import { hubConsentOptions, type HubConsentOptions } from './grant';
import { appOrigin } from './origin';

export interface HubAppView {
  id: string;
  name: string;
  /** Where the app says it runs. */
  clientUri: string | null;
  /** The app's own words about what it's for. Shown, never enforced. */
  purpose: string | null;
  /** What it can reach, as the person granted it, with labels. */
  accounts: { connectionId: string; service: string; account: string; tools: string[]; connected: boolean }[];
  services: string[];
  off: boolean;
  lastUsedAt: string | null;
  pendingApprovals: number;
  /** The personal app in Ri this is, when its address matches one Ri connects to. */
  personalAppId: string | null;
}

/** A personal app in Ri whose address is this hub app's. */
function linkedPersonalApp(app: HubAppRecord): string | null {
  const origins = new Set([app.clientUri, ...(registeredClient(app.clientId)?.redirectUris ?? [])].map(appOrigin).filter(Boolean));
  const entry = getMcpServerStore().list().find((server) => server.app && origins.has(appOrigin(server.url)));
  return entry?.app?.id ?? null;
}

async function options(): Promise<HubConsentOptions> {
  const runtime = await getIntegrationRuntime();
  return hubConsentOptions(runtime.getToolkits(), await runtime.listConnections({ ownerId: getIntegrationOwnerId() }));
}

function view(app: HubAppRecord, offered: HubConsentOptions): HubAppView {
  return {
    id: app.id, name: app.name, clientUri: app.clientUri, purpose: app.purpose,
    accounts: app.grant.accounts.map((account) => {
      const live = offered.accounts.find((item) => item.connectionId === account.connectionId);
      return { connectionId: account.connectionId, service: live?.service ?? account.toolkitId, account: live?.account ?? 'An account no longer connected', tools: account.tools, connected: !!live };
    }),
    services: app.grant.services,
    off: !!app.revokedAt,
    lastUsedAt: app.lastUsedAt,
    pendingApprovals: listPendingApprovals().filter((pending) => pending.hubApp?.appId === app.id).length,
    personalAppId: linkedPersonalApp(app),
  };
}

export async function listHubAppViews(): Promise<HubAppView[]> {
  const offered = await options();
  return listHubApps().map((app) => view(app, offered));
}

export async function getHubAppView(id: string) {
  const app = getHubApp(id);
  if (!app) return null;
  return {
    ...view(app, await options()),
    approvals: listPendingApprovals().filter((pending) => pending.hubApp?.appId === app.id),
    calls: listHubCalls(app.id, 50),
  };
}

/** One switch: the app's tokens stop at its next call, and its waiting writes are dropped. */
export function turnOffHubApp(id: string): void {
  const app = getHubApp(id);
  if (!app) return;
  revokeHubApp(id);
  dropPending(id);
}

/** Take back one account, or one tool on it. The app's next call sees the narrower grant. */
export function narrowHubApp(id: string, remove: { connectionId: string; tool?: string } | { service: string }): HubGrant | null {
  const app = getHubApp(id);
  if (!app) return null;
  const grant: HubGrant = 'service' in remove
    ? { ...app.grant, services: app.grant.services.filter((service) => service !== remove.service) }
    : {
        ...app.grant,
        accounts: app.grant.accounts.flatMap((account) => {
          if (account.connectionId !== remove.connectionId) return [account];
          const tools = remove.tool ? account.tools.filter((tool) => tool !== remove.tool) : [];
          return tools.length ? [{ ...account, tools }] : [];
        }),
      };
  setHubAppGrant(id, grant);
  dropPending(id, 'service' in remove ? undefined : remove.connectionId);
  return grant;
}

/** Waiting approvals from an app whose access changed can no longer license a call. */
function dropPending(appId: string, connectionId?: string) {
  revokeHubApprovals(appId, connectionId);
}
