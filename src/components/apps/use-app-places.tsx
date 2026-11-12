'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { connectedAppsQuery } from '@/components/mcp-apps/catalog';
import type { RailPlace } from '@/components/workspaces/rail-nav';
import { AppsRailList } from './apps-rail-list';

/**
 * Apps in the rail (docs/rail.md): one place row, first among the places.
 * Clicking it opens the library. Resting on it peeks your apps beside the
 * rail, the rail's full height, in the wide rail and the strip alike
 * (`AppsRailList`): connections whose MCP server declares a standalone
 * screen. Reaching the row warms the connections, so the peek opens with
 * them. The library also holds connectors, custom MCP servers and skills.
 */
export function useAppPlaces(): RailPlace[] {
  const { activeView, setActiveView } = useDashboard();
  const queryClient = useQueryClient();
  const route = activeView.kind === 'apps' ? activeView.route : null;

  return useMemo(() => [
    {
      id: 'apps',
      label: 'Apps',
      title: 'Apps',
      icon: LayoutGrid,
      onClick: () => setActiveView({ kind: 'apps', route: '' }),
      onIntent: () => void queryClient.prefetchQuery(connectedAppsQuery()),
      active: route !== null,
      flyout: { label: 'Apps', content: <AppsRailList /> },
    },
  ], [route, setActiveView, queryClient]);
}
