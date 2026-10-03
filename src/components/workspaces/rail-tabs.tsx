'use client';

import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen, Plus, Search, type LucideIcon } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { WorkspaceNav } from './workspace-nav';
import { StatusView } from './status-view';
import { HistoryView } from './history-view';
import { PinnedRail } from './pinned-rail';
import { SkinnyView } from './skinny-view';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';
import { RailFooter } from './rail-footer';
import { RailHome } from './rail-home';
import { openLauncher } from './launcher/launcher-store';
import { openChatSearch } from './chat-search-store';
import { TriggersModal } from '@/components/triggers/triggers-modal';

type RailTab = 'status' | 'workspace' | 'history';

const STORAGE_KEY = 'ri.rail.tab';
const DEFAULT_TAB: RailTab = 'workspace';

/**
 * The left rail, top to bottom:
 *
 *   - **Home** — the orchestrator by name, which is the way home (`RailHome`).
 *   - **Toolbar** — ➕ a new execution in any agent (the launcher, with no
 *     agent picked), search every chat (a modal), and collapse.
 *   - **Tabs** — three lenses on the same work:
 *       - `workspace` — the canonical folder tree by workspace. Houses the
 *                    workspace management actions (create, settings, reorder).
 *       - `status` — active sessions bucketed by their derived state
 *                    (Needs Approval / Unread / Waiting / Working). Cross-
 *                    workspace; the workspace tree is collapsed away.
 *       - `history` — chronological feed of every execution, active AND
 *                    archived, grouped by date with a workspace-pill filter.
 *                    The only tab that surfaces archived sessions.
 *   - **Footer** — what you set up rather than visit: schedules and
 *     triggers, and connecting apps (`RailFooter`).
 *
 * Active tab persists per-user in localStorage. Defaults to `workspace`
 * — the workspace tree is the primary navigation surface; the other
 * two are cross-workspace lenses people switch into.
 *
 * In skinny mode (`railCollapsed`) the tab UI is hidden but the tab
 * choice is preserved so expanding back doesn't reshuffle the user's
 * view. The skinny renderer uses the tab only as a sort key — see
 * `SkinnyView`. Home, the toolbar and schedules fold to icons in the same
 * order, so a button is in the same place in both widths.
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
        <RailHome collapsed={collapsed} />
        <RailToolbar collapsed={collapsed} onToggle={onToggle} />
        {!collapsed && <RailHeader tab={tab} onSelectTab={select} />}
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto pt-1 pb-4',
            collapsed && 'overflow-x-hidden border-t border-border/40',
          )}
        >
          {/* Pinned executions sit above the tab body on every wide tab, so
              the user's kept-close work is one glance away regardless of
              which lens they're in. Hidden in skinny mode (no room).
              Renders nothing when empty. */}
          {!collapsed && <PinnedRail />}
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
        <RailFooter collapsed={collapsed} onOpenSchedules={() => setTriggersOpen(true)} />
      </div>
      <SessionHoverPreview />
      <TriggersModal open={triggersOpen} onClose={() => setTriggersOpen(false)} />
    </SessionHoverProvider>
  );
}

/**
 * Start work, find work, and fold the rail. A row of icons under the home
 * row when the rail is wide, a column of the same icons in the same order
 * when it's skinny.
 *
 * ➕ opens the launcher with no agent picked: you write what you want and
 * pick where it runs, in either order. Starting in a given agent stays on
 * that agent's row and view, which open the launcher on it.
 */
function RailToolbar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const toggleLabel = `${collapsed ? 'Expand rail' : 'Collapse rail'} (${HOTKEYS.toggleRail.label})`;
  const actions = (
    <>
      <RailIconButton
        icon={Plus}
        label="New execution"
        onClick={() => openLauncher({ workspaceId: null })}
      />
      <RailIconButton icon={Search} label="Search chats" onClick={openChatSearch} />
    </>
  );
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 pb-1.5">
        {actions}
        <RailIconButton
          icon={PanelLeftOpen}
          label={toggleLabel}
          ariaLabel="Expand rail"
          onClick={onToggle}
        />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-0.5 px-2 pt-1 pb-1.5">
      {actions}
      <div className="flex-1" />
      <RailIconButton
        icon={PanelLeftClose}
        label={toggleLabel}
        ariaLabel="Collapse rail"
        onClick={onToggle}
      />
    </div>
  );
}

function RailIconButton({
  icon: Icon,
  label,
  ariaLabel,
  onClick,
}: {
  icon: LucideIcon;
  /** Tooltip. Doubles as the accessible name unless `ariaLabel` is set. */
  label: string;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      title={label}
      className="p-1.5 rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Icon size={14} />
    </button>
  );
}

interface RailHeaderProps {
  tab: RailTab;
  onSelectTab: (next: RailTab) => void;
}

/** The tab switcher, in the wide rail only. */
function RailHeader({ tab, onSelectTab }: RailHeaderProps) {
  return (
    <div className="flex items-center gap-0.5 px-1 pt-1 pb-1.5 border-y border-border/40">
      <TabButton active={tab === 'workspace'} onClick={() => onSelectTab('workspace')}>
        Agents
      </TabButton>
      <TabButton active={tab === 'status'} onClick={() => onSelectTab('status')}>
        Status
      </TabButton>
      <TabButton active={tab === 'history'} onClick={() => onSelectTab('history')}>
        History
      </TabButton>
    </div>
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
