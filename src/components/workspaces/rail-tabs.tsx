'use client';

import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useDashboard } from '@/contexts/dashboard-context';
import { HOTKEYS } from '@/constants/commands';
import { cn } from '@/lib/utils';
import { WorkspaceNav } from './workspace-nav';
import { StatusView } from './status-view';
import { SkinnyView } from './skinny-view';
import { SessionHoverProvider } from './session-hover-context';
import { SessionHoverPreview } from './session-hover-preview';

type RailTab = 'status' | 'workspace';

const STORAGE_KEY = 'flow.rail.tab';
const DEFAULT_TAB: RailTab = 'status';

/**
 * Top-level switcher for the left rail. Two surfaces in wide mode:
 *
 *   - `status` — sessions bucketed by their derived state
 *                (Needs Approval / Unread / Waiting / Working). Cross-
 *                workspace; the workspace tree is collapsed away.
 *   - `workspace` — the existing folder tree by workspace. Houses the
 *                workspace management actions (create, settings, reorder).
 *
 * Active tab persists per-user in localStorage. Defaults to `status`
 * because that's the higher-leverage daily view; "by workspace" is the
 * tab people drop into when they need to manage workspaces themselves.
 *
 * In skinny mode (`railCollapsed`) the tab UI is hidden but the tab
 * choice is preserved so expanding back doesn't reshuffle the user's
 * view. The skinny renderer uses the tab only as a sort key — see
 * `SkinnyView`.
 */
export function RailTabs() {
  const { railCollapsed, toggleRailCollapsed } = useDashboard();
  const [tab, setTab] = useState<RailTab>(DEFAULT_TAB);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'status' || stored === 'workspace') setTab(stored);
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
        <RailHeader
          collapsed={railCollapsed}
          tab={tab}
          onSelectTab={select}
          onToggle={toggleRailCollapsed}
        />
        <div
          className={cn(
            'flex-1 min-h-0 overflow-y-auto pt-1 pb-4',
            railCollapsed && 'overflow-x-hidden',
          )}
        >
          {railCollapsed ? (
            <SkinnyView tab={tab} />
          ) : tab === 'status' ? (
            <StatusView />
          ) : (
            <WorkspaceNav />
          )}
        </div>
      </div>
      <SessionHoverPreview />
    </SessionHoverProvider>
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
      <TabButton active={tab === 'status'} onClick={() => onSelectTab('status')}>
        By status
      </TabButton>
      <TabButton active={tab === 'workspace'} onClick={() => onSelectTab('workspace')}>
        By workspace
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
