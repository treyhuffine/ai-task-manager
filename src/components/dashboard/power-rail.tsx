"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { Rail } from '@/components/workspaces/rail';
import { cn } from '@/lib/utils';

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
  const { railCollapsed, executionRailOpen, toggleRailCollapsed, toggleExecutionRailOpen } = useDashboard();

  // Resolve the "is the rail expanded right now?" question.
  // - compact: driven by executionRailOpen (defaults false → collapsed)
  // - otherwise: driven by railCollapsed (the global pref)
  const expanded = !fixed && (compact ? executionRailOpen : !railCollapsed);
  const onToggle = fixed ? undefined : compact ? toggleExecutionRailOpen : toggleRailCollapsed;

  return (
    <aside
      className={cn(
        'relative flex-shrink-0 border-r border-border flex flex-col bg-background z-30',
        'transition-[width] duration-200 ease-out',
        expanded ? 'w-[256px]' : 'w-[44px]',
      )}
      data-compact={compact || undefined}
      data-expanded={expanded || undefined}
    >
      <Rail expanded={expanded} onToggle={onToggle} />
    </aside>
  );
}
