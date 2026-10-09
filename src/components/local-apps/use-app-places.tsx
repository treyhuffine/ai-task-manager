'use client';

import { useMemo } from 'react';
import { LayoutGrid } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import type { RailPlace } from '@/components/workspaces/rail-nav';
import { useLocalApps } from './app-hooks';
import { appPlaces } from './app-places';
import { AppsRailList } from './apps-rail-list';

/**
 * Apps in the rail (docs/rail.md): one place row, first among the places.
 * Clicking it opens the library. Resting on it peeks your apps beside the
 * rail, the rail's full height, in the wide rail and the strip alike
 * (`AppsRailList`). Nothing shows while the Home hasn't enabled local apps.
 */
export function useAppPlaces(): RailPlace[] {
  const { enabled, data } = useLocalApps({ live: false });
  const { activeView, setActiveView } = useDashboard();
  const route = activeView.kind === 'apps' ? activeView.route : null;
  const instances = data?.instances;
  const approvals = data?.approvals;

  return useMemo(() => {
    if (!enabled) return [];
    const waiting = appPlaces(instances ?? [], approvals ?? []).filter((app) => app.needsApproval).length;
    return [
      {
        id: 'apps',
        label: 'Apps',
        title: waiting > 0 ? `Apps: ${waiting} need${waiting === 1 ? 's' : ''} you` : 'Apps',
        icon: LayoutGrid,
        onClick: () => setActiveView({ kind: 'apps', route: '' }),
        active: route !== null,
        count: waiting > 0 ? waiting : undefined,
        tone: 'attention',
        flyout: { label: 'Apps', content: <AppsRailList /> },
      },
    ];
  }, [enabled, instances, approvals, route, setActiveView]);
}
