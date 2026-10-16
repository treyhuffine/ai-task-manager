/**
 * Which apps the rail and ⌘K list, and when a rail row is the one on screen.
 * Pure, so the rail's rows, the palette and their tests agree (docs/rail.md).
 *
 * An app is anything with an interface that opens under `/apps`: an app
 * installed in Ri, built here or included, or a connection whose MCP server
 * offers one (docs/connected-mcp-apps.md), official or added by you.
 */

export interface AppPlace {
  key: string;
  displayName: string;
  /** The `/apps/<route>` it opens. */
  route: string;
  /** Every route it stands for: an installed app's root, or each account's page of a connected app. */
  roots: string[];
  /** Its glyph: an installed app's tile, a provider's logo, or a custom MCP server. */
  mark: { kind: 'app'; icon?: string } | { kind: 'provider'; providerId: string } | { kind: 'server' };
  /** Words ⌘K matches beyond the name. */
  keywords: string;
  /** An action is waiting on the person's approval. */
  needsApproval: boolean;
}

interface ListedInstance {
  id: string;
  slug: string;
  displayName: string;
  icon?: string;
  enabled: boolean;
  archived: boolean;
  hasView: boolean;
}

interface ListedConnectedApp {
  /** The MCP server, one per account. */
  id: string;
  toolkitName: string;
  providerId?: string;
  available: boolean;
}

/** A connected app's page, for one account. */
export const connectedRoute = (serverId: string) => `~connected/${serverId}`;

/**
 * The apps a person can open now, by name. A disabled or archived app, or a
 * connection that is off or signed out, can't open, so it waits in the
 * library with its state rather than taking a row it can't honor.
 *
 * A connected app is one row per product, as the library shows it: a
 * provider's accounts share a row, which opens the first account that can
 * open (its page switches between them). A custom MCP server is its own product.
 */
export function appPlaces(
  instances: readonly ListedInstance[],
  approvals: readonly { instanceId: string }[],
  connected: readonly ListedConnectedApp[] = [],
): AppPlace[] {
  const waiting = new Set(approvals.map((approval) => approval.instanceId));
  const installed = instances
    .filter((item) => item.enabled && !item.archived && item.hasView)
    .map((item): AppPlace => ({
      key: `app:${item.id}`,
      displayName: item.displayName,
      route: item.slug,
      roots: [item.slug],
      mark: { kind: 'app', icon: item.icon },
      keywords: item.slug,
      needsApproval: waiting.has(item.id),
    }));
  const products = new Map<string, ListedConnectedApp[]>();
  for (const app of connected) {
    const product = app.providerId ? `provider:${app.providerId}` : `server:${app.id}`;
    products.set(product, [...(products.get(product) ?? []), app]);
  }
  const linked = [...products].flatMap(([product, accounts]): AppPlace[] => {
    const open = accounts.find((account) => account.available);
    if (!open) return [];
    return [{
      key: `connected:${product}`,
      displayName: open.toolkitName,
      route: connectedRoute(open.id),
      roots: accounts.map((account) => connectedRoute(account.id)),
      mark: open.providerId ? { kind: 'provider', providerId: open.providerId } : { kind: 'server' },
      keywords: `${open.providerId ?? 'mcp'} connector`,
      // Its approvals belong to the view that asked, and end when it closes.
      needsApproval: false,
    }];
  });
  return [...installed, ...linked].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The `/apps/<route>` an installed app owns: its root and anything under it. */
export function isAppRoute(route: string, slug: string): boolean {
  return route === slug || route.startsWith(`${slug}/`);
}

/** Whether a rail row is the one on screen: you are in it, on any of its accounts. */
export function isPlaceRoute(place: Pick<AppPlace, 'roots'>, route: string): boolean {
  return place.roots.some((root) => isAppRoute(route, root));
}

/** The routes the library row stands for: the library itself and the drafts it lists. */
export function isLibraryRoute(route: string): boolean {
  return route === '' || route === 'new' || route.startsWith('drafts/');
}

/** The library's route for a draft, and an app's for a path inside it. */
export const draftRoute = (id: string) => `drafts/${id}`;
