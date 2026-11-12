import type { McpIcon } from '@/lib/integrations/mcp-icons';

/**
 * Which apps the rail and ⌘K list, and when a rail row is the one on screen.
 * Pure, so the rail's rows, the palette and their tests agree (docs/rail.md).
 *
 * An app is anything with a screen you can open on its own under `/apps`: a
 * connection whose MCP server declares a standalone screen
 * (docs/connected-mcp-apps.md), official or added by you. A service whose
 * interface only comes back as a tool result, such as Todoist's task list,
 * isn't one: it is used from chat, with `@`, and waits in the library and
 * Connectors.
 */

export interface AppPlace {
  key: string;
  displayName: string;
  /** The `/apps/<route>` it opens. */
  route: string;
  /** The query it opens with: a connected app's standalone screen to launch (`open`). */
  query?: Record<string, string>;
  /** Every route it stands for: each account's page of a connected app. */
  roots: string[];
  /**
   * Its glyph: an entrypoint's own icons (OpenAI's spec: the tool's, else its
   * server's), a provider's logo, or a custom MCP server.
   */
  mark: { kind: 'icons'; icons: readonly McpIcon[] } | { kind: 'provider'; providerId: string } | { kind: 'server' };
  /** Words ⌘K matches beyond the name. */
  keywords: string;
}

interface ListedConnectedApp {
  /** The MCP server, one per account. */
  id: string;
  toolkitName: string;
  providerId?: string;
  available: boolean;
  /** Its server declares a screen that opens on its own, not only a tool result's view. */
  standalone: boolean;
  /** Those screens, the global entrypoints, with their titles and icons. Each is a row. */
  entrypoints?: readonly { name: string; title?: string; icons?: readonly McpIcon[] }[];
  /** A personal app's connection for one place. Only Ri's own opens in Apps; an agent's is for that agent's chats. */
  app?: { id: string; place: { kind: 'ri' } | { kind: 'agent'; workspaceId: string } };
}

/** A connected app's page, for one account. */
export const connectedRoute = (serverId: string) => `~connected/${serverId}`;

/**
 * The apps a person can open now, by name. A connection that is off or signed
 * out can't open, so it waits in the library with its state rather than
 * taking a row it can't honor. Neither can a connection with no standalone
 * screen: it has nothing to open.
 *
 * A connected app is one row per standalone screen (OpenAI's global
 * entrypoint), titled and marked as the spec has it: the tool's title, and
 * its icon, else the server's, else the provider's logo. A product's accounts
 * share rows, which open the first account that can open (its page switches
 * between them). A custom MCP server is its own product. On the product's
 * page, its first row is the one lit.
 */
export function appPlaces(connected: readonly ListedConnectedApp[] = []): AppPlace[] {
  const products = new Map<string, ListedConnectedApp[]>();
  for (const app of connected.filter((item) => item.standalone && item.app?.place.kind !== 'agent')) {
    const product = app.providerId ? `provider:${app.providerId}` : app.app ? `app:${app.app.id}` : `server:${app.id}`;
    products.set(product, [...(products.get(product) ?? []), app]);
  }
  const linked = [...products].flatMap(([product, accounts]): AppPlace[] => {
    const open = accounts.find((account) => account.available);
    if (!open) return [];
    const screens = open.entrypoints?.length ? open.entrypoints : [undefined];
    return screens.map((screen, index): AppPlace => ({
      key: index ? `connected:${product}:${screen!.name}` : `connected:${product}`,
      displayName: screen?.title || open.toolkitName,
      route: connectedRoute(open.id),
      // Choosing it opens the screen itself, as ChatGPT's sidebar does, not the page about it.
      ...(screen ? { query: { open: screen.name } } : {}),
      roots: index ? [] : accounts.map((account) => connectedRoute(account.id)),
      mark: screen?.icons?.length ? { kind: 'icons', icons: screen.icons }
        : open.providerId ? { kind: 'provider', providerId: open.providerId } : { kind: 'server' },
      keywords: `${open.toolkitName} ${open.providerId ?? 'mcp'} connector`,
    }));
  });
  return linked.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The `/apps/<route>` a root owns: the root itself and anything under it. */
export function isAppRoute(route: string, root: string): boolean {
  return route === root || route.startsWith(`${root}/`);
}

/** Whether a rail row is the one on screen: you are in it, on any of its accounts. */
export function isPlaceRoute(place: Pick<AppPlace, 'roots'>, route: string): boolean {
  return place.roots.some((root) => isAppRoute(route, root));
}

/** The routes the library row stands for: the library itself, and `new`, which older links name. */
export function isLibraryRoute(route: string): boolean {
  return route === '' || route === 'new';
}
