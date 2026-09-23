'use client';

import { GitBranch, PanelRightClose, PanelRightOpen, Play } from 'lucide-react';
import { useAgentExecutions } from '@/hooks/use-agent';
import { openLauncher } from '@/components/workspaces/launcher/launcher-store';
import type { WorkspaceRecord } from '@/db/types';
import { cn } from '@/lib/utils';
import { AgentIcon } from './agent-icon';

/** Home-relative display of an absolute path, the way a shell prompt shows it. */
function displayPath(path: string): string {
  const home = path.match(/^\/(?:Users|home)\/[^/]+/)?.[0];
  return home ? `~${path.slice(home.length)}` : path;
}

/**
 * The agent view's header: who the agent is, where it lives, how much of
 * its work is running or waiting on you, and the way to start more.
 */
export function AgentHeader({
  workspace,
  toolsCollapsed,
  onToggleTools,
}: {
  workspace: WorkspaceRecord;
  toolsCollapsed: boolean;
  onToggleTools: () => void;
}) {
  const { working, needsYou } = useAgentExecutions(workspace.id);
  const archived = workspace.status === 'archived';

  return (
    <header className="@container flex-shrink-0 flex items-center gap-3 border-b border-border px-4 py-2 min-w-0">
      <AgentIcon workspace={workspace} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="truncate text-[13px] font-semibold text-foreground">{workspace.name}</h1>
          {archived && (
            <span className="flex-shrink-0 rounded border border-border px-1.5 py-px text-[9.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Archived
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 min-w-0 text-[10.5px] text-muted-foreground/75">
          {workspace.isGit && <GitBranch size={10} className="flex-shrink-0" aria-label="Git repository" />}
          <span className="truncate font-mono" title={workspace.cwd}>
            {displayPath(workspace.cwd)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <CountPill count={working.length} label="working" tone="working" />
        <CountPill count={needsYou.length} label="need you" singular="needs you" tone="attention" />
      </div>

      {!archived && (
        <button
          onClick={() => openLauncher(workspace.id)}
          className="flex flex-shrink-0 items-center gap-1.5 h-7 px-2.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
          title={`Start new work in ${workspace.name}`}
        >
          <Play size={11} className="fill-current" />
          <span className="hidden @[520px]:inline">Start work</span>
        </button>
      )}
      <button
        onClick={onToggleTools}
        className="flex-shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        aria-label={toolsCollapsed ? 'Show tools' : 'Hide tools'}
        title={toolsCollapsed ? 'Show tools' : 'Hide tools'}
      >
        {toolsCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
      </button>
    </header>
  );
}

function CountPill({
  count,
  label,
  singular,
  tone,
}: {
  count: number;
  label: string;
  singular?: string;
  tone: 'working' | 'attention';
}) {
  if (count === 0) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium',
        tone === 'working'
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
      )}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          tone === 'working' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500',
        )}
      />
      {count} {count === 1 && singular ? singular : label}
    </span>
  );
}
