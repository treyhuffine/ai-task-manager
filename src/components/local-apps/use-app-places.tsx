'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutGrid } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { connectedAppsQuery } from '@/components/mcp-apps/catalog';
import type { RailPlace } from '@/components/workspaces/rail-nav';
import { useLocalApps } from './app-hooks';
import { appPlaces } from './app-places';
import { AppsRailList } from './apps-rail-list';

/**
 * Apps in the rail (docs/rail.md): one place row, first among the places.
 * Clicking it opens the library. Resting on it peeks your apps beside the
 * rail, the rail's full height, in the wide rail and the strip alike
 * (`AppsRailList`): installed apps and connections whose MCP server offers an
 * interface. Reaching the row warms the connections, so the peek opens with
 * them. The library also holds connections and skills, independent of whether
 * this Home enables the local app runtime.
 */
export function useAppPlaces(): RailPlace[] {
  const { data } = useLocalApps({ live: false });
  const { activeView, setActiveView } = useDashboard();
  const queryClient = useQueryClient();
  const route = activeView.kind === 'apps' ? activeView.route : null;
  const instances = data?.instances;
  const approvals = data?.approvals;

  return useMemo(() => {
    // Only installed apps hold approvals between visits. A connected app's end with its view.
    const waiting = appPlaces(instances ?? [], approvals ?? []).filter((app) => app.needsApproval).length;
    return [
      {
        id: 'apps',
        label: 'Apps',
        title: waiting > 0 ? `Apps: ${waiting} need${waiting === 1 ? 's' : ''} you` : 'Apps',
        icon: LayoutGrid,
        onClick: () => setActiveView({ kind: 'apps', route: '' }),
        onIntent: () => void queryClient.prefetchQuery(connectedAppsQuery()),
        active: route !== null,
        count: waiting > 0 ? waiting : undefined,
        tone: 'attention',
        flyout: { label: 'Apps', content: <AppsRailList /> },
      },
    ];
  }, [instances, approvals, route, setActiveView, queryClient]);
}
