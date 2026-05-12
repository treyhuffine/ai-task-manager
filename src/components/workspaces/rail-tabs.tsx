'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { WorkspaceNav } from './workspace-nav';
import { StatusView } from './status-view';

type RailTab = 'status' | 'workspace';

const STORAGE_KEY = 'flow.rail.tab';
const DEFAULT_TAB: RailTab = 'status';

/**
 * Top-level switcher for the left rail. Two surfaces:
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
 */
export function RailTabs() {
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
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0 px-1 pt-1 pb-1.5 border-b border-border/40">
        <TabButton active={tab === 'status'} onClick={() => select('status')}>
          By status
        </TabButton>
        <TabButton active={tab === 'workspace'} onClick={() => select('workspace')}>
          By workspace
        </TabButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pt-1 pb-4">
        {tab === 'status' ? <StatusView /> : <WorkspaceNav />}
      </div>
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
