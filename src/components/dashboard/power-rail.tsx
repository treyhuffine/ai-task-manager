"use client";

import { useDashboard } from '@/contexts/dashboard-context';
import { RailTabs } from '@/components/workspaces/rail-tabs';
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
   * How the rail renders when `compact` and the user has opened it.
   *
   *   - `push` (default): the open rail occupies layout width and the
   *     sibling content shrinks. Same as the non-execution dashboard.
   *   - `overlay`: the rail keeps its 44px footprint in layout and
   *     overlays a floating panel on top of the sibling content. Used
   *     by execution view variants where we don't want chat width to
   *     change as the user peeks at the rail.
   *
   * Built as a single switch so we can A/B the two without restructuring
   * the dashboard. Default `push` matches existing behavior.
   */
  compactExpandMode?: 'push' | 'overlay';
}

export function PowerRail({ compact = false, compactExpandMode = 'push' }: PowerRailProps) {
  const { railCollapsed, executionRailOpen } = useDashboard();

  // Resolve the "is the rail visually expanded right now?" question.
  // - compact: driven by executionRailOpen (defaults false → skinny)
  // - non-compact: driven by railCollapsed (the global pref)
  const expanded = compact ? executionRailOpen : !railCollapsed;

  // Overlay mode keeps the 44px footprint always, even when expanded.
  const overlay = compact && compactExpandMode === 'overlay';
  const flowWidthExpanded = expanded && !overlay;

  return (
    <aside
      className={cn(
        'relative border-r border-border flex flex-col bg-background z-30',
        'transition-[width] duration-200 ease-out',
        flowWidthExpanded ? 'w-[256px]' : 'w-[44px]',
      )}
      data-compact={compact || undefined}
      data-expanded={expanded || undefined}
    >
      {/* In flow: skinny when collapsed-or-overlay, full when expanded
          and not overlay. The overlay variant always keeps the icon
          strip in flow so the rest of the layout doesn't shift. */}
      {flowWidthExpanded ? (
        <div className="flex h-full w-full flex-col">
          <RailTabs toggleTarget={compact ? 'execution' : 'global'} />
        </div>
      ) : (
        <div className="flex h-full w-[44px] flex-col">
          <RailTabs forceCollapsed toggleTarget={compact ? 'execution' : 'global'} />
        </div>
      )}

      {/* Overlay panel. Renders on top of the 44px strip when the user
          has opened the rail in overlay mode. */}
      {overlay && expanded && (
        <div className="absolute inset-y-0 left-0 z-40 flex w-[256px] flex-col border-r border-border bg-background shadow-xl">
          <RailTabs toggleTarget="execution" />
        </div>
      )}
    </aside>
  );
}
