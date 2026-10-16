import { trpc } from '@/lib/trpc/client';

/**
 * The connections whose MCP server offers an interface (docs/connected-mcp-apps.md),
 * as one cache shared by the rail's Apps flyout, ⌘K, the library and the app's own page.
 */
export const connectedAppsQuery = (staleTime = 15_000) =>
  trpc.connectedApps.catalog.queryOptions(undefined, { staleTime });
