"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { Rail } from '@/components/workspaces/rail';
import { RailContainer } from '@/components/home/home-navigation';
export { RailContainer } from '@/components/home/home-navigation';

interface PowerRailProps {
  /**
   * When true, the rail's open/closed state is driven by
   * `executionRailOpen` (defaults closed) instead of the global
   * `railCollapsed` preference. ⌘\ still toggles, but it toggles the
   * execution-scoped state so the global preference stays untouched.
   */
  compact?: boolean;
  /**
   * Always collapsed, with no way to widen it: tablets, where 256px is too
   * much of the window. Agents still opens the list as a flyout over the
   * page, so nothing is out of reach.
   */
  fixed?: boolean;
}

export function PowerRail({ compact = false, fixed = false }: PowerRailProps) {
  const { activeView, railCollapsed, executionRailOpen, appsRailOpen, toggleRailCollapsed, toggleExecutionRailOpen, toggleAppsRailOpen } = useDashboard();
  const inApps = activeView.kind === 'apps';

  // Resolve the "is the rail expanded right now?" question.
  // - compact: driven by executionRailOpen (defaults false → collapsed)
  // - Apps: a temporary override, reset on each visit
  // - otherwise: driven by railCollapsed (the global pref)
  const expanded = !fixed && (inApps ? appsRailOpen : compact ? executionRailOpen : !railCollapsed);
  const onToggle = fixed ? undefined : inApps ? toggleAppsRailOpen : compact ? toggleExecutionRailOpen : toggleRailCollapsed;

  return <RailContainer expanded={expanded} compact={compact || inApps}><Rail expanded={expanded} onToggle={onToggle}/></RailContainer>;
}
