'use client';

import { useState, type ReactNode } from 'react';
import { AppWindow, FolderTree, LayoutGrid, Settings2, SquareTerminal } from 'lucide-react';
import type { WorkspaceRecord } from '@/db/types';
import type { AgentTab } from '@/types/dashboard';
import { cn } from '@/lib/utils';
import { AgentOverview } from './agent-overview';
import { AgentFiles } from './agent-files';
import { AgentTerminal } from './agent-terminal';
import { AgentPreview } from './agent-preview';
import { AgentSetup } from './agent-setup';

const TABS: ReadonlyArray<{ id: AgentTab; label: string; icon: ReactNode }> = [
  { id: 'overview', label: 'Overview', icon: <LayoutGrid size={12} /> },
  { id: 'files', label: 'Files', icon: <FolderTree size={12} /> },
  { id: 'terminal', label: 'Terminal', icon: <SquareTerminal size={12} /> },
  { id: 'preview', label: 'Preview', icon: <AppWindow size={12} /> },
  { id: 'setup', label: 'Setup', icon: <Settings2 size={12} /> },
];

/**
 * The agent view's tools panel. A tab stays mounted once visited, so a
 * terminal keeps its scrollback and the file tree its expanded folders when
 * the user flips between tabs. Keyed by agent in `AgentView`, so moving to
 * another agent starts fresh.
 */
export function AgentTools({
  workspace,
  tab,
  onSelectTab,
}: {
  workspace: WorkspaceRecord;
  tab: AgentTab;
  onSelectTab: (tab: AgentTab) => void;
}) {
  // Every tab the user has opened in this agent, the current one included.
  // Derived during render, so a tab that arrives through the URL mounts
  // straight away.
  const [visited, setVisited] = useState<ReadonlySet<AgentTab>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));

  const body = (id: AgentTab): ReactNode => {
    switch (id) {
      case 'overview':
        return <AgentOverview workspace={workspace} onSelectTab={onSelectTab} />;
      case 'files':
        return <AgentFiles workspace={workspace} />;
      case 'terminal':
        return <AgentTerminal workspace={workspace} />;
      case 'preview':
        return <AgentPreview workspace={workspace} active={tab === 'preview'} onOpenSetup={() => onSelectTab('setup')} />;
      case 'setup':
        return <AgentSetup workspace={workspace} />;
    }
  };

  return (
    <div className="@container flex flex-col h-full min-h-0">
      <div role="tablist" aria-label="Agent tools" className="shrink-0 flex items-center gap-0.5 border-b border-border px-2 py-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onSelectTab(t.id)}
            title={t.label}
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap',
              tab === t.id
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
            )}
          >
            {t.icon}
            <span className="hidden @[380px]:inline">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 relative">
        {TABS.filter((t) => visited.has(t.id)).map((t) => (
          // Inactive tabs stay laid out (so a terminal keeps its size) but
          // are transparent and inert. Not `visibility: hidden`, which a
          // descendant that sets `visibility: visible` (the terminal panel
          // does) would override and paint through the tab on screen.
          <div
            key={t.id}
            role="tabpanel"
            inert={tab !== t.id}
            className={cn('absolute inset-0 flex flex-col min-h-0', tab === t.id ? 'z-10' : 'opacity-0')}
          >
            {body(t.id)}
          </div>
        ))}
      </div>
    </div>
  );
}
