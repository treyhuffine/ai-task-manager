'use client';

import { useEffect, useState } from 'react';
import { Clock, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { WorkspaceNav } from './workspace-nav';
import { StatusView } from './status-view';
import { HistoryView } from './history-view';
import { SkinnyView } from './skinny-view';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';
import { RailFooter } from './rail-footer';
import { TriggersModal } from '@/components/triggers/triggers-modal';
import { useRunsStats } from '@/hooks/use-runs-stats';

type RailTab = 'status' | 'workspace' | 'history';

const STORAGE_KEY = 'flow.rail.tab';
const DEFAULT_TAB: RailTab = 'workspace';

/**
 * Top-level switcher for the left rail. Three surfaces in wide mode:
 *
 *   - `workspace` — the canonical folder tree by workspace. Houses the
 *                workspace management actions (create, settings, reorder).
 *   - `status` — active sessions bucketed by their derived state
 *                (Needs Approval / Unread / Waiting / Working). Cross-
 *                workspace; the workspace tree is collapsed away.
 *   - `history` — chronological feed of every execution, active AND
 *                archived, grouped by date with a search input and
 *                workspace-pill filter. The only tab that surfaces
 *                archived sessions; the only tab with its own search.
 *
 * Active tab persists per-user in localStorage. Defaults to `workspace`
 * — the workspace tree is the primary navigation surface; the other
 * two are cross-workspace lenses people switch into.
 *
 * In skinny mode (`railCollapsed`) the tab UI is hidden but the tab
 * choice is preserved so expanding back doesn't reshuffle the user's
 * view. The skinny renderer uses the tab only as a sort key — see
 * `SkinnyView`.
 */
interface RailTabsProps {
  /**
   * When truthy, render the skinny-icon variant regardless of the
   * user's `railCollapsed` preference. Set by `PowerRail` when the
   * execution view is active and the rail is in its compact state.
   */
  forceCollapsed?: boolean;
  /**
   * Which state the toggle button mutates. `'global'` flips
   * `railCollapsed` (the across-app preference); `'execution'` flips
   * `executionRailOpen` (the execution-view-local override). PowerRail
   * passes `'execution'` when in compact mode so the button stays in
   * sync with ⌘\ semantics.
   */
  toggleTarget?: 'global' | 'execution';
}

export function RailTabs({ forceCollapsed, toggleTarget = 'global' }: RailTabsProps = {}) {
  const {
    railCollapsed,
    toggleRailCollapsed,
    toggleExecutionRailOpen,
  } = useDashboard();
  const [tab, setTab] = useState<RailTab>(DEFAULT_TAB);
  const [triggersOpen, setTriggersOpen] = useState(false);
  const collapsed = !!forceCollapsed || railCollapsed;
  const onToggle =
    toggleTarget === 'execution' ? toggleExecutionRailOpen : toggleRailCollapsed;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'status' || stored === 'workspace' || stored === 'history') {
      setTab(stored);
    }
  }, []);

  const select = (next: RailTab) => {
    setTab(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
    }
  };

  return (
    <SessionHoverProvider>
      <div className="flex flex-col h-full">
        <TriggersButton
          collapsed={collapsed}
          onClick={() => setTriggersOpen(true)}
        />
        <RailHeader
          collapsed={collapsed}
          tab={tab}
          onSelectTab={select}
          onToggle={onToggle}
        />
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto pt-1 pb-4',
            collapsed && 'overflow-x-hidden',
          )}
        >
          {collapsed ? (
            <SkinnyView tab={tab} />
          ) : tab === 'status' ? (
            <StatusView />
          ) : tab === 'history' ? (
            <HistoryView />
          ) : (
            <WorkspaceNav />
          )}
        </div>
        {!collapsed && <RailFooter />}
      </div>
      <SessionHoverPreview />
      <TriggersModal open={triggersOpen} onClose={() => setTriggersOpen(false)} />
    </SessionHoverProvider>
  );
}

/**
 * Prominent button at the top of the rail. Two modes:
 *   - expanded: full-width "Triggers and Triggers" pill with the clock icon
 *   - collapsed (skinny rail): icon-only button centered
 * Both open the TriggersModal — same surface, same affordance.
 */
function TriggersButton({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  const { data } = useRunsStats();
  const activeRuns = data?.activeRuns ?? 0;

  if (collapsed) {
    return (
      <div className="flex items-center justify-center pt-2 pb-1 border-b border-border/40">
        <button
          type="button"
          onClick={onClick}
          aria-label={
            activeRuns > 0
              ? `Open triggers and triggers: ${activeRuns} run${activeRuns === 1 ? '' : 's'} active`
              : 'Open triggers and triggers'
          }
          title={activeRuns > 0 ? `${activeRuns} active` : 'Triggers and Triggers'}
          className="relative p-1.5 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <Clock size={14} />
          {activeRuns > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-blue-500"
              aria-hidden
            />
          )}
        </button>
      </div>
    );
  }
  return (
    <div className="px-2 pt-2 pb-1 border-b border-border/40">
      <button
        type="button"
        onClick={onClick}
        className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 transition-all active:scale-95"
      >
        <Clock size={12} className="text-primary-foreground" />
        <span>Triggers and Triggers</span>
        {activeRuns > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary-foreground/15 text-primary-foreground text-[10px] tabular-nums">
            <span className="size-1.5 rounded-full bg-primary-foreground" />
            {activeRuns}
          </span>
        )}
      </button>
    </div>
  );
}

interface RailHeaderProps {
  collapsed: boolean;
  tab: RailTab;
  onSelectTab: (next: RailTab) => void;
  onToggle: () => void;
}

/**
 * Top section of the rail. In wide mode it carries the tab switcher
 * with the collapse button on the right; in skinny mode it's just the
 * expand button so the workspace icons get the rest of the vertical
 * space. The collapse/expand affordance always lives in the same spot
 * so muscle memory works in both modes.
 */
function RailHeader({ collapsed, tab, onSelectTab, onToggle }: RailHeaderProps) {
  if (collapsed) {
    return (
      <div className="flex items-center justify-center pt-1 pb-1.5 border-b border-border/40">
        <ToggleButton collapsed={collapsed} onToggle={onToggle} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5 px-1 pt-1 pb-1.5 border-b border-border/40">
      <TabButton active={tab === 'workspace'} onClick={() => onSelectTab('workspace')}>
        Workspace
      </TabButton>
      <TabButton active={tab === 'status'} onClick={() => onSelectTab('status')}>
        Status
      </TabButton>
      <TabButton active={tab === 'history'} onClick={() => onSelectTab('history')}>
        History
      </TabButton>
      <ToggleButton collapsed={collapsed} onToggle={onToggle} />
    </div>
  );
}

function ToggleButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      onClick={onToggle}
      aria-label={collapsed ? 'Expand rail' : 'Collapse rail'}
      title={`${collapsed ? 'Expand rail' : 'Collapse rail'} (${HOTKEYS.toggleRail.label})`}
      className="p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-muted/50 transition-colors"
    >
      <Icon size={14} />
    </button>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex-1 px-2 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] transition-colors',
        active
          ? 'text-foreground bg-muted/60'
          : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/30',
      )}
    >
      {children}
    </button>
  );
}
