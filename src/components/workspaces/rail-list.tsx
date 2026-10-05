'use client';

import type { ReactNode } from 'react';
import type { RailTab } from '@/lib/client/rail-tab';
import { cn } from '@/lib/utils';
import { WorkspaceNav } from './workspace-nav';
import { HistoryView } from './history-view';
import { PinnedRail } from './pinned-rail';

/**
 * The rail's list of work, shared by the wide rail and the collapsed rail's
 * Agents flyout. Two tabs, the same work two ways:
 *
 *   - **Agents** (`workspace`): the agent tree, each agent with its
 *     executions. Houses the agent actions (create, setup, reorder, archive).
 *   - **Recent** (`history`): every execution, newest first in date groups,
 *     with an agent filter. The only list that shows archived work.
 *
 * Work by status lives in the header's pills, from every view, so the rail
 * doesn't repeat it.
 */
export function RailTabSwitch({ tab, onSelect }: { tab: RailTab; onSelect: (next: RailTab) => void }) {
  return (
    <div role="tablist" aria-label="Rail list" className="flex items-center gap-0.5 px-1 pt-1 pb-1.5 border-y border-border/40">
      <TabButton active={tab === 'workspace'} onClick={() => onSelect('workspace')}>
        Agents
      </TabButton>
      <TabButton active={tab === 'history'} onClick={() => onSelect('history')}>
        Recent
      </TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex-1 px-2 py-1.5 rounded-md text-[10px] font-medium uppercase tracking-[0.1em] transition-colors',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        active
          ? 'text-foreground bg-muted/60'
          : 'text-muted-foreground/70 hover:text-foreground hover:bg-muted/30',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Pinned executions, then the chosen list. Pins sit above both tabs, so the
 * work you keep close is one glance away whichever list is open. Renders
 * nothing for pins when there are none.
 */
export function RailListBody({ tab }: { tab: RailTab }) {
  return (
    <div className="pt-1">
      <PinnedRail />
      {tab === 'history' ? <HistoryView /> : <WorkspaceNav />}
    </div>
  );
}
