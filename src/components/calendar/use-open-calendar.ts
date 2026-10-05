'use client';

import { useCallback } from 'react';
import { useDashboard } from '@/contexts/dashboard-context';
import { useViewportTier } from '@/hooks/use-viewport-tier';
import { HOME_VIEW } from '@/lib/client/active-view';

/**
 * Go to the calendar, one of Home's panel tabs, from anywhere, and whether
 * it's on screen now. On a desktop it takes the right panel and leaves the
 * chat where it is (`panelForTab`). A tablet shows only the left panel, so
 * it goes there, or it would open somewhere nobody can see.
 */
export function useOpenCalendar(): { openCalendar: () => void; calendarShowing: boolean } {
  const { activeView, setActiveView, panelATab, panelBTab, showPanelTab, setPanelTab } = useDashboard();
  const tablet = useViewportTier() === 'tablet';

  const calendarShowing =
    activeView.kind === 'home' && (panelATab === 'calendar' || (!tablet && panelBTab === 'calendar'));

  const openCalendar = useCallback(() => {
    setActiveView(HOME_VIEW);
    if (tablet) setPanelTab('a', 'calendar');
    else showPanelTab('calendar');
  }, [setActiveView, setPanelTab, showPanelTab, tablet]);

  return { openCalendar, calendarShowing };
}
